import { setTimeout as sleep } from "node:timers/promises";
import type { ProxyAppController } from "../controller";
import { Dispatcher, serializeResult } from "../internals";
import { DummyDispatcher, ProxyObject } from "./base";
import { ProxyHandleDispatcher } from "./handle";

export class ProxyBrowserDispatcher extends Dispatcher {
  private controller: ProxyAppController;
  private context: ProxyBrowserContextDispatcher;

  constructor(parent: any, controller: ProxyAppController) {
    const object = new ProxyObject(parent._object, "proxyBrowser");
    object.options = { name: "webkit" };
    super(parent, object, "Browser", { version: "wry-wkwebview", name: "webkit" });
    this.controller = controller;
    this.context = new ProxyBrowserContextDispatcher(this, controller);
    this._dispatchEvent("context", { context: this.context });
  }

  async close(): Promise<void> {
    await this.context.disposeTree();
    await this.controller.close();
    this._dispatchEvent("close");
    this._dispose();
  }

  async newContext(): Promise<never> {
    throw new Error("The WRY Playwright proxy exposes a single prelaunched context");
  }
}

export class ProxyBrowserContextDispatcher extends Dispatcher {
  private controller: ProxyAppController;
  private page: ProxyPageDispatcher;

  constructor(parent: any, controller: ProxyAppController) {
    const object = new ProxyObject(parent._object, "proxyContext");
    super(parent, object, "BrowserContext", {
      isChromium: false,
      requestContext: new ProxyAPIRequestContextDispatcher(parent),
      tracing: new ProxyTracingDispatcher(parent),
      options: {},
    });
    this.controller = controller;
    this.page = new ProxyPageDispatcher(this, controller);
    this._dispatchEvent("page", { page: this.page });
  }

  async updateSubscription(): Promise<void> {}

  async newPage(): Promise<{ page: ProxyPageDispatcher }> {
    return { page: this.page };
  }

  async setTestIdAttributeName(): Promise<void> {}

  async close(): Promise<void> {
    await this.disposeTree();
  }

  async disposeTree(): Promise<void> {
    this.page._dispatchEvent("close");
    this.page._dispose();
    this._dispatchEvent("close");
    this._dispose();
  }
}

class ProxyTracingDispatcher extends DummyDispatcher {
  constructor(parent: any) {
    super(parent, new ProxyObject(parent._object, "proxyTracing"), "Tracing", {});
  }
}

class ProxyAPIRequestContextDispatcher extends DummyDispatcher {
  constructor(parent: any) {
    const tracing = new ProxyTracingDispatcher(parent);
    super(parent, new ProxyObject(parent._object, "proxyRequest"), "APIRequestContext", {
      tracing,
    });
  }
}

class ProxyPageDispatcher extends Dispatcher {
  private controller: ProxyAppController;
  private frame: ProxyFrameDispatcher;

  constructor(parent: any, controller: ProxyAppController) {
    const frame = new ProxyFrameDispatcher(parent, controller);
    const object = new ProxyObject(parent._object, "proxyPage");
    super(parent, object, "Page", {
      mainFrame: frame,
      viewportSize: controller.snapshotState.viewportSize,
      isClosed: false,
      opener: undefined,
    });
    this.controller = controller;
    this.adopt(frame);
    this.frame = frame;
  }

  async updateSubscription(): Promise<void> {}

  async reload(): Promise<Record<string, never>> {
    await this.controller.reload();
    await this.frame.refresh();
    return {};
  }

  async close(): Promise<void> {
    await this.controller.close();
    this._dispatchEvent("close");
    this._dispose();
  }

  async snapshotForAI(): Promise<{ full: string }> {
    return { full: await this.controller.content() };
  }
}

class ProxyFrameDispatcher extends Dispatcher {
  private controller: ProxyAppController;

  constructor(parent: any, controller: ProxyAppController) {
    const object = new ProxyObject(parent._object, "proxyFrame");
    super(parent, object, "Frame", {
      url: controller.snapshotState.url,
      name: "",
      parentFrame: undefined,
      loadStates: ["commit", "domcontentloaded", "load", "networkidle"],
    });
    this.controller = controller;
  }

  private emitNavigated(snapshot = this.controller.snapshotState): void {
    this._dispatchEvent("navigated", {
      url: snapshot.url,
      name: "",
      error: undefined,
      newDocument: undefined,
    });
  }

  async refresh(): Promise<void> {
    const snapshot = await this.controller.snapshot();
    this.emitNavigated(snapshot);
  }

  async evaluateExpression(params: any): Promise<{ value: unknown }> {
    return {
      value: serializeResult(
        await this.controller.evaluateExpression(
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async evaluateExpressionHandle(params: any): Promise<{ handle: ProxyHandleDispatcher }> {
    const meta = await this.controller.evaluateExpressionHandle(
      params.expression,
      params.isFunction,
      params.arg
    );
    return { handle: new ProxyHandleDispatcher(this, this.controller, meta) };
  }

  async waitForSelector(params: any): Promise<{ element?: ProxyHandleDispatcher }> {
    const meta = await this.controller.waitForSelector(
      params.selector,
      null,
      params.state,
      params.timeout
    );
    return {
      element: meta ? new ProxyHandleDispatcher(this, this.controller, meta) : undefined,
    };
  }

  async dispatchEvent(params: any): Promise<void> {
    await this.controller.dispatchEvent(
      params.selector,
      null,
      null,
      params.type,
      params.eventInit
    );
  }

  async evalOnSelector(params: any): Promise<{ value: unknown }> {
    return {
      value: serializeResult(
        await this.controller.evalOnSelector(
          params.selector,
          null,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async evalOnSelectorAll(params: any): Promise<{ value: unknown }> {
    return {
      value: serializeResult(
        await this.controller.evalOnSelectorAll(
          params.selector,
          null,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async querySelector(params: any): Promise<{ element?: ProxyHandleDispatcher }> {
    const meta = await this.controller.querySelector(params.selector, null);
    return {
      element: meta ? new ProxyHandleDispatcher(this, this.controller, meta) : undefined,
    };
  }

  async querySelectorAll(params: any): Promise<{ elements: ProxyHandleDispatcher[] }> {
    const elements = await this.controller.querySelectorAll(params.selector, null);
    return {
      elements: elements.map(
        (meta) => new ProxyHandleDispatcher(this, this.controller, meta)
      ),
    };
  }

  async queryCount(params: any): Promise<{ value: number }> {
    return { value: await this.controller.queryCount(params.selector, null) };
  }

  async content(): Promise<{ value: string }> {
    return { value: await this.controller.content() };
  }

  async setContent(params: any): Promise<void> {
    await this.controller.setContent(params.html);
    this.emitNavigated();
  }

  async goto(params: any): Promise<Record<string, never>> {
    await this.controller.goto(params.url);
    await this.refresh();
    return {};
  }

  async click(params: any): Promise<void> {
    await this.controller.click(params.selector, null, null);
  }

  async dblclick(params: any): Promise<void> {
    await this.controller.dblclick(params.selector, null, null);
  }

  async fill(params: any): Promise<void> {
    await this.controller.fill(params.selector, null, null, params.value);
  }

  async focus(params: any): Promise<void> {
    await this.controller.focus(params.selector, null, null);
  }

  async blur(params: any): Promise<void> {
    await this.controller.blur(params.selector, null, null);
  }

  async textContent(params: any): Promise<{ value?: string }> {
    const value = await this.controller.textContent(params.selector, null, null);
    return value === null ? {} : { value };
  }

  async innerText(params: any): Promise<{ value: string }> {
    return { value: await this.controller.innerText(params.selector, null, null) };
  }

  async innerHTML(params: any): Promise<{ value: string }> {
    return { value: await this.controller.innerHTML(params.selector, null, null) };
  }

  async getAttribute(params: any): Promise<{ value?: string }> {
    const value = await this.controller.getAttribute(
      params.selector,
      null,
      null,
      params.name
    );
    return value === null ? {} : { value };
  }

  async inputValue(params: any): Promise<{ value: string }> {
    return { value: await this.controller.inputValue(params.selector, null, null) };
  }

  async isChecked(params: any): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isChecked", params.selector, null, null) };
  }

  async isDisabled(params: any): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isDisabled", params.selector, null, null) };
  }

  async isEditable(params: any): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isEditable", params.selector, null, null) };
  }

  async isEnabled(params: any): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isEnabled", params.selector, null, null) };
  }

  async isHidden(params: any): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isHidden", params.selector, null, null) };
  }

  async isVisible(params: any): Promise<{ value: boolean }> {
    return { value: await this.controller.boolState("isVisible", params.selector, null, null) };
  }

  async hover(params: any): Promise<void> {
    await this.controller.hover(params.selector, null, null);
  }

  async selectOption(params: any): Promise<{ values: string[] }> {
    return {
      values: await this.controller.selectOption(
        params.selector,
        null,
        null,
        params.options || [],
        params.elements || []
      ),
    };
  }

  async type(params: any): Promise<void> {
    await this.controller.type(params.selector, null, null, params.text);
  }

  async press(params: any): Promise<void> {
    await this.controller.press(params.selector, null, null, params.key);
  }

  async check(params: any): Promise<void> {
    await this.controller.setChecked(params.selector, null, null, true, params.trial);
  }

  async uncheck(params: any): Promise<void> {
    await this.controller.setChecked(params.selector, null, null, false, params.trial);
  }

  async waitForTimeout(params: any): Promise<void> {
    await sleep(params.waitTimeout);
  }

  async waitForFunction(params: any): Promise<{ handle: ProxyHandleDispatcher }> {
    const meta = await this.controller.waitForFunction(
      params.expression,
      params.isFunction,
      params.arg,
      params.timeout,
      params.pollingInterval
    );
    return { handle: new ProxyHandleDispatcher(this, this.controller, meta) };
  }

  async title(): Promise<{ value: string }> {
    return { value: await this.controller.title() };
  }
}

export class ProxyPlaywrightDispatcher extends Dispatcher {
  constructor(scope: any, controller: ProxyAppController) {
    const chromium = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyChromium"),
      "BrowserType",
      { executablePath: "", name: "chromium" }
    );
    const firefox = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyFirefox"),
      "BrowserType",
      { executablePath: "", name: "firefox" }
    );
    const webkit = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyWebkit"),
      "BrowserType",
      { executablePath: "", name: "webkit" }
    );
    const android = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyAndroid"),
      "Android",
      {}
    );
    const electron = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyElectron"),
      "Electron",
      {}
    );
    const browser = new ProxyBrowserDispatcher(webkit, controller);
    super(scope, new ProxyObject(scope._object, "proxyPlaywright"), "Playwright", {
      chromium,
      firefox,
      webkit,
      android,
      electron,
      preLaunchedBrowser: browser,
    });
  }
}
