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
const {
  TargetClosedError,
  TimeoutError,
} = requirePlaywrightInternal("lib/server/errors.js");

const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(ROOT, "target", "debug", "dioxus-react");
const DEFAULT_PROXY_PORT = 0;
const RUNTIME_VERSION = 2;

function randomPort() {
  return 10000 + Math.floor(Math.random() * 40000);
}

const RUNTIME_BOOTSTRAP = `(() => {
  const version = ${RUNTIME_VERSION};
  if (window.__pwProxy && window.__pwProxy.version === version)
    return true;

  const state = {
    version,
    nextHandleId: 1,
    handles: new Map(),
  };

  const normalizeSelector = (selector) => {
    if (typeof selector !== "string")
      throw new Error("Selector must be a string");
    if (selector.startsWith("css="))
      return selector.slice(4);
    return selector;
  };

  const preview = (value) => {
    if (value instanceof Element) {
      const id = value.id ? "#" + value.id : "";
      return "<" + value.tagName.toLowerCase() + id + ">";
    }
    if (value === null)
      return "null";
    if (value === undefined)
      return "undefined";
    if (typeof value === "string")
      return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
      return String(value);
    if (typeof value === "function")
      return "JSHandle@function";
    if (Array.isArray(value))
      return "JSHandle@array";
    return "JSHandle@object";
  };

  const createHandle = (value) => {
    const id = state.nextHandleId++;
    state.handles.set(id, value);
    return {
      id,
      type: value instanceof Element ? "element" : "js",
      preview: preview(value),
    };
  };

  const resolveHandle = (handleId) => state.handles.get(handleId);

  const resolveRoot = (rootHandleId) => {
    if (!rootHandleId)
      return document;
    return resolveHandle(rootHandleId);
  };

  const deserialize = (value, handleIds) => {
    if (value === null || typeof value !== "object")
      return value;
    if ("h" in value)
      return resolveHandle(handleIds[value.h]);
    if ("n" in value)
      return value.n;
    if ("b" in value)
      return value.b;
    if ("s" in value)
      return value.s;
    if ("v" in value) {
      switch (value.v) {
        case "null":
          return null;
        case "undefined":
          return undefined;
        case "NaN":
          return NaN;
        case "Infinity":
          return Infinity;
        case "-Infinity":
          return -Infinity;
        case "-0":
          return -0;
        default:
          return undefined;
      }
    }
    if ("d" in value)
      return new Date(value.d);
    if ("u" in value)
      return new URL(value.u);
    if ("bi" in value)
      return BigInt(value.bi);
    if ("r" in value)
      return new RegExp(value.r.p, value.r.f);
    if ("a" in value)
      return value.a.map((entry) => deserialize(entry, handleIds));
    if ("o" in value) {
      const out = {};
      for (const entry of value.o)
        out[entry.k] = deserialize(entry.v, handleIds);
      return out;
    }
    return value;
  };

  const getElement = (selector, rootHandleId) => {
    const root = resolveRoot(rootHandleId);
    if (!root || typeof root.querySelector !== "function")
      return null;
    return root.querySelector(normalizeSelector(selector));
  };

  const getElements = (selector, rootHandleId) => {
    const root = resolveRoot(rootHandleId);
    if (!root || typeof root.querySelectorAll !== "function")
      return [];
    return Array.from(root.querySelectorAll(normalizeSelector(selector)));
  };

  const getTarget = (payload) => {
    if (payload.handleId)
      return resolveHandle(payload.handleId);
    if (payload.selector)
      return getElement(payload.selector, payload.rootHandleId);
    return null;
  };

  const focusTarget = (target) => {
    if (!target || typeof target.focus !== "function")
      throw new Error("Target is not focusable");
    target.focus();
  };

  const setNativeValue = (target, value) => {
    if (target instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      descriptor.set.call(target, value);
      return;
    }
    if (target instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      descriptor.set.call(target, value);
      return;
    }
    if (target && target.isContentEditable) {
      target.textContent = value;
      return;
    }
    throw new Error("Target does not support textual value");
  };

  const getTextValue = (target) => {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
      return target.value;
    if (target && target.isContentEditable)
      return target.textContent || "";
    return "";
  };

  const setCheckedValue = (target, checked) => {
    if (target instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
      descriptor.set.call(target, checked);
      return;
    }
    throw new Error("Target is not a checkbox or radio button");
  };

  const eventConstructor = (type, init) => {
    if (type === "click" || type === "dblclick" || type === "mousedown" || type === "mouseup" || type === "mouseover" || type === "mouseout" || type === "mouseenter" || type === "mouseleave")
      return MouseEvent;
    if (type === "keydown" || type === "keyup" || type === "keypress")
      return KeyboardEvent;
    if (type === "wheel")
      return WheelEvent;
    if (type === "input" || type === "change")
      return Event;
    if (init && typeof init === "object" && "detail" in init)
      return CustomEvent;
    return Event;
  };

  const dispatchEvent = (target, type, init) => {
    const EventCtor = eventConstructor(type, init);
    const defaults = {
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const event = new EventCtor(type, Object.assign(defaults, init || {}));
    target.dispatchEvent(event);
  };

  const typeIntoTarget = (target, text) => {
    focusTarget(target);
    let current = getTextValue(target);
    for (const char of text) {
      dispatchEvent(target, "keydown", { key: char });
      dispatchEvent(target, "keypress", { key: char });
      current += char;
      setNativeValue(target, current);
      dispatchEvent(target, "input", {});
      dispatchEvent(target, "keyup", { key: char });
    }
    dispatchEvent(target, "change", {});
    return current;
  };

  const pressTarget = (target, key) => {
    focusTarget(target);
    dispatchEvent(target, "keydown", { key });
    if (key.length === 1)
      dispatchEvent(target, "keypress", { key });
    if (key === "Backspace") {
      const current = getTextValue(target);
      setNativeValue(target, current.slice(0, -1));
      dispatchEvent(target, "input", {});
    }
    dispatchEvent(target, "keyup", { key });
    if (key === "Enter")
      dispatchEvent(target, "change", {});
    return getTextValue(target);
  };

  const isVisible = (target) => {
    if (!target)
      return false;
    if (target.hidden)
      return false;
    const style = window.getComputedStyle(target);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
      return false;
    return true;
  };

  const matchesOption = (option, spec) => {
    if (!spec)
      return false;
    if (spec.valueOrLabel !== undefined)
      return option.value === spec.valueOrLabel || option.label === spec.valueOrLabel;
    if (spec.value !== undefined && option.value !== spec.value)
      return false;
    if (spec.label !== undefined && option.label !== spec.label)
      return false;
    if (spec.index !== undefined && Array.from(option.parentElement.options).indexOf(option) !== spec.index)
      return false;
    return true;
  };

  const executeExpression = (expression, isFunction, argValue, handleIds, firstArg) => {
    const arg = deserialize(argValue, handleIds);
    if (!isFunction)
      return (0, eval)(expression);
    const fn = (0, eval)(expression);
    if (firstArg === undefined)
      return fn(arg);
    return fn(firstArg, arg);
  };

  window.__pwProxy = {
    version,

    evaluate(payload) {
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        undefined
      );
    },

    evaluateHandle(payload) {
      return createHandle(
        executeExpression(
          payload.expression,
          payload.isFunction,
          payload.argValue,
          payload.handleIds || [],
          undefined
        )
      );
    },

    evaluateOnHandle(payload) {
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        resolveHandle(payload.handleId)
      );
    },

    evaluateHandleOnHandle(payload) {
      return createHandle(
        executeExpression(
          payload.expression,
          payload.isFunction,
          payload.argValue,
          payload.handleIds || [],
          resolveHandle(payload.handleId)
        )
      );
    },

    waitForFunctionStep(payload) {
      const value = executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        undefined
      );
      if (!value)
        return null;
      return createHandle(value);
    },

    disposeHandle(payload) {
      state.handles.delete(payload.handleId);
      return null;
    },

    jsonValue(payload) {
      return resolveHandle(payload.handleId);
    },

    getProperty(payload) {
      const target = resolveHandle(payload.handleId);
      return createHandle(target ? target[payload.name] : undefined);
    },

    getPropertyList(payload) {
      const target = resolveHandle(payload.handleId);
      const properties = [];
      if (!target || (typeof target !== "object" && typeof target !== "function"))
        return properties;
      for (const name in target)
        properties.push({ name, handle: createHandle(target[name]) });
      return properties;
    },

    querySelector(payload) {
      const element = getElement(payload.selector, payload.rootHandleId);
      return element ? createHandle(element) : null;
    },

    querySelectorAll(payload) {
      return getElements(payload.selector, payload.rootHandleId).map((element) =>
        createHandle(element)
      );
    },

    queryCount(payload) {
      return getElements(payload.selector, payload.rootHandleId).length;
    },

    waitForSelectorStep(payload) {
      const element = getElement(payload.selector, payload.rootHandleId);
      const stateName = payload.state || "visible";
      if (stateName === "attached")
        return element ? createHandle(element) : null;
      if (stateName === "visible")
        return element && isVisible(element) ? createHandle(element) : null;
      if (stateName === "hidden")
        return !element || !isVisible(element) ? { hidden: true } : null;
      if (stateName === "detached")
        return !element ? { hidden: true } : null;
      throw new Error("Unsupported waitForSelector state: " + stateName);
    },

    evalOnSelector(payload) {
      const element = getElement(payload.selector, payload.rootHandleId);
      if (!element)
        throw new Error("No element matches selector: " + payload.selector);
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        element
      );
    },

    evalOnSelectorAll(payload) {
      const elements = getElements(payload.selector, payload.rootHandleId);
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        elements
      );
    },

    textContent(payload) {
      const target = getTarget(payload);
      return target ? target.textContent : null;
    },

    innerText(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      return target.innerText;
    },

    innerHTML(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      return target.innerHTML;
    },

    getAttribute(payload) {
      const target = getTarget(payload);
      if (!target)
        return null;
      return target.getAttribute(payload.name);
    },

    inputValue(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      return getTextValue(target);
    },

    content() {
      if (document.doctype)
        return "<!DOCTYPE " + document.doctype.name + ">" + document.documentElement.outerHTML;
      return document.documentElement.outerHTML;
    },

    title() {
      return document.title;
    },

    focus(payload) {
      focusTarget(getTarget(payload));
      return null;
    },

    blur(payload) {
      const target = getTarget(payload);
      if (!target || typeof target.blur !== "function")
        throw new Error("Target is not blur-capable");
      target.blur();
      return null;
    },

    click(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      if (typeof target.click === "function")
        target.click();
      else
        dispatchEvent(target, "click", {});
      return null;
    },

    dblclick(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      dispatchEvent(target, "dblclick", {});
      return null;
    },

    hover(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      dispatchEvent(target, "mouseover", {});
      dispatchEvent(target, "mouseenter", {});
      return null;
    },

    dispatchEvent(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      const init = deserialize(payload.eventInitValue, payload.handleIds || []);
      dispatchEvent(target, payload.type, init);
      return null;
    },

    fill(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      focusTarget(target);
      setNativeValue(target, payload.value);
      dispatchEvent(target, "input", {});
      dispatchEvent(target, "change", {});
      return null;
    },

    type(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      return typeIntoTarget(target, payload.text);
    },

    press(payload) {
      const target = getTarget(payload);
      if (!target)
        throw new Error("Target not found");
      return pressTarget(target, payload.key);
    },

    check(payload) {
      const target = getTarget(payload);
      if (!(target instanceof HTMLInputElement))
        throw new Error("Target is not a checkbox or radio button");
      if (target.type === "radio" && payload.checked === false)
        throw new Error("Cannot uncheck radio button");
      if (!payload.trial && target.checked !== payload.checked)
        target.click();
      return target.checked;
    },

    selectOption(payload) {
      const target = getTarget(payload);
      if (!(target instanceof HTMLSelectElement))
        throw new Error("Target is not a select element");

      let selectedOptions = [];
      if (payload.optionHandleIds && payload.optionHandleIds.length) {
        selectedOptions = payload.optionHandleIds
          .map((id) => resolveHandle(id))
          .filter((value) => value instanceof HTMLOptionElement);
      } else {
        const specs = payload.options || [];
        if (!specs.length) {
          selectedOptions = [];
        } else {
          selectedOptions = Array.from(target.options).filter((option) =>
            specs.some((spec) => matchesOption(option, spec))
          );
        }
      }

      if (!target.multiple && selectedOptions.length > 1)
        selectedOptions = selectedOptions.slice(0, 1);

      for (const option of Array.from(target.options))
        option.selected = selectedOptions.includes(option);

      dispatchEvent(target, "input", {});
      dispatchEvent(target, "change", {});

      return Array.from(target.selectedOptions).map((option) => option.value);
    },

    isVisible(payload) {
      return isVisible(getTarget(payload));
    },

    isHidden(payload) {
      return !isVisible(getTarget(payload));
    },

    isChecked(payload) {
      const target = getTarget(payload);
      if (target instanceof HTMLInputElement)
        return !!target.checked;
      const aria = target ? target.getAttribute("aria-checked") : null;
      return aria === "true";
    },

    isDisabled(payload) {
      const target = getTarget(payload);
      if (!target)
        return false;
      return !!target.disabled || target.getAttribute("aria-disabled") === "true";
    },

    isEnabled(payload) {
      return !window.__pwProxy.isDisabled(payload);
    },

    isEditable(payload) {
      const target = getTarget(payload);
      if (!target)
        return false;
      if (target.isContentEditable)
        return true;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
        return !target.readOnly && !target.disabled;
      return false;
    },
  };

  return true;
})()`;

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
  constructor({ appPort = randomPort() } = {}) {
    this._appPort = appPort;
    this._app = null;
    this._bridge = null;
    this._stopped = false;
    this._lastSnapshot = {
      url: "wry://index.html",
      title: "",
      viewportSize: { width: 0, height: 0 },
    };
  }

  async start() {
    this._stopped = false;
    this._app = spawn(BIN, ["--test-port", String(this._appPort)], {
      cwd: ROOT,
      stdio: process.env.DEBUG ? "inherit" : "ignore",
    });
    this._bridge = new TestBridge(this._appPort);
    await this._bridge.connect();
    await this.waitForAppReady();
  }

  async close() {
    if (this._stopped) return;
    this._stopped = true;
    await this._shutdownApp();
  }

  async restart() {
    await this._shutdownApp();
    await this.start();
  }

  async _shutdownApp() {
    this._bridge?.close();
    this._bridge = null;
    if (!this._app) return;
    this._app.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => this._app.once("exit", resolve)),
      sleep(2_000),
    ]);
    this._app = null;
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
    throw new TimeoutError(`Timed out after ${timeoutMs}ms`);
  }

  async waitForAppReady() {
    await this.waitFor(async () => {
      const header = await this.evalValue(
        `document.querySelector("h1")?.textContent ?? null`
      );
      return header === "dioxus-react";
    }, 15_000);
    await this.ensureRuntime();
    await this.snapshot();
  }

  async ensureRuntime() {
    await this.evalValue(RUNTIME_BOOTSTRAP);
  }

  async runtimeCall(method, payload = {}) {
    await this.ensureRuntime();
    return await this.evalValue(`(() => {
      const payload = ${JSON.stringify(payload)};
      return window.__pwProxy[${JSON.stringify(method)}](payload);
    })()`);
  }

  _handleIds(dispatchers = []) {
    return dispatchers.map((dispatcher) => dispatcher.handleId);
  }

  _payloadFromArg(arg) {
    return {
      argValue: arg.value,
      handleIds: this._handleIds(arg.handles),
    };
  }

  async snapshot() {
    const [url, title, viewportSize] = await Promise.all([
      this.evalValue("location.href"),
      this.evalValue("document.title"),
      this.evalValue("({ width: window.innerWidth, height: window.innerHeight })"),
    ]);
    this._lastSnapshot = { url, title, viewportSize };
    return this._lastSnapshot;
  }

  async evaluateExpression(expression, isFunction, arg) {
    return await this.runtimeCall("evaluate", {
      expression,
      isFunction,
      ...this._payloadFromArg(arg),
    });
  }

  async evaluateExpressionHandle(expression, isFunction, arg) {
    return await this.runtimeCall("evaluateHandle", {
      expression,
      isFunction,
      ...this._payloadFromArg(arg),
    });
  }

  async evaluateOnHandle(handleId, expression, isFunction, arg) {
    return await this.runtimeCall("evaluateOnHandle", {
      handleId,
      expression,
      isFunction,
      ...this._payloadFromArg(arg),
    });
  }

  async evaluateHandleOnHandle(handleId, expression, isFunction, arg) {
    return await this.runtimeCall("evaluateHandleOnHandle", {
      handleId,
      expression,
      isFunction,
      ...this._payloadFromArg(arg),
    });
  }

  async waitForFunction(expression, isFunction, arg, timeout, pollingInterval) {
    const deadline = timeout ? Date.now() + timeout : Infinity;
    const intervalMs = pollingInterval ?? 16;
    while (Date.now() < deadline) {
      const result = await this.runtimeCall("waitForFunctionStep", {
        expression,
        isFunction,
        ...this._payloadFromArg(arg),
      });
      if (result) return result;
      await sleep(intervalMs);
    }
    throw new TimeoutError(`Timeout ${timeout}ms exceeded`);
  }

  async querySelector(selector, rootHandleId) {
    return await this.runtimeCall("querySelector", { selector, rootHandleId });
  }

  async querySelectorAll(selector, rootHandleId) {
    return await this.runtimeCall("querySelectorAll", { selector, rootHandleId });
  }

  async waitForSelector(selector, rootHandleId, state, timeout) {
    const deadline = timeout ? Date.now() + timeout : Date.now() + 30_000;
    while (Date.now() < deadline) {
      const result = await this.runtimeCall("waitForSelectorStep", {
        selector,
        rootHandleId,
        state,
      });
      if (result) return result.hidden ? null : result;
      await sleep(50);
    }
    throw new TimeoutError(`Timeout ${timeout}ms exceeded`);
  }

  async evalOnSelector(selector, rootHandleId, expression, isFunction, arg) {
    return await this.runtimeCall("evalOnSelector", {
      selector,
      rootHandleId,
      expression,
      isFunction,
      ...this._payloadFromArg(arg),
    });
  }

  async evalOnSelectorAll(selector, rootHandleId, expression, isFunction, arg) {
    return await this.runtimeCall("evalOnSelectorAll", {
      selector,
      rootHandleId,
      expression,
      isFunction,
      ...this._payloadFromArg(arg),
    });
  }

  async handleJsonValue(handleId) {
    return await this.runtimeCall("jsonValue", { handleId });
  }

  async disposeHandle(handleId) {
    await this.runtimeCall("disposeHandle", { handleId });
  }

  async getHandleProperty(handleId, name) {
    return await this.runtimeCall("getProperty", { handleId, name });
  }

  async getHandleProperties(handleId) {
    return await this.runtimeCall("getPropertyList", { handleId });
  }

  async textContent(selector, rootHandleId, handleId) {
    return await this.runtimeCall("textContent", { selector, rootHandleId, handleId });
  }

  async innerText(selector, rootHandleId, handleId) {
    return await this.runtimeCall("innerText", { selector, rootHandleId, handleId });
  }

  async innerHTML(selector, rootHandleId, handleId) {
    return await this.runtimeCall("innerHTML", { selector, rootHandleId, handleId });
  }

  async getAttribute(selector, rootHandleId, handleId, name) {
    return await this.runtimeCall("getAttribute", {
      selector,
      rootHandleId,
      handleId,
      name,
    });
  }

  async inputValue(selector, rootHandleId, handleId) {
    return await this.runtimeCall("inputValue", { selector, rootHandleId, handleId });
  }

  async queryCount(selector, rootHandleId) {
    return await this.runtimeCall("queryCount", { selector, rootHandleId });
  }

  async content() {
    return await this.runtimeCall("content");
  }

  async title() {
    return await this.runtimeCall("title");
  }

  async focus(selector, rootHandleId, handleId) {
    await this.runtimeCall("focus", { selector, rootHandleId, handleId });
  }

  async blur(selector, rootHandleId, handleId) {
    await this.runtimeCall("blur", { selector, rootHandleId, handleId });
  }

  async click(selector, rootHandleId, handleId) {
    await this.runtimeCall("click", { selector, rootHandleId, handleId });
  }

  async dblclick(selector, rootHandleId, handleId) {
    await this.runtimeCall("dblclick", { selector, rootHandleId, handleId });
  }

  async hover(selector, rootHandleId, handleId) {
    await this.runtimeCall("hover", { selector, rootHandleId, handleId });
  }

  async dispatchEvent(selector, rootHandleId, handleId, type, eventInit) {
    await this.runtimeCall("dispatchEvent", {
      selector,
      rootHandleId,
      handleId,
      type,
      eventInitValue: eventInit.value,
      handleIds: this._handleIds(eventInit.handles),
    });
  }

  async fill(selector, rootHandleId, handleId, value) {
    await this.runtimeCall("fill", { selector, rootHandleId, handleId, value });
  }

  async type(selector, rootHandleId, handleId, text) {
    await this.runtimeCall("type", { selector, rootHandleId, handleId, text });
  }

  async press(selector, rootHandleId, handleId, key) {
    await this.runtimeCall("press", { selector, rootHandleId, handleId, key });
  }

  async setChecked(selector, rootHandleId, handleId, checked, trial) {
    return await this.runtimeCall("check", {
      selector,
      rootHandleId,
      handleId,
      checked,
      trial: !!trial,
    });
  }

  async selectOption(selector, rootHandleId, handleId, options, elements) {
    return await this.runtimeCall("selectOption", {
      selector,
      rootHandleId,
      handleId,
      options,
      optionHandleIds: this._handleIds(elements),
    });
  }

  async boolState(method, selector, rootHandleId, handleId) {
    return await this.runtimeCall(method, { selector, rootHandleId, handleId });
  }

  async reload() {
    await this.restart();
  }

  async goto(url) {
    await this.evalValue(
      `setTimeout(() => { location.href = ${JSON.stringify(url)}; }, 0); null`
    );
    await this.waitForAppReady();
  }
}

class ProxyHandleDispatcher extends Dispatcher {
  constructor(parent, controller, meta) {
    const object = new ProxyObject(parent._object, "proxyHandle");
    super(parent, object, meta.type === "element" ? "ElementHandle" : "JSHandle", {
      preview: meta.preview,
    });
    this._controller = controller;
    this.handleId = meta.id;
    this._isElement = meta.type === "element";
  }

  async evaluateExpression(params) {
    return {
      value: serializeResult(
        await this._controller.evaluateOnHandle(
          this.handleId,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async evaluateExpressionHandle(params) {
    const meta = await this._controller.evaluateHandleOnHandle(
      this.handleId,
      params.expression,
      params.isFunction,
      params.arg
    );
    return { handle: new ProxyHandleDispatcher(this.parentScope(), this._controller, meta) };
  }

  async getProperty(params) {
    const meta = await this._controller.getHandleProperty(this.handleId, params.name);
    return { handle: new ProxyHandleDispatcher(this.parentScope(), this._controller, meta) };
  }

  async getPropertyList() {
    const properties = await this._controller.getHandleProperties(this.handleId);
    return {
      properties: properties.map((entry) => ({
        name: entry.name,
        value: new ProxyHandleDispatcher(this.parentScope(), this._controller, entry.handle),
      })),
    };
  }

  async jsonValue() {
    return { value: serializeResult(await this._controller.handleJsonValue(this.handleId)) };
  }

  async dispose() {
    await this._controller.disposeHandle(this.handleId);
    this._dispose();
  }

  async getAttribute(params) {
    const value = await this._controller.getAttribute(
      null,
      null,
      this.handleId,
      params.name
    );
    return value === null ? {} : { value };
  }

  async inputValue() {
    return { value: await this._controller.inputValue(null, null, this.handleId) };
  }

  async textContent() {
    const value = await this._controller.textContent(null, null, this.handleId);
    return value === null ? {} : { value };
  }

  async innerText() {
    return { value: await this._controller.innerText(null, null, this.handleId) };
  }

  async innerHTML() {
    return { value: await this._controller.innerHTML(null, null, this.handleId) };
  }

  async isChecked() {
    return { value: await this._controller.boolState("isChecked", null, null, this.handleId) };
  }

  async isDisabled() {
    return { value: await this._controller.boolState("isDisabled", null, null, this.handleId) };
  }

  async isEditable() {
    return { value: await this._controller.boolState("isEditable", null, null, this.handleId) };
  }

  async isEnabled() {
    return { value: await this._controller.boolState("isEnabled", null, null, this.handleId) };
  }

  async isHidden() {
    return { value: await this._controller.boolState("isHidden", null, null, this.handleId) };
  }

  async isVisible() {
    return { value: await this._controller.boolState("isVisible", null, null, this.handleId) };
  }

  async dispatchEvent(params) {
    await this._controller.dispatchEvent(
      null,
      null,
      this.handleId,
      params.type,
      params.eventInit
    );
  }

  async hover() {
    await this._controller.hover(null, null, this.handleId);
  }

  async click() {
    await this._controller.click(null, null, this.handleId);
  }

  async dblclick() {
    await this._controller.dblclick(null, null, this.handleId);
  }

  async selectOption(params) {
    return {
      values: await this._controller.selectOption(
        null,
        null,
        this.handleId,
        params.options || [],
        params.elements || []
      ),
    };
  }

  async fill(params) {
    await this._controller.fill(null, null, this.handleId, params.value);
  }

  async focus() {
    await this._controller.focus(null, null, this.handleId);
  }

  async type(params) {
    await this._controller.type(null, null, this.handleId, params.text);
  }

  async press(params) {
    await this._controller.press(null, null, this.handleId, params.key);
  }

  async check(params) {
    await this._controller.setChecked(null, null, this.handleId, true, params.trial);
  }

  async uncheck(params) {
    await this._controller.setChecked(null, null, this.handleId, false, params.trial);
  }

  async querySelector(params) {
    const meta = await this._controller.querySelector(params.selector, this.handleId);
    return { element: meta ? new ProxyHandleDispatcher(this.parentScope(), this._controller, meta) : undefined };
  }

  async querySelectorAll(params) {
    const elements = await this._controller.querySelectorAll(params.selector, this.handleId);
    return {
      elements: elements.map(
        (meta) => new ProxyHandleDispatcher(this.parentScope(), this._controller, meta)
      ),
    };
  }

  async evalOnSelector(params) {
    return {
      value: serializeResult(
        await this._controller.evalOnSelector(
          params.selector,
          this.handleId,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async evalOnSelectorAll(params) {
    return {
      value: serializeResult(
        await this._controller.evalOnSelectorAll(
          params.selector,
          this.handleId,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async waitForSelector(params) {
    const meta = await this._controller.waitForSelector(
      params.selector,
      this.handleId,
      params.state,
      params.timeout
    );
    return { element: meta ? new ProxyHandleDispatcher(this.parentScope(), this._controller, meta) : undefined };
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
      viewportSize: controller._lastSnapshot.viewportSize,
      isClosed: false,
      opener: undefined,
    });
    this._controller = controller;
    this.adopt(frame);
    this._frame = frame;
  }

  async updateSubscription() {}

  async reload() {
    await this._controller.reload();
    await this._frame.refresh();
    return {};
  }

  async close() {
    await this._controller.close();
    this._dispatchEvent("close");
    this._dispose();
  }
}

class ProxyFrameDispatcher extends Dispatcher {
  constructor(parent, controller) {
    const object = new ProxyObject(parent._object, "proxyFrame");
    super(parent, object, "Frame", {
      url: controller._lastSnapshot.url,
      name: "",
      parentFrame: undefined,
      loadStates: ["commit", "domcontentloaded", "load", "networkidle"],
    });
    this._controller = controller;
  }

  async refresh() {
    const snapshot = await this._controller.snapshot();
    this._dispatchEvent("navigated", {
      url: snapshot.url,
      name: "",
      error: undefined,
      newDocument: undefined,
    });
  }

  async evaluateExpression(params) {
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

  async evaluateExpressionHandle(params) {
    const meta = await this._controller.evaluateExpressionHandle(
      params.expression,
      params.isFunction,
      params.arg
    );
    return { handle: new ProxyHandleDispatcher(this, this._controller, meta) };
  }

  async waitForSelector(params) {
    const meta = await this._controller.waitForSelector(
      params.selector,
      null,
      params.state,
      params.timeout
    );
    return { element: meta ? new ProxyHandleDispatcher(this, this._controller, meta) : undefined };
  }

  async dispatchEvent(params) {
    await this._controller.dispatchEvent(params.selector, null, null, params.type, params.eventInit);
  }

  async evalOnSelector(params) {
    return {
      value: serializeResult(
        await this._controller.evalOnSelector(
          params.selector,
          null,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async evalOnSelectorAll(params) {
    return {
      value: serializeResult(
        await this._controller.evalOnSelectorAll(
          params.selector,
          null,
          params.expression,
          params.isFunction,
          params.arg
        )
      ),
    };
  }

  async querySelector(params) {
    const meta = await this._controller.querySelector(params.selector, null);
    return { element: meta ? new ProxyHandleDispatcher(this, this._controller, meta) : undefined };
  }

  async querySelectorAll(params) {
    const elements = await this._controller.querySelectorAll(params.selector, null);
    return {
      elements: elements.map(
        (meta) => new ProxyHandleDispatcher(this, this._controller, meta)
      ),
    };
  }

  async queryCount(params) {
    return { value: await this._controller.queryCount(params.selector, null) };
  }

  async content() {
    return { value: await this._controller.content() };
  }

  async goto(params) {
    await this._controller.goto(params.url);
    await this.refresh();
    return {};
  }

  async click(params) {
    await this._controller.click(params.selector, null, null);
  }

  async dblclick(params) {
    await this._controller.dblclick(params.selector, null, null);
  }

  async fill(params) {
    await this._controller.fill(params.selector, null, null, params.value);
  }

  async focus(params) {
    await this._controller.focus(params.selector, null, null);
  }

  async blur(params) {
    await this._controller.blur(params.selector, null, null);
  }

  async textContent(params) {
    const value = await this._controller.textContent(params.selector, null, null);
    return value === null ? {} : { value };
  }

  async innerText(params) {
    return { value: await this._controller.innerText(params.selector, null, null) };
  }

  async innerHTML(params) {
    return { value: await this._controller.innerHTML(params.selector, null, null) };
  }

  async getAttribute(params) {
    const value = await this._controller.getAttribute(
      params.selector,
      null,
      null,
      params.name
    );
    return value === null ? {} : { value };
  }

  async inputValue(params) {
    return { value: await this._controller.inputValue(params.selector, null, null) };
  }

  async isChecked(params) {
    return { value: await this._controller.boolState("isChecked", params.selector, null, null) };
  }

  async isDisabled(params) {
    return { value: await this._controller.boolState("isDisabled", params.selector, null, null) };
  }

  async isEditable(params) {
    return { value: await this._controller.boolState("isEditable", params.selector, null, null) };
  }

  async isEnabled(params) {
    return { value: await this._controller.boolState("isEnabled", params.selector, null, null) };
  }

  async isHidden(params) {
    return { value: await this._controller.boolState("isHidden", params.selector, null, null) };
  }

  async isVisible(params) {
    return { value: await this._controller.boolState("isVisible", params.selector, null, null) };
  }

  async hover(params) {
    await this._controller.hover(params.selector, null, null);
  }

  async selectOption(params) {
    return {
      values: await this._controller.selectOption(
        params.selector,
        null,
        null,
        params.options || [],
        params.elements || []
      ),
    };
  }

  async type(params) {
    await this._controller.type(params.selector, null, null, params.text);
  }

  async press(params) {
    await this._controller.press(params.selector, null, null, params.key);
  }

  async check(params) {
    await this._controller.setChecked(params.selector, null, null, true, params.trial);
  }

  async uncheck(params) {
    await this._controller.setChecked(params.selector, null, null, false, params.trial);
  }

  async waitForTimeout(params) {
    await sleep(params.waitTimeout);
  }

  async waitForFunction(params) {
    const meta = await this._controller.waitForFunction(
      params.expression,
      params.isFunction,
      params.arg,
      params.timeout,
      params.pollingInterval
    );
    return { handle: new ProxyHandleDispatcher(this, this._controller, meta) };
  }

  async title() {
    return { value: await this._controller.title() };
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
  constructor({ appPort = randomPort(), proxyPort = DEFAULT_PROXY_PORT } = {}) {
    this._appPort = appPort;
    this._proxyPort = proxyPort;
    this._controller = new ProxyAppController({ appPort });
    this._server = null;
    this._connections = new Set();
  }

  async start() {
    await this._controller.start();
    this._server = new wsServer({ port: this._proxyPort });
    this._server.on("connection", (socket) => {
      const connection = new DispatcherConnection();
      this._connections.add(connection);
      const root = new RootDispatcher(connection, async (scope) => {
        return new ProxyPlaywrightDispatcher(scope, this._controller);
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
    const address = this._server.address();
    if (!address || typeof address === "string")
      throw new Error("Proxy websocket server is not listening");
    return `ws://127.0.0.1:${address.port}`;
  }

  async close() {
    for (const connection of this._connections)
      connection.onmessage = () => {};
    this._connections.clear();
    if (this._server) {
      await new Promise((resolve) => this._server.close(resolve));
      this._server = null;
    }
    await this._controller.close();
  }
}
