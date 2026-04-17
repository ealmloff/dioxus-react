import { FrameExecutionContext, Page } from "../internals";
import type { WryBrowserContext } from "./browser";
import { WryExecutionContextDelegate } from "./executionContext";
import { WryRawKeyboard, WryRawMouse, WryRawTouchscreen } from "./input";
import type { WryRuntime } from "./runtime";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WRY_MAIN_FRAME_ID = "wry-main";
const WRY_INITIAL_DOCUMENT_ID = "wry-doc-1";

type WryRuntimeEvent =
  | { kind: "console"; type: string; text: string }
  | { kind: "pageerror"; name: string; message: string; stack: string }
  | { kind: "lifecycle"; event: "load" | "domcontentloaded" };

/**
 * PageDelegate for a wry webview. Implements the slice of Playwright's
 * PageDelegate contract (see chromium/crPage.js) that Playwright actually
 * calls in practice. Unsupported methods throw on invocation; we add them
 * back only when a failing test demands it.
 */
export class WryPageDelegate {
  readonly rawKeyboard: WryRawKeyboard;
  readonly rawMouse: WryRawMouse;
  readonly rawTouchscreen: WryRawTouchscreen;
  readonly _page: any;
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
    this._page = new (Page as any)(this, browserContext);
  }

  async initialize(initialUrl = "wry://index.html"): Promise<void> {
    const fm = this._page.frameManager;
    fm.frameAttached(WRY_MAIN_FRAME_ID, null);
    const frame = fm.mainFrame();
    const context = new (FrameExecutionContext as any)(this._executionContextDelegate, frame, "main");
    frame._setContext("main", context);
    frame._setContext("utility", context);
    fm.frameCommittedNewDocumentNavigation(WRY_MAIN_FRAME_ID, initialUrl, "", WRY_INITIAL_DOCUMENT_ID, true);
    fm.frameLifecycleEvent(WRY_MAIN_FRAME_ID, "load");
    fm.frameLifecycleEvent(WRY_MAIN_FRAME_ID, "domcontentloaded");
    await this._page.reportAsNew(undefined);
    this.startEventFerry();
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
    if (!Array.isArray(events)) return;
    for (const event of events) {
      if (event.kind === "console") {
        this._page.addConsoleMessage(null, event.type, [], { url: "", lineNumber: 0, columnNumber: 0 }, event.text);
      } else if (event.kind === "pageerror") {
        const err = new Error(event.message);
        err.name = event.name;
        if (event.stack) err.stack = event.stack;
        this._page.addPageError(err);
      } else if (event.kind === "lifecycle") {
        this._page.frameManager.frameLifecycleEvent(WRY_MAIN_FRAME_ID, event.event);
      }
    }
  }

  // -------- PageDelegate interface (minimal slice) --------

  async navigateFrame(_frame: any, url: string): Promise<any> {
    await this._runtime.call("rawEvaluateJSON", `(window.location.assign(${JSON.stringify(url)}), null)`);
    return { newDocumentId: `wry-doc-${Date.now()}` };
  }

  async reload(): Promise<void> {
    await this._runtime.call("rawEvaluateJSON", "(window.location.reload(), null)");
  }

  async closePage(): Promise<void> {
    await (this._browserContext._browser as any)._closePage?.(this);
  }

  async getContentFrame(): Promise<null> {
    return null;
  }

  async getOwnerFrame(handle: any): Promise<string> {
    return handle?._context?.frame?._id ?? WRY_MAIN_FRAME_ID;
  }

  async getBoundingBox(handle: any): Promise<any> {
    return handle.evaluate((el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  }

  async scrollRectIntoViewIfNeeded(handle: any): Promise<string> {
    try {
      await handle.evaluate((el: Element) => {
        if (!el.isConnected) throw new Error("error:notconnected");
        const any = el as any;
        if (typeof any.scrollIntoViewIfNeeded === "function") any.scrollIntoViewIfNeeded(false);
        else el.scrollIntoView({ block: "center", inline: "center" });
      });
      return "done";
    } catch (error) {
      if ((error as Error).message.includes("error:notconnected")) return "error:notconnected";
      throw error;
    }
  }

  async getContentQuads(handle: any): Promise<any> {
    return handle.evaluate((el: Element) =>
      Array.from(el.getClientRects()).map((r) => [
        { x: r.left, y: r.top },
        { x: r.right, y: r.top },
        { x: r.right, y: r.bottom },
        { x: r.left, y: r.bottom },
      ]),
    );
  }

  async adoptElementHandle<T>(handle: T): Promise<T> {
    return handle;
  }

  rafCountForStablePosition(): number {
    return 1;
  }

  shouldToggleStyleSheetToSyncAnimations(): boolean {
    return false;
  }

  coverage(): null {
    return null;
  }

  // Methods below are noops that Playwright calls unconditionally during
  // lifecycle/context setup. Leaving them as async-noops is cheaper than
  // letting the call crash.
  async updateExtraHTTPHeaders() {}
  async updateEmulatedViewportSize() {}
  async updateEmulateMedia() {}
  async updateRequestInterception() {}
  async updateFileChooserInterception() {}
  async updateOffline() {}
  async updateHttpCredentials() {}
  async updateGeolocation() {}
  async updateUserAgent() {}
  async bringToFront() {}
  async addInitScript() {}
  async removeInitScripts() {}
  async exposePlaywrightBinding() {}
  async resetForReuse() {}
  async inputActionEpilogue() {}
  async requestGC() {}
  async setBackgroundColor() {}
  async stopScreencast() {}
  goBack() { return Promise.resolve(false); }
  goForward() { return Promise.resolve(false); }
}
