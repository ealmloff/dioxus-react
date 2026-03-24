import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { BIN, ROOT, randomPort } from "./constants";
import { TestBridge } from "./bridge";
import {
  deserializeBridgeValue,
  serializeProtocolValue,
  TargetClosedError,
  TimeoutError,
} from "./internals";
import { RUNTIME_BOOTSTRAP } from "./runtime";
import {
  CompatBrowserContext,
  CompatElementHandle,
  type CompatFrame,
  type CompatJSHandle,
  type CompatPage,
} from "./compat";
import type {
  ControllerEvent,
  FrameMeta,
  HandleMeta,
  PropertyHandleEntry,
  RuntimeConsoleRecord,
  SerializedArgument,
  SerializedErrorValue,
  Snapshot,
} from "./types";

interface ControllerOptions {
  appPort?: number;
}

interface ExpectOptions {
  timeout?: number;
  selector?: string;
  expression?: string;
  isNot?: boolean;
  expectedValue?: SerializedArgument;
  [key: string]: unknown;
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

function titleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1] : "";
}

function isRuntimeHandleReference(value: unknown): value is { __pwRuntimeHandleId: number } {
  return (
    !!value &&
    typeof value === "object" &&
    "__pwRuntimeHandleId" in value &&
    typeof (value as { __pwRuntimeHandleId?: unknown }).__pwRuntimeHandleId === "number"
  );
}

function normalizeBinaryPayload(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value.map((entry) => (typeof entry === "number" ? entry : 0)));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const data = record.type === "Buffer" ? record.data : record.data;
    if (Array.isArray(data)) {
      return Uint8Array.from(data.map((entry) => (typeof entry === "number" ? entry : 0)));
    }
    const numericKeys = Object.keys(record)
      .filter((key) => /^\d+$/.test(key))
      .map((key) => Number(key))
      .sort((left, right) => left - right);
    if (numericKeys.length > 0) {
      return Uint8Array.from(
        numericKeys.map((key) => {
          const next = record[String(key)];
          return typeof next === "number" ? next : 0;
        })
      );
    }
    if (typeof record.length === "number") {
      const length = Math.max(0, Math.floor(record.length));
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        const next = record[String(index)];
        bytes[index] = typeof next === "number" ? next : 0;
      }
      return bytes;
    }
  }
  const objectKeys =
    value && typeof value === "object" ? Object.keys(value as Record<string, unknown>).join(",") : "";
  throw new Error(
    `Expected binary screenshot payload (type=${typeof value}, keys=${objectKeys || "(none)"})`
  );
}

function normalizeStringArrayPayload(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const numericKeys = Object.keys(record)
      .filter((key) => /^\d+$/.test(key))
      .map((key) => Number(key))
      .sort((left, right) => left - right);
    if (numericKeys.length > 0) {
      return numericKeys.map((key) => String(record[String(key)] ?? ""));
    }
  }
  throw new Error(`Expected string array payload, got ${typeof value}`);
}

export class ProxyAppController {
  readonly mainFrameId = 1;
  readonly appPort: number;
  private app: ReturnType<typeof spawn> | null = null;
  private bridge: TestBridge | null = null;
  private bridgeCallQueue: Promise<void> = Promise.resolve();
  private runtimeInstalled = false;
  private runtimeInstallPromise: Promise<void> | null = null;
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
  private desiredViewportSize: Snapshot["viewportSize"] | null = null;
  private grantedPermissions = new Set<string>();
  private geolocation: { latitude: number; longitude: number } | null = null;
  private eventListeners = new Set<(event: ControllerEvent) => void>();
  private eventPollingRequested = false;
  private eventPollingPromise: Promise<void> | null = null;
  private collectingRuntimeEvents = false;
  private consoleMessageHistory: RuntimeConsoleRecord[] = [];
  private pageErrorHistory: SerializedErrorValue[] = [];
  private compatContext: CompatBrowserContext;
  private compatPage: CompatPage;
  private knownFrames = new Map<number, FrameMeta>();

  constructor({ appPort = randomPort() }: ControllerOptions = {}) {
    this.appPort = appPort;
    this.compatContext = new CompatBrowserContext(this);
    this.compatPage = this.compatContext.page();
    this.knownFrames.set(this.mainFrameId, {
      id: this.mainFrameId,
      url: this.lastSnapshot.url,
      name: "",
      parentFrameId: null,
    });
  }

  get snapshotState(): Snapshot {
    return this.lastSnapshot;
  }

  private resetCompatState(): void {
    const testIdAttributeName = this.compatContext.selectors().testIdAttributeName();
    this.compatContext = new CompatBrowserContext(this);
    this.compatContext.setTestIdAttributeName(testIdAttributeName);
    this.compatPage = this.compatContext.page();
    this.knownFrames.clear();
    this.knownFrames.set(this.mainFrameId, {
      id: this.mainFrameId,
      url: this.lastSnapshot.url,
      name: "",
      parentFrameId: null,
    });
  }

  frameInfoSync(frameId: number): FrameMeta {
    return (
      this.knownFrames.get(frameId) ?? {
        id: frameId,
        url: frameId === this.mainFrameId ? this.lastSnapshot.url : "about:blank",
        name: "",
        parentFrameId: null,
      }
    );
  }

  private rememberFrame(frame: FrameMeta): FrameMeta {
    this.knownFrames.set(frame.id, frame);
    return frame;
  }

  private compatFrame(frameId = this.mainFrameId): CompatFrame {
    return this.compatPage.frame(frameId, this.frameInfoSync(frameId));
  }

  private async compatFrameForHandle(handleId: number): Promise<CompatFrame> {
    const frame = await this.ownerFrameInfo(handleId);
    return this.compatFrame(frame?.id ?? this.mainFrameId);
  }

  private async compatScopeHandle(
    rootHandleId: number | null,
    _defaultFrameId = this.mainFrameId
  ): Promise<CompatElementHandle | undefined> {
    if (!rootHandleId) {
      return undefined;
    }
    const frame = await this.compatFrameForHandle(rootHandleId);
    return frame.scopeHandle({
      id: rootHandleId,
      type: "element",
      preview: "ElementHandle",
      frameId: frame.id,
    });
  }

  async start(): Promise<void> {
    if (process.env.DEBUG) {
      console.error(`[controller] start appPort=${this.appPort}`);
    }
    this.stopped = false;
    this.invalidateRuntime();
    this.appExitInfo = null;
    this.processLogs = [];
    this.processLogBuffers = { stdout: "", stderr: "" };
    this.eventPollingRequested = false;
    this.consoleMessageHistory = [];
    this.pageErrorHistory = [];
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
    this.resetCompatState();
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

  onEvent(listener: (event: ControllerEvent) => void): void {
    this.eventListeners.add(listener);
  }

  offEvent(listener: (event: ControllerEvent) => void): void {
    this.eventListeners.delete(listener);
  }

  async setEventPollingRequested(requested: boolean): Promise<void> {
    this.eventPollingRequested = requested;
    if (requested) {
      this.startEventPolling();
      return;
    }
    await this.stopEventPolling();
  }

  private invalidateRuntime(): void {
    this.runtimeInstalled = false;
    this.runtimeInstallPromise = null;
  }

  private emitControllerEvent(event: ControllerEvent): void {
    if (event.kind === "console") {
      this.consoleMessageHistory.push(event.message);
      if (this.consoleMessageHistory.length > 200) {
        this.consoleMessageHistory.shift();
      }
    }
    if (event.kind === "pageerror") {
      this.pageErrorHistory.push(event.error);
      if (this.pageErrorHistory.length > 200) {
        this.pageErrorHistory.shift();
      }
    }
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private startEventPolling(): void {
    if (this.eventPollingPromise) {
      return;
    }
    this.eventPollingPromise = (async () => {
      while (!this.stopped && this.eventPollingRequested) {
        if (!this.bridge || !this.runtimeInstalled || this.runtimeInstallPromise) {
          await sleep(50);
          continue;
        }
        try {
          await this.collectRuntimeEvents();
        } catch {
          if (!this.eventPollingRequested || this.stopped) {
            break;
          }
        }
        await sleep(50);
      }
    })();
  }

  private async stopEventPolling(): Promise<void> {
    this.eventPollingRequested = false;
    await this.eventPollingPromise?.catch(() => {});
    this.eventPollingPromise = null;
  }

  private async collectRuntimeEvents(): Promise<void> {
    if (
      this.collectingRuntimeEvents ||
      !this.bridge ||
      !this.runtimeInstalled ||
      this.runtimeInstallPromise
    ) {
      return;
    }
    this.collectingRuntimeEvents = true;
    try {
      const raw = await this.evalValue(`(() => {
        if (!window.__pwProxy || typeof window.__pwProxy.takeEvents !== "function") {
          return [];
        }
        return window.__pwProxy.takeEvents();
      })()`);
      if (!Array.isArray(raw)) {
        return;
      }
      for (const event of raw) {
        this.emitControllerEvent(event as ControllerEvent);
      }
    } finally {
      this.collectingRuntimeEvents = false;
    }
  }

  async consoleMessages(): Promise<RuntimeConsoleRecord[]> {
    await this.collectRuntimeEvents();
    return this.consoleMessageHistory.slice();
  }

  async pageErrors(): Promise<SerializedErrorValue[]> {
    await this.collectRuntimeEvents();
    return this.pageErrorHistory.slice();
  }

  private async shutdownApp(): Promise<void> {
    await this.stopEventPolling();
    this.invalidateRuntime();
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

  async evalValue(script: string): Promise<unknown> {
    return await this.withSerializedBridgeCall(async () => {
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
    });
  }

  private async withSerializedBridgeCall<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.bridgeCallQueue;
    let release: (() => void) | undefined;
    this.bridgeCallQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release?.();
    }
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
    if (this.runtimeInstalled) {
      return;
    }

    if (this.runtimeInstallPromise) {
      await this.runtimeInstallPromise;
      return;
    }

    const installPromise = (async () => {
      await this.evalValue(RUNTIME_BOOTSTRAP);
      this.runtimeInstalled = true;
      if (this.grantedPermissions.size > 0) {
        await this.runtimeCall<void>("grantPermissions", {
          permissions: [...this.grantedPermissions],
        });
      }
      if (this.geolocation) {
        await this.runtimeCall<void>("setGeolocation", { geolocation: this.geolocation });
      }
      if (this.desiredViewportSize) {
        await this.runtimeCall<void>("setViewportSize", {
          viewportSize: this.desiredViewportSize,
        });
      }
    })();
    this.runtimeInstallPromise = installPromise;

    try {
      await installPromise;
    } catch (error) {
      this.runtimeInstalled = false;
      throw error;
    } finally {
      if (this.runtimeInstallPromise === installPromise) {
        this.runtimeInstallPromise = null;
      }
    }
  }

  async runtimeCall<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    await this.ensureRuntime();
    const handleIds: number[] = [];
    const serializedPayload = serializeProtocolValue(payload, (value: unknown) => {
      if (isRuntimeHandleReference(value)) {
        return { h: handleIds.push(value.__pwRuntimeHandleId) - 1 };
      }
      return { fallThrough: value };
    });
    return (await this.evalValue(`(() => {
      const payload = window.__pwProxy.deserializeValue(
        ${JSON.stringify(serializedPayload)},
        ${JSON.stringify(handleIds)}
      );
      return window.__pwProxy[${JSON.stringify(method)}](payload);
    })()`)) as T;
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

  private serializeArgumentValue(value: unknown): SerializedArgument {
    const handles: Array<{ handleId: number }> = [];
    const serializedValue = serializeProtocolValue(value, (candidate: unknown) => {
      if (isRuntimeHandleReference(candidate)) {
        return { h: handles.push({ handleId: candidate.__pwRuntimeHandleId }) - 1 };
      }
      return { fallThrough: candidate };
    });
    return {
      value: serializedValue,
      handles,
    };
  }

  private async runElementAction<T>(
    frameId: number,
    handleId: number,
    action: string,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    return (await this.evaluateExpression(
      `(payload) => {
        if (!window.__pwProxy || typeof window.__pwProxy.runElementAction !== "function") {
          throw new Error("Playwright proxy runtime action helper is not installed");
        }
        return window.__pwProxy.runElementAction(payload.element, payload.action, payload);
      }`,
      true,
      this.serializeArgumentValue({
        action,
        element: { __pwRuntimeHandleId: handleId },
        ...payload,
      }),
      frameId
    )) as T;
  }

  private async runSelectorAction<T>(
    frameId: number,
    action: "fill" | "type" | "press" | "selectOption" | "inputValue" | "textContent",
    selector: string,
    rootHandleId: number | null,
    strict: boolean | undefined,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const commandPayload = {
      frameId,
      selector,
      rootHandleId,
      strict: !!strict,
      optionHandleIds: [] as number[],
      ...payload,
    };
    return (await this.evaluateExpression(
      `() => {
        if (!window.__pwProxy) {
          throw new Error("Playwright proxy runtime is not installed");
        }
        const command = window.__pwProxy[${JSON.stringify(action)}];
        if (typeof command !== "function") {
          throw new Error("Playwright proxy action command is not available");
        }
        return command(${JSON.stringify(commandPayload)});
      }`,
      true,
      this.serializeArgumentValue(undefined),
      frameId
    )) as T;
  }

  private async deserializeArgumentInFrame(
    arg: SerializedArgument | undefined,
    frameId: number
  ): Promise<unknown> {
    if (!arg) {
      return undefined;
    }
    return await this.evaluateExpression("(arg) => arg", true, arg, frameId);
  }

  async snapshot(): Promise<Snapshot> {
    const url = (await this.evalValue("location.href")) as string;
    const title = (await this.evalValue("document.title")) as string;
    const viewportSize = (await this.evalValue(
      "({ width: window.innerWidth, height: window.innerHeight })"
    )) as { width: number; height: number };

    this.lastSnapshot = { url, title, viewportSize };
    this.rememberFrame({
      id: this.mainFrameId,
      url,
      name: "",
      parentFrameId: null,
    });
    return this.lastSnapshot;
  }

  async frameInfo(frameId: number): Promise<FrameMeta> {
    return this.rememberFrame(await this.runtimeCall<FrameMeta>("frameInfo", { frameId }));
  }

  async getContentFrame(handleId: number): Promise<FrameMeta | null> {
    const frame = await this.runtimeCall<FrameMeta | null>("getContentFrame", { handleId });
    return frame ? this.rememberFrame(frame) : null;
  }

  async contentFrameInfo(handleId: number): Promise<FrameMeta | null> {
    return await this.getContentFrame(handleId);
  }

  async ownerFrameInfo(handleId: number): Promise<FrameMeta | null> {
    const frame = await this.runtimeCall<FrameMeta | null>("getOwnerFrame", { handleId });
    return frame ? this.rememberFrame(frame) : null;
  }

  async injectedScriptHandle(frameId: number): Promise<HandleMeta> {
    return await this.runtimeCall<HandleMeta>("getInjectedScriptHandle", { frameId });
  }

  async cloneHandle(handleId: number): Promise<HandleMeta> {
    return await this.runtimeCall<HandleMeta>("cloneHandle", { handleId });
  }

  async generateSelector(handleId: number): Promise<string> {
    return await this.runtimeCall<string>("generateSelector", { handleId });
  }

  private async compatQuery(
    frameId: number,
    selector: string,
    rootHandleId: number | null,
    strict?: boolean
  ): Promise<CompatElementHandle | null> {
    const frame = this.compatFrame(frameId);
    const scope = await this.compatScopeHandle(rootHandleId, frameId);
    return (await frame.selectors.query(selector, { strict: !!strict }, scope)) as CompatElementHandle | null;
  }

  private async compatQueryAll(
    frameId: number,
    selector: string,
    rootHandleId: number | null
  ): Promise<CompatElementHandle[]> {
    const frame = this.compatFrame(frameId);
    const scope = await this.compatScopeHandle(rootHandleId, frameId);
    return (await frame.selectors.queryAll(selector, scope)) as CompatElementHandle[];
  }

  private async selectorHandleMeta(
    frameId: number,
    selector: string,
    rootHandleId: number | null,
    strict?: boolean
  ): Promise<HandleMeta | null> {
    const handle = await this.compatQuery(frameId, selector, rootHandleId, strict);
    return handle?.meta ?? null;
  }

  private async requiredSelectorHandleMeta(
    frameId: number,
    selector: string,
    rootHandleId: number | null,
    strict?: boolean
  ): Promise<HandleMeta> {
    const handle = await this.selectorHandleMeta(frameId, selector, rootHandleId, strict);
    if (!handle) {
      throw new Error("Target not found");
    }
    return handle;
  }

  private async withTransientSelectorHandle<T>(
    frameId: number,
    selector: string,
    rootHandleId: number | null,
    strict: boolean | undefined,
    callback: (handle: HandleMeta) => Promise<T>
  ): Promise<T> {
    const handle = await this.requiredSelectorHandleMeta(frameId, selector, rootHandleId, strict);
    try {
      return await callback(handle);
    } finally {
      await this.disposeHandle(handle.id).catch(() => {});
    }
  }

  async evaluateExpression(
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument,
    frameId = 1
  ): Promise<unknown> {
    return await this.runtimeCall<unknown>("evaluate", {
      frameId,
      expression,
      isFunction,
      ...this.payloadFromArg(arg),
    });
  }

  async evaluateExpressionHandle(
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument,
    frameId = 1
  ): Promise<HandleMeta> {
    return await this.runtimeCall<HandleMeta>("evaluateHandle", {
      frameId,
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
    return await this.runtimeCall<unknown>("evaluateOnHandle", {
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
    return await this.runtimeCall<HandleMeta>("evaluateHandleOnHandle", {
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
    pollingInterval?: number,
    frameId = 1
  ): Promise<HandleMeta> {
    const deadline = timeout ? Date.now() + timeout : Infinity;
    const intervalMs = pollingInterval ?? 16;

    while (Date.now() < deadline) {
      const result = await this.runtimeCall<HandleMeta | null>("waitForFunctionStep", {
        frameId,
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
    frameId: number,
    selector: string,
    rootHandleId: number | null,
    strict?: boolean
  ): Promise<HandleMeta | null> {
    return await this.selectorHandleMeta(frameId, selector, rootHandleId, strict);
  }

  async querySelectorAll(
    frameId: number,
    selector: string,
    rootHandleId: number | null
  ): Promise<HandleMeta[]> {
    const handles = await this.compatQueryAll(frameId, selector, rootHandleId);
    return handles.map((handle) => handle.meta);
  }

  async waitForSelector(
    frameId: number,
    selector: string,
    rootHandleId: number | null,
    state?: string,
    timeout?: number,
    strict?: boolean
  ): Promise<HandleMeta | null> {
    const deadline = timeout ? Date.now() + timeout : Date.now() + 30_000;
    const stateName = state ?? "visible";

    while (Date.now() < deadline) {
      const handle = await this.selectorHandleMeta(frameId, selector, rootHandleId, strict);
      if (stateName === "attached") {
        if (handle) {
          return handle;
        }
      } else if (stateName === "detached") {
        if (!handle) {
          return null;
        }
      } else if (stateName === "hidden") {
        if (!handle) {
          return null;
        }
        const hidden = await this.boolState("isHidden", null, null, handle.id, false, frameId);
        if (hidden) {
          await this.disposeHandle(handle.id).catch(() => {});
          return null;
        }
        await this.disposeHandle(handle.id).catch(() => {});
      } else {
        if (handle) {
          const visible = await this.boolState("isVisible", null, null, handle.id, false, frameId);
          if (visible) {
            return handle;
          }
          await this.disposeHandle(handle.id).catch(() => {});
        }
      }
      await sleep(50);
    }

    throw new TimeoutError(`Timeout ${timeout}ms exceeded`);
  }

  async evalOnSelector(
    frameId: number,
    selector: string,
    rootHandleId: number | null,
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument,
    strict?: boolean
  ): Promise<unknown> {
    return await this.withTransientSelectorHandle(
      frameId,
      selector,
      rootHandleId,
      strict,
      async (handle) =>
        await this.evaluateOnHandle(handle.id, expression, isFunction, arg)
    );
  }

  async evalOnSelectorAll(
    frameId: number,
    selector: string,
    rootHandleId: number | null,
    expression: string,
    isFunction: boolean,
    arg: SerializedArgument
  ): Promise<unknown> {
    const frame = this.compatFrame(frameId);
    const scope = await this.compatScopeHandle(rootHandleId, frameId);
    const arrayHandle = (await frame.selectors.queryArrayInMainWorld(
      selector,
      scope
    )) as CompatJSHandle;
    try {
      return await this.evaluateOnHandle(arrayHandle.handleId, expression, isFunction, arg);
    } finally {
      arrayHandle.dispose();
    }
  }

  async handleJsonValue(handleId: number): Promise<unknown> {
    return await this.runtimeCall<unknown>("jsonValue", { handleId });
  }

  async disposeHandle(handleId: number): Promise<void> {
    await this.runtimeCall<void>("disposeHandle", { handleId });
  }

  async getHandleProperty(handleId: number, name: string): Promise<HandleMeta> {
    return await this.runtimeCall<HandleMeta>("getProperty", { handleId, name });
  }

  async getHandleProperties(handleId: number): Promise<PropertyHandleEntry[]> {
    return await this.runtimeCall<PropertyHandleEntry[]>("getPropertyList", { handleId });
  }

  async textContent(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean,
    frameId = 1
  ): Promise<string | null> {
    if (selector) {
      return await this.runSelectorAction<string | null>(
        frameId,
        "textContent",
        selector,
        rootHandleId,
        strict
      );
    }
    return await this.runtimeCall<string | null>("textContent", {
      frameId,
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
    strict?: boolean,
    frameId = 1
  ): Promise<string> {
    if (selector) {
      return await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.innerText(null, null, handle.id, false, frameId)
      );
    }
    return await this.runtimeCall<string>("innerText", {
      frameId,
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
    strict?: boolean,
    frameId = 1
  ): Promise<string> {
    if (selector) {
      return await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.innerHTML(null, null, handle.id, false, frameId)
      );
    }
    return await this.runtimeCall<string>("innerHTML", {
      frameId,
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
    strict?: boolean,
    frameId = 1
  ): Promise<string | null> {
    if (selector) {
      const handle = await this.selectorHandleMeta(frameId, selector, rootHandleId, strict);
      if (!handle) {
        return null;
      }
      try {
        return await this.getAttribute(null, null, handle.id, name, false, frameId);
      } finally {
        await this.disposeHandle(handle.id).catch(() => {});
      }
    }
    return await this.runtimeCall<string | null>("getAttribute", {
      frameId,
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
    strict?: boolean,
    frameId = 1
  ): Promise<string> {
    if (selector) {
      return await this.runSelectorAction<string>(
        frameId,
        "inputValue",
        selector,
        rootHandleId,
        strict
      );
    }
    return await this.runtimeCall<string>("inputValue", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async queryCount(frameId: number, selector: string, rootHandleId: number | null): Promise<number> {
    return await this.runtimeCall<number>("queryCount", {
      frameId,
      selector,
      rootHandleId,
    });
  }

  async resolveSelector(frameId: number, selector: string, rootHandleId: number | null): Promise<string> {
    return await this.withTransientSelectorHandle(
      frameId,
      selector,
      rootHandleId,
      true,
      async (handle) => await this.generateSelector(handle.id)
    );
  }

  async highlight(frameId: number, selector: string, rootHandleId: number | null): Promise<void> {
    const frame = this.compatFrame(frameId);
    const scope = await this.compatScopeHandle(rootHandleId, frameId);
    const resolved = await frame.selectors.resolveInjectedForSelector(selector, { strict: false }, scope);
    if (!resolved) {
      return;
    }
    await resolved.injected.evaluate(
      (
        injected: { highlight: (selector: unknown) => void },
        payload: { info: { parsed: unknown } }
      ) => {
        injected.highlight(payload.info.parsed);
      },
      { info: resolved.info }
    );
  }

  async content(): Promise<string> {
    return await this.runtimeCall<string>("content");
  }

  async frameContent(frameId: number): Promise<string> {
    return await this.runtimeCall<string>("frameContent", { frameId });
  }

  async setTestIdAttributeName(testIdAttributeName: string): Promise<void> {
    this.compatContext.setTestIdAttributeName(testIdAttributeName);
    await this.runtimeCall<void>("setTestIdAttributeName", { testIdAttributeName });
  }

  async setContent(html: string): Promise<void> {
    await this.ensureRuntime();
    await this.runtimeCall<boolean>("resetHandles");
    await this.evalValue(`(() => {
      function executeInsertedScripts(root) {
        const scripts = Array.from(root.querySelectorAll("script"));
        for (const oldScript of scripts) {
          const script = document.createElement("script");
          for (const attr of oldScript.attributes) {
            script.setAttribute(attr.name, attr.value);
          }
          script.textContent = oldScript.textContent;
          oldScript.replaceWith(script);
        }
      }

      const html = ${JSON.stringify(html)};
      const hasDocumentMarkup = /<!doctype|<html|<head|<body/i.test(html);
      if (hasDocumentMarkup) {
        const nextDocument = new DOMParser().parseFromString(html, "text/html");
        document.head.innerHTML = nextDocument.head.innerHTML;
        document.body.innerHTML = nextDocument.body.innerHTML;
        executeInsertedScripts(document.head);
        executeInsertedScripts(document.body);
        document.title = nextDocument.title;
      } else {
        document.body.innerHTML = html;
        executeInsertedScripts(document.body);
        document.title = "";
      }
      return null;
    })()`);
    this.invalidateRuntime();
    await this.ensureRuntime();
    this.lastSnapshot = {
      ...this.lastSnapshot,
      title: titleFromHtml(html),
    };
  }

  async title(): Promise<string> {
    return await this.runtimeCall<string>("title");
  }

  async frameTitle(frameId: number): Promise<string> {
    return await this.runtimeCall<string>("title", { frameId });
  }

  async pageScreenshot(fullPage: boolean): Promise<Uint8Array> {
    return normalizeBinaryPayload(await this.runtimeCall<unknown>("screenshotPage", { fullPage }));
  }

  async elementScreenshot(handleId: number): Promise<Uint8Array> {
    return normalizeBinaryPayload(
      await this.runtimeCall<unknown>("screenshotElement", { handleId })
    );
  }

  async expect(frameId: number, params: ExpectOptions): Promise<unknown> {
    type ExpectationResult = { matches?: boolean; missingReceived?: boolean; received?: unknown };
    type FrameContext = {
      _context(world: "main" | "utility"): Promise<{ injectedScript: () => Promise<unknown> }>;
    };
    type InjectedRuntimeHandle = {
      evaluate: (pageFunction: unknown, args: unknown) => Promise<unknown>;
    };
    const timeout = typeof params.timeout === "number" ? params.timeout : 5_000;
    const deadline = Date.now() + timeout;
    const baseOptions = {
      ...params,
      expectedValue: await this.deserializeArgumentInFrame(params.expectedValue, frameId),
    };
    const lastIntermediateResult: {
      isSet: boolean;
      received?: unknown;
      errorMessage?: string;
    } = { isSet: false };

    const runExpectation = async (): Promise<ExpectationResult> => {
      const selector = typeof baseOptions.selector === "string" ? baseOptions.selector : undefined;
      const frame = this.compatFrame(frameId);
      const resolved = selector
        ? await frame.selectors.resolveInjectedForSelector(selector, { strict: true })
        : undefined;
      const targetFrame: FrameContext = resolved?.frame ?? frame;
      const world =
        baseOptions.expression === "to.have.property"
          ? "main"
          : (resolved?.info?.world ?? "utility");
      const context = await targetFrame._context(world);
      const injected = (resolved?.injected ?? (await context.injectedScript())) as InjectedRuntimeHandle;
      const scope = resolved?.scope;
      const options = { ...baseOptions };
      delete options.selector;

      return (await injected.evaluate(
        async (
          injectedScript: unknown,
          payload: { info?: unknown; options?: unknown; scope?: unknown }
        ) => {
          const script = injectedScript as {
            querySelectorAll: (selector: unknown, root: unknown) => unknown[];
            strictModeViolationError: (selector: unknown, elements: unknown[]) => never;
            previewNode: (node: unknown) => string;
            checkDeprecatedSelectorUsage: (selector: unknown, elements: unknown[]) => void;
            expect: (
              element: unknown,
              options: Record<string, unknown>,
              elements: unknown[]
            ) => { matches?: boolean; missingReceived?: boolean; received?: unknown };
          };
          const parsed = payload.info as { parsed?: unknown } | undefined;
          const options = (payload.options as Record<string, unknown>) ?? {};
          const elements = payload.info
            ? script.querySelectorAll(
                parsed?.parsed,
                payload.scope || document
              )
            : [];
          const isArray =
            options.expression === "to.have.count" || String(options.expression).endsWith(".array");
          let log = "";
          if (isArray) {
            log = `  locator resolved to ${elements.length} element${elements.length === 1 ? "" : "s"}`;
          } else if (elements.length > 1) {
            throw script.strictModeViolationError(parsed?.parsed, elements);
          } else if (elements.length) {
            log = `  locator resolved to ${script.previewNode(elements[0])}`;
          }
          if (payload.info) {
            script.checkDeprecatedSelectorUsage(parsed?.parsed, elements);
          }
          return {
            log,
            ...(await script.expect(elements[0], options, elements)),
          };
        },
        { info: resolved?.info, options, scope }
      )) as { matches?: boolean; missingReceived?: boolean; received?: unknown };
    };

    while (Date.now() < deadline) {
      try {
        const result = await runExpectation();
        if (result.matches !== baseOptions.isNot) {
          return result;
        }
        if (result.missingReceived) {
          lastIntermediateResult.errorMessage = "Error: element(s) not found";
        } else {
          lastIntermediateResult.received = result.received;
          lastIntermediateResult.errorMessage = undefined;
        }
        lastIntermediateResult.isSet = true;
      } catch (error) {
        if (error instanceof Error) {
          lastIntermediateResult.errorMessage = error.message;
        }
        lastIntermediateResult.isSet = true;
      }
      await sleep(100);
    }

    return {
      matches: !!baseOptions.isNot,
      timedOut: true,
      ...(lastIntermediateResult.received !== undefined
        ? { received: lastIntermediateResult.received }
        : {}),
      ...(lastIntermediateResult.errorMessage
        ? { errorMessage: lastIntermediateResult.errorMessage }
        : {}),
    };
  }

  async focus(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.focus(null, null, handle.id, false, frameId)
      );
      return;
    }
    await this.runtimeCall<void>("focus", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async blur(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.blur(null, null, handle.id, false, frameId)
      );
      return;
    }
    await this.runtimeCall<void>("blur", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async click(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.click(null, null, handle.id, false, frameId)
      );
      return;
    }
    await this.runtimeCall<void>("click", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async dblclick(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.dblclick(null, null, handle.id, false, frameId)
      );
      return;
    }
    await this.runtimeCall<void>("dblclick", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async hover(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.hover(null, null, handle.id, false, frameId)
      );
      return;
    }
    await this.runtimeCall<void>("hover", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async tap(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.tap(null, null, handle.id, false, frameId)
      );
      return;
    }
    await this.runtimeCall<void>("click", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async scrollIntoViewIfNeeded(handleId: number): Promise<void> {
    await this.runtimeCall<void>("scrollIntoViewIfNeeded", { handleId });
  }

  async dispatchEvent(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    type: string,
    eventInit: SerializedArgument,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) =>
          await this.dispatchEvent(null, null, handle.id, type, eventInit, false, frameId)
      );
      return;
    }
    await this.runtimeCall<void>("dispatchEvent", {
      frameId,
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
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.runSelectorAction<void>(
        frameId,
        "fill",
        selector,
        rootHandleId,
        strict,
        { value }
      );
      return;
    }
    if (handleId !== null) {
      await this.runElementAction<void>(frameId, handleId, "fill", { value });
      return;
    }
    await this.runtimeCall<void>("fill", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      value,
      strict: !!strict,
    });
  }

  async type(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    text: string,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.runSelectorAction<void>(
        frameId,
        "type",
        selector,
        rootHandleId,
        strict,
        { text }
      );
      return;
    }
    if (handleId !== null) {
      await this.runElementAction<string>(frameId, handleId, "type", { text });
      return;
    }
    await this.runtimeCall<string>("type", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      text,
      strict: !!strict,
    });
  }

  async press(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    key: string,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.runSelectorAction<void>(
        frameId,
        "press",
        selector,
        rootHandleId,
        strict,
        { key }
      );
      return;
    }
    if (handleId !== null) {
      await this.runElementAction<string>(frameId, handleId, "press", { key });
      return;
    }
    await this.runtimeCall<string>("press", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      key,
      strict: !!strict,
    });
  }

  async setChecked(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    checked: boolean,
    trial?: boolean,
    strict?: boolean,
    frameId = 1
  ): Promise<boolean> {
    if (selector) {
      return await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.setChecked(null, null, handle.id, checked, trial, false, frameId)
      );
    }
    return await this.runtimeCall<boolean>("check", {
      frameId,
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
    strict?: boolean,
    frameId = 1
  ): Promise<string[]> {
    if (selector) {
      if (elements.length === 0) {
        return normalizeStringArrayPayload(
          await this.runSelectorAction<unknown>(
            frameId,
            "selectOption",
            selector,
            rootHandleId,
            strict,
            { options }
          )
        );
      }
      return await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) =>
          await this.selectOption(null, null, handle.id, options, elements, false, frameId)
      );
    }
    if (handleId !== null) {
      return normalizeStringArrayPayload(
        await this.runElementAction<unknown>(frameId, handleId, "selectOption", {
          options,
          optionElements: elements.map((element) => ({
            __pwRuntimeHandleId: element.handleId,
          })),
        })
      );
    }
    return normalizeStringArrayPayload(
      await this.runtimeCall<unknown>("selectOption", {
        frameId,
        selector,
        rootHandleId,
        handleId,
        options,
        optionHandleIds: this.handleIds(elements),
        strict: !!strict,
      })
    );
  }

  async setInputFiles(
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    payloads: Array<{ name: string; mimeType?: string; buffer: Uint8Array }>,
    strict?: boolean,
    frameId = 1
  ): Promise<void> {
    if (selector) {
      await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) =>
          await this.setInputFiles(null, null, handle.id, payloads, false, frameId)
      );
      return;
    }
    if (handleId !== null) {
      await this.runElementAction<void>(frameId, handleId, "setInputFiles", { payloads });
      return;
    }
    await this.runtimeCall<void>("setInputFiles", {
      frameId,
      selector,
      rootHandleId,
      handleId,
      payloads,
      strict: !!strict,
    });
  }

  async dragAndDrop(
    frameId: number,
    source: string,
    target: string,
    strict?: boolean
  ): Promise<void> {
    await this.runtimeCall<void>("dragAndDrop", {
      frameId,
      source,
      target,
      strict: !!strict,
    });
  }

  async boolState(
    method: string,
    selector: string | null,
    rootHandleId: number | null,
    handleId: number | null,
    strict?: boolean,
    frameId = 1
  ): Promise<boolean> {
    if (selector) {
      return await this.withTransientSelectorHandle(
        frameId,
        selector,
        rootHandleId,
        strict,
        async (handle) => await this.boolState(method, null, null, handle.id, false, frameId)
      );
    }
    return await this.runtimeCall<boolean>(method, {
      frameId,
      selector,
      rootHandleId,
      handleId,
      strict: !!strict,
    });
  }

  async grantPermissions(permissions: string[]): Promise<void> {
    this.grantedPermissions = new Set(permissions);
    if (!this.runtimeInstalled) {
      return;
    }
    await this.runtimeCall<void>("grantPermissions", { permissions });
  }

  async setGeolocation(
    geolocation: { latitude: number; longitude: number } | null
  ): Promise<void> {
    this.geolocation = geolocation;
    if (!this.runtimeInstalled) {
      return;
    }
    await this.runtimeCall<void>("setGeolocation", { geolocation });
  }

  async setViewportSize(viewportSize: Snapshot["viewportSize"]): Promise<void> {
    this.desiredViewportSize = { ...viewportSize };
    await this.runtimeCall<void>("setViewportSize", { viewportSize });
    this.lastSnapshot = {
      ...this.lastSnapshot,
      viewportSize: { ...viewportSize },
    };
  }

  async dismissDialog(_dialogId: number): Promise<void> {}

  async acceptDialog(_dialogId: number, _promptText?: string): Promise<void> {}

  async reload(): Promise<void> {
    await this.restart();
  }

  async goBack(): Promise<void> {
    const previousUrl = String(await this.evalValue("location.href"));
    await this.runtimeCall<void>("goBack");
    await this.waitFor(async () => {
      const nextUrl = await this.evalValue("location.href");
      return typeof nextUrl === "string" && nextUrl !== previousUrl ? nextUrl : null;
    }, 5_000);
    await this.snapshot();
  }

  async goto(url: string): Promise<void> {
    await this.evalValue(
      `setTimeout(() => { location.href = ${JSON.stringify(url)}; }, 0); null`
    );
    this.invalidateRuntime();
    await this.waitForAppReady();
  }
}
