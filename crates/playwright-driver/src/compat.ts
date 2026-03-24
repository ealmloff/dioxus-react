import type { ProxyAppController } from "./controller";
import {
  FrameSelectors,
  Selectors,
  type PlaywrightFrameSelectorsInstance,
  type PlaywrightSelectorsInstance,
} from "./playwright";
import type { FrameInfo, HandleMeta } from "./types";

type CompatValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | bigint
  | RegExp
  | Date
  | URL
  | CompatHandle
  | CompatValue[]
  | { [key: string]: CompatValue };

function serializeCompatValue(
  value: CompatValue,
  handles: CompatHandle[]
): unknown {
  if (value instanceof CompatHandle) {
    const index = handles.push(value) - 1;
    return { h: index };
  }

  if (value === null) return { v: "null" };
  if (value === undefined) return { v: "undefined" };
  if (typeof value === "boolean") return { b: value };
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { v: "NaN" };
    if (value === Infinity) return { v: "Infinity" };
    if (value === -Infinity) return { v: "-Infinity" };
    if (Object.is(value, -0)) return { v: "-0" };
    return { n: value };
  }
  if (typeof value === "string") return { s: value };
  if (typeof value === "bigint") return { bi: value.toString() };
  if (value instanceof Date) return { d: value.toJSON() };
  if (value instanceof URL) return { u: value.toString() };
  if (value instanceof RegExp) return { r: { p: value.source, f: value.flags } };
  if (Array.isArray(value)) {
    return { a: value.map((entry) => serializeCompatValue(entry, handles)) };
  }

  const out: Array<{ k: string; v: unknown }> = [];
  for (const [key, entry] of Object.entries(value)) {
    out.push({ k: key, v: serializeCompatValue(entry as CompatValue, handles) });
  }
  return { o: out };
}

function serializeCompatArgument(value: CompatValue): {
  value: unknown;
  handles: Array<{ handleId: number }>;
} {
  const handles: CompatHandle[] = [];
  return {
    value: serializeCompatValue(value, handles),
    handles: handles.map((handle) => ({ handleId: handle.handleId })),
  };
}

export class CompatBrowserContext {
  readonly _options = {
    strictSelectors: false,
  };
  readonly _browser = {
    sdkLanguage(): string {
      return "javascript";
    },
  };
  private selectorsInstance: PlaywrightSelectorsInstance;

  constructor(private controller: ProxyAppController) {
    this.selectorsInstance = new Selectors([], "data-testid");
  }

  selectors(): PlaywrightSelectorsInstance {
    return this.selectorsInstance;
  }

  setTestIdAttributeName(testIdAttributeName: string): void {
    this.selectorsInstance.setTestIdAttributeName(testIdAttributeName);
  }

  page(): CompatPage {
    return new CompatPage(this.controller, this);
  }
}

export class CompatPage {
  readonly delegate: {
    getContentFrame: (element: CompatElementHandle) => Promise<CompatFrame | null>;
    adoptElementHandle: (
      element: CompatElementHandle,
      context: CompatWorld
    ) => Promise<CompatElementHandle>;
  };
  readonly frameManager: {
    frames: () => CompatFrame[];
  };
  private readonly frames = new Map<number, CompatFrame>();

  constructor(
    private controller: ProxyAppController,
    readonly browserContext: CompatBrowserContext
  ) {
    this.delegate = {
      getContentFrame: async (element) => {
        const info = await this.controller.contentFrameInfo(element.handleId);
        return info ? this.frame(info.id, info) : null;
      },
      adoptElementHandle: async (element, context) => {
        const meta = await this.controller.cloneHandle(element.handleId);
        return new CompatElementHandle(
          this.controller,
          meta,
          context.frame,
          context,
          this
        );
      },
    };
    this.frameManager = {
      frames: () => [...this.frames.values()],
    };
  }

  mainFrame(): CompatFrame {
    return this.frame(this.controller.mainFrameId);
  }

  frame(frameId: number, info?: FrameInfo): CompatFrame {
    const cached = this.frames.get(frameId);
    if (cached) {
      if (info) cached.update(info);
      return cached;
    }

    const frame = new CompatFrame(this.controller, this, info ?? this.controller.frameInfoSync(frameId));
    this.frames.set(frameId, frame);
    return frame;
  }
}

export class CompatWorld {
  constructor(
    private controller: ProxyAppController,
    readonly frame: CompatFrame,
    readonly world: "main" | "utility"
  ) {}

  async injectedScript(): Promise<CompatJSHandle> {
    const meta = await this.controller.injectedScriptHandle(this.frame.id);
    return new CompatJSHandle(this.controller, meta, this.frame, this, this.frame.page);
  }
}

class CompatHandle {
  readonly _page: CompatPage;
  readonly _frame: CompatFrame;
  _context: CompatWorld;

  constructor(
    protected controller: ProxyAppController,
    readonly meta: HandleMeta,
    frame: CompatFrame,
    context: CompatWorld,
    page: CompatPage
  ) {
    this._frame = frame;
    this._context = context;
    this._page = page;
  }

  get handleId(): number {
    return this.meta.id;
  }

  asElement(): CompatElementHandle | null {
    return null;
  }

  async evaluate(
    pageFunction: string | ((...args: CompatValue[]) => unknown),
    arg?: CompatValue
  ): Promise<unknown> {
    const serialized = serializeCompatArgument((arg ?? undefined) as CompatValue);
    return await this.controller.evaluateOnHandle(
      this.handleId,
      String(pageFunction),
      typeof pageFunction === "function",
      serialized
    );
  }

  async evaluateHandle(
    pageFunction: string | ((...args: CompatValue[]) => unknown),
    arg?: CompatValue
  ): Promise<CompatHandle> {
    const serialized = serializeCompatArgument((arg ?? undefined) as CompatValue);
    const meta = await this.controller.evaluateHandleOnHandle(
      this.handleId,
      String(pageFunction),
      typeof pageFunction === "function",
      serialized
    );
    return createCompatHandle(this.controller, meta, this._frame, this._context, this._page);
  }

  async getProperties(): Promise<Map<string, CompatHandle>> {
    const entries = await this.controller.getHandleProperties(this.handleId);
    const map = new Map<string, CompatHandle>();
    for (const entry of entries) {
      map.set(
        entry.name,
        createCompatHandle(this.controller, entry.handle, this._frame, this._context, this._page)
      );
    }
    return map;
  }

  async jsonValue(): Promise<unknown> {
    return await this.controller.handleJsonValue(this.handleId);
  }

  dispose(): void {
    // These compat handles are internal Playwright-server wrappers used only
    // within a single proxy session. The real client-facing handles are
    // disposed through the dispatcher layer. Avoid issuing background bridge
    // traffic here because upstream helpers call dispose() opportunistically,
    // and racing those fire-and-forget RPCs against later commands is worse
    // than leaking a few temporary runtime handles for the life of the page.
  }
}

export class CompatJSHandle extends CompatHandle {}

export class CompatElementHandle extends CompatHandle {
  asElement(): CompatElementHandle {
    return this;
  }

  async ownerFrame(): Promise<CompatFrame | null> {
    const info = await this.controller.ownerFrameInfo(this.handleId);
    return info ? this._page.frame(info.id, info) : null;
  }

  async contentFrame(): Promise<CompatFrame | null> {
    const info = await this.controller.contentFrameInfo(this.handleId);
    return info ? this._page.frame(info.id, info) : null;
  }
}

function createCompatHandle(
  controller: ProxyAppController,
  meta: HandleMeta,
  frame: CompatFrame,
  context: CompatWorld,
  page: CompatPage
): CompatHandle {
  if (meta.type === "element") {
    return new CompatElementHandle(controller, meta, frame, context, page);
  }
  return new CompatJSHandle(controller, meta, frame, context, page);
}

export class CompatFrame {
  readonly _page: CompatPage;
  readonly selectors: PlaywrightFrameSelectorsInstance;
  readonly seq: number;
  _url: string;
  private info: FrameInfo;
  private readonly worlds = new Map<"main" | "utility", CompatWorld>();

  constructor(
    private controller: ProxyAppController,
    readonly page: CompatPage,
    info: FrameInfo
  ) {
    this._page = page;
    this.info = info;
    this.seq = info.id;
    this._url = info.url;
    this.selectors = new FrameSelectors(this);
  }

  get id(): number {
    return this.info.id;
  }

  name(): string {
    return this.info.name;
  }

  url(): string {
    return this.info.url;
  }

  parentFrame(): CompatFrame | null {
    return this.info.parentFrameId === null ? null : this.page.frame(this.info.parentFrameId);
  }

  frameForId(frameId: number): CompatFrame {
    return this.page.frame(frameId);
  }

  update(info: FrameInfo): void {
    this.info = info;
    this._url = info.url;
  }

  async _context(world: "main" | "utility"): Promise<CompatWorld> {
    let context = this.worlds.get(world);
    if (!context) {
      context = new CompatWorld(this.controller, this, world);
      this.worlds.set(world, context);
    }
    return context;
  }

  async _mainContext(): Promise<CompatWorld> {
    return await this._context("main");
  }

  scopeHandle(meta: HandleMeta): CompatElementHandle {
    return new CompatElementHandle(
      this.controller,
      meta,
      this,
      new CompatWorld(this.controller, this, "utility"),
      this.page
    );
  }
}
