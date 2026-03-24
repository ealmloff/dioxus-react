import { test, expect } from "@playwright/test";
import { installInternalSessionHooks } from "./playwright-internal-utils.mjs";

test.describe.configure({ mode: "serial" });

const { currentPage } = installInternalSessionHooks(test);

test.describe("Playwright Internal: page-evaluate.spec.ts", () => {
  test("should work @smoke", async () => {
    expect(await currentPage().evaluate(() => 7 * 3)).toBe(21);
  });

  test("should transfer NaN", async () => {
    const result = await currentPage().evaluate((value) => value, NaN);
    expect(Object.is(result, NaN)).toBe(true);
  });

  test("should transfer -0", async () => {
    const result = await currentPage().evaluate((value) => value, -0);
    expect(Object.is(result, -0)).toBe(true);
  });

  test("should transfer Infinity", async () => {
    const result = await currentPage().evaluate((value) => value, Infinity);
    expect(Object.is(result, Infinity)).toBe(true);
  });

  test("should transfer -Infinity", async () => {
    const result = await currentPage().evaluate((value) => value, -Infinity);
    expect(Object.is(result, -Infinity)).toBe(true);
  });

  test("should roundtrip unserializable values", async () => {
    const value = {
      infinity: Infinity,
      nInfinity: -Infinity,
      nZero: -0,
      nan: NaN,
    };
    expect(await currentPage().evaluate((input) => input, value)).toEqual(value);
  });

  test("should roundtrip promise to value", async () => {
    expect(await currentPage().evaluate((value) => Promise.resolve(value), null)).toBe(null);
    expect(await currentPage().evaluate((value) => Promise.resolve(value), Infinity)).toBe(
      Infinity
    );
    expect(await currentPage().evaluate((value) => Promise.resolve(value), -0)).toBe(-0);
    expect(await currentPage().evaluate((value) => Promise.resolve(value), undefined)).toBe(
      undefined
    );
  });

  test("should transfer arrays", async () => {
    expect(await currentPage().evaluate((value) => value, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  test("should transfer arrays as arrays, not objects", async () => {
    expect(await currentPage().evaluate((value) => Array.isArray(value), [1, 2, 3])).toBe(true);
  });

  test("should modify global environment", async () => {
    await currentPage().evaluate(() => {
      window.globalVar = 123;
    });
    expect(await currentPage().evaluate("globalVar")).toBe(123);
  });

  test("should work with unicode chars", async () => {
    expect(
      await currentPage().evaluate((value) => value["中文字符"], { "中文字符": 42 })
    ).toBe(42);
  });

  test("should work with large strings", async () => {
    const expected = "x".repeat(40_000);
    expect(await currentPage().evaluate((data) => data, expected)).toBe(expected);
  });
});
