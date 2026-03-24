import { test, expect, webkit } from "@playwright/test";
import { PlaywrightWryProxy } from "./driver/dist/index.mjs";

test.describe.configure({ mode: "default" });

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
  await expect.poll(() => currentPage().evaluate(() => document.querySelectorAll(".tab").length)).toBe(7);
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

test("supports advanced locator combinators on real app fixtures", async () => {
  await clickTab("Locator Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Locator Lab");

  const notes = currentPage().locator(".selector-note");
  expect(await notes.filter({ visible: true }).count()).toBe(1);
  expect(await notes.filter({ visible: false }).count()).toBe(1);

  const cards = currentPage().locator(".selector-card");
  expect(await cards.count()).toBe(3);
  expect(await cards.filter({ hasText: "Shared details" }).count()).toBe(2);
  expect(await cards.filter({ hasNotText: "Beta" }).count()).toBe(2);

  const betaButton = currentPage().getByRole("button", { name: "Open Beta" });
  expect(await cards.filter({ has: betaButton }).count()).toBe(1);
  expect(await cards.filter({ hasNot: betaButton }).count()).toBe(2);

  const alphaButton = currentPage()
    .getByRole("button", { name: "Open Alpha" })
    .and(currentPage().getByTitle("open alpha card"));
  expect(await alphaButton.count()).toBe(1);
  await alphaButton.click();
  await expect.poll(() => currentPage().textContent("#selector-status")).toBe("alpha");

  const union = currentPage()
    .getByRole("button", { name: "Open Alpha" })
    .or(currentPage().getByRole("button", { name: "Open Gamma" }));
  expect(await union.count()).toBe(2);

  await union.last().click();
  await expect.poll(() => currentPage().textContent("#selector-status")).toBe("gamma");
});

test("supports nested iframe content through the proxy surface", async () => {
  await clickTab("Locator Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Locator Lab");

  const frame = await currentPage().$("#locator-frame");
  expect(frame).toBeTruthy();
  expect(await frame.getAttribute("title")).toBe("Nested action frame");

  await expect.poll(() =>
    frame.evaluate(
      (iframe) => iframe.contentDocument?.getElementById("frame-status")?.textContent
    )
  ).toBe("ready");
  expect(
    await frame.evaluate(
      (iframe) => iframe.contentDocument?.getElementById("frame-title")?.textContent
    )
  ).toBe("Nested Frame");
  expect(
    await frame.evaluate(
      (iframe) => iframe.contentDocument?.getElementById("frame-count")?.textContent
    )
  ).toBe("0");

  await frame.evaluate((iframe) => {
    const button = iframe.contentDocument?.getElementById("frame-action");
    if (!button) throw new Error("Frame action button not found");
    button.click();
  });

  await expect.poll(() =>
    frame.evaluate(
      (iframe) => iframe.contentDocument?.getElementById("frame-count")?.textContent
    )
  ).toBe("1");
  await expect.poll(() => currentPage().textContent("#locator-frame-output")).toBe("1");
});

test("waits for a delayed action target to become visible and enabled", async () => {
  await clickTab("Locator Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Locator Lab");

  expect(await currentPage().isVisible("#locator-delayed-action")).toBe(false);
  await expect.poll(() => currentPage().textContent("#locator-delayed-output")).toBe("waiting");

  await currentPage().waitForSelector("#locator-delayed-action", { state: "visible" });
  expect(await currentPage().isVisible("#locator-delayed-action")).toBe(true);
  expect(await currentPage().isEnabled("#locator-delayed-action")).toBe(true);

  await currentPage().click("#locator-delayed-action");
  await expect.poll(() => currentPage().textContent("#locator-delayed-output")).toBe("clicked");
});

test("supports network probe requests in the Playwright surface lab", async () => {
  await clickTab("Playwright Surface Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Playwright Surface Lab");

  await currentPage().click("#surface-network-probe");
  await expect.poll(() => currentPage().textContent("#surface-network-output")).toBe(
    "surface-network-probe"
  );
});

test.skip("screenshot API: locator().screenshot()", async () => {
  await clickTab("Playwright Surface Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Playwright Surface Lab");

  const shot = await currentPage()
    .locator("#surface-screenshot-target")
    .screenshot();
  expect(Buffer.isBuffer(shot)).toBe(true);
  expect(shot.length).toBeGreaterThan(100);
});

test.skip("supports file chooser interactions through setInputFiles", async () => {
  await clickTab("Playwright Surface Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Playwright Surface Lab");

  await currentPage().locator("#surface-file-input").setInputFiles({
    name: "surface-upload.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("surface-upload"),
  });
  await expect.poll(() => currentPage().textContent("#surface-file-output")).toBe(
    "surface-upload.txt"
  );
}, "Current driver does not yet implement setInputFiles");

test.skip("dialog API: page.waitForEvent('dialog')", async () => {
  await clickTab("Playwright Surface Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Playwright Surface Lab");

  const dialog = await Promise.all([
    currentPage().waitForEvent("dialog"),
    currentPage().click("#surface-dialog-button"),
  ]).then(([event]) => event);

  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toBe("Surface dialog probe");
  await dialog.dismiss();
  await expect.poll(() => currentPage().textContent("#surface-dialog-output")).toBe("dismissed");
}, "Current driver does not yet implement dialog events");

test.skip("supports hash navigation and back-button history", async () => {
  await clickTab("Playwright Surface Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Playwright Surface Lab");

  await expect.poll(() => currentPage().textContent("#surface-nav-output")).toBe("(none)");
  await currentPage().click("#surface-nav-link");
  await expect.poll(() => currentPage().evaluate(() => window.location.hash)).toBe(
    "#surface-anchor"
  );
  await expect.poll(() => currentPage().textContent("#surface-nav-output")).toBe(
    "#surface-anchor"
  );

  await currentPage().goBack();
  await expect.poll(() => currentPage().evaluate(() => window.location.hash)).toBe("");
}, "Current driver does not yet implement page.goBack");

test.skip("supports viewport resize reporting", async () => {
  await clickTab("Playwright Surface Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Playwright Surface Lab");

  await currentPage().setViewportSize({ width: 980, height: 760 });
  await expect.poll(() => currentPage().textContent("#surface-viewport-output")).toBe("980x760");

  await currentPage().setViewportSize({ width: 1200, height: 900 });
  await expect.poll(() => currentPage().textContent("#surface-viewport-output")).toBe("1200x900");
}, "Current driver does not yet implement setViewportSize");

test.skip("geolocation API: context.setGeolocation()", async () => {
  await clickTab("Playwright Surface Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Playwright Surface Lab");

  const context = currentPage().context();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 37.4219, longitude: -122.084 });

  await currentPage().click("#surface-geolocation-query");
  await expect
    .poll(() => currentPage().textContent("#surface-geolocation-output"))
    .not.toBe("requesting");

  const geo = await currentPage().textContent("#surface-geolocation-output");
  expect(geo).toMatch(/^(?:-?\d+\.\d{4},-?\d+\.\d{4}|unsupported|denied|error:.*)$/);
});

test("supports keyboard input sequencing", async () => {
  await clickTab("Playwright Surface Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Playwright Surface Lab");

  await currentPage().fill("#surface-keyboard-input", "");
  await currentPage().type("#surface-keyboard-input", "ab");
  await expect.poll(() => currentPage().textContent("#surface-keyboard-output")).toBe("a,b");
});

test.skip("supports modern locator queries on surface controls", async () => {
  await clickTab("Playwright Surface Lab");
  await expect.poll(() => currentPage().textContent("h2")).toBe("Playwright Surface Lab");

  const surfaceList = currentPage().locator("#surface-locator-list");
  expect(await surfaceList.getAttribute("role")).toBe("list");
  expect(await surfaceList.locator("button").count()).toBe(3);
  await expect.poll(() => currentPage().getByRole("listitem").count()).toBe(3);

  await surfaceList.getByRole("button", { name: "Open Surface Beta" }).click();
  await expect.poll(() => currentPage().textContent("#surface-locator-output")).toBe("beta");

  await expect
    .poll(() => currentPage().getByRole("button", { name: "Open Surface Gamma" }).count())
    .toBe(1);
  await currentPage().locator("#surface-locator-gamma").click();
  await expect.poll(() => currentPage().textContent("#surface-locator-output")).toBe("gamma");
}, "Current driver does not yet support the full modern locator surface");

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
