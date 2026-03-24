import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { BIN, ROOT, randomPort } from "./constants";
import { TestBridge } from "./bridge";
import { deserializeBridgeValue, TargetClosedError, TimeoutError } from "./internals";
import { RUNTIME_BOOTSTRAP } from "./runtime";
import type {
  HandleMeta,
  PropertyHandleEntry,
  SerializedArgument,
  Snapshot,
} from "./types";

interface ControllerOptions {
  appPort?: number;
}

interface WaitForSelectorHidden {
  hidden: true;
}

interface BrowserLogEntry {
  type?: string;
  message?: string;
  timestamp?: number;
}

interface ProcessLogEntry {
  stream: "stdout" | "stderr";
  line: string;
  category: "process" | "js-log" | "js-error";
}

function isHiddenWaitResult(value: unknown): value is WaitForSelectorHidden {
  return !!value && typeof value === "object" && "hidden" in value;
}

function titleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1] : "";
}

export class ProxyAppController {
  readonly appPort: number;
  private app: any = null;
  private bridge: TestBridge | null = null;
  private stopped = false;
  private appExitInfo: { code: number | null; signal: string | null } | null = null;
  private processLogs: ProcessLogEntry[] = [];
  private processLogBuffers: Record<"stdout" | "stderr", string> = {
    stdout: "",
    stderr: "",
  };
  private lastSnapshot: Snapshot = {
    url: "wry://index.html",
    title: "",
    viewportSize: { width: 0, height: 0 },
  };

  constructor({ appPort = randomPort() }: ControllerOptions = {}) {
    this.appPort = appPort;
  }

  get snapshotState(): Snapshot {
    return this.lastSnapshot;
  }

  async start(): Promise<void> {
    if (process.env.DEBUG) {
      console.error(`[controller] start appPort=${this.appPort}`);
    }
    this.stopped = false;
    this.appExitInfo = null;
    this.processLogs = [];
    this.processLogBuffers = { stdout: "", stderr: "" };
    this.app = spawn(BIN, ["--test-port", String(this.appPort)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.app.once("exit", (code: number | null, signal: string | null) => {
      this.appExitInfo = { code, signal };
    });
    this.app.stdout?.setEncoding("utf-8");
    this.app.stderr?.setEncoding("utf-8");
    this.app.stdout?.on("data", (chunk: string) => this.recordProcessOutput("stdout", chunk));
    this.app.stderr?.on("data", (chunk: string) => this.recordProcessOutput("stderr", chunk));
    this.bridge = new TestBridge(this.appPort);
    try {
      if (process.env.DEBUG) {
        console.error("[controller] connecting TCP bridge");
      }
      await this.bridge.connect();
      if (process.env.DEBUG) {
        console.error("[controller] TCP bridge connected");
      }
    } catch (error) {
      throw await this.decorateStartupError(error);
    }
    if (process.env.DEBUG) {
      console.error("[controller] waiting for app ready");
    }
    await this.waitForAppReady();
    if (process.env.DEBUG) {
      console.error("[controller] app ready");
    }
  }

  async close(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    await this.shutdownApp();
  }

  async restart(): Promise<void> {
    await this.shutdownApp();
    await this.start();
  }

  private async shutdownApp(): Promise<void> {
    this.bridge?.close();
    this.bridge = null;

    if (!this.app) {
      return;
    }

    const waitForExit = () =>
      new Promise<boolean>((resolve) => {
        this.app.once("exit", () => resolve(true));
      });

    this.app.kill("SIGTERM");
    const exitedGracefully = await Promise.race([waitForExit(), sleep(2_000).then(() => false)]);
    if (!exitedGracefully) {
      this.app.kill("SIGKILL");
      await Promise.race([waitForExit(), sleep(1_000).then(() => false)]);
    }
    this.app = null;
  }

  private recordProcessOutput(stream: "stdout" | "stderr", chunk: string): void {
    if (process.env.DEBUG) {
      if (stream === "stdout") {
        process.stdout.write(chunk);
      } else {
        process.stderr.write(chunk);
      }
    }

    const text = this.processLogBuffers[stream] + chunk;
    const lines = text.split(/\r?\n/);
    this.processLogBuffers[stream] = lines.pop() ?? "";

    for (const line of lines) {
      this.recordProcessLine(stream, line);
    }
  }

  private flushProcessLogBuffers(): void {
    for (const stream of ["stdout", "stderr"] as const) {
      const pending = this.processLogBuffers[stream].trim();
      if (!pending) {
        continue;
      }
      this.recordProcessLine(stream, pending);
      this.processLogBuffers[stream] = "";
    }
  }

  private recordProcessLine(stream: "stdout" | "stderr", line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const entry: ProcessLogEntry = {
      stream,
      line: trimmed,
      category: this.classifyProcessLine(trimmed),
    };
    this.processLogs.push(entry);
    if (this.processLogs.length > 200) {
      this.processLogs.shift();
    }

    if (!process.env.DEBUG && entry.category === "js-error") {
      process.stderr.write(`[wry-js] ${trimmed}\n`);
    }
  }

  private classifyProcessLine(line: string): ProcessLogEntry["category"] {
    if (line.startsWith("[ERROR IN JS CONSOLE]") || line.startsWith("[JS] ERROR:")) {
      return "js-error";
    }
    if (line.startsWith("[JS]")) {
      return "js-log";
    }
    return "process";
  }

  async evalValue(script: string): Promise<any> {
    if (!this.bridge) {
      throw new TargetClosedError("Embedded app bridge is not connected");
    }

    let raw: string;
    try {
      raw = String(await this.bridge.eval(script));
    } catch (error) {
      throw await this.decorateRuntimeError(error);
    }
    const value = deserializeBridgeValue(JSON.parse(String(raw)));
    const bridgeError =
      value && typeof value === "object"
        ? (value as { __error?: string; __stack?: string })
        : null;
    if (bridgeError?.__error) {
      const error = new Error(bridgeError.__error);
      error.stack = bridgeError.__stack || error.stack;
      throw await this.decorateRuntimeError(error);
    }

    return value;
  }

  async waitFor<T>(
    predicate: () => Promise<T>,
    timeoutMs = 5_000,
    intervalMs = 50
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
      try {
        const value = await predicate();
        if (value) {
          return value;
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(intervalMs);
    }

    if (lastError) {
      throw lastError;
    }

    throw new TimeoutError(`Timed out after ${timeoutMs}ms`);
  }

  async waitForAppReady(): Promise<void> {
    try {
      await this.waitFor(async () => {
        const header = await this.evalValue(
          `document.querySelector("h1")?.textContent ?? null`
        );
        if (process.env.DEBUG) {
          console.error(`[controller] ready probe h1=${JSON.stringify(header)}`);
        }
        return header === "dioxus-react";
      }, 15_000);
    } catch (error) {
      throw await this.decorateStartupError(error);
    }
    await this.ensureRuntime();
    await this.snapshot();
  }

  private async safeEvalValue(script: string): Promise<unknown> {
    try {
      return await this.evalValue(script);
    } catch {
      return null;
    }
  }

  private async getBrowserLogs(): Promise<BrowserLogEntry[]> {
    const logs = await this.safeEvalValue("window.__testBridgeLogs ?? []");
    return Array.isArray(logs) ? (logs as BrowserLogEntry[]) : [];
  }

  private async decorateStartupError(error: unknown): Promise<Error> {
    const base =
      error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error));
    const diagnostics: string[] = [];
    this.flushProcessLogBuffers();

    const [readyState, rootText, logs] = await Promise.all([
      this.safeEvalValue("document.readyState"),
      this.safeEvalValue(`document.getElementById("root")?.textContent ?? null`),
      this.getBrowserLogs(),
    ]);

    if (typeof readyState === "string" && readyState) {
      diagnostics.push(`document.readyState: ${readyState}`);
    }

    if (typeof rootText === "string" && rootText.trim()) {
      diagnostics.push(`root text: ${rootText}`);
    }

    if (logs.length > 0) {
      diagnostics.push("browser logs:");
      for (const entry of logs.slice(-20)) {
        const type = entry.type ?? "log";
        const message = entry.message ?? "";
        diagnostics.push(`[${type}] ${message}`);
      }
    }

    if (this.appExitInfo) {
      diagnostics.push(
        `app exit: code=${this.appExitInfo.code ?? "null"} signal=${this.appExitInfo.signal ?? "null"}`
      );
    }

    const jsErrorLines = this.processLogs
      .filter((entry) => entry.category === "js-error")
      .slice(-20)
      .map((entry) => entry.line);
    if (jsErrorLines.length > 0) {
      diagnostics.push("native js console errors:");
      diagnostics.push(...jsErrorLines);
    }

    if (this.processLogs.length > 0) {
      diagnostics.push("app process logs:");
      diagnostics.push(
        ...this.processLogs.slice(-40).map((entry) => `[app:${entry.stream}] ${entry.line}`)
      );
    }

    if (diagnostics.length > 0) {
      base.message = `${base.message}\n${diagnostics.join("\n")}`;
    }

    return base;
  }

  private async decorateRuntimeError(error: unknown): Promise<Error> {
    const base =
      error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error));
    this.flushProcessLogBuffers();

    const diagnostics: string[] = [];
    const browserLogs = await this.getBrowserLogs();
    const jsErrorLines = this.processLogs
      .filter((entry) => entry.category === "js-error")
      .slice(-10)
      .map((entry) => entry.line);

    if (jsErrorLines.length > 0) {
      diagnostics.push("native js console errors:");
      diagnostics.push(...jsErrorLines);
    }

    const recentBrowserErrors = browserLogs
      .filter((entry) => entry.type === "error")
      .slice(-10)
      .map((entry) => `[${entry.type}] ${entry.message ?? ""}`);
    if (recentBrowserErrors.length > 0) {
      diagnostics.push("browser error logs:");
      diagnostics.push(...recentBrowserErrors);
    }

    if (diagnostics.length > 0) {
      base.message = `${base.message}\n${diagnostics.join("\n")}`;
    }

    return base;
  }

  async ensureRuntime(): Promise<void> {
    await this.evalValue(RUNTIME_BOOTSTRAP);
  }

  async runtimeCall(method: string, payload: Record<string, unknown> = {}): Promise<any> {
    await this.ensureRuntime();
    return await this.evalValue(`(() => {
      const payload = ${JSON.stringify(payload)};
      return window.__pwProxy[${JSON.stringify(method)}](payload);
    })()`);
  }

  private handleIds(handles: Array<{ handleId: number }> = []): number[] {
    return handles.map((handle) => handle.handleId);
  }

  private payloadFromArg(arg: SerializedArgument): {
    argValue: unknown;
    handleIds: number[];
  } {
    return {
      argValue: arg.value,
      handleIds: this.handleIds(arg.handles),
    };
  }

  async snapshot(): Promise<Snapshot> {
    const url = await this.evalValue("location.href");
    const title = await this.evalValue("document.title");
    const viewportSize = await this.evalValue(
      "({ width: window.innerWidth, height: window.innerHeight })"
    );

    this.lastSnapshot = { url, title, viewportSize };
    return this.lastSnapshot;
  }

  async evaluateExpression(
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument
  ): Promise<unknown> {
    return await this.runtimeCall("evaluate", {
      expression,
      isFunction,
      ...this.payloadFromArg(arg),
    });
  }

  async evaluateExpressionHandle(
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument
  ): Promise<HandleMeta> {
    return await this.runtimeCall("evaluateHandle", {
      expression,
      isFunction,
      ...this.payloadFromArg(arg),
    });
  }

  async evaluateOnHandle(
    handleId: number,
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument
  ): Promise<unknown> {
    return await this.runtimeCall("evaluateOnHandle", {
      handleId,
      expression,
      isFunction,
      ...this.payloadFromArg(arg),
    });
  }

  async evaluateHandleOnHandle(
    handleId: number,
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument
  ): Promise<HandleMeta> {
    return await this.runtimeCall("evaluateHandleOnHandle", {
      handleId,
      expression,
      isFunction,
      ...this.payloadFromArg(arg),
    });
  }

  async waitForFunction(
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument,
    timeout?: number,
    pollingInterval?: number
  ): Promise<HandleMeta> {
    const deadline = timeout ? Date.now() + timeout : Infinity;
    const intervalMs = pollingInterval ?? 16;

    while (Date.now() < deadline) {
      const result = await this.runtimeCall("waitForFunctionStep", {
        expression,
        isFunction,
        ...this.payloadFromArg(arg),
      });

      if (result) {
        return result;
      }
      await sleep(intervalMs);
    }

    throw new TimeoutError(`Timeout ${timeout}ms exceeded`);
  }

  async querySelector(
    selector: string,
    rootHandleId: number | null,
    strict?: boolean
  ): Promise<HandleMeta | null> {
    return await this.runtimeCall("querySelector", { selector, rootHandleId, strict: !!strict });
  }

  async querySelectorAll(
    selector: string,
    rootHandleId: number | null
  ): Promise<HandleMeta[]> {
    return await this.runtimeCall("querySelectorAll", { selector, rootHandleId });
  }

  async waitForSelector(
    selector: string,
    rootHandleId: number | null,
    state?: string,
    timeout?: number,
    strict?: boolean
  ): Promise<HandleMeta | null> {
    const deadline = timeout ? Date.now() + timeout : Date.now() + 30_000;

    while (Date.now() < deadline) {
      const result = await this.runtimeCall("waitForSelectorStep", {
        selector,
        rootHandleId,
        state,
        strict: !!strict,
      });

      if (result) {
        return isHiddenWaitResult(result) ? null : result;
      }
      await sleep(50);
    }

    throw new TimeoutError(`Timeout ${timeout}ms exceeded`);
  }

  async evalOnSelector(
    selector: string,
    rootHandleId: number | null,
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument,
    strict?: boolean
  ): Promise<unknown> {
    return await this.runtimeCall("evalOnSelector", {
      selector,
      rootHandleId,
      strict: !!strict,
      expression,
      isFunction,
      ...this.payloadFromArg(arg),
    });
  }

  async evalOnSelectorAll(
    selector: string,
    rootHandleId: number | null,
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument
  ): Promise<unknown> {
    return await this.runtimeCall("evalOnSelectorAll", {
      selector,
      rootHandleId,
      expression,
      isFunction,
      ...this.payloadFromArg(arg),
    });
  }

  async handleJsonValue(handleId: number): Promise<unknown> {
    return await this.runtimeCall("jsonValue", { handleId });
  }

  async disposeHandle(handleId: number): Promise<void> {
    await this.runtimeCall("disposeHandle", { handleId });
  }

  async getHandleProperty(handleId: number, name: string): Promise<HandleMeta> {
    return await this.runtimeCall("getProperty", { handleId, name });
  }

  async getHandleProperties(handleId: number): Promise<PropertyHandleEntry[]> {
    return await this.runtimeCall("getPropertyList", { handleId });
  }

  async textContent(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<string | null> {
    return await this.runtimeCall("textContent", {
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async innerText(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<string> {
    return await this.runtimeCall("innerText", {
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async innerHTML(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<string> {
    return await this.runtimeCall("innerHTML", {
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async getAttribute(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    name: string,
    strict?: boolean
  ): Promise<string | null> {
    return await this.runtimeCall("getAttribute", {
      selector,
      rootHandleId,
      handleId,
      name,
      strict: !!strict,
    });
  }

  async inputValue(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<string> {
    return await this.runtimeCall("inputValue", {
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async queryCount(selector: string, rootHandleId: number | null): Promise<number> {
    return await this.runtimeCall("queryCount", { selector, rootHandleId });
  }

  async resolveSelector(selector: string, rootHandleId: number | null): Promise<string> {
    const result = await this.runtimeCall("resolveSelector", { selector, rootHandleId });
    return result.resolvedSelector;
  }

  async highlight(selector: string, rootHandleId: number | null): Promise<void> {
    await this.runtimeCall("highlight", { selector, rootHandleId });
  }

  async content(): Promise<string> {
    return await this.runtimeCall("content");
  }

  async setTestIdAttributeName(testIdAttributeName: string): Promise<void> {
    await this.runtimeCall("setTestIdAttributeName", { testIdAttributeName });
  }

  async setContent(html: string): Promise<void> {
    await this.ensureRuntime();
    await this.runtimeCall("resetHandles");
    await this.evalValue(`(() => {
      const html = ${JSON.stringify(html)};
      const hasDocumentMarkup = /<!doctype|<html|<head|<body/i.test(html);
      if (hasDocumentMarkup) {
        const nextDocument = new DOMParser().parseFromString(html, "text/html");
        document.head.innerHTML = nextDocument.head.innerHTML;
        document.body.innerHTML = nextDocument.body.innerHTML;
        document.title = nextDocument.title;
      } else {
        document.body.innerHTML = html;
        document.title = "";
      }
      return null;
    })()`);
    await this.ensureRuntime();
    this.lastSnapshot = {
      ...this.lastSnapshot,
      title: titleFromHtml(html),
    };
  }

  async title(): Promise<string> {
    return await this.runtimeCall("title");
  }

  async focus(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("focus", { selector, rootHandleId, handleId, strict: !!strict });
  }

  async blur(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("blur", { selector, rootHandleId, handleId, strict: !!strict });
  }

  async click(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("click", { selector, rootHandleId, handleId, strict: !!strict });
  }

  async dblclick(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("dblclick", { selector, rootHandleId, handleId, strict: !!strict });
  }

  async hover(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("hover", { selector, rootHandleId, handleId, strict: !!strict });
  }

  async tap(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("click", { selector, rootHandleId, handleId, strict: !!strict });
  }

  async scrollIntoViewIfNeeded(handleId: number): Promise<void> {
    await this.runtimeCall("scrollIntoViewIfNeeded", { handleId });
  }

  async dispatchEvent(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    type: string,
    eventInit: SerializedArgument,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("dispatchEvent", {
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
      type,
      eventInitValue: eventInit.value,
      handleIds: this.handleIds(eventInit.handles),
    });
  }

  async fill(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    value: string,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("fill", { selector, rootHandleId, handleId, value, strict: !!strict });
  }

  async type(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    text: string,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("type", { selector, rootHandleId, handleId, text, strict: !!strict });
  }

  async press(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    key: string,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall("press", { selector, rootHandleId, handleId, key, strict: !!strict });
  }

  async setChecked(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    checked: boolean,
    trial?: boolean,
    strict?: boolean
  ): Promise<boolean> {
    return await this.runtimeCall("check", {
      selector,
      rootHandleId,
      handleId,
      checked,
      trial: !!trial,
      strict: !!strict,
    });
  }

  async selectOption(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    options: unknown[],
    elements: Array<{ handleId: number }>,
    strict?: boolean
  ): Promise<string[]> {
    return await this.runtimeCall("selectOption", {
      selector,
      rootHandleId,
      handleId,
      options,
      optionHandleIds: this.handleIds(elements),
      strict: !!strict,
    });
  }

  async boolState(
    method: string,
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean
  ): Promise<boolean> {
    return await this.runtimeCall(method, {
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async reload(): Promise<void> {
    await this.restart();
  }

  async goto(url: string): Promise<void> {
    await this.evalValue(
      `setTimeout(() => { location.href = ${JSON.stringify(url)}; }, 0); null`
    );
    await this.waitForAppReady();
  }
}
