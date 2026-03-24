import { test, expect } from "./fixtures.mjs";

// Adapted from Playwright v1.58.2 tests/page/queryselector.spec.ts.

test("should throw for non-string selector", async ({ page }) => {
  const error = await page.$(null).catch((value) => value);
  expect(error.message).toContain("selector: expected string");
});

test("should query existing element with css selector @smoke", async ({ page }) => {
  await page.setContent("<section>test</section>");
  const element = await page.$("css=section");
  expect(element).toBeTruthy();
});

test("should return null for non-existing element", async ({ page }) => {
  const element = await page.$("non-existing-element");
  expect(element).toBe(null);
});

test("should auto-detect css selector", async ({ page }) => {
  await page.setContent("<section>test</section>");
  const element = await page.$("section");
  expect(element).toBeTruthy();
});

test("should query existing elements", async ({ page }) => {
  await page.setContent("<div>A</div><br/><div>B</div>");
  const elements = await page.$$("div");
  expect(elements.length).toBe(2);
  const texts = await Promise.all(elements.map((element) => element.textContent()));
  expect(texts).toEqual(["A", "B"]);
});

test("should return empty array if nothing is found", async ({ page }) => {
  const elements = await page.$$("div");
  expect(elements.length).toBe(0);
});
