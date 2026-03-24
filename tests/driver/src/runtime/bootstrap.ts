import playwrightInjectedSource from "virtual:driver-playwright-injected-source";

type AnyRecord = Record<string, any>;
type ElementStateName =
  | "visible"
  | "hidden"
  | "enabled"
  | "disabled"
  | "editable"
  | "checked"
  | "unchecked";
type InjectedScriptCtor = new (
  window: Window & typeof globalThis,
  options: AnyRecord
) => InjectedScriptLike;

interface InjectedScriptLike {
  parseSelector(selector: string): unknown;
  querySelector(selector: unknown, root: Node, strict: boolean): Element | undefined;
  querySelectorAll(selector: unknown, root: Node): Element[];
  generateSelectorSimple(targetElement: Element, options?: AnyRecord): string;
  highlight(selector: unknown): void;
  elementState(
    node: Node,
    state: ElementStateName
  ): { matches: boolean; received?: string | "error:notconnected"; isRadio?: boolean };
  previewNode?(node: Node): string;
}

declare global {
  interface Window {
    __pwProxy?: AnyRecord;
  }
}

export default function installPlaywrightRuntime(version: number): true {
  if (window.__pwProxy && window.__pwProxy.version === version) return true;

  const state = {
    version,
    nextHandleId: 1,
    handles: new Map<number, any>(),
    parsedSelectors: new Map<string, unknown>(),
    testIdAttributeName: "data-testid",
    injectedScript: null as InjectedScriptLike | null,
    injectedScriptCtor: null as InjectedScriptCtor | null,
  };

  const resolveHandle = (handleId: number): any => state.handles.get(handleId);

  const resolveRoot = (rootHandleId: number | null | undefined): Node => {
    if (!rootHandleId) return document;
    const root = resolveHandle(rootHandleId);
    if (!root) throw new Error("Root handle not found");
    return root;
  };

  const loadInjectedScriptCtor = (): InjectedScriptCtor => {
    if (state.injectedScriptCtor) return state.injectedScriptCtor;

    const module = { exports: {} as AnyRecord };
    new Function("module", playwrightInjectedSource)(module);

    const factory = module.exports.InjectedScript;
    if (typeof factory !== "function") {
      throw new Error("Playwright injected script did not expose InjectedScript");
    }

    const ctor = factory();
    if (typeof ctor !== "function") {
      throw new Error("Playwright injected script factory did not return a constructor");
    }

    state.injectedScriptCtor = ctor as InjectedScriptCtor;
    return state.injectedScriptCtor;
  };

  const getInjectedScript = (): InjectedScriptLike => {
    if (state.injectedScript) return state.injectedScript;

    const InjectedScript = loadInjectedScriptCtor();
    const previousMutationObserver = window.MutationObserver;
    if (typeof previousMutationObserver !== "function") {
      window.MutationObserver = class {
        observe() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as typeof MutationObserver;
    }
    try {
      state.injectedScript = new InjectedScript(window, {
        isUnderTest: false,
        sdkLanguage: "javascript",
        testIdAttributeName: state.testIdAttributeName,
        stableRafCount: 1,
        browserName: "webkit",
        isUtilityWorld: false,
        customEngines: [],
      });
    } finally {
      if (typeof previousMutationObserver === "function") {
        window.MutationObserver = previousMutationObserver;
      } else {
        delete (window as AnyRecord).MutationObserver;
      }
    }
    return state.injectedScript;
  };

  const validateSelector = (selector: unknown): string => {
    if (typeof selector === "string") return selector;
    if (selector instanceof String) return selector.valueOf();
    throw new Error(`selector: expected string, got ${typeof selector}`);
  };

  const parseSelector = (selector: unknown): unknown => {
    const value = validateSelector(selector);
    const cached = state.parsedSelectors.get(value);
    if (cached) return cached;

    const parsed = getInjectedScript().parseSelector(value);
    state.parsedSelectors.set(value, parsed);
    return parsed;
  };

  const querySelector = (
    selector: unknown,
    rootHandleId: number | null | undefined,
    strict = false
  ): Element | null => {
    const root = resolveRoot(rootHandleId);
    const parsed = parseSelector(selector);
    return getInjectedScript().querySelector(parsed, root, strict) ?? null;
  };

  const querySelectorAll = (
    selector: unknown,
    rootHandleId: number | null | undefined
  ): Element[] => {
    const root = resolveRoot(rootHandleId);
    const parsed = parseSelector(selector);
    return getInjectedScript().querySelectorAll(parsed, root);
  };

  const resolveTarget = (payload: AnyRecord): any => {
    if (payload.handleId) return resolveHandle(payload.handleId);
    if (Object.prototype.hasOwnProperty.call(payload, "selector")) {
      return querySelector(payload.selector, payload.rootHandleId, !!payload.strict);
    }
    return null;
  };

  const requireTarget = (payload: AnyRecord): any => {
    const target = resolveTarget(payload);
    if (!target) throw new Error("Target not found");
    return target;
  };

  const readElementState = (
    target: any,
    stateName: ElementStateName
  ): { matches: boolean; received?: string | "error:notconnected"; isRadio?: boolean } => {
    return getInjectedScript().elementState(target, stateName);
  };

  const preview = (value: any): string => {
    if (value instanceof Element) {
      return getInjectedScript().previewNode?.(value) ?? `<${value.tagName.toLowerCase()}>`;
    }
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }
    if (typeof value === "function") return "JSHandle@function";
    if (Array.isArray(value)) return "JSHandle@array";
    return "JSHandle@object";
  };

  const createHandle = (value: any) => {
    const id = state.nextHandleId++;
    state.handles.set(id, value);
    return {
      id,
      type: value instanceof Element ? "element" : "js",
      preview: preview(value),
    };
  };

  const deserialize = (value: any, handleIds: number[]): any => {
    if (value === null || typeof value !== "object") return value;
    if ("h" in value) return resolveHandle(handleIds[value.h]);
    if ("n" in value) return value.n;
    if ("b" in value) return value.b;
    if ("s" in value) return value.s;
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
    if ("d" in value) return new Date(value.d);
    if ("u" in value) return new URL(value.u);
    if ("bi" in value) return BigInt(value.bi);
    if ("r" in value) return new RegExp(value.r.p, value.r.f);
    if ("a" in value) return value.a.map((entry: any) => deserialize(entry, handleIds));
    if ("o" in value) {
      const out: Record<string, any> = {};
      for (const entry of value.o) out[entry.k] = deserialize(entry.v, handleIds);
      return out;
    }
    return value;
  };

  const focusTarget = (target: any): void => {
    if (!target || typeof target.focus !== "function") throw new Error("Target is not focusable");
    target.focus();
  };

  const setNativeValue = (target: any, value: string): void => {
    if (target instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      descriptor?.set?.call(target, value);
      return;
    }
    if (target instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      descriptor?.set?.call(target, value);
      return;
    }
    if (target && target.isContentEditable) {
      target.textContent = value;
      return;
    }
    throw new Error("Target does not support textual value");
  };

  const scrollIntoViewIfNeeded = (target: any): void => {
    if (!(target instanceof Element)) throw new Error("Target is not an element");
    const targetAsAny = target as AnyRecord;
    if (typeof targetAsAny.scrollIntoViewIfNeeded === "function") {
      targetAsAny.scrollIntoViewIfNeeded(false);
      return;
    }
    target.scrollIntoView();
  };

  const getTextValue = (target: any): string => {
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return target.value;
    }
    if (target && target.isContentEditable) return target.textContent || "";
    return "";
  };

  const eventConstructor = (type: string, init: any): any => {
    if (
      type === "click" ||
      type === "dblclick" ||
      type === "mousedown" ||
      type === "mouseup" ||
      type === "mouseover" ||
      type === "mouseout" ||
      type === "mouseenter" ||
      type === "mouseleave"
    ) {
      return MouseEvent;
    }
    if (type === "keydown" || type === "keyup" || type === "keypress") return KeyboardEvent;
    if (type === "wheel") return WheelEvent;
    if (type === "input" || type === "change") return Event;
    if (init && typeof init === "object" && "detail" in init) return CustomEvent;
    return Event;
  };

  const keyboardCodeForKey = (key: string): string => {
    if (key === "Enter") return "Enter";
    if (key === "Backspace") return "Backspace";
    if (key === "Tab") return "Tab";
    if (key === "Escape") return "Escape";
    if (key === " ") return "Space";
    if (typeof key === "string" && key.length === 1) return "Key" + key.toUpperCase();
    return key || "";
  };

  const keyboardCodePoint = (key: string): number => {
    if (key === "Enter") return 13;
    if (key === "Backspace") return 8;
    if (key === "Tab") return 9;
    if (key === "Escape") return 27;
    if (key === " ") return 32;
    if (typeof key === "string" && key.length === 1) return key.charCodeAt(0);
    return 0;
  };

  const enrichKeyboardInit = (type: string, init: any): AnyRecord => {
    const key = init && typeof init.key === "string" ? init.key : "";
    const codePoint = keyboardCodePoint(key);
    return Object.assign(
      {
        key,
        code: keyboardCodeForKey(key),
        keyCode: codePoint,
        charCode: type === "keypress" ? codePoint : 0,
        which: codePoint,
      },
      init || {}
    );
  };

  const dispatchSyntheticEvent = (target: any, type: string, init: any): void => {
    const EventCtor = eventConstructor(type, init);
    const defaults = {
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const eventInit =
      EventCtor === KeyboardEvent
        ? Object.assign(defaults, enrichKeyboardInit(type, init))
        : Object.assign(defaults, init || {});
    const event = new EventCtor(type, eventInit);
    target.dispatchEvent(event);
  };

  const typeIntoTarget = (target: any, text: string): string => {
    focusTarget(target);
    let current = getTextValue(target);
    for (const char of text) {
      dispatchSyntheticEvent(target, "keydown", { key: char });
      dispatchSyntheticEvent(target, "keypress", { key: char });
      current += char;
      setNativeValue(target, current);
      dispatchSyntheticEvent(target, "input", {});
      dispatchSyntheticEvent(target, "keyup", { key: char });
    }
    dispatchSyntheticEvent(target, "change", {});
    return current;
  };

  const pressTarget = (target: any, key: string): string => {
    focusTarget(target);
    dispatchSyntheticEvent(target, "keydown", { key });
    if (key.length === 1 || key === "Enter") dispatchSyntheticEvent(target, "keypress", { key });
    if (key === "Backspace") {
      const current = getTextValue(target);
      setNativeValue(target, current.slice(0, -1));
      dispatchSyntheticEvent(target, "input", {});
    }
    dispatchSyntheticEvent(target, "keyup", { key });
    if (key === "Enter") dispatchSyntheticEvent(target, "change", {});
    return getTextValue(target);
  };

  const matchesOption = (option: any, spec: any): boolean => {
    if (!spec) return false;
    if (spec.valueOrLabel !== undefined) {
      return option.value === spec.valueOrLabel || option.label === spec.valueOrLabel;
    }
    if (spec.value !== undefined && option.value !== spec.value) return false;
    if (spec.label !== undefined && option.label !== spec.label) return false;
    if (spec.index !== undefined) {
      const options = Array.from(option.parentElement?.options ?? []);
      if (options.indexOf(option) !== spec.index) return false;
    }
    return true;
  };

  const executeExpression = (
    expression: string,
    isFunction: boolean,
    argValue: any,
    handleIds: number[],
    firstArg: any
  ): any => {
    const arg = deserialize(argValue, handleIds);
    if (!isFunction) return (0, eval)(expression);
    const fn = (0, eval)(expression);
    if (firstArg === undefined) return fn(arg);
    return fn(firstArg, arg);
  };

  const proxy: AnyRecord = {
    version,

    evaluate(payload: AnyRecord) {
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        undefined
      );
    },

    evaluateHandle(payload: AnyRecord) {
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

    evaluateOnHandle(payload: AnyRecord) {
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        resolveHandle(payload.handleId)
      );
    },

    evaluateHandleOnHandle(payload: AnyRecord) {
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

    waitForFunctionStep(payload: AnyRecord) {
      const value = executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        undefined
      );
      if (!value) return null;
      return createHandle(value);
    },

    disposeHandle(payload: AnyRecord) {
      state.handles.delete(payload.handleId);
      return null;
    },

    jsonValue(payload: AnyRecord) {
      return resolveHandle(payload.handleId);
    },

    getProperty(payload: AnyRecord) {
      const target = resolveHandle(payload.handleId);
      return createHandle(target ? target[payload.name] : undefined);
    },

    getPropertyList(payload: AnyRecord) {
      const target = resolveHandle(payload.handleId);
      const properties: Array<{ name: string; handle: ReturnType<typeof createHandle> }> = [];
      if (!target || (typeof target !== "object" && typeof target !== "function")) {
        return properties;
      }
      for (const name in target) properties.push({ name, handle: createHandle(target[name]) });
      return properties;
    },

    querySelector(payload: AnyRecord) {
      const element = querySelector(payload.selector, payload.rootHandleId, !!payload.strict);
      return element ? createHandle(element) : null;
    },

    querySelectorAll(payload: AnyRecord) {
      return querySelectorAll(payload.selector, payload.rootHandleId).map((element) =>
        createHandle(element)
      );
    },

    queryCount(payload: AnyRecord) {
      return querySelectorAll(payload.selector, payload.rootHandleId).length;
    },

    resolveSelector(payload: AnyRecord) {
      const element = querySelector(payload.selector, payload.rootHandleId, !!payload.strict);
      if (!element) throw new Error("No element matching " + payload.selector);
      const resolvedSelector = getInjectedScript().generateSelectorSimple(element);
      if (!resolvedSelector) {
        throw new Error("Unable to generate locator for " + payload.selector);
      }
      return { resolvedSelector };
    },

    highlight(payload: AnyRecord) {
      const parsed = parseSelector(payload.selector);
      getInjectedScript().highlight(parsed);
      return null;
    },

    resetHandles() {
      state.nextHandleId = 1;
      state.handles.clear();
      return true;
    },

    setTestIdAttributeName(payload: AnyRecord) {
      if (typeof payload.testIdAttributeName !== "string" || !payload.testIdAttributeName) {
        throw new Error("testIdAttributeName must be a non-empty string");
      }
      state.testIdAttributeName = payload.testIdAttributeName;
      state.injectedScript = null;
      state.parsedSelectors.clear();
      return null;
    },

    waitForSelectorStep(payload: AnyRecord) {
      const element = querySelector(payload.selector, payload.rootHandleId, !!payload.strict);
      const stateName = payload.state || "visible";
      if (stateName === "attached") return element ? createHandle(element) : null;
      if (stateName === "detached") return !element ? { hidden: true } : null;
      if (!element) return stateName === "hidden" ? { hidden: true } : null;

      if (stateName === "visible" || stateName === "hidden") {
        const result = readElementState(element, stateName);
        if (result.received === "error:notconnected") {
          return stateName === "hidden" ? { hidden: true } : null;
        }
        if (result.matches) {
          return stateName === "hidden" ? { hidden: true } : createHandle(element);
        }
        return null;
      }

      throw new Error("Unsupported waitForSelector state: " + stateName);
    },

    evalOnSelector(payload: AnyRecord) {
      const element = querySelector(payload.selector, payload.rootHandleId, !!payload.strict);
      if (!element) {
        throw new Error(`Failed to find element matching selector "${payload.selector}"`);
      }
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        element
      );
    },

    evalOnSelectorAll(payload: AnyRecord) {
      const elements = querySelectorAll(payload.selector, payload.rootHandleId);
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        elements
      );
    },

    textContent(payload: AnyRecord) {
      const target = resolveTarget(payload);
      return target ? target.textContent : null;
    },

    innerText(payload: AnyRecord) {
      return requireTarget(payload).innerText;
    },

    innerHTML(payload: AnyRecord) {
      return requireTarget(payload).innerHTML;
    },

    getAttribute(payload: AnyRecord) {
      const target = resolveTarget(payload);
      if (!target) return null;
      return target.getAttribute(payload.name);
    },

    inputValue(payload: AnyRecord) {
      return getTextValue(requireTarget(payload));
    },

    content() {
      if (document.doctype) {
        return "<!DOCTYPE " + document.doctype.name + ">" + document.documentElement.outerHTML;
      }
      return document.documentElement.outerHTML;
    },

    title() {
      return document.title;
    },

    focus(payload: AnyRecord) {
      focusTarget(requireTarget(payload));
      return null;
    },

    blur(payload: AnyRecord) {
      const target = requireTarget(payload);
      if (typeof target.blur !== "function") throw new Error("Target is not blur-capable");
      target.blur();
      return null;
    },

    click(payload: AnyRecord) {
      const target = requireTarget(payload);
      if (typeof target.click === "function") target.click();
      else dispatchSyntheticEvent(target, "click", {});
      return null;
    },

    dblclick(payload: AnyRecord) {
      dispatchSyntheticEvent(requireTarget(payload), "dblclick", {});
      return null;
    },

    hover(payload: AnyRecord) {
      const target = requireTarget(payload);
      dispatchSyntheticEvent(target, "mouseover", {});
      dispatchSyntheticEvent(target, "mouseenter", {});
      return null;
    },

    scrollIntoViewIfNeeded(payload: AnyRecord) {
      scrollIntoViewIfNeeded(requireTarget(payload));
      return null;
    },

    dispatchEvent(payload: AnyRecord) {
      const init = deserialize(payload.eventInitValue, payload.handleIds || []);
      dispatchSyntheticEvent(requireTarget(payload), payload.type, init);
      return null;
    },

    fill(payload: AnyRecord) {
      const target = requireTarget(payload);
      focusTarget(target);
      setNativeValue(target, payload.value);
      dispatchSyntheticEvent(target, "input", {});
      dispatchSyntheticEvent(target, "change", {});
      return null;
    },

    type(payload: AnyRecord) {
      return typeIntoTarget(requireTarget(payload), payload.text);
    },

    press(payload: AnyRecord) {
      return pressTarget(requireTarget(payload), payload.key);
    },

    check(payload: AnyRecord) {
      const target = requireTarget(payload);
      if (!(target instanceof HTMLInputElement)) {
        throw new Error("Target is not a checkbox or radio button");
      }
      if (target.type === "radio" && payload.checked === false) {
        throw new Error("Cannot uncheck radio button");
      }
      if (!payload.trial && target.checked !== payload.checked) target.click();
      return target.checked;
    },

    selectOption(payload: AnyRecord) {
      const target = requireTarget(payload);
      if (!(target instanceof HTMLSelectElement)) {
        throw new Error("Target is not a select element");
      }

      let selectedOptions: HTMLOptionElement[] = [];
      if (payload.optionHandleIds && payload.optionHandleIds.length) {
        selectedOptions = payload.optionHandleIds
          .map((id: number) => resolveHandle(id))
          .filter((value: unknown): value is HTMLOptionElement => value instanceof HTMLOptionElement);
      } else {
        const specs = payload.options || [];
        if (!specs.length) {
          selectedOptions = [];
        } else {
          selectedOptions = Array.from(target.options).filter((option) =>
            specs.some((spec: any) => matchesOption(option, spec))
          );
        }
      }

      if (!target.multiple && selectedOptions.length > 1) {
        selectedOptions = selectedOptions.slice(0, 1);
      }

      for (const option of Array.from(target.options)) {
        option.selected = selectedOptions.includes(option);
      }

      dispatchSyntheticEvent(target, "input", {});
      dispatchSyntheticEvent(target, "change", {});

      return Array.from(target.selectedOptions).map((option) => option.value);
    },

    isVisible(payload: AnyRecord) {
      const target = resolveTarget(payload);
      if (!target) return false;
      const result = readElementState(target, "visible");
      return result.received !== "error:notconnected" && result.matches;
    },

    isHidden(payload: AnyRecord) {
      const target = resolveTarget(payload);
      if (!target) return true;
      const result = readElementState(target, "hidden");
      return result.received === "error:notconnected" || result.matches;
    },

    isChecked(payload: AnyRecord) {
      const target = resolveTarget(payload);
      if (!target) return false;
      const result = readElementState(target, "checked");
      return result.received !== "error:notconnected" && result.matches;
    },

    isDisabled(payload: AnyRecord) {
      const target = resolveTarget(payload);
      if (!target) return false;
      const result = readElementState(target, "disabled");
      return result.received !== "error:notconnected" && result.matches;
    },

    isEnabled(payload: AnyRecord) {
      const target = resolveTarget(payload);
      if (!target) return false;
      const result = readElementState(target, "enabled");
      return result.received !== "error:notconnected" && result.matches;
    },

    isEditable(payload: AnyRecord) {
      const target = resolveTarget(payload);
      if (!target) return false;
      const result = readElementState(target, "editable");
      return result.received !== "error:notconnected" && result.matches;
    },
  };

  window.__pwProxy = proxy;
  return true;
}

export {};
