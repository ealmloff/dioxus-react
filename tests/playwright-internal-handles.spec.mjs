import { test, expect } from "@playwright/test";
import { installInternalSessionHooks } from "./playwright-internal-utils.mjs";


const { currentPage } = installInternalSessionHooks(test);

test.describe("Playwright Internal: jshandle-properties.spec.ts", () => {
  test("should work @smoke", async () => {
    const handle = await currentPage().evaluateHandle(() => ({
      one: 1,
      two: 2,
      three: 3,
    }));
    const two = await handle.getProperty("two");
    expect(await two.jsonValue()).toEqual(2);
  });

  test("should work with undefined, null, and empty", async () => {
    const handle = await currentPage().evaluateHandle(() => ({
      undefined,
      null: null,
    }));
    expect(String(await (await handle.getProperty("undefined")).jsonValue())).toEqual(
      "undefined"
    );
    expect(await (await handle.getProperty("null")).jsonValue()).toEqual(null);
    expect(String(await (await handle.getProperty("empty")).jsonValue())).toEqual("undefined");
  });

  test("should work with unserializable values", async () => {
    const handle = await currentPage().evaluateHandle(() => ({
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

  test("getProperties should work", async () => {
    const handle = await currentPage().evaluateHandle(() => ({ foo: "bar" }));
    const properties = await handle.getProperties();
    expect(await properties.get("foo").jsonValue()).toBe("bar");
  });

  test("getProperties should return empty map for non-objects", async () => {
    const handle = await currentPage().evaluateHandle(() => 123);
    expect((await handle.getProperties()).size).toBe(0);
  });

  test("getProperties should return even non-own properties", async () => {
    const handle = await currentPage().evaluateHandle(() => {
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

  test("getProperties should work with elements", async () => {
    await currentPage().setContent("<div>Hello</div>");
    const handle = await currentPage().evaluateHandle(() => ({ body: document.body }));
    const properties = await handle.getProperties();
    expect(await properties.get("body").textContent()).toBe("Hello");
  });
});
