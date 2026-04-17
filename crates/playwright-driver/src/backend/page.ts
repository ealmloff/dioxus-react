import { FrameExecutionContext, Page } from "../internals";
import type { WryBrowserContext } from "./browser";
import { WryExecutionContextDelegate } from "./executionContext";
import { WryRawKeyboard, WryRawMouse, WryRawTouchscreen } from "./input";
import type { WryRuntime } from "./runtime";

interface PageLike {
  frameManager: {
    frameAttached(frameId: string, parentFrameId: string | null): FrameLike;
    frameCommittedNewDocumentNavigation(
      frameId: string,
      url: string,
      name: string,
      documentId: string,
      initial: boolean,
    ): void;
    frameLifecycleEvent(frameId: string, event: string): void;
    mainFrame(): FrameLike;
  };
  addConsoleMessage(worker: unknown, type: string, args: unknown[], location: ConsoleLocation, text: string): void;
  addPageError(error: Error): void;
  reportAsNew(opener: unknown, error?: unknown): Promise<void>;
}

interface ConsoleLocation {
  url: string;
  lineNumber: number;
  columnNumber: number;
}

type WryRuntimeEvent =
  | { kind: "console"; type: string; text: string }
  | { kind: "pageerror"; name: string; message: string; stack: string }
  | { kind: "lifecycle"; event: "load" | "domcontentloaded" }
  | { kind: "dialog"; id: number; type: string; message: string; defaultValue: string };

interface FrameLike {
  _id: string;
  _setContext(world: "main" | "utility", context: unknown): void;
}

type PageCtor = new (delegate: unknown, browserContext: unknown) => PageLike;
type FrameExecutionContextCtor = new (
  delegate: unknown,
  frame: unknown,
  world: string,
) => unknown;

const PageBaseCtor = Page as unknown as PageCtor;
const FrameExecutionContextCtor = FrameExecutionContext as unknown as FrameExecutionContextCtor;

const WRY_MAIN_FRAME_ID = "wry-main";
const WRY_INITIAL_DOCUMENT_ID = "wry-doc-1";

/**
 * PageDelegate for a wry webview. Implements the ~40-method contract Playwright's
 * Page class expects from its `delegate` (modeled on
 * node_modules/playwright-core/lib/server/chromium/crPage.js).
 *
 * Most methods are noop or throw-not-supported stubs because the embedded
 * wry webview does not expose OS-level features (screenshots, PDF, video,
 * geolocation, cookies, HTTP credentials, etc.). The methods that do real
 * work are:
 *  - navigateFrame / reload
 *  - closePage
 *  - addInitScript / removeInitScripts
 *  - adoptElementHandle (identity since there's only one world)
 *  - getContentQuads / scrollRectIntoViewIfNeeded (via element evaluate)
 *  - inputActionEpilogue (noop; no CDP session to flush)
 */
export class WryPageDelegate {
  readonly rawKeyboard: WryRawKeyboard;
  readonly rawMouse: WryRawMouse;
  readonly rawTouchscreen: WryRawTouchscreen;
  readonly _page: PageLike;
  readonly _browserContext: WryBrowserContext;
  readonly _runtime: WryRuntime;
  readonly _executionContextDelegate: WryExecutionContextDelegate;

  private eventPoller: ReturnType<typeof setInterval> | null = null;
  private eventPollInFlight = false;
  private stopped = false;

  constructor(browserContext: WryBrowserContext, runtime: WryRuntime) {
    this._browserContext = browserContext;
    this._runtime = runtime;
    this._executionContextDelegate = new WryExecutionContextDelegate(runtime);
    this.rawKeyboard = new WryRawKeyboard(runtime);
    this.rawMouse = new WryRawMouse(runtime);
    this.rawTouchscreen = new WryRawTouchscreen(runtime);
    this._page = new PageBaseCtor(this, browserContext);
  }

  startEventFerry(intervalMs = 50): void {
    if (this.eventPoller) return;
    this.eventPoller = setInterval(() => {
      if (this.stopped || this.eventPollInFlight) return;
      this.eventPollInFlight = true;
      void this.drainEvents().finally(() => {
        this.eventPollInFlight = false;
      });
    }, intervalMs);
  }

  stopEventFerry(): void {
    this.stopped = true;
    if (this.eventPoller) {
      clearInterval(this.eventPoller);
      this.eventPoller = null;
    }
  }

  private async drainEvents(): Promise<void> {
    let events: WryRuntimeEvent[];
    try {
      events = await this._runtime.call<WryRuntimeEvent[]>("takeEvents");
    } catch {
      return;
    }
    if (!Array.isArray(events) || events.length === 0) return;
    for (const event of events) {
      this.dispatchEvent(event);
    }
  }

  private dispatchEvent(event: WryRuntimeEvent): void {
    if (event.kind === "console") {
      this._page.addConsoleMessage(null, event.type, [], { url: "", lineNumber: 0, columnNumber: 0 }, event.text);
      return;
    }
    if (event.kind === "pageerror") {
      const err = new Error(event.message);
      err.name = event.name;
      if (event.stack) err.stack = event.stack;
      this._page.addPageError(err);
      return;
    }
    if (event.kind === "lifecycle") {
      this._page.frameManager.frameLifecycleEvent(WRY_MAIN_FRAME_ID, event.event);
      return;
    }
    // Dialog ferry is sketched but not wired up yet (Tier 3).
  }

  /**
   * Call once after the runtime bridge is connected and __pwx is installed.
   * Attaches the main frame and advertises the initial document load so
   * Playwright's FrameManager treats the page as initialized.
   */
  async initialize(initialUrl = "wry://index.html"): Promise<void> {
    this._page.frameManager.frameAttached(WRY_MAIN_FRAME_ID, null);
    const frame = this._page.frameManager.mainFrame();
    const mainContext = new FrameExecutionContextCtor(
      this._executionContextDelegate,
      frame,
      "main",
    );
    frame._setContext("main", mainContext);
    // wry has no utility world; reuse the main context. Playwright still calls
    // _utilityContext() in some paths (InjectedScript), and getting the same
    // context back is harmless.
    frame._setContext("utility", mainContext);
    this._page.frameManager.frameCommittedNewDocumentNavigation(
      WRY_MAIN_FRAME_ID,
      initialUrl,
      "",
      WRY_INITIAL_DOCUMENT_ID,
      true,
    );
    this._page.frameManager.frameLifecycleEvent(WRY_MAIN_FRAME_ID, "load");
    this._page.frameManager.frameLifecycleEvent(WRY_MAIN_FRAME_ID, "domcontentloaded");
    await this._page.reportAsNew(undefined);
    this.startEventFerry();
  }

  // -------- PageDelegate interface (mirrors crPage.js shape) --------

  async navigateFrame(_frame: unknown, url: string, _referrer: unknown): Promise<unknown> {
    await this._runtime.call("rawEvaluateJSON", `(window.location.assign(${JSON.stringify(url)}), null)`);
    return { newDocumentId: `wry-doc-${Date.now()}` };
  }

  async updateExtraHTTPHeaders(): Promise<void> {
    /* not supported on wry */
  }

  async updateGeolocation(): Promise<void> {
    /* not supported on wry */
  }

  async updateOffline(): Promise<void> {
    /* not supported on wry */
  }

  async updateHttpCredentials(): Promise<void> {
    /* not supported on wry */
  }

  async updateEmulatedViewportSize(): Promise<void> {
    /* not supported: viewport is owned by the wry window */
  }

  async bringToFront(): Promise<void> {
    /* not supported */
  }

  async updateEmulateMedia(): Promise<void> {
    /* not supported */
  }

  async updateUserAgent(): Promise<void> {
    /* not supported */
  }

  async updateRequestInterception(): Promise<void> {
    /* deferred to Tier 2 */
  }

  async updateFileChooserInterception(): Promise<void> {
    /* deferred to Tier 3 */
  }

  async reload(): Promise<void> {
    await this._runtime.call("rawEvaluateJSON", "(window.location.reload(), null)");
  }

  goBack(): Promise<boolean> {
    return Promise.resolve(false);
  }

  goForward(): Promise<boolean> {
    return Promise.resolve(false);
  }

  async requestGC(): Promise<void> {
    /* not exposed by wry */
  }

  async addInitScript(_initScript: unknown, _world: "main" | "utility" = "main"): Promise<void> {
    // Init scripts would need to be injected before app JS runs; wry currently
    // does not support this cleanly. Deferred.
  }

  async exposePlaywrightBinding(): Promise<void> {
    /* deferred */
  }

  async removeInitScripts(): Promise<void> {
    /* deferred (paired with addInitScript) */
  }

  async closePage(_runBeforeUnload: boolean): Promise<void> {
    await this._browserContext._browser._closePage?.(this);
  }

  async setBackgroundColor(): Promise<void> {
    /* not supported */
  }

  async takeScreenshot(): Promise<never> {
    throw new Error("Screenshots are not supported on the wry backend yet");
  }

  async getContentFrame(_handle: unknown): Promise<null> {
    return null;
  }

  async getOwnerFrame(handle: OwnerFrameHandle): Promise<string | null> {
    return handle._context?.frame?._id ?? WRY_MAIN_FRAME_ID;
  }

  async getBoundingBox(handle: EvaluableHandle): Promise<BoundingBox | null> {
    return handle.evaluate((el: Element) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  }

  async scrollRectIntoViewIfNeeded(
    handle: EvaluableHandle,
    _rect: unknown,
  ): Promise<"error:notconnected" | "error:notvisible" | "done"> {
    try {
      await handle.evaluate((el: Element) => {
        if (!el.isConnected) throw new Error("error:notconnected");
        const anyEl = el as Element & { scrollIntoViewIfNeeded?: (center: boolean) => void };
        if (typeof anyEl.scrollIntoViewIfNeeded === "function") {
          anyEl.scrollIntoViewIfNeeded(false);
          return;
        }
        el.scrollIntoView({ block: "center", inline: "center" });
      });
      return "done";
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes("error:notconnected")) return "error:notconnected";
      throw error;
    }
  }

  async startScreencast(): Promise<never> {
    throw new Error("Screencast is not supported on the wry backend");
  }

  async stopScreencast(): Promise<void> {
    /* noop */
  }

  rafCountForStablePosition(): number {
    return 1;
  }

  async getContentQuads(handle: EvaluableHandle): Promise<Quad[] | null> {
    return handle.evaluate((el: Element) => {
      const rects = el.getClientRects();
      const quads: Array<Array<{ x: number; y: number }>> = [];
      for (const rect of Array.from(rects)) {
        quads.push([
          { x: rect.left, y: rect.top },
          { x: rect.right, y: rect.top },
          { x: rect.right, y: rect.bottom },
          { x: rect.left, y: rect.bottom },
        ]);
      }
      return quads;
    });
  }

  async setInputFilePaths(): Promise<never> {
    throw new Error("File uploads are not supported on the wry backend yet");
  }

  async adoptElementHandle<T>(handle: T, _to: unknown): Promise<T> {
    // All handles live in the single shared execution context.
    return handle;
  }

  async inputActionEpilogue(): Promise<void> {
    /* no CDP session to flush */
  }

  async resetForReuse(): Promise<void> {
    /* session reuse not supported */
  }

  coverage(): null {
    return null;
  }

  shouldToggleStyleSheetToSyncAnimations(): boolean {
    return false;
  }

  async getFrameElement(_frame: unknown): Promise<never> {
    throw new Error("Only the main frame is exposed on the wry backend");
  }
}

// --- Helper types for PageDelegate method contracts ---

interface EvaluableHandle {
  evaluate<R>(fn: (...args: unknown[]) => R, arg?: unknown): Promise<R>;
}

interface OwnerFrameHandle {
  _context?: { frame?: { _id?: string } };
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Quad = Array<{ x: number; y: number }>;
