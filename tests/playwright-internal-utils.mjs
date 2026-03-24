import { webkit } from "@playwright/test";
import { PlaywrightWryProxy } from "./driver/dist/index.mjs";

const BLANK_DOCUMENT = "<!DOCTYPE html><html><head></head><body></body></html>";

export function installInternalSessionHooks(test) {
  /** @type {import("./driver/dist/index.mjs").PlaywrightWryProxy | null} */
  let proxy = null;
  /** @type {import("@playwright/test").Browser | null} */
  let browser = null;
  /** @type {import("@playwright/test").BrowserContext | null} */
  let context = null;
  /** @type {import("@playwright/test").Page | null} */
  let page = null;

  function currentPage() {
    if (!page) {
      throw new Error("Playwright page not initialized");
    }
    return page;
  }

  async function closeSession() {
    await browser?.close().catch(() => {});
    await proxy?.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
    browser = null;
    context = null;
    page = null;
    proxy = null;
  }

  async function startSession(retries = 3) {
    let lastError = null;

    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        proxy = new PlaywrightWryProxy();
        const wsEndpoint = await proxy.start();
        browser = await webkit.connect(wsEndpoint);
        context = browser.contexts()[0];
        if (!context) {
          throw new Error("Proxy did not expose a browser context");
        }
        page = context.pages()[0];
        if (!page) {
          throw new Error("Proxy did not expose a page");
        }
        return;
      } catch (error) {
        lastError = error;
        await closeSession();
      }
    }

    throw lastError ?? new Error("Failed to start Playwright WRY session");
  }

  test.beforeEach(async () => {
    await startSession();
    await currentPage().setContent(BLANK_DOCUMENT);
    await currentPage().evaluate(() => {
      delete window.globalVar;
    });
  });

  test.afterEach(async () => {
    await closeSession();
  });

  return { currentPage };
}
