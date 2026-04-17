import { test, expect, webkit } from "@playwright/test";
import { PlaywrightWryProxy } from "./driver/dist/index.mjs";

test.describe.configure({ mode: "parallel" });

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

function dispatchHtml() {
  return `<!doctype html>
    <html>
      <head><title>Command Dispatch Lab</title></head>
      <body>
        <button id="dispatch-button" data-role="primary">Dispatch</button>
        <button id="eval-button" data-value="42">Eval</button>
        <input id="text-input" value="" />
        <input id="checkbox" type="checkbox" />
        <select id="single-select">
          <option value="">Choose</option>
          <option value="green">Green</option>
          <option value="blue">Blue</option>
        </select>
        <select id="multi-select" multiple>
          <option value="alpha">Alpha</option>
          <option value="beta">Beta</option>
          <option value="gamma">Gamma</option>
        </select>
        <div id="result">ready</div>
        <div id="status"></div>
        <ul id="list">
          <li class="item">One</li>
          <li class="item">Two</li>
          <li class="item">Three</li>
        </ul>
        <script>
          const result = document.getElementById("result");
          document
            .getElementById("dispatch-button")
            .addEventListener("click", () => (result.textContent = "clicked"));
          document
            .getElementById("dispatch-button")
            .addEventListener("tap", () => (result.textContent = "tapped"));
          document
            .getElementById("dispatch-button")
            .addEventListener("dblclick", () => (result.textContent = "double-clicked"));
          document
            .getElementById("dispatch-button")
            .addEventListener("custom-event", (event) => {
              result.textContent =
                "custom:" + (event.detail && event.detail.kind ? event.detail.kind : "missing");
            });
        </script>
      </body>
    </html>`;
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

async function seedDispatchPage() {
  await currentPage().setContent(dispatchHtml());
}

test.beforeEach(async () => {
  await startSession();
});

test.afterEach(async () => {
  await closeSession();
});

test("exposes __pwx execution-context runtime in the webview", async () => {
  await seedDispatchPage();

  // rawEvaluateJSON: primitive.
  const jsonRemote = await currentPage().evaluate(async () => {
    return await window.__pwx.rawEvaluateJSON("1 + 2");
  });
  expect(jsonRemote).toEqual({ type: "number", value: 3 });

  // rawEvaluateJSON: NaN / Infinity round-trip via unserializableValue.
  const nanRemote = await currentPage().evaluate(async () => {
    return await window.__pwx.rawEvaluateJSON("NaN");
  });
  expect(nanRemote).toMatchObject({ type: "number", unserializableValue: "NaN" });

  // rawEvaluateHandle: object gets an objectId; callFunctionOn reads it back.
  const callRoundTrip = await currentPage().evaluate(async () => {
    const handle = await window.__pwx.rawEvaluateHandle("({ a: 40, b: 2 })");
    const sum = await window.__pwx.callFunctionOn({
      functionDeclaration: "(function(o){return o.a + o.b;})",
      objectId: handle.objectId,
      arguments: [{ objectId: handle.objectId }],
      returnByValue: true,
      awaitPromise: true,
    });
    const props = window.__pwx.getProperties(handle.objectId);
    window.__pwx.releaseHandle(handle.objectId);
    return { sum, props: props.map((p) => ({ name: p.name, value: p.handle.value })) };
  });
  expect(callRoundTrip.sum).toEqual({ type: "number", value: 42 });
  expect(callRoundTrip.props).toEqual([
    { name: "a", value: 40 },
    { name: "b", value: 2 },
  ]);

  // rawEvaluateHandle: DOM node gets subtype:node.
  const nodeRemote = await currentPage().evaluate(async () => {
    const remote = await window.__pwx.rawEvaluateHandle("document.body");
    return { type: remote.type, subtype: remote.subtype, hasObjectId: typeof remote.objectId === "string" };
  });
  expect(nodeRemote).toEqual({ type: "object", subtype: "node", hasObjectId: true });
});

test("dispatches page.setContent/title/content/evaluation commands", async () => {
  await seedDispatchPage();

  expect(await currentPage().title()).toBe("Command Dispatch Lab");
  expect(await currentPage().content()).toContain("dispatch-button");

  expect(await currentPage().evaluate(() => document.querySelectorAll("#list .item").length)).toBe(3);
  expect(await currentPage().evaluate(() => document.title)).toBe("Command Dispatch Lab");
  expect(await currentPage().$eval("#eval-button", (node) => node.getAttribute("data-value"))).toBe("42");

  const value = await currentPage().evaluateHandle(() => ({
    status: "ok",
    items: ["alpha", "beta"],
  }));
  expect(await value.jsonValue()).toEqual({ status: "ok", items: ["alpha", "beta"] });

  const property = await value.getProperty("status");
  expect(await property.jsonValue()).toBe("ok");

  const properties = await value.getProperties();
  expect(await properties.get("status").jsonValue()).toBe("ok");
  expect(await properties.get("items").jsonValue()).toEqual(["alpha", "beta"]);
});

test("dispatches query, $eval, and $$eval command paths", async () => {
  await seedDispatchPage();

  const button = await currentPage().$("button#dispatch-button");
  expect(button).toBeTruthy();
  expect(await button.getAttribute("data-role")).toBe("primary");

  const items = await currentPage().$$(".item");
  expect(items).toHaveLength(3);
  expect(await Promise.all(items.map((node) => node.textContent()))).toEqual(["One", "Two", "Three"]);

  expect(await currentPage().$$eval("#list .item", (nodes) => nodes.map((node) => node.textContent))).toEqual([
    "One",
    "Two",
    "Three",
  ]);

  expect(await currentPage().locator("#list .item").count()).toBe(3);
});

test("dispatches action commands that are not covered in the app tab flow", async () => {
  await seedDispatchPage();
  await currentPage().waitForSelector("#dispatch-button");
  await currentPage().evaluate(() => {
    const button = document.getElementById("dispatch-button");
    const result = document.getElementById("result");
    if (!button || !result) return;

    button.addEventListener("click", () => {
      result.textContent = "clicked";
    });
    button.addEventListener("dblclick", () => {
      result.textContent = "double-clicked";
    });
    button.addEventListener("custom-event", (event) => {
      const kind = event.detail && event.detail.kind ? event.detail.kind : "missing";
      result.textContent = `custom-${kind}`;
    });
  });

  expect(await currentPage().textContent("#result")).toBe("ready");

  await currentPage().click("#dispatch-button");
  await expect.poll(() => currentPage().textContent("#result")).toBe("clicked");

  await currentPage().dblclick("#dispatch-button");
  await expect.poll(() => currentPage().textContent("#result")).toBe("double-clicked");

  await currentPage().dispatchEvent("#dispatch-button", "custom-event", {
    detail: { kind: "command-dispatch" },
  });
  await expect.poll(() => currentPage().textContent("#result")).toBe("custom-command-dispatch");

  const selected = await currentPage().selectOption("#single-select", { label: "Blue" });
  expect(selected).toEqual(["blue"]);

  const multi = await currentPage().selectOption("#multi-select", [
    { value: "alpha" },
    { value: "gamma" },
  ]);
  expect(multi).toEqual(["alpha", "gamma"]);

  await currentPage().fill("#text-input", "playwright");
  expect(await currentPage().inputValue("#text-input")).toBe("playwright");
  await currentPage().type("#text-input", "!");
  expect(await currentPage().inputValue("#text-input")).toBe("playwright!");
  await currentPage().press("#text-input", "Backspace");
  expect(await currentPage().inputValue("#text-input")).toBe("playwright");
});

test("dispatches unsupported browser.newContext command", async () => {
  await seedDispatchPage();

  await expect(currentPage().context().browser().newContext()).rejects.toThrow(
    /single prelaunched context/
  );
});
