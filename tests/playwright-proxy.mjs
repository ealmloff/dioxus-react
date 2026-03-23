import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { TestBridge } from "./bridge.mjs";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_CORE_ROOT = path.dirname(
  require.resolve("playwright-core/package.json")
);
const requirePlaywrightInternal = (relativePath) =>
  require(path.join(PLAYWRIGHT_CORE_ROOT, relativePath));

const { wsServer } = requirePlaywrightInternal("lib/utilsBundle.js");
const {
  Dispatcher,
  DispatcherConnection,
  RootDispatcher,
} = requirePlaywrightInternal("lib/server/dispatchers/dispatcher.js");
const { serializeResult } = requirePlaywrightInternal(
  "lib/server/dispatchers/jsHandleDispatcher.js"
);
const { SdkObject } = requirePlaywrightInternal("lib/server/instrumentation.js");
const { TargetClosedError } = requirePlaywrightInternal("lib/server/errors.js");

const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(ROOT, "target", "debug", "dioxus-react");
const APP_PORT = 9199;
const DEFAULT_PROXY_PORT = 9323;

function serializeForEval(value) {
  return JSON.stringify(value);
}

function buildEvaluateScript(expression, isFunction, serializedValue) {
  return `(() => {
    const __pwDeserialize = (value) => {
      if (value === null || typeof value !== "object") return value;
      if ("n" in value) return value.n;
      if ("b" in value) return value.b;
      if ("s" in value) return value.s;
      if ("v" in value) {
        switch (value.v) {
          case "null": return null;
          case "undefined": return undefined;
          case "NaN": return NaN;
          case "Infinity": return Infinity;
          case "-Infinity": return -Infinity;
          case "-0": return -0;
          default: return undefined;
        }
      }
      if ("d" in value) return new Date(value.d);
      if ("u" in value) return new URL(value.u);
      if ("bi" in value) return BigInt(value.bi);
      if ("r" in value) return new RegExp(value.r.p, value.r.f);
      if ("a" in value) return value.a.map(__pwDeserialize);
      if ("o" in value) {
        const out = {};
        for (const entry of value.o) out[entry.k] = __pwDeserialize(entry.v);
        return out;
      }
      return value;
    };
    const __pwExpression = ${JSON.stringify(expression)};
    const __pwArg = __pwDeserialize(${serializeForEval(serializedValue)});
    let __pwValue;
    if (${isFunction ? "true" : "false"}) {
      const __pwFunction = (0, eval)(__pwExpression);
      __pwValue = __pwFunction(__pwArg);
    } else {
      __pwValue = (0, eval)(__pwExpression);
    }
    if (__pwValue && typeof __pwValue.then === "function") {
      throw new Error("Async page.evaluate is not supported by the embedded WRY bridge");
    }
    return __pwValue;
  })()`;
}

class ProxyObject extends SdkObject {
  constructor(parent, prefix) {
    super(parent, prefix);
  }
}

class DummyDispatcher extends Dispatcher {
  constructor(parent, object, type, initializer = {}) {
    super(parent, object, type, initializer);
    this._type_EventTarget = true;
  }

  async updateSubscription() {}
}

class ProxyAppController {
  constructor({ appPort = APP_PORT } = {}) {
    this._appPort = appPort;
    this._app = null;
    this._bridge = null;
    this._stopped = false;
  }

  async start() {
    this._app = spawn(BIN, ["--test-port", String(this._appPort)], {
      cwd: ROOT,
      stdio: process.env.DEBUG ? "inherit" : "ignore",
    });
    this._bridge = new TestBridge(this._appPort);
    await this._bridge.connect();
    await this.waitFor(async () => {
      const header = await this.evalValue(`document.querySelector("h1")?.textContent ?? null`);
      return header === "dioxus-react";
    }, 15_000);
  }

  async close() {
    if (this._stopped) return;
    this._stopped = true;
    this._bridge?.close();
    this._bridge = null;
    if (this._app) {
      this._app.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => this._app.once("exit", resolve)),
        sleep(2_000),
      ]);
      this._app = null;
    }
  }

  async evalValue(script) {
    if (!this._bridge) {
      throw new TargetClosedError("Embedded app bridge is not connected");
    }
    const raw = await this._bridge.eval(script);
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && value.__error) {
      const error = new Error(value.__error);
      error.stack = value.__stack || error.stack;
      throw error;
    }
    return value;
  }

  async waitFor(predicate, timeoutMs = 5_000, intervalMs = 50) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await predicate();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(intervalMs);
    }
    if (lastError) throw lastError;
    throw new Error(`Timed out after ${timeoutMs}ms`);
  }

  async snapshot() {
    const [url, title, viewportSize] = await Promise.all([
      this.evalValue("location.href"),
      this.evalValue("document.title"),
      this.evalValue("({ width: window.innerWidth, height: window.innerHeight })"),
    ]);
    return { url, title, viewportSize };
  }

  async evaluateExpression(expression, isFunction, arg) {
    if (arg.handles.length) {
      throw new Error("JSHandle arguments are not supported by the WRY Playwright proxy");
    }
    return await this.evalValue(buildEvaluateScript(expression, isFunction, arg.value));
  }

  async textContent(selector) {
    return await this.evalValue(
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`
    );
  }

  async content() {
    return await this.evalValue(
      "document.doctype ? '<!DOCTYPE ' + document.doctype.name + '>' + document.documentElement.outerHTML : document.documentElement.outerHTML"
    );
  }

  async title() {
    return await this.evalValue("document.title");
  }

  async queryCount(selector) {
    return await this.evalValue(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`
    );
  }

  async isVisible(selector) {
    return await this.evalValue(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    })()`);
  }

  async click(selector) {
    await this.evalValue(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('No element matches selector: ' + ${JSON.stringify(selector)});
      element.click();
      return null;
    })()`);
  }

  async fill(selector, value) {
    await this.evalValue(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('No element matches selector: ' + ${JSON.stringify(selector)});
      const proto =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (!descriptor || typeof descriptor.set !== "function") {
        throw new Error("Unable to find native value setter");
      }
      element.focus();
      descriptor.set.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return null;
    })()`);
  }

  async inputValue(selector) {
    return await this.evalValue(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('No element matches selector: ' + ${JSON.stringify(selector)});
      return element.value ?? "";
    })()`);
  }
}

class ProxyBrowserDispatcher extends Dispatcher {
  constructor(parent, controller) {
    const object = new ProxyObject(parent._object, "proxyBrowser");
    object.options = { name: "webkit" };
    super(parent, object, "Browser", { version: "wry-wkwebview", name: "webkit" });
    this._controller = controller;
    this._context = new ProxyBrowserContextDispatcher(this, controller);
    this._dispatchEvent("context", { context: this._context });
  }

  async close() {
    await this._context.disposeTree();
    await this._controller.close();
    this._dispatchEvent("close");
    this._dispose();
  }

  async newContext() {
    throw new Error("The WRY Playwright proxy exposes a single prelaunched context");
  }
}

class ProxyBrowserContextDispatcher extends Dispatcher {
  constructor(parent, controller) {
    const object = new ProxyObject(parent._object, "proxyContext");
    super(parent, object, "BrowserContext", {
      isChromium: false,
      requestContext: new ProxyAPIRequestContextDispatcher(parent),
      tracing: new ProxyTracingDispatcher(parent),
      options: {},
    });
    this._controller = controller;
    this._page = new ProxyPageDispatcher(this, controller);
    this._dispatchEvent("page", { page: this._page });
  }

  async updateSubscription() {}

  async newPage() {
    return { page: this._page };
  }

  async close() {
    await this.disposeTree();
  }

  async disposeTree() {
    this._page._dispatchEvent("close");
    this._page._dispose();
    this._dispatchEvent("close");
    this._dispose();
  }
}

class ProxyTracingDispatcher extends DummyDispatcher {
  constructor(parent) {
    super(parent, new ProxyObject(parent._object, "proxyTracing"), "Tracing", {});
  }
}

class ProxyAPIRequestContextDispatcher extends DummyDispatcher {
  constructor(parent) {
    const tracing = new ProxyTracingDispatcher(parent);
    super(parent, new ProxyObject(parent._object, "proxyRequest"), "APIRequestContext", {
      tracing,
    });
  }
}

class ProxyPageDispatcher extends Dispatcher {
  constructor(parent, controller) {
    const frame = new ProxyFrameDispatcher(parent, controller);
    const object = new ProxyObject(parent._object, "proxyPage");
    super(parent, object, "Page", {
      mainFrame: frame,
      viewportSize: frame.viewportSize,
      isClosed: false,
      opener: undefined,
    });
    this._controller = controller;
    this.adopt(frame);
    this._frame = frame;
  }

  async updateSubscription() {}

  async close() {
    await this._controller.close();
    this._dispatchEvent("close");
    this._dispose();
  }
}

class ProxyFrameDispatcher extends Dispatcher {
  constructor(parent, controller) {
    const object = new ProxyObject(parent._object, "proxyFrame");
    const snapshot = { url: "asset://localhost/index.html", viewportSize: { width: 0, height: 0 } };
    super(parent, object, "Frame", {
      url: snapshot.url,
      name: "",
      parentFrame: undefined,
      loadStates: ["commit", "domcontentloaded", "load", "networkidle"],
    });
    this._controller = controller;
    this.viewportSize = snapshot.viewportSize;
    this._refreshPromise = this.refresh();
  }

  async refresh() {
    const snapshot = await this._controller.snapshot();
    this.viewportSize = snapshot.viewportSize;
    this._dispatchEvent("navigated", {
      url: snapshot.url,
      name: "",
      error: undefined,
      newDocument: undefined,
    });
  }

  async _ready() {
    await this._refreshPromise;
  }

  async evaluateExpression(params) {
    await this._ready();
    return {
      value: serializeResult(
        await this._controller.evaluateExpression(
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async textContent(params) {
    await this._ready();
    const value = await this._controller.textContent(params.selector);
    return value === null ? {} : { value };
  }

  async queryCount(params) {
    await this._ready();
    return { value: await this._controller.queryCount(params.selector) };
  }

  async content() {
    await this._ready();
    return { value: await this._controller.content() };
  }

  async title() {
    await this._ready();
    return { value: await this._controller.title() };
  }

  async click(params) {
    await this._ready();
    await this._controller.click(params.selector);
  }

  async fill(params) {
    await this._ready();
    await this._controller.fill(params.selector, params.value);
  }

  async inputValue(params) {
    await this._ready();
    return { value: await this._controller.inputValue(params.selector) };
  }

  async isVisible(params) {
    await this._ready();
    return { value: await this._controller.isVisible(params.selector) };
  }

  async waitForTimeout(params) {
    await sleep(params.waitTimeout);
  }
}

class ProxyPlaywrightDispatcher extends Dispatcher {
  constructor(scope, controller) {
    const chromium = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyChromium"),
      "BrowserType",
      { executablePath: "", name: "chromium" }
    );
    const firefox = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyFirefox"),
      "BrowserType",
      { executablePath: "", name: "firefox" }
    );
    const webkit = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyWebkit"),
      "BrowserType",
      { executablePath: "", name: "webkit" }
    );
    const android = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyAndroid"),
      "Android",
      {}
    );
    const electron = new DummyDispatcher(
      scope,
      new ProxyObject(scope._object, "proxyElectron"),
      "Electron",
      {}
    );
    const browser = new ProxyBrowserDispatcher(webkit, controller);
    super(scope, new ProxyObject(scope._object, "proxyPlaywright"), "Playwright", {
      chromium,
      firefox,
      webkit,
      android,
      electron,
      preLaunchedBrowser: browser,
    });
    this._browser = browser;
  }
}

export class PlaywrightWryProxy {
  constructor({ appPort = APP_PORT, proxyPort = DEFAULT_PROXY_PORT } = {}) {
    this._appPort = appPort;
    this._proxyPort = proxyPort;
    this._controller = new ProxyAppController({ appPort });
    this._server = null;
    this._connections = new Set();
    this._rootDispatchers = new Set();
  }

  async start() {
    await this._controller.start();
    this._server = new wsServer({ port: this._proxyPort });
    this._server.on("connection", (socket) => {
      const connection = new DispatcherConnection();
      this._connections.add(connection);
      const root = new RootDispatcher(connection, async (scope) => {
        const playwright = new ProxyPlaywrightDispatcher(scope, this._controller);
        this._rootDispatchers.add(playwright);
        return playwright;
      });
      connection.onmessage = (message) => {
        socket.send(JSON.stringify(message));
      };
      socket.on("message", async (data) => {
        const message = JSON.parse(String(data));
        await connection.dispatch(message);
      });
      socket.on("close", () => {
        this._connections.delete(connection);
        root._dispose();
      });
    });
    await new Promise((resolve) => this._server.once("listening", resolve));
    return this.wsEndpoint();
  }

  wsEndpoint() {
    return `ws://127.0.0.1:${this._proxyPort}`;
  }

  async close() {
    for (const connection of this._connections) {
      connection.onmessage = () => {};
    }
    this._connections.clear();
    if (this._server) {
      await new Promise((resolve) => this._server.close(resolve));
      this._server = null;
    }
    await this._controller.close();
  }
}
