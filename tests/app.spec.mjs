import { test, expect, webkit } from "@playwright/test";
import { PlaywrightWryProxy } from "./playwright-proxy.mjs";

test.describe.configure({ mode: "serial" });

/** @type {import("./playwright-proxy.mjs").PlaywrightWryProxy | null} */
let proxy = null;
/** @type {import("@playwright/test").Browser | null} */
let browser = null;
/** @type {import("@playwright/test").BrowserContext | null} */
let context = null;
/** @type {import("@playwright/test").Page | null} */
let page = null;

function currentPage() {
  if (!page) throw new Error("Playwright page not initialized");
  return page;
}

async function clickTab(name) {
  await currentPage().evaluate((tabName) => {
    const tab = Array.from(document.querySelectorAll(".tab")).find(
      (element) => element.textContent === tabName
    );
    if (!tab) throw new Error(`No tab matches ${tabName}`);
    tab.click();
  }, name);
}

async function clickFileEntry(name) {
  await currentPage().evaluate((fileName) => {
    const entry = Array.from(document.querySelectorAll(".file-entry")).find(
      (element) => element.querySelector(".file-name")?.textContent === fileName
    );
    if (!entry) throw new Error(`No file entry matches ${fileName}`);
    entry.click();
  }, name);
}

test.beforeAll(async () => {
  proxy = new PlaywrightWryProxy();
  const wsEndpoint = await proxy.start();
  browser = await webkit.connect(wsEndpoint);
  context = browser.contexts()[0];
  if (!context) throw new Error("Proxy did not expose a browser context");
  page = context.pages()[0];
  if (!page) throw new Error("Proxy did not expose a page");
  await expect.poll(() => currentPage().textContent("h1")).toBe("dioxus-react");
});

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  await proxy?.close();
});

test("connects to the real embedded WRY page", async () => {
  expect(currentPage().url()).toContain("wry://");
  await expect.poll(() => currentPage().evaluate(() => document.querySelectorAll(".tab").length)).toBe(4);
  await expect.poll(() => currentPage().textContent("h1")).toBe("dioxus-react");
});

test("reads native system information through the proxy", async () => {
  await clickTab("System Info");
  await expect.poll(() => currentPage().textContent("h2")).toBe("System Information");
  await expect.poll(() => currentPage().textContent(".info-table")).toBeTruthy();
  const tableText = await currentPage().textContent(".info-table");
  expect(tableText).toContain("os");
  expect(tableText).toMatch(/macos|linux|windows/);
});

test("runs native fibonacci via Playwright page actions", async () => {
  await clickTab("Fibonacci");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Native Fibonacci");
  await currentPage().fill('input[type="number"]', "7");
  await expect.poll(() => currentPage().inputValue('input[type="number"]')).toBe("7");
  await currentPage().click(".btn");
  await expect.poll(() => currentPage().textContent(".result-value")).toBe("13");
});

test("browses the real filesystem", async () => {
  await clickTab("File Explorer");
  await expect.poll(() => currentPage().textContent("h2")).toBe("File Explorer");
  await expect.poll(() => currentPage().evaluate(() => document.querySelectorAll(".file-entry").length)).toBeGreaterThan(0);
  await expect.poll(() => currentPage().inputValue(".path-input")).toContain("dioxus-react");
  await clickFileEntry("Cargo.toml");
  await expect.poll(() => currentPage().textContent(".file-preview h3")).toBe("Cargo.toml");
  await expect.poll(() => currentPage().textContent(".file-preview pre")).toContain("[package]");
});

test("switches tabs and preserves React interactivity", async () => {
  await clickTab("Counter");
  await expect.poll(() => currentPage().textContent(".counter-value")).toBe("0");
  await currentPage().click(".counter-row .btn:last-child");
  await currentPage().click(".counter-row .btn:last-child");
  await currentPage().click(".counter-row .btn:first-child");
  await expect.poll(() => currentPage().textContent(".counter-value")).toBe("1");

  await clickTab("System Info");
  await expect.poll(() => currentPage().textContent("h2")).toBe("System Information");
  await clickTab("Counter");
  await expect.poll(() => currentPage().textContent(".counter-value")).toBe("0");
});
