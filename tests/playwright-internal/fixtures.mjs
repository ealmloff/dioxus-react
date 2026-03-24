import { test as base, expect, webkit } from "@playwright/test";
import { PlaywrightWryProxy } from "../driver/dist/index.mjs";

const BLANK_DOCUMENT = "<!DOCTYPE html><html><head></head><body></body></html>";

export const test = base.extend({
  page: async ({}, use) => {
    const proxy = new PlaywrightWryProxy();
    const wsEndpoint = await proxy.start();
    const browser = await webkit.connect(wsEndpoint);
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error("Proxy did not expose a browser context");
    }
    const page = context.pages()[0];
    if (!page) {
      throw new Error("Proxy did not expose a page");
    }

    await page.setContent(BLANK_DOCUMENT);
    await page.evaluate(() => {
      delete window.globalVar;
    });
    try {
      await use(page);
    } finally {
      await Promise.race([
        browser.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
      await proxy.close();
    }
  },
});

export { expect };
