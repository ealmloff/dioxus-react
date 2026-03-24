import { setTimeout as sleep } from "node:timers/promises";
import type { ProxyAppController } from "../controller";
import { Dispatcher, type DispatcherLike, serializeResult } from "../internals";
import { DummyDispatcher, ProxyObject } from "./base";
import { ProxyHandleDispatcher } from "./handle";
import type {
  CheckParams,
  ContentParams,
  DispatchPageEventParams,
  EvalParams,
  ExpectParams,
  FillParams,
  GetAttributeParams,
  GotoParams,
  HighlightParams,
  PressParams,
  QueryCountParams,
  ResolveParams,
  SelectorEvalParams,
  SelectorParamsWithStrict,
  TestIdAttributeNameParams,
  TypeParams,
  WaitForTimeoutParams,
  WaitForFunctionParams,
  WaitSelectorParams,
  SelectOptionParams,
} from "./protocol";

export class ProxyBrowserDispatcher extends Dispatcher {
  private controller: ProxyAppController;
  private context: ProxyBrowserContextDispatcher;

  constructor(parent: DispatcherLike, controller: ProxyAppController) {
    const object = new ProxyObject(parent._object as object, "proxyBrowser");
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

  constructor(parent: DispatcherLike, controller: ProxyAppController) {
    const object = new ProxyObject(parent._object as object, "proxyContext");
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

  async setTestIdAttributeName(params: TestIdAttributeNameParams): Promise<void> {
    await this.controller.setTestIdAttributeName(params.testIdAttributeName);
  }

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
  constructor(parent: DispatcherLike) {
    super(parent, new ProxyObject(parent._object as object, "proxyTracing"), "Tracing", {});
  }
}

class ProxyAPIRequestContextDispatcher extends DummyDispatcher {
  constructor(parent: DispatcherLike) {
    const tracing = new ProxyTracingDispatcher(parent);
    super(parent, new ProxyObject(parent._object as object, "proxyRequest"), "APIRequestContext", {
      tracing,
    });
  }
}

class ProxyPageDispatcher extends Dispatcher {
  private controller: ProxyAppController;
  private frames = new Map<number, ProxyFrameDispatcher>();
  private frame: ProxyFrameDispatcher;

  constructor(parent: DispatcherLike, controller: ProxyAppController) {
    const frame = new ProxyFrameDispatcher(parent, controller, controller.mainFrameId);
    const object = new ProxyObject(parent._object as object, "proxyPage");
    super(parent, object, "Page", {
      mainFrame: frame,
      viewportSize: controller.snapshotState.viewportSize,
      isClosed: false,
      opener: undefined,
    });
    this.controller = controller;
    this.adopt(frame);
    this.frame = frame;
    this.frames.set(controller.mainFrameId, frame);
  }

  frameForId(frameId: number): ProxyFrameDispatcher {
    const cached = this.frames.get(frameId);
    if (cached) {
      return cached;
    }

    const frame = new ProxyFrameDispatcher(this, this.controller, frameId);
    this.frames.set(frameId, frame);
    this.adopt(frame);
    return frame;
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
  readonly frameId: number;

  constructor(
    parent: DispatcherLike,
    controller: ProxyAppController,
    frameId: number,
  ) {
    const info = controller.frameInfoSync(frameId);
    const object = new ProxyObject(parent._object as object, "proxyFrame");
    super(parent, object, "Frame", {
      url: info.url,
      name: info.name,
      parentFrame: info.parentFrameId === null ? undefined : undefined,
      loadStates: ["commit", "domcontentloaded", "load", "networkidle"],
    });
    this.controller = controller;
    this.frameId = frameId;
  }

  private pageDispatcher(): ProxyPageDispatcher {
    const parent = this.parentScope() as DispatcherLike | undefined;
    if (parent && parent._type === "Page") {
      return parent as unknown as ProxyPageDispatcher;
    }
    const grandParent = parent?.parentScope?.();
    if (grandParent && grandParent._type === "Page") {
      return grandParent as unknown as ProxyPageDispatcher;
    }
    throw new Error("Cannot resolve page dispatcher");
  }

  frameForId(frameId: number): ProxyFrameDispatcher {
    return this.pageDispatcher().frameForId(frameId);
  }

  private emitNavigated(info = this.controller.frameInfoSync(this.frameId)): void {
    this._dispatchEvent("navigated", {
      url: info.url,
      name: info.name,
      error: undefined,
      newDocument: undefined,
    });
  }

  async refresh(): Promise<void> {
    const info =
      this.frameId === this.controller.mainFrameId
        ? await this.controller.frameInfo(this.frameId)
        : await this.controller.frameInfo(this.frameId);
    this.emitNavigated(info);
  }

  async evaluateExpression(params: EvalParams): Promise<{ value: unknown }> {
    return {
      value: serializeResult(
        await this.controller.evaluateExpression(
          params.expression,
          params.isFunction,
          params.arg,
          this.frameId
        )
      ),
    };
  }

  async evaluateExpressionHandle(params: EvalParams): Promise<{ handle: ProxyHandleDispatcher }> {
    const meta = await this.controller.evaluateExpressionHandle(
      params.expression,
      params.isFunction,
      params.arg,
      this.frameId
    );
    return { handle: new ProxyHandleDispatcher(this, this.controller, meta, this) };
  }

  async waitForSelector(params: WaitSelectorParams): Promise<{ element?: ProxyHandleDispatcher }> {
    const meta = await this.controller.waitForSelector(
      this.frameId,
      params.selector,
      null,
      params.state,
      params.timeout,
      params.strict
    );
    return {
      element: meta ? new ProxyHandleDispatcher(this, this.controller, meta, this) : undefined,
    };
  }

  async dispatchEvent(params: DispatchPageEventParams): Promise<void> {
    await this.controller.dispatchEvent(
      params.selector,
      null,
      null,
      params.type,
      params.eventInit,
      params.strict,
      this.frameId,
    );
  }

  async evalOnSelector(params: SelectorEvalParams): Promise<{ value: unknown }> {
    return {
      value: serializeResult(
        await this.controller.evalOnSelector(
          this.frameId,
          params.selector,
          null,
          params.expression,
          params.isFunction,
          params.arg,
          params.strict
        )
      ),
    };
  }

  async evalOnSelectorAll(params: SelectorEvalParams): Promise<{ value: unknown }> {
    return {
      value: serializeResult(
        await this.controller.evalOnSelectorAll(
          this.frameId,
          params.selector,
          null,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async querySelector(params: SelectorParamsWithStrict): Promise<{ element?: ProxyHandleDispatcher }> {
    const meta = await this.controller.querySelector(this.frameId, params.selector, null, params.strict);
    return {
      element: meta ? new ProxyHandleDispatcher(this, this.controller, meta, this) : undefined,
    };
  }

  async querySelectorAll(
    params: SelectorParamsWithStrict
  ): Promise<{ elements: ProxyHandleDispatcher[] }> {
    const elements = await this.controller.querySelectorAll(this.frameId, params.selector, null);
    return {
      elements: elements.map(
        (meta) => new ProxyHandleDispatcher(this, this.controller, meta, this)
      ),
    };
  }

  async resolveSelector(params: ResolveParams): Promise<{ resolvedSelector: string }> {
    return {
      resolvedSelector: await this.controller.resolveSelector(this.frameId, params.selector, null),
    };
  }

  async highlight(params: HighlightParams): Promise<void> {
    await this.controller.highlight(this.frameId, params.selector, null);
  }

  async queryCount(params: QueryCountParams): Promise<{ value: number }> {
    return { value: await this.controller.queryCount(this.frameId, params.selector, null) };
  }

  async content(): Promise<{ value: string }> {
    return {
      value:
        this.frameId === this.controller.mainFrameId
          ? await this.controller.content()
          : await this.controller.frameContent(this.frameId),
    };
  }

  async setContent(params: ContentParams): Promise<void> {
    await this.controller.setContent(params.html);
    this.emitNavigated();
  }

  async goto(params: GotoParams): Promise<Record<string, never>> {
    await this.controller.goto(params.url);
    await this.refresh();
    return {};
  }

  async click(params: SelectorParamsWithStrict): Promise<void> {
    await this.controller.click(params.selector, null, null, params.strict, this.frameId);
  }

  async dblclick(params: SelectorParamsWithStrict): Promise<void> {
    await this.controller.dblclick(params.selector, null, null, params.strict, this.frameId);
  }

  async tap(params: SelectorParamsWithStrict): Promise<void> {
    await this.controller.tap(params.selector, null, null, params.strict, this.frameId);
  }

  async fill(params: FillParams): Promise<void> {
    await this.controller.fill(params.selector, null, null, params.value, params.strict, this.frameId);
  }

  async focus(params: SelectorParamsWithStrict): Promise<void> {
    await this.controller.focus(params.selector, null, null, params.strict, this.frameId);
  }

  async blur(params: SelectorParamsWithStrict): Promise<void> {
    await this.controller.blur(params.selector, null, null, params.strict, this.frameId);
  }

  async textContent(params: SelectorParamsWithStrict): Promise<{ value?: string }> {
    const value = await this.controller.textContent(
      params.selector,
      null,
      null,
      params.strict,
      this.frameId
    );
    return value === null ? {} : { value };
  }

  async innerText(params: SelectorParamsWithStrict): Promise<{ value: string }> {
    return {
      value: await this.controller.innerText(params.selector, null, null, params.strict, this.frameId),
    };
  }

  async innerHTML(params: SelectorParamsWithStrict): Promise<{ value: string }> {
    return {
      value: await this.controller.innerHTML(params.selector, null, null, params.strict, this.frameId),
    };
  }

  async getAttribute(
    params: SelectorParamsWithStrict & GetAttributeParams
  ): Promise<{ value?: string }> {
    const value = await this.controller.getAttribute(
      params.selector,
      null,
      null,
      params.name,
      params.strict,
      this.frameId
    );
    return value === null ? {} : { value };
  }

  async inputValue(params: SelectorParamsWithStrict): Promise<{ value: string }> {
    return {
      value: await this.controller.inputValue(params.selector, null, null, params.strict, this.frameId),
    };
  }

  async isChecked(params: SelectorParamsWithStrict): Promise<{ value: boolean }> {
    return {
      value: await this.controller.boolState(
        "isChecked",
        params.selector,
        null,
        null,
        params.strict,
        this.frameId
      ),
    };
  }

  async isDisabled(params: SelectorParamsWithStrict): Promise<{ value: boolean }> {
    return {
      value: await this.controller.boolState(
        "isDisabled",
        params.selector,
        null,
        null,
        params.strict,
        this.frameId
      ),
    };
  }

  async isEditable(params: SelectorParamsWithStrict): Promise<{ value: boolean }> {
    return {
      value: await this.controller.boolState(
        "isEditable",
        params.selector,
        null,
        null,
        params.strict,
        this.frameId
      ),
    };
  }

  async isEnabled(params: SelectorParamsWithStrict): Promise<{ value: boolean }> {
    return {
      value: await this.controller.boolState(
        "isEnabled",
        params.selector,
        null,
        null,
        params.strict,
        this.frameId
      ),
    };
  }

  async isHidden(params: SelectorParamsWithStrict): Promise<{ value: boolean }> {
    return {
      value: await this.controller.boolState(
        "isHidden",
        params.selector,
        null,
        null,
        params.strict,
        this.frameId
      ),
    };
  }

  async isVisible(params: SelectorParamsWithStrict): Promise<{ value: boolean }> {
    return {
      value: await this.controller.boolState(
        "isVisible",
        params.selector,
        null,
        null,
        params.strict,
        this.frameId
      ),
    };
  }

  async hover(params: SelectorParamsWithStrict): Promise<void> {
    await this.controller.hover(params.selector, null, null, params.strict, this.frameId);
  }

  async selectOption(params: SelectorParamsWithStrict & SelectOptionParams): Promise<{ values: string[] }> {
    return {
      values: await this.controller.selectOption(
        params.selector,
        null,
        null,
        params.options || [],
        params.elements || [],
        params.strict,
        this.frameId
      ),
    };
  }

  async type(params: TypeParams): Promise<void> {
    await this.controller.type(params.selector, null, null, params.text, params.strict, this.frameId);
  }

  async press(params: PressParams): Promise<void> {
    await this.controller.press(params.selector, null, null, params.key, params.strict, this.frameId);
  }

  async check(params: SelectorParamsWithStrict & CheckParams): Promise<void> {
    await this.controller.setChecked(
      params.selector,
      null,
      null,
      true,
      params.trial,
      params.strict,
      this.frameId
    );
  }

  async uncheck(params: SelectorParamsWithStrict & CheckParams): Promise<void> {
    await this.controller.setChecked(
      params.selector,
      null,
      null,
      false,
      params.trial,
      params.strict,
      this.frameId
    );
  }

  async waitForTimeout(params: WaitForTimeoutParams): Promise<void> {
    await sleep(params.waitTimeout);
  }

  async waitForFunction(params: WaitForFunctionParams): Promise<{ handle: ProxyHandleDispatcher }> {
    const meta = await this.controller.waitForFunction(
      params.expression,
      params.isFunction,
      params.arg,
      params.timeout,
      params.pollingInterval,
      this.frameId
    );
    return { handle: new ProxyHandleDispatcher(this, this.controller, meta, this) };
  }

  async title(): Promise<{ value: string }> {
    return {
      value:
        this.frameId === this.controller.mainFrameId
          ? await this.controller.title()
          : await this.controller.frameTitle(this.frameId),
    };
  }

  async expect(params: ExpectParams): Promise<unknown> {
    return await this.controller.expect(this.frameId, params);
  }
}

export class ProxyPlaywrightDispatcher extends Dispatcher {
  constructor(scope: DispatcherLike, controller: ProxyAppController) {
    const chromium = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object as object, "proxyChromium"),
      "BrowserType",
      { executablePath: "", name: "chromium" }
    );
    const firefox = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object as object, "proxyFirefox"),
      "BrowserType",
      { executablePath: "", name: "firefox" }
    );
    const webkit = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object as object, "proxyWebkit"),
      "BrowserType",
      { executablePath: "", name: "webkit" }
    );
    const android = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object as object, "proxyAndroid"),
      "Android",
      {}
    );
    const electron = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object as object, "proxyElectron"),
      "Electron",
      {}
    );
    const browser = new ProxyBrowserDispatcher(webkit, controller);
    super(scope, new ProxyObject(scope._object as object, "proxyPlaywright"), "Playwright", {
      chromium,
      firefox,
      webkit,
      android,
      electron,
      preLaunchedBrowser: browser,
    });
  }
}
