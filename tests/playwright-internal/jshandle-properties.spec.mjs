import { test, expect } from "./fixtures.mjs";

// Adapted from Playwright v1.58.2 tests/page/jshandle-properties.spec.ts.

test("should work @smoke", async ({ page }) => {
  const handle = await page.evaluateHandle(() => ({
    one: 1,
    two: 2,
    three: 3,
  }));
  const two = await handle.getProperty("two");
  expect(await two.jsonValue()).toEqual(2);
});

test("should work with undefined, null, and empty", async ({ page }) => {
  const handle = await page.evaluateHandle(() => ({
    undefined,
    null: null,
  }));
  const undefinedHandle = await handle.getProperty("undefined");
  expect(String(await undefinedHandle.jsonValue())).toEqual("undefined");
  const nullHandle = await handle.getProperty("null");
  expect(await nullHandle.jsonValue()).toEqual(null);
  const emptyHandle = await handle.getProperty("empty");
  expect(String(await emptyHandle.jsonValue())).toEqual("undefined");
});

test("should work with unserializable values", async ({ page }) => {
  const handle = await page.evaluateHandle(() => ({
    infinity: Infinity,
    nInfinity: -Infinity,
    nan: NaN,
    nzero: -0,
  }));
  expect(await (await handle.getProperty("infinity")).jsonValue()).toEqual(Infinity);
  expect(await (await handle.getProperty("nInfinity")).jsonValue()).toEqual(-Infinity);
  expect(String(await (await handle.getProperty("nan")).jsonValue())).toEqual("NaN");
  expect(await (await handle.getProperty("nzero")).jsonValue()).toEqual(-0);
});

test("getProperties should work", async ({ page }) => {
  const handle = await page.evaluateHandle(() => ({ foo: "bar" }));
  const properties = await handle.getProperties();
  const foo = properties.get("foo");
  expect(foo).toBeTruthy();
  expect(await foo.jsonValue()).toBe("bar");
});

test("getProperties should return empty map for non-objects", async ({ page }) => {
  const handle = await page.evaluateHandle(() => 123);
  const properties = await handle.getProperties();
  expect(properties.size).toBe(0);
});

test("getProperties should return even non-own properties", async ({ page }) => {
  const handle = await page.evaluateHandle(() => {
    class A {
      constructor() {
        this.a = "1";
      }
    }
    class B extends A {
      constructor() {
        super();
        this.b = "2";
      }
    }
    return new B();
  });
  const properties = await handle.getProperties();
  expect(await properties.get("a").jsonValue()).toBe("1");
  expect(await properties.get("b").jsonValue()).toBe("2");
});

test("getProperties should work with elements", async ({ page }) => {
  await page.setContent("<div>Hello</div>");
  const handle = await page.evaluateHandle(() => ({ body: document.body }));
  const properties = await handle.getProperties();
  const body = properties.get("body");
  expect(body).toBeTruthy();
  expect(await body.textContent()).toBe("Hello");
});
