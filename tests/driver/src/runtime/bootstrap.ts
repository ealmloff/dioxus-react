type AnyRecord = Record<string, any>;

type Matcher =
  | { kind: "string"; value: string; exact: boolean }
  | { kind: "regex"; regex: RegExp };

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
  };

  const normalizeSelector = (selector: string): string => {
    if (typeof selector !== "string") throw new Error("Selector must be a string");
    if (selector.startsWith("css=")) return selector.slice(4);
    return selector;
  };

  const normalizeWhitespace = (text: unknown): string =>
    String(text ?? "")
      .replace(/[\u200b\u00ad]/g, "")
      .trim()
      .replace(/\s+/g, " ");

  const parseEscapedValue = (rawValue: string): Matcher | null => {
    if (!rawValue) return null;

    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      const quote = rawValue[0];
      let value = "";
      let escaped = false;
      let index = 1;
      for (; index < rawValue.length; index += 1) {
        const char = rawValue[index];
        if (escaped) {
          value += char;
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === quote) break;
        value += char;
      }

      if (index >= rawValue.length) return null;

      const suffix = rawValue.slice(index + 1);
      return {
        kind: "string",
        value,
        exact: suffix.includes("s"),
      };
    }

    if (rawValue.startsWith("/")) {
      const lastSlash = rawValue.lastIndexOf("/");
      if (lastSlash > 0) {
        const pattern = rawValue.slice(1, lastSlash);
        const flags = rawValue.slice(lastSlash + 1);
        try {
          return {
            kind: "regex",
            regex: new RegExp(pattern, flags),
          };
        } catch {
          return null;
        }
      }
    }

    return {
      kind: "string",
      value: rawValue,
      exact: true,
    };
  };

  const matchesEscapedValue = (
    actual: unknown,
    matcher: Matcher | null,
    normalize = false
  ): boolean => {
    if (actual === null || actual === undefined || !matcher) return false;

    const actualValue = normalize ? normalizeWhitespace(actual) : String(actual);
    if (matcher.kind === "regex") return matcher.regex.test(actualValue);

    const expected = normalize ? normalizeWhitespace(matcher.value) : matcher.value;
    if (matcher.exact) return actualValue === expected;

    return actualValue.toLowerCase().includes(expected.toLowerCase());
  };

  const parseInternalAttributeSelector = (
    selector: string,
    prefix: string
  ): { attributeName: string; matcher: Matcher } | null => {
    if (!selector.startsWith(prefix) || !selector.endsWith("]")) return null;

    const body = selector.slice(prefix.length, -1);
    const equalsIndex = body.indexOf("=");
    if (equalsIndex <= 0) return null;

    const attributeName = body.slice(0, equalsIndex);
    const rawValue = body.slice(equalsIndex + 1);
    if (!attributeName) return null;

    const matcher = parseEscapedValue(rawValue);
    if (!matcher) return null;

    return { attributeName, matcher };
  };

  const parseTextSelector = (selector: string): Matcher | null => {
    const prefix = "internal:text=";
    if (!selector.startsWith(prefix)) return null;
    return parseEscapedValue(selector.slice(prefix.length));
  };

  const parseLabelSelector = (selector: string): Matcher | null => {
    const prefix = "internal:label=";
    if (!selector.startsWith(prefix)) return null;
    return parseEscapedValue(selector.slice(prefix.length));
  };

  const parseRoleSelector = (selector: string): AnyRecord | null => {
    const prefix = "internal:role=";
    if (!selector.startsWith(prefix)) return null;

    let index = prefix.length;
    while (index < selector.length && selector[index] !== "[") index += 1;

    const role = selector.slice(prefix.length, index);
    if (!role) return null;

    const parsed: AnyRecord = { role };
    while (index < selector.length) {
      if (selector[index] !== "[") return null;
      const endIndex = selector.indexOf("]", index + 1);
      if (endIndex < 0) return null;

      const body = selector.slice(index + 1, endIndex);
      const equalsIndex = body.indexOf("=");
      if (equalsIndex <= 0) return null;

      const name = body.slice(0, equalsIndex);
      const rawValue = body.slice(equalsIndex + 1);

      if (name === "name") {
        parsed.name = parseEscapedValue(rawValue);
      } else if (
        name === "checked" ||
        name === "disabled" ||
        name === "selected" ||
        name === "expanded" ||
        name === "pressed" ||
        name === "include-hidden"
      ) {
        if (rawValue !== "true" && rawValue !== "false") return null;
        parsed[name] = rawValue === "true";
      } else if (name === "level") {
        parsed.level = Number(rawValue);
      }

      index = endIndex + 1;
    }

    return parsed;
  };

  const resolveHandle = (handleId: number): any => state.handles.get(handleId);

  const resolveRoot = (rootHandleId: number | null | undefined): any => {
    if (!rootHandleId) return document;
    return resolveHandle(rootHandleId);
  };

  const getRootElements = (rootHandleId: number | null | undefined): Element[] => {
    const root = resolveRoot(rootHandleId);
    if (!root || typeof root.querySelectorAll !== "function") return [];
    return Array.from(root.querySelectorAll("*"));
  };

  const getNodeText = (element: any): string => {
    if (!element) return "";
    if (typeof element.innerText === "string" && element.innerText) return element.innerText;
    return element.textContent || "";
  };

  const getByAttributeElements = (
    selector: string,
    rootHandleId: number | null | undefined,
    prefix: string
  ): Element[] | null => {
    const parsed = parseInternalAttributeSelector(selector, prefix);
    if (!parsed) return null;

    return getRootElements(rootHandleId).filter((element) =>
      matchesEscapedValue(element.getAttribute(parsed.attributeName), parsed.matcher)
    );
  };

  const getTextElements = (
    selector: string,
    rootHandleId: number | null | undefined
  ): Element[] | null => {
    const matcher = parseTextSelector(selector);
    if (!matcher) return null;

    const elements = getRootElements(rootHandleId);
    const directMatches = new Set(
      elements.filter((element) => matchesEscapedValue(getNodeText(element), matcher, true))
    );

    return elements.filter((element) => {
      if (!directMatches.has(element)) return false;
      return !Array.from(element.querySelectorAll("*")).some((child) => directMatches.has(child));
    });
  };

  const getControlLabels = (element: any): string[] => {
    const texts: string[] = [];

    if (typeof element.getAttribute === "function") {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) texts.push(ariaLabel);

      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        for (const id of String(labelledBy).split(/\s+/).filter(Boolean)) {
          const target = document.getElementById(id);
          if (target) texts.push(getNodeText(target));
        }
      }
    }

    const labels = element?.labels ? Array.from(element.labels as Iterable<HTMLLabelElement>) : [];
    for (const label of labels) texts.push(getNodeText(label));

    return texts;
  };

  const getLabelElements = (
    selector: string,
    rootHandleId: number | null | undefined
  ): Element[] | null => {
    const matcher = parseLabelSelector(selector);
    if (!matcher) return null;

    return getRootElements(rootHandleId).filter((element) =>
      getControlLabels(element).some((labelText) =>
        matchesEscapedValue(labelText, matcher, true)
      )
    );
  };

  const implicitRole = (element: any): string | null => {
    if (!element || typeof element.getAttribute !== "function") return null;

    const explicit = element.getAttribute("role");
    if (explicit) return explicit.trim().split(/\s+/)[0] || null;

    const tagName = element.tagName.toLowerCase();
    if (tagName === "button") return "button";
    if (tagName === "a" && element.hasAttribute("href")) return "link";
    if (tagName === "textarea") return "textbox";
    if (tagName === "select") return element.multiple || element.size > 1 ? "listbox" : "combobox";
    if (tagName === "option") return "option";
    if (tagName === "img") return "img";
    if (tagName === "ul" || tagName === "ol") return "list";
    if (tagName === "li") return "listitem";
    if (/^h[1-6]$/.test(tagName)) return "heading";
    if (tagName !== "input") return null;

    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    return "textbox";
  };

  const accessibleName = (element: any, role: string): string => {
    const ariaLabel = element.getAttribute?.("aria-label");
    if (ariaLabel) return ariaLabel;

    const labelledBy = element.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const labels = String(labelledBy)
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((label) => getNodeText(label));
      if (labels.length > 0) return labels.join(" ");
    }

    const labels = getControlLabels(element);
    if (labels.length > 0) return labels.join(" ");

    if (role === "button") {
      if (element.tagName.toLowerCase() === "input") return element.value || "";
      return getNodeText(element);
    }

    if (role === "img") return element.getAttribute("alt") || element.getAttribute("title") || "";

    return getNodeText(element);
  };

  const roleState = (element: any, name: string): boolean | undefined => {
    if (name === "disabled")
      return Boolean(element.disabled || element.getAttribute("aria-disabled") === "true");
    if (name === "checked") {
      if ("checked" in element) return Boolean(element.checked);
      const ariaChecked = element.getAttribute("aria-checked");
      return ariaChecked === "true";
    }
    if (name === "selected") {
      if ("selected" in element) return Boolean(element.selected);
      return element.getAttribute("aria-selected") === "true";
    }
    if (name === "expanded") return element.getAttribute("aria-expanded") === "true";
    if (name === "pressed") return element.getAttribute("aria-pressed") === "true";
    return undefined;
  };

  const roleLevel = (element: any): number | undefined => {
    const tagName = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tagName)) return Number(tagName[1]);
    const ariaLevel = element.getAttribute("aria-level");
    return ariaLevel ? Number(ariaLevel) : undefined;
  };

  const isVisible = (target: any): boolean => {
    if (!target) return false;
    if (target.hidden) return false;
    const style = window.getComputedStyle(target);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
      return false;
    return true;
  };

  const getRoleElements = (
    selector: string,
    rootHandleId: number | null | undefined
  ): Element[] | null => {
    const parsed = parseRoleSelector(selector);
    if (!parsed) return null;

    return getRootElements(rootHandleId).filter((element) => {
      const role = implicitRole(element);
      if (role !== parsed.role) return false;

      if (parsed["include-hidden"] !== true && !isVisible(element)) return false;

      if (
        parsed.name &&
        !matchesEscapedValue(accessibleName(element, parsed.role), parsed.name, true)
      )
        return false;

      for (const key of ["checked", "disabled", "selected", "expanded", "pressed"]) {
        if (parsed[key] === undefined) continue;
        if (roleState(element, key) !== parsed[key]) return false;
      }

      if (parsed.level !== undefined && roleLevel(element) !== parsed.level) return false;

      return true;
    });
  };

  const getSpecialSelectorElements = (
    selector: string,
    rootHandleId: number | null | undefined
  ): Element[] | null => {
    if (selector.startsWith("internal:testid="))
      return getByAttributeElements(selector, rootHandleId, "internal:testid=[");
    if (selector.startsWith("internal:attr="))
      return getByAttributeElements(selector, rootHandleId, "internal:attr=[");
    if (selector.startsWith("internal:text=")) return getTextElements(selector, rootHandleId);
    if (selector.startsWith("internal:label=")) return getLabelElements(selector, rootHandleId);
    if (selector.startsWith("internal:role=")) return getRoleElements(selector, rootHandleId);
    return null;
  };

  const preview = (value: any): string => {
    if (value instanceof Element) {
      const id = value.id ? "#" + value.id : "";
      return "<" + value.tagName.toLowerCase() + id + ">";
    }
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
      return String(value);
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

  const getElement = (
    selector: string,
    rootHandleId: number | null | undefined
  ): Element | null => {
    const specialElements = getSpecialSelectorElements(selector, rootHandleId);
    if (specialElements !== null) return specialElements[0] ?? null;
    if (selector.startsWith("internal:"))
      throw new Error("Unsupported internal selector: " + selector);
    const root = resolveRoot(rootHandleId);
    if (!root || typeof root.querySelector !== "function") return null;
    return root.querySelector(normalizeSelector(selector));
  };

  const getElements = (
    selector: string,
    rootHandleId: number | null | undefined
  ): Element[] => {
    const specialElements = getSpecialSelectorElements(selector, rootHandleId);
    if (specialElements !== null) return specialElements;
    if (selector.startsWith("internal:"))
      throw new Error("Unsupported internal selector: " + selector);
    const root = resolveRoot(rootHandleId);
    if (!root || typeof root.querySelectorAll !== "function") return [];
    return Array.from(root.querySelectorAll(normalizeSelector(selector)));
  };

  const getTarget = (payload: AnyRecord): any => {
    if (payload.handleId) return resolveHandle(payload.handleId);
    if (payload.selector) return getElement(payload.selector, payload.rootHandleId);
    return null;
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

  const getTextValue = (target: any): string => {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
      return target.value;
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
    )
      return MouseEvent;
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

  const keyboardCodePoint = (key: string, type: string): number => {
    if (key === "Enter") return 13;
    if (key === "Backspace") return 8;
    if (key === "Tab") return 9;
    if (key === "Escape") return 27;
    if (key === " ") return 32;
    if (typeof key === "string" && key.length === 1) return key.charCodeAt(0);
    return type === "keypress" ? 0 : 0;
  };

  const enrichKeyboardInit = (type: string, init: any): AnyRecord => {
    const key = init && typeof init.key === "string" ? init.key : "";
    const codePoint = keyboardCodePoint(key, type);
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
    if (spec.valueOrLabel !== undefined)
      return option.value === spec.valueOrLabel || option.label === spec.valueOrLabel;
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
      if (!target || (typeof target !== "object" && typeof target !== "function"))
        return properties;
      for (const name in target)
        properties.push({ name, handle: createHandle(target[name]) });
      return properties;
    },

    querySelector(payload: AnyRecord) {
      const element = getElement(payload.selector, payload.rootHandleId);
      return element ? createHandle(element) : null;
    },

    querySelectorAll(payload: AnyRecord) {
      return getElements(payload.selector, payload.rootHandleId).map((element) =>
        createHandle(element)
      );
    },

    queryCount(payload: AnyRecord) {
      return getElements(payload.selector, payload.rootHandleId).length;
    },

    resetHandles() {
      state.nextHandleId = 1;
      state.handles.clear();
      return true;
    },

    waitForSelectorStep(payload: AnyRecord) {
      const element = getElement(payload.selector, payload.rootHandleId);
      const stateName = payload.state || "visible";
      if (stateName === "attached") return element ? createHandle(element) : null;
      if (stateName === "visible") return element && isVisible(element) ? createHandle(element) : null;
      if (stateName === "hidden") return !element || !isVisible(element) ? { hidden: true } : null;
      if (stateName === "detached") return !element ? { hidden: true } : null;
      throw new Error("Unsupported waitForSelector state: " + stateName);
    },

    evalOnSelector(payload: AnyRecord) {
      const element = getElement(payload.selector, payload.rootHandleId);
      if (!element) throw new Error("No element matches selector: " + payload.selector);
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        element
      );
    },

    evalOnSelectorAll(payload: AnyRecord) {
      const elements = getElements(payload.selector, payload.rootHandleId);
      return executeExpression(
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payload.handleIds || [],
        elements
      );
    },

    textContent(payload: AnyRecord) {
      const target = getTarget(payload);
      return target ? target.textContent : null;
    },

    innerText(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
      return target.innerText;
    },

    innerHTML(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
      return target.innerHTML;
    },

    getAttribute(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) return null;
      return target.getAttribute(payload.name);
    },

    inputValue(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
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

    focus(payload: AnyRecord) {
      focusTarget(getTarget(payload));
      return null;
    },

    blur(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target || typeof target.blur !== "function")
        throw new Error("Target is not blur-capable");
      target.blur();
      return null;
    },

    click(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
      if (typeof target.click === "function") target.click();
      else dispatchSyntheticEvent(target, "click", {});
      return null;
    },

    dblclick(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
      dispatchSyntheticEvent(target, "dblclick", {});
      return null;
    },

    hover(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
      dispatchSyntheticEvent(target, "mouseover", {});
      dispatchSyntheticEvent(target, "mouseenter", {});
      return null;
    },

    dispatchEvent(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
      const init = deserialize(payload.eventInitValue, payload.handleIds || []);
      dispatchSyntheticEvent(target, payload.type, init);
      return null;
    },

    fill(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
      focusTarget(target);
      setNativeValue(target, payload.value);
      dispatchSyntheticEvent(target, "input", {});
      dispatchSyntheticEvent(target, "change", {});
      return null;
    },

    type(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
      return typeIntoTarget(target, payload.text);
    },

    press(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) throw new Error("Target not found");
      return pressTarget(target, payload.key);
    },

    check(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!(target instanceof HTMLInputElement))
        throw new Error("Target is not a checkbox or radio button");
      if (target.type === "radio" && payload.checked === false)
        throw new Error("Cannot uncheck radio button");
      if (!payload.trial && target.checked !== payload.checked) target.click();
      return target.checked;
    },

    selectOption(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!(target instanceof HTMLSelectElement))
        throw new Error("Target is not a select element");

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

      if (!target.multiple && selectedOptions.length > 1)
        selectedOptions = selectedOptions.slice(0, 1);

      for (const option of Array.from(target.options))
        option.selected = selectedOptions.includes(option);

      dispatchSyntheticEvent(target, "input", {});
      dispatchSyntheticEvent(target, "change", {});

      return Array.from(target.selectedOptions).map((option) => option.value);
    },

    isVisible(payload: AnyRecord) {
      return isVisible(getTarget(payload));
    },

    isHidden(payload: AnyRecord) {
      return !isVisible(getTarget(payload));
    },

    isChecked(payload: AnyRecord) {
      const target = getTarget(payload);
      if (target instanceof HTMLInputElement) return !!target.checked;
      const aria = target ? target.getAttribute("aria-checked") : null;
      return aria === "true";
    },

    isDisabled(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) return false;
      return !!target.disabled || target.getAttribute("aria-disabled") === "true";
    },

    isEnabled(payload: AnyRecord) {
      return !proxy.isDisabled(payload);
    },

    isEditable(payload: AnyRecord) {
      const target = getTarget(payload);
      if (!target) return false;
      if (target.isContentEditable) return true;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
        return !target.readOnly && !target.disabled;
      return false;
    },
  };

  window.__pwProxy = proxy;
  return true;
}

export {};
