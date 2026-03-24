import { test, expect } from "./fixtures.mjs";

// Adapted from Playwright v1.58.2 tests/page/page-evaluate.spec.ts.

test("should work @smoke", async ({ page }) => {
  const result = await page.evaluate(() => 7 * 3);
  expect(result).toBe(21);
});

test("should transfer NaN", async ({ page }) => {
  const result = await page.evaluate((value) => value, NaN);
  expect(Object.is(result, NaN)).toBe(true);
});

test("should transfer -0", async ({ page }) => {
  const result = await page.evaluate((value) => value, -0);
  expect(Object.is(result, -0)).toBe(true);
});

test("should transfer Infinity", async ({ page }) => {
  const result = await page.evaluate((value) => value, Infinity);
  expect(Object.is(result, Infinity)).toBe(true);
});

test("should transfer -Infinity", async ({ page }) => {
  const result = await page.evaluate((value) => value, -Infinity);
  expect(Object.is(result, -Infinity)).toBe(true);
});

test("should roundtrip unserializable values", async ({ page }) => {
  const value = {
    infinity: Infinity,
    nInfinity: -Infinity,
    nZero: -0,
    nan: NaN,
  };
  const result = await page.evaluate((input) => input, value);
  expect(result).toEqual(value);
});

test("should roundtrip promise to value", async ({ page }) => {
  expect(await page.evaluate((value) => Promise.resolve(value), null)).toBe(null);
  expect(await page.evaluate((value) => Promise.resolve(value), Infinity)).toBe(Infinity);
  expect(await page.evaluate((value) => Promise.resolve(value), -0)).toBe(-0);
  expect(await page.evaluate((value) => Promise.resolve(value), undefined)).toBe(undefined);
});

test("should transfer arrays", async ({ page }) => {
  const result = await page.evaluate((value) => value, [1, 2, 3]);
  expect(result).toEqual([1, 2, 3]);
});

test("should transfer arrays as arrays, not objects", async ({ page }) => {
  const result = await page.evaluate((value) => Array.isArray(value), [1, 2, 3]);
  expect(result).toBe(true);
});

test("should modify global environment", async ({ page }) => {
  await page.evaluate(() => {
    window.globalVar = 123;
  });
  expect(await page.evaluate("globalVar")).toBe(123);
});

test("should work with unicode chars", async ({ page }) => {
  const result = await page.evaluate((value) => value["中文字符"], { "中文字符": 42 });
  expect(result).toBe(42);
});

test("should work with large strings", async ({ page }) => {
  const expected = "x".repeat(40_000);
  expect(await page.evaluate((data) => data, expected)).toBe(expected);
});
