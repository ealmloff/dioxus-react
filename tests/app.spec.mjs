import { test, expect, webkit } from "@playwright/test";
import { PlaywrightWryProxy } from "./driver/dist/index.mjs";


/** @type {import("./driver/dist/index.mjs").PlaywrightWryProxy | null} */
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

async function startSession() {
  proxy = new PlaywrightWryProxy();
  const wsEndpoint = await proxy.start();
  browser = await webkit.connect(wsEndpoint);
  context = browser.contexts()[0];
  if (!context) throw new Error("Proxy did not expose a browser context");
  page = context.pages()[0];
  if (!page) throw new Error("Proxy did not expose a page");
  await expect.poll(() => currentPage().textContent("h1")).toBe("dioxus-react");
}

async function closeSession() {
  await browser?.close().catch(() => {});
  await proxy?.close();
  browser = null;
  context = null;
  page = null;
  proxy = null;
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

test.beforeEach(async () => {
  await startSession();
});

test.afterEach(async () => {
  await closeSession();
});

test("connects to the real embedded WRY page", async () => {
  expect(currentPage().url()).toContain("wry://");
  await expect.poll(() => currentPage().title()).toBe("dioxus-react");
  await expect.poll(() => currentPage().evaluate(() => document.querySelectorAll(".tab").length)).toBe(6);
  await expect.poll(() => currentPage().textContent("h1")).toBe("dioxus-react");
  await expect.poll(() => currentPage().content()).toContain("wasm-bindgen-wry");
});

test("reads native system information through the proxy", async () => {
  await clickTab("System Info");
  await expect.poll(() => currentPage().textContent("h2")).toBe("System Information");
  await expect.poll(() => currentPage().textContent(".info-table")).toBeTruthy();
  const tableText = await currentPage().textContent(".info-table");
  expect(tableText).toContain("os");
  expect(tableText).toMatch(/macos|linux|windows/);
});

test("runs native fibonacci and browses the real filesystem", async () => {
  await clickTab("Fibonacci");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Native Fibonacci");
  await currentPage().fill('input[type="number"]', "7");
  await expect.poll(() => currentPage().inputValue('input[type="number"]')).toBe("7");
  await currentPage().click(".btn");
  await expect.poll(() => currentPage().textContent(".result-value")).toBe("13");

  await clickTab("File Explorer");
  await expect.poll(() => currentPage().textContent("h2")).toBe("File Explorer");
  await expect.poll(() => currentPage().evaluate(() => document.querySelectorAll(".file-entry").length)).toBeGreaterThan(0);
  await expect.poll(() => currentPage().inputValue(".path-input")).toContain("dioxus-react");
  await currentPage().evaluate(() => {
    const entry = Array.from(document.querySelectorAll(".file-entry")).find(
      (element) => element.querySelector(".file-name")?.textContent === "Cargo.toml"
    );
    if (!entry) throw new Error("Cargo.toml not found");
    entry.click();
  });
  await expect.poll(() => currentPage().textContent(".file-preview h3")).toBe("Cargo.toml");
  await expect.poll(() => currentPage().textContent(".file-preview pre")).toContain("[package]");
});

test("supports frame-level form and state methods", async () => {
  await clickTab("Automation Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Automation Lab");

  expect(await currentPage().isEditable("#lab-text")).toBe(true);
  expect(await currentPage().isEnabled("#lab-text")).toBe(true);
  expect(await currentPage().isEditable("#lab-readonly")).toBe(false);
  expect(await currentPage().isDisabled("#lab-disabled")).toBe(true);
  expect(await currentPage().isEnabled("#lab-disabled")).toBe(false);
  expect(await currentPage().isHidden("#lab-async-note")).toBe(true);

  await currentPage().focus("#lab-text");
  await currentPage().type("#lab-text", "proxy");
  await expect.poll(() => currentPage().textContent("#lab-text-output")).toBe("proxy");
  await expect.poll(() => currentPage().textContent("#lab-keylog")).toContain("p");

  await currentPage().press("#lab-text", "Enter");
  await expect.poll(() => currentPage().textContent("#lab-submit-count")).toBe("1");

  await currentPage().check("#lab-checkbox");
  expect(await currentPage().isChecked("#lab-checkbox")).toBe(true);
  await expect.poll(() => currentPage().textContent("#lab-checkbox-output")).toBe("checked");

  await currentPage().uncheck("#lab-checkbox");
  expect(await currentPage().isChecked("#lab-checkbox")).toBe(false);
  await expect.poll(() => currentPage().textContent("#lab-checkbox-output")).toBe("unchecked");

  await currentPage().selectOption("#lab-select", { label: "Green" });
  await expect.poll(() => currentPage().textContent("#lab-select-output")).toBe("green");

  const multiValues = await currentPage().selectOption("#lab-multi-select", [
    "alpha",
    "gamma",
  ]);
  expect(multiValues).toEqual(["alpha", "gamma"]);
  await expect.poll(() => currentPage().textContent("#lab-multi-select-output")).toBe("alpha,gamma");
});

test("supports content, focus, query counts, and wait timeouts", async () => {
  await clickTab("Automation Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Automation Lab");

  expect((await currentPage().innerText("#lab-rich-content")).trim()).toBe("Hello World");
  const richHtml = await currentPage().innerHTML("#lab-rich-content");
  expect(richHtml).toContain("<span>Hello</span>");
  expect(richHtml).toContain("<strong>World</strong>");
  expect(richHtml).toContain("hidden");

  const blurInput = currentPage().locator("#lab-blur-input");
  await blurInput.focus();
  await expect.poll(() => currentPage().textContent("#lab-blur-output")).toBe("focused");
  await blurInput.blur();
  await expect.poll(() => currentPage().textContent("#lab-blur-output")).toBe("blurred");

  await expect.poll(() => currentPage().locator(".lab-list-item").count()).toBe(3);

  const start = performance.now();
  await currentPage().waitForTimeout(80);
  expect(performance.now() - start).toBeGreaterThanOrEqual(60);
});

test("exposes stable locator fixtures for labels, titles, placeholders, text, and roles", async () => {
  await clickTab("Locator Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Locator Lab");

  expect(await currentPage().textContent("#locator-name-label")).toBe("Full name");
  expect(await currentPage().textContent("#locator-search-label")).toBe("Search sample");
  expect(await currentPage().getAttribute("#locator-name", "placeholder")).toBe("Ada Lovelace");
  expect(await currentPage().getAttribute("#locator-search", "placeholder")).toBe(
    "Search the catalog"
  );
  expect(await currentPage().getAttribute("#locator-search", "aria-label")).toBe(
    "Search sample"
  );
  expect(await currentPage().getAttribute("#locator-save", "title")).toBe("Save locator sample");
  expect(await currentPage().textContent("#locator-text-target")).toBe("Locator text target");
  expect(await currentPage().textContent("#locator-save-output")).toBe("idle");
  expect(await currentPage().textContent("#locator-status")).toBe("Idle status");
  expect(await currentPage().getAttribute("#locator-status", "role")).toBe("status");
  expect(await currentPage().getAttribute("#locator-link", "title")).toBe("jump to locator lab");

  await currentPage().click("#locator-save");
  await expect.poll(() => currentPage().textContent("#locator-save-output")).toBe("saved");
  await expect.poll(() => currentPage().textContent("#locator-status")).toBe("Saved status");
});

test("supports waiters and event dispatch", async () => {
  await clickTab("Automation Lab");

  await currentPage().click("#lab-reveal");
  const note = await currentPage().waitForSelector("#lab-async-note");
  expect(note).toBeTruthy();
  expect(await currentPage().isVisible("#lab-async-note")).toBe(true);
  await expect.poll(() => currentPage().textContent("#lab-async-note")).toBe("Ready for waitForSelector");

  await currentPage().hover("#lab-hover-target");
  await expect.poll(() => currentPage().textContent("#lab-hover-output")).toBe("hovered");

  await currentPage().dblclick("#lab-double-target");
  await expect.poll(() => currentPage().textContent("#lab-double-count")).toBe("1");

  await currentPage().dispatchEvent("#lab-dispatch-target", "lab:update", {
    detail: { message: "manual-dispatch" },
  });
  await expect.poll(() => currentPage().textContent("#lab-dispatch-output")).toBe("manual-dispatch");
});

test("supports handles, scoped queries, and handle arguments", async () => {
  await clickTab("Automation Lab");

  const scope = await currentPage().$("#lab-scope");
  expect(scope).toBeTruthy();
  expect(await scope.getAttribute("data-scope")).toBe("root");

  const scopedLabel = await scope.waitForSelector("#lab-scope-label");
  expect(scopedLabel).toBeTruthy();
  expect(await scopedLabel.textContent()).toBe("Scoped query root");
  expect(await scopedLabel.getAttribute("data-role")).toBe("scope-label");

  const items = await scope.$$(".lab-list-item");
  expect(items).toHaveLength(3);
  expect(await items[1].textContent()).toBe("Two");

  const count = await scope.$$eval(".lab-list-item", (nodes) => nodes.length);
  expect(count).toBe(3);
  expect(await scope.$eval("#lab-list", (node) => node.children.length)).toBe(3);

  const handle = await currentPage().evaluateHandle(() => ({
    ready: false,
    nested: { value: 7 },
  }));
  const nested = await handle.getProperty("nested");
  expect(await nested.jsonValue()).toEqual({ value: 7 });

  const properties = await handle.getProperties();
  expect(await properties.get("ready").jsonValue()).toBe(false);

  const checkbox = await currentPage().$("#lab-checkbox");
  expect(checkbox).toBeTruthy();

  await currentPage().evaluate((element) => {
    window.setTimeout(() => {
      element.checked = true;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, 120);
  }, checkbox);

  const checkedHandle = await currentPage().waitForFunction(
    (element) => element.checked,
    checkbox
  );
  expect(await checkedHandle.jsonValue()).toBe(true);
  expect(await currentPage().isChecked("#lab-checkbox")).toBe(true);

  const windowHandle = await currentPage().waitForFunction(() => window);
  expect(await windowHandle.evaluate((win) => win.location.protocol)).toBe("wry:");
});

test("survives a real page reload", async () => {
  await clickTab("Automation Lab");
  await currentPage().fill("#lab-text", "before reload");
  await expect.poll(() => currentPage().textContent("#lab-text-output")).toBe("before reload");

  await currentPage().reload();

  await expect.poll(() => currentPage().title()).toBe("dioxus-react");
  await expect.poll(() => currentPage().textContent("h1")).toBe("dioxus-react");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Counter");

  await clickTab("Automation Lab");
  await expect.poll(() => currentPage().inputValue("#lab-text")).toBe("");
  await expect.poll(() => currentPage().textContent("#lab-checkbox-output")).toBe("unchecked");
});
