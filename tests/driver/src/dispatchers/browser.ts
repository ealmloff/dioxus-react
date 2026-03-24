import { setTimeout as sleep } from "node:timers/promises";
import type { ProxyAppController } from "../controller";
import { Dispatcher, type DispatcherLike, serializeResult } from "../internals";
import { DummyDispatcher, ProxyObject } from "./base";
import { ProxyHandleDispatcher } from "./handle";
import type {
  ControllerEvent,
  HandleMeta,
  NameValue,
  NetworkRequestRecord,
  NetworkResponseRecord,
  RequestSizes,
  SerializedErrorValue,
} from "../types";
import type {
  CheckParams,
  ContentParams,
  DispatchPageEventParams,
  DragAndDropParams,
  EvalParams,
  ExpectParams,
  FillParams,
  Geolocation,
  GrantPermissionsParams,
  GetAttributeParams,
  GotoParams,
  HighlightParams,
  PressParams,
  QueryCountParams,
  ResolveParams,
  SelectorEvalParams,
  SelectorParamsWithStrict,
  ScreenshotParams,
  SetGeolocationParams,
  SetInputFilesParams,
  SetViewportSizeParams,
  TestIdAttributeNameParams,
  TypeParams,
  WaitForTimeoutParams,
  WaitForFunctionParams,
  WaitSelectorParams,
  SelectOptionParams,
} from "./protocol";

type ContextSubscriptionEvent =
  "console"
  | "dialog"
  | "request"
  | "response"
  | "requestFinished"
  | "requestFailed";

type PageSubscriptionEvent = ContextSubscriptionEvent | "fileChooser";
type WaitForEventInfoParams = {
  info?: {
    waitId?: string;
    phase?: string;
    event?: string;
  };
};

declare const Buffer: {
  from(data: Uint8Array): Uint8Array;
};

const headerBytes = (headers: NameValue[]): number => {
  return headers.reduce((total, header) => total + header.name.length + header.value.length + 4, 0);
};

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
  private subscriptions = new Set<ContextSubscriptionEvent>();
  private requestDispatchers = new Map<number, ProxyRequestDispatcher>();
  private responseDispatchers = new Map<number, ProxyResponseDispatcher>();
  private controllerListener: (event: ControllerEvent) => void;

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
    this.controllerListener = (event) => {
      this.handleControllerEvent(event);
    };
    this.controller.onEvent(this.controllerListener);
    this._dispatchEvent("page", { page: this.page });
  }

  async updateSubscription(params: { event: ContextSubscriptionEvent; enabled: boolean }): Promise<void> {
    if (params.enabled) {
      this.subscriptions.add(params.event);
    } else {
      this.subscriptions.delete(params.event);
    }
    await this.syncEventPolling();
  }

  async newPage(): Promise<{ page: ProxyPageDispatcher }> {
    return { page: this.page };
  }

  async grantPermissions(params: GrantPermissionsParams): Promise<void> {
    await this.controller.grantPermissions(params.permissions);
  }

  async setGeolocation(params: SetGeolocationParams): Promise<void> {
    const geolocation = params.geolocation
      ? { latitude: params.geolocation.latitude, longitude: params.geolocation.longitude }
      : null;
    await this.controller.setGeolocation(geolocation);
  }

  async setTestIdAttributeName(params: TestIdAttributeNameParams): Promise<void> {
    await this.controller.setTestIdAttributeName(params.testIdAttributeName);
  }

  async syncEventPolling(): Promise<void> {
    await this.controller.setEventPollingRequested(
      this.subscriptions.size > 0 || this.page.needsEventPolling()
    );
  }

  private shouldDispatch(event: ContextSubscriptionEvent): boolean {
    return this.subscriptions.has(event) || this.page.hasSubscription(event);
  }

  private requestDispatcher(record: NetworkRequestRecord): ProxyRequestDispatcher {
    const existing = this.requestDispatchers.get(record.id);
    if (existing) {
      return existing;
    }
    const dispatcher = new ProxyRequestDispatcher(this, this.page.mainFrame(), record);
    this.requestDispatchers.set(record.id, dispatcher);
    this.adopt(dispatcher);
    return dispatcher;
  }

  private responseDispatcher(
    requestDispatcher: ProxyRequestDispatcher,
    responseRecord: NetworkResponseRecord
  ): ProxyResponseDispatcher {
    const existing = this.responseDispatchers.get(requestDispatcher.requestId);
    if (existing) {
      return existing;
    }
    const dispatcher = new ProxyResponseDispatcher(this, requestDispatcher, responseRecord);
    this.responseDispatchers.set(requestDispatcher.requestId, dispatcher);
    this.adopt(dispatcher);
    requestDispatcher.setResponse(dispatcher);
    return dispatcher;
  }

  private handleControllerEvent(event: ControllerEvent): void {
    switch (event.kind) {
      case "console":
        if (!this.shouldDispatch("console")) {
          return;
        }
        this._dispatchEvent("console", {
          type: event.message.type,
          text: event.message.text,
          args: [],
          location: event.message.location,
          page: this.page,
          worker: undefined,
        });
        return;
      case "pageerror":
        this._dispatchEvent("pageError", {
          error: event.error,
          page: this.page,
        });
        return;
      case "dialog":
        if (!this.shouldDispatch("dialog")) {
          return;
        }
        this._dispatchEvent("dialog", {
          dialog: new ProxyDialogDispatcher(this, this.controller, this.page, event.dialog),
        });
        return;
      case "request":
        {
          const request = this.requestDispatcher(event.request);
          if (!this.shouldDispatch("request")) {
            return;
          }
          this._dispatchEvent("request", {
            request,
            page: this.page,
          });
        }
        return;
      case "response":
        {
          const request = this.requestDispatchers.get(event.requestId);
          if (!request) {
            return;
          }
          const response = this.responseDispatcher(request, event.response);
          if (!this.shouldDispatch("response")) {
            return;
          }
          this._dispatchEvent("response", {
            response,
            page: this.page,
          });
        }
        return;
      case "requestFinished":
        {
          const request = this.requestDispatchers.get(event.requestId);
          if (!request) {
            return;
          }
          const response = event.response
            ? this.responseDispatcher(request, event.response)
            : undefined;
          if (!this.shouldDispatch("requestFinished")) {
            return;
          }
          this._dispatchEvent("requestFinished", {
            request,
            response,
            responseEndTiming: event.responseEndTiming,
            page: this.page,
          });
        }
        return;
      case "requestFailed":
        if (!this.shouldDispatch("requestFailed")) {
          return;
        }
        {
          const request = this.requestDispatchers.get(event.requestId);
          if (!request) {
            return;
          }
          this._dispatchEvent("requestFailed", {
            request,
            failureText: event.failureText,
            responseEndTiming: event.responseEndTiming,
            page: this.page,
          });
        }
        return;
      case "filechooser":
        this.page.handleFileChooser(event.fileChooser.handle, event.fileChooser.isMultiple);
        return;
      case "viewport":
        this.page.handleViewportSizeChanged(event.viewportSize);
        return;
    }
  }

  async close(): Promise<void> {
    await this.disposeTree();
  }

  async disposeTree(): Promise<void> {
    this.controller.offEvent(this.controllerListener);
    await this.controller.setEventPollingRequested(false);
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

class ProxyDialogDispatcher extends Dispatcher {
  private controller: ProxyAppController;
  private dialogId: number;

  constructor(
    parent: DispatcherLike,
    controller: ProxyAppController,
    page: ProxyPageDispatcher,
    dialog: Extract<ControllerEvent, { kind: "dialog" }>["dialog"],
  ) {
    super(parent, new ProxyObject(parent._object as object, "proxyDialog"), "Dialog", {
      page,
      type: dialog.type,
      message: dialog.message,
      defaultValue: dialog.defaultValue,
    });
    this.controller = controller;
    this.dialogId = dialog.id;
  }

  async accept(params?: { promptText?: string }): Promise<void> {
    await this.controller.acceptDialog(this.dialogId, params?.promptText);
    this._dispose();
  }

  async dismiss(): Promise<void> {
    await this.controller.dismissDialog(this.dialogId);
    this._dispose();
  }
}

class ProxyRequestDispatcher extends Dispatcher {
  readonly requestId: number;
  private requestRecord: NetworkRequestRecord;
  private responseDispatcher: ProxyResponseDispatcher | undefined;

  constructor(
    parent: DispatcherLike,
    frame: ProxyFrameDispatcher,
    requestRecord: NetworkRequestRecord,
  ) {
    super(parent, new ProxyObject(parent._object as object, "proxyRequest"), "Request", {
      frame,
      serviceWorker: undefined,
      url: requestRecord.url,
      resourceType: requestRecord.resourceType,
      method: requestRecord.method,
      postData: requestRecord.postData,
      headers: requestRecord.headers,
      isNavigationRequest: requestRecord.isNavigationRequest,
      redirectedFrom: undefined,
      hasResponse: false,
    });
    this.requestId = requestRecord.id;
    this.requestRecord = requestRecord;
  }

  setResponse(responseDispatcher: ProxyResponseDispatcher): void {
    this.responseDispatcher = responseDispatcher;
    this._dispatchEvent("response", {});
  }

  async rawRequestHeaders(): Promise<{ headers: NameValue[] }> {
    return { headers: this.requestRecord.headers };
  }

  async response(): Promise<{ response?: ProxyResponseDispatcher }> {
    return { response: this.responseDispatcher };
  }

  requestRecordValue(): NetworkRequestRecord {
    return this.requestRecord;
  }
}

class ProxyResponseDispatcher extends Dispatcher {
  private requestDispatcher: ProxyRequestDispatcher;
  private responseRecord: NetworkResponseRecord;

  constructor(
    parent: DispatcherLike,
    requestDispatcher: ProxyRequestDispatcher,
    responseRecord: NetworkResponseRecord,
  ) {
    super(parent, new ProxyObject(parent._object as object, "proxyResponse"), "Response", {
      request: requestDispatcher,
      url: responseRecord.url,
      status: responseRecord.status,
      statusText: responseRecord.statusText,
      headers: responseRecord.headers,
      timing: responseRecord.timing,
      fromServiceWorker: responseRecord.fromServiceWorker,
    });
    this.requestDispatcher = requestDispatcher;
    this.responseRecord = responseRecord;
  }

  async body(): Promise<{ binary: Uint8Array }> {
    return { binary: this.responseRecord.body };
  }

  async securityDetails(): Promise<{ value?: undefined }> {
    return { value: undefined };
  }

  async serverAddr(): Promise<{ value?: undefined }> {
    return { value: undefined };
  }

  async rawResponseHeaders(): Promise<{ headers: NameValue[] }> {
    return { headers: this.responseRecord.headers };
  }

  async sizes(): Promise<{ sizes: RequestSizes }> {
    const requestRecord = this.requestDispatcher.requestRecordValue();
    return {
      sizes: {
        requestBodySize: requestRecord.postData?.byteLength ?? 0,
        requestHeadersSize: headerBytes(requestRecord.headers),
        responseBodySize: this.responseRecord.body.byteLength,
        responseHeadersSize: headerBytes(this.responseRecord.headers),
      },
    };
  }
}

class ProxyPageDispatcher extends Dispatcher {
  private controller: ProxyAppController;
  private frames = new Map<number, ProxyFrameDispatcher>();
  private frame: ProxyFrameDispatcher;
  private subscriptions = new Set<PageSubscriptionEvent>();
  private eventWaits = new Map<string, string>();
  private eventWaitCounts = new Map<string, number>();

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

  mainFrame(): ProxyFrameDispatcher {
    return this.frame;
  }

  hasSubscription(event: ContextSubscriptionEvent): boolean {
    return this.subscriptions.has(event);
  }

  needsEventPolling(): boolean {
    return this.subscriptions.size > 0 || this.eventWaitCounts.size > 0;
  }

  private contextDispatcher(): ProxyBrowserContextDispatcher {
    const parent = this.parentScope();
    if (!parent || parent._type !== "BrowserContext") {
      throw new Error("Cannot resolve browser context dispatcher");
    }
    return parent as unknown as ProxyBrowserContextDispatcher;
  }

  private adjustEventWait(event: string, delta: 1 | -1): void {
    const next = (this.eventWaitCounts.get(event) ?? 0) + delta;
    if (next > 0) {
      this.eventWaitCounts.set(event, next);
      return;
    }
    this.eventWaitCounts.delete(event);
  }

  handleFileChooser(meta: HandleMeta, isMultiple: boolean): void {
    if (!this.subscriptions.has("fileChooser")) {
      return;
    }
    this._dispatchEvent("fileChooser", {
      element: new ProxyHandleDispatcher(this, this.controller, meta, this.frame),
      isMultiple,
    });
  }

  handleViewportSizeChanged(viewportSize: { width: number; height: number }): void {
    this._dispatchEvent("viewportSizeChanged", { viewportSize });
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

  async updateSubscription(params: { event: PageSubscriptionEvent; enabled: boolean }): Promise<void> {
    if (params.enabled) {
      this.subscriptions.add(params.event);
    } else {
      this.subscriptions.delete(params.event);
    }
    await this.contextDispatcher().syncEventPolling();
  }

  async waitForEventInfo(params: WaitForEventInfoParams): Promise<void> {
    const info = params.info;
    const waitId = info?.waitId;
    const phase = info?.phase;
    if (!waitId || !phase) {
      return;
    }
    if (phase === "before") {
      const event = info.event;
      if (!event) {
        return;
      }
      this.eventWaits.set(waitId, event);
      this.adjustEventWait(event, 1);
      await this.contextDispatcher().syncEventPolling();
      return;
    }
    if (phase === "after") {
      const event = this.eventWaits.get(waitId);
      if (!event) {
        return;
      }
      this.eventWaits.delete(waitId);
      this.adjustEventWait(event, -1);
      await this.contextDispatcher().syncEventPolling();
    }
  }

  async reload(): Promise<Record<string, never>> {
    await this.controller.reload();
    await this.frame.refresh();
    return {};
  }

  async goBack(): Promise<{ response?: undefined }> {
    await this.controller.goBack();
    await this.frame.refresh();
    return { response: undefined };
  }

  async setViewportSize(params: SetViewportSizeParams): Promise<void> {
    await this.controller.setViewportSize(params.viewportSize);
    this.handleViewportSizeChanged(params.viewportSize);
  }

  async close(): Promise<void> {
    await this.controller.close();
    this._dispatchEvent("close");
    this._dispose();
  }

  async snapshotForAI(): Promise<{ full: string }> {
    return { full: await this.controller.content() };
  }

  async screenshot(params: ScreenshotParams): Promise<{ binary: Uint8Array }> {
    return { binary: Buffer.from(await this.controller.pageScreenshot(params.fullPage ?? false)) };
  }

  async consoleMessages(): Promise<{
    messages: Array<{
      type: string;
      text: string;
      args: [];
      location: {
        url: string;
        lineNumber: number;
        columnNumber: number;
      };
    }>;
  }> {
    const messages = await this.controller.consoleMessages();
    return {
      messages: messages.map((message) => ({
        type: message.type,
        text: message.text,
        args: [],
        location: message.location,
      })),
    };
  }

  async pageErrors(): Promise<{ errors: SerializedErrorValue[] }> {
    return {
      errors: await this.controller.pageErrors(),
    };
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

  async dragAndDrop(params: DragAndDropParams): Promise<void> {
    await this.controller.dragAndDrop(
      this.frameId,
      params.source,
      params.target,
      params.strict
    );
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

  async setInputFiles(params: SelectorParamsWithStrict & SetInputFilesParams): Promise<void> {
    await this.controller.setInputFiles(
      params.selector,
      null,
      null,
      params.payloads || [],
      params.strict,
      this.frameId
    );
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
