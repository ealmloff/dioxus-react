import { Browser, BrowserContext } from "../internals";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal Browser + BrowserContext subclasses for wry. One prelaunched
 * context, one page, no cookies/storage/network/video. Unsupported surface
 * throws on call; Playwright rarely reaches it for the APIs we exercise.
 */
export class WryBrowser extends (Browser as any) {
  private readonly _wryContexts = new Set<unknown>();

  constructor(parent: unknown) {
    const tmp = (globalThis as any).process?.env?.TMPDIR ?? "/tmp";
    super(parent, {
      name: "webkit",
      sdkLanguage: "javascript",
      isChromium: false,
      artifactsDir: `${tmp}/wry-playwright-artifacts`,
      tracesDir: `${tmp}/wry-playwright-traces`,
      downloadsPath: `${tmp}/wry-playwright-downloads`,
    });
  }

  _registerContext(context: unknown): void {
    this._wryContexts.add(context);
  }

  contexts(): unknown[] {
    return [...this._wryContexts];
  }

  version(): string {
    return "wry-wkwebview";
  }

  userAgent(): string {
    return "";
  }

  async _closePage(): Promise<void> {
    // Page lifetime is owned by the connection layer, not the browser.
  }
}

export class WryBrowserContext extends (BrowserContext as any) {
  private readonly _wryPages = new Set<unknown>();

  constructor(browser: WryBrowser) {
    super(browser, {
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

  canResetForReuse(): boolean {
    return false;
  }

  async doGetCookies() { return []; }
  async doAddCookies() {}
  async doClearCookies() {}
  async doSetExtraHTTPHeaders() {}
  async doSetHTTPCredentials() {}
  async doGrantPermissions() {}
  async doClearPermissions() {}
  async doSetGeolocation() {}
  async doSetOffline() {}
  async doExposePlaywrightBinding() {}
  async doAddInitScript() {}
  async doRemoveInitScripts() {}
  async doUpdateDefaultViewport() {}
  async doUpdateDefaultEmulatedMedia() {}
  async doUpdateRequestInterception() {}
  async doClose() {}
}
