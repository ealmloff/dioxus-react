import { Browser, BrowserContext } from "../internals";

export interface BrowserBase {
  options: { name: string; sdkLanguage?: string };
  _defaultContext: unknown;
  _didClose?(): void;
  _closePage?(page: unknown): Promise<void>;
  emit(event: string, payload?: unknown): void;
}

export interface BrowserContextBase {
  _options: Record<string, unknown>;
  _browser: BrowserBase;
}

type BrowserCtor = new (parent: unknown, options: { name: string; sdkLanguage?: string }) => BrowserBase;
type BrowserContextCtor = new (
  browser: BrowserBase,
  options: Record<string, unknown>,
  browserContextId?: string,
) => BrowserContextBase;

const BrowserBaseCtor = Browser as unknown as BrowserCtor;
const BrowserContextBaseCtor = BrowserContext as unknown as BrowserContextCtor;

/**
 * Minimal Browser subclass that represents the embedded wry webview as a
 * single prelaunched "browser" with one persistent context. Most Browser APIs
 * (newContext, version, userAgent) are stubs — we only ever serve a single
 * app window.
 */
export class WryBrowser extends BrowserBaseCtor {
  private closed = false;
  private readonly _wryContexts = new Set<unknown>();

  constructor(parent: unknown) {
    const tmpDir = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TMPDIR ?? "/tmp";
    super(parent, {
      name: "webkit",
      sdkLanguage: "javascript",
      isChromium: false,
      artifactsDir: `${tmpDir}/wry-playwright-artifacts`,
      tracesDir: `${tmpDir}/wry-playwright-traces`,
      downloadsPath: `${tmpDir}/wry-playwright-downloads`,
    } as Record<string, unknown> as { name: string; sdkLanguage?: string });
  }

  _registerContext(context: unknown): void {
    this._wryContexts.add(context);
  }

  contexts(): unknown[] {
    return [...this._wryContexts];
  }

  // Playwright's Browser uses these helpers when it closes or dispatches events.
  async doCreateNewContext(): Promise<never> {
    throw new Error("WryBrowser exposes a single prelaunched context; newContext is not supported");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this._didClose?.();
    this.emit("disconnected");
  }

  isConnected(): boolean {
    return !this.closed;
  }

  version(): string {
    return "wry-wkwebview";
  }

  userAgent(): string {
    return "";
  }

  // Helper for WryPageDelegate.closePage() — BrowserContext.newPage calls
  // delegate.closePage which in CRPage routes through browser._closePage.
  async _closePage(_page: unknown): Promise<void> {
    // No-op: the wry app process is owned by the connection layer, not the page.
  }
}

/**
 * Minimal BrowserContext for wry. One context per wry app instance. Cookies,
 * storage state, routing, tracing, etc. are all stubs for now — the webview
 * is a single-origin app with no context-level configuration.
 */
export class WryBrowserContext extends BrowserContextBaseCtor {
  private closed = false;
  private readonly _wryPages = new Set<unknown>();

  constructor(browser: WryBrowser) {
    super(browser as unknown as BrowserBase, {
      selectorEngines: [],
      testIdAttributeName: "data-testid",
      viewport: { width: 1280, height: 720 },
      acceptDownloads: "accept",
    });
  }

  _registerPage(page: unknown): void {
    this._wryPages.add(page);
  }

  possiblyUninitializedPages(): unknown[] {
    return [...this._wryPages];
  }

  async _initialize(): Promise<void> {
    // Nothing to initialize eagerly; the wry webview is ready by the time
    // the context wrapper is constructed.
  }

  canResetForReuse(): boolean {
    return false;
  }

  async resetForReuse(): Promise<void> {
    // Not supported; tests get a fresh app process per session.
  }

  async doGetCookies(): Promise<never[]> {
    return [];
  }

  async doAddCookies(): Promise<void> {
    /* noop */
  }

  async doClearCookies(): Promise<void> {
    /* noop */
  }

  async doSetExtraHTTPHeaders(): Promise<void> {
    /* noop */
  }

  async doSetHTTPCredentials(): Promise<void> {
    /* noop */
  }

  async doGrantPermissions(): Promise<void> {
    /* noop */
  }

  async doClearPermissions(): Promise<void> {
    /* noop */
  }

  async doSetGeolocation(): Promise<void> {
    /* noop */
  }

  async doSetOffline(): Promise<void> {
    /* noop */
  }

  async doExposePlaywrightBinding(): Promise<void> {
    /* noop */
  }

  async doAddInitScript(): Promise<void> {
    /* handled on the page delegate */
  }

  async doRemoveInitScripts(): Promise<void> {
    /* noop */
  }

  async doUpdateDefaultViewport(): Promise<void> {
    /* noop */
  }

  async doUpdateDefaultEmulatedMedia(): Promise<void> {
    /* noop */
  }

  async doUpdateRequestInterception(): Promise<void> {
    /* noop */
  }

  async doClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
  }

  async doNewPage(): Promise<never> {
    throw new Error("WryBrowserContext exposes a single prelaunched page; newPage is not supported");
  }
}
