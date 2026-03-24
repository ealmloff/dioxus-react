import { test, expect, webkit } from "@playwright/test";
import { PlaywrightWryProxy } from "./driver/dist/index.mjs";

const BLANK_DOCUMENT = "<!DOCTYPE html><html><head></head><body></body></html>";


/** @type {import("./driver/dist/index.mjs").PlaywrightWryProxy | null} */
let proxy = null;
/** @type {import("@playwright/test").Browser | null} */
let browser = null;
/** @type {import("@playwright/test").BrowserContext | null} */
let context = null;
/** @type {import("@playwright/test").Page | null} */
let page = null;

function currentPage() {
  if (!page) {
    throw new Error("Playwright page not initialized");
  }
  return page;
}

async function closeSession() {
  await browser?.close().catch(() => {});
  await proxy?.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  browser = null;
  context = null;
  page = null;
  proxy = null;
}

async function startSession(retries = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      proxy = new PlaywrightWryProxy();
      const wsEndpoint = await proxy.start();
      browser = await webkit.connect(wsEndpoint);
      context = browser.contexts()[0];
      if (!context) {
        throw new Error("Proxy did not expose a browser context");
      }
      page = context.pages()[0];
      if (!page) {
        throw new Error("Proxy did not expose a page");
      }
      return;
    } catch (error) {
      lastError = error;
      await closeSession();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError ?? new Error("Failed to start Playwright WRY session");
}

test.beforeEach(async () => {
  await startSession();
  await currentPage().setContent(BLANK_DOCUMENT);
  await currentPage().evaluate(() => {
    delete window.globalVar;
  });
});

test.afterEach(async () => {
  await closeSession();
});

test.describe("Playwright Internal: page-evaluate.spec.ts", () => {
  test("should work @smoke", async () => {
    const result = await currentPage().evaluate(() => 7 * 3);
    expect(result).toBe(21);
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
    const result = await currentPage().evaluate((input) => input, value);
    expect(result).toEqual(value);
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
    const result = await currentPage().evaluate((value) => value, [1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });

  test("should transfer arrays as arrays, not objects", async () => {
    const result = await currentPage().evaluate((value) => Array.isArray(value), [1, 2, 3]);
    expect(result).toBe(true);
  });

  test("should modify global environment", async () => {
    await currentPage().evaluate(() => {
      window.globalVar = 123;
    });
    expect(await currentPage().evaluate("globalVar")).toBe(123);
  });

  test("should work with unicode chars", async () => {
    const result = await currentPage().evaluate((value) => value["中文字符"], {
      "中文字符": 42,
    });
    expect(result).toBe(42);
  });

  test("should work with large strings", async () => {
    const expected = "x".repeat(40_000);
    expect(await currentPage().evaluate((data) => data, expected)).toBe(expected);
  });
});

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
    const undefinedHandle = await handle.getProperty("undefined");
    expect(String(await undefinedHandle.jsonValue())).toEqual("undefined");
    const nullHandle = await handle.getProperty("null");
    expect(await nullHandle.jsonValue()).toEqual(null);
    const emptyHandle = await handle.getProperty("empty");
    expect(String(await emptyHandle.jsonValue())).toEqual("undefined");
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
    const foo = properties.get("foo");
    expect(foo).toBeTruthy();
    expect(await foo.jsonValue()).toBe("bar");
  });

  test("getProperties should return empty map for non-objects", async () => {
    const handle = await currentPage().evaluateHandle(() => 123);
    const properties = await handle.getProperties();
    expect(properties.size).toBe(0);
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
    const body = properties.get("body");
    expect(body).toBeTruthy();
    expect(await body.textContent()).toBe("Hello");
  });
});

test.describe("Playwright Internal: queryselector.spec.ts", () => {
  test("should throw for non-string selector", async () => {
    const error = await currentPage().$(null).catch((value) => value);
    expect(error.message).toContain("selector: expected string");
  });

  test("should query existing element with css selector @smoke", async () => {
    await currentPage().setContent("<section>test</section>");
    const element = await currentPage().$("css=section");
    expect(element).toBeTruthy();
  });

  test("should return null for non-existing element", async () => {
    const element = await currentPage().$("non-existing-element");
    expect(element).toBe(null);
  });

  test("should auto-detect css selector", async () => {
    await currentPage().setContent("<section>test</section>");
    const element = await currentPage().$("section");
    expect(element).toBeTruthy();
  });

  test("should query existing elements", async () => {
    await currentPage().setContent("<div>A</div><br/><div>B</div>");
    const elements = await currentPage().$$("div");
    expect(elements.length).toBe(2);
    const texts = await Promise.all(elements.map((element) => element.textContent()));
    expect(texts).toEqual(["A", "B"]);
  });

  test("should return empty array if nothing is found", async () => {
    const elements = await currentPage().$$("div");
    expect(elements.length).toBe(0);
  });
});

test.describe("Playwright Internal: page-wait-for-selector-1.spec.ts", () => {
  test("should immediately resolve promise if node exists", async () => {
    await currentPage().setContent("<div></div>");
    await currentPage().waitForSelector("div", { state: "attached" });
  });

  test("elementHandle.waitForSelector should immediately resolve if node exists", async () => {
    await currentPage().setContent("<span>extra</span><div><span>target</span></div>");
    const div = await currentPage().$("div");
    const span = await div.waitForSelector("span", { state: "attached" });
    expect(await span.evaluate((element) => element.textContent)).toBe("target");
  });

  test("elementHandle.waitForSelector should wait", async () => {
    await currentPage().setContent("<div></div>");
    const div = await currentPage().$("div");
    const promise = div.waitForSelector("span", { state: "attached" });
    await div.evaluate((element) => {
      element.innerHTML = "<span>target</span>";
    });
    const span = await promise;
    expect(await span.evaluate((element) => element.textContent)).toBe("target");
  });

  test("elementHandle.waitForSelector should timeout", async () => {
    await currentPage().setContent("<div></div>");
    const div = await currentPage().$("div");
    const error = await div.waitForSelector("span", { timeout: 100 }).catch((value) => value);
    expect(error.message).toContain("Timeout 100ms exceeded");
  });

  test("should work with removed MutationObserver", async () => {
    await currentPage().evaluate(() => {
      delete window.MutationObserver;
    });
    const [handle] = await Promise.all([
      currentPage().waitForSelector(".zombo"),
      currentPage().setContent("<div class='zombo'>anything</div>"),
    ]);
    expect(await currentPage().evaluate((element) => element.textContent, handle)).toBe(
      "anything"
    );
  });

  test("should resolve promise when node is added", async () => {
    const promise = currentPage().waitForSelector("div", { state: "attached" });
    await currentPage().evaluate(() => {
      document.body.appendChild(document.createElement("br"));
      document.body.appendChild(document.createElement("div"));
    });
    const handle = await promise;
    const tagName = await handle.getProperty("tagName").then((value) => value.jsonValue());
    expect(tagName).toBe("DIV");
  });
});
