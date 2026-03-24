import { test, expect } from "./fixtures.mjs";

// Adapted from Playwright v1.58.2 tests/page/page-wait-for-selector-1.spec.ts.

test("should immediately resolve promise if node exists", async ({ page }) => {
  await page.setContent("<div></div>");
  await page.waitForSelector("div", { state: "attached" });
});

test("elementHandle.waitForSelector should immediately resolve if node exists", async ({
  page,
}) => {
  await page.setContent("<span>extra</span><div><span>target</span></div>");
  const div = await page.$("div");
  const span = await div.waitForSelector("span", { state: "attached" });
  expect(await span.evaluate((element) => element.textContent)).toBe("target");
});

test("elementHandle.waitForSelector should wait", async ({ page }) => {
  await page.setContent("<div></div>");
  const div = await page.$("div");
  const promise = div.waitForSelector("span", { state: "attached" });
  await div.evaluate((element) => {
    element.innerHTML = "<span>target</span>";
  });
  const span = await promise;
  expect(await span.evaluate((element) => element.textContent)).toBe("target");
});

test("elementHandle.waitForSelector should timeout", async ({ page }) => {
  await page.setContent("<div></div>");
  const div = await page.$("div");
  const error = await div.waitForSelector("span", { timeout: 100 }).catch((value) => value);
  expect(error.message).toContain("Timeout 100ms exceeded");
});

test("should work with removed MutationObserver", async ({ page }) => {
  await page.evaluate(() => {
    delete window.MutationObserver;
  });
  const [handle] = await Promise.all([
    page.waitForSelector(".zombo"),
    page.setContent("<div class='zombo'>anything</div>"),
  ]);
  expect(await page.evaluate((element) => element.textContent, handle)).toBe("anything");
});

test("should resolve promise when node is added", async ({ page }) => {
  const promise = page.waitForSelector("div", { state: "attached" });
  await page.evaluate(() => {
    document.body.appendChild(document.createElement("br"));
    document.body.appendChild(document.createElement("div"));
  });
  const handle = await promise;
  const tagName = await handle.getProperty("tagName").then((value) => value.jsonValue());
  expect(tagName).toBe("DIV");
});
