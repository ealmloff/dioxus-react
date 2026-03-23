import { RUNTIME_VERSION } from "./constants";

export const RUNTIME_BOOTSTRAP = `(() => {
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
