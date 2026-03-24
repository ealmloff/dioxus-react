import playwrightInjectedSource from "virtual:driver-playwright-injected-source";

type AnyRecord = Record<string, unknown>
type MessagePayload = Record<string, unknown>;
type EventConstructorLike =
  | typeof Event
  | typeof KeyboardEvent
  | typeof MouseEvent
  | typeof WheelEvent
  | typeof CustomEvent;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asObject = (value: unknown): AnyRecord =>
  value !== null && typeof value === "object" ? (value as AnyRecord) : {};

const asUnknownArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asNumberArray = (value: unknown): number[] => {
  const values = asUnknownArray(value);
  const result: number[] = [];
  for (const item of values) {
    const numeric = asNumber(item);
    if (numeric !== undefined) {
      result.push(numeric);
    }
  }
  return result;
};
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
  querySelector(selector: unknown, root: unknown, strict: boolean): Element | undefined;
  querySelectorAll(selector: unknown, root: unknown): Element[];
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

  interface FrameRecord {
    id: number;
    windowRef: Window;
    parentId: number | null;
  }

  interface HandleRecord {
    value: unknown;
    frameId: number;
  }

  const state = {
    version,

    deserializeValue(serializedValue: AnyRecord, handleIds: number[] = []) {
      return deserialize(serializedValue, handleIds);
    },
    nextHandleId: 1,
    nextFrameId: 1,
    handles: new Map<number, HandleRecord>(),
    frames: new Map<number, FrameRecord>(),
    windows: new WeakMap<Window, number>(),
    parsedSelectors: new Map<string, unknown>(),
    testIdAttributeName: "data-testid",
    injectedScripts: new Map<number, InjectedScriptLike>(),
    injectedScriptCtor: null as InjectedScriptCtor | null,
  };

  const frameIdForWindow = (targetWindow: Window): number => {
    const cached = state.windows.get(targetWindow);
    if (cached) {
      return cached;
    }

    const id = state.nextFrameId++;
    let parentId: number | null = null;
    try {
      const frameElement = targetWindow.frameElement;
      if (frameElement instanceof HTMLIFrameElement || frameElement instanceof HTMLFrameElement) {
        const ownerWindow = frameElement.ownerDocument?.defaultView;
        if (ownerWindow) {
          parentId = frameIdForWindow(ownerWindow);
        }
      }
    } catch {
      parentId = null;
    }

    state.windows.set(targetWindow, id);
    state.frames.set(id, { id, windowRef: targetWindow, parentId });
    return id;
  };

  const rootFrameId = frameIdForWindow(window);

  const resolveFrame = (frameId: number | null | undefined): FrameRecord => {
    const record = state.frames.get(frameId ?? rootFrameId);
    if (!record) {
      throw new Error(`Frame not found: ${String(frameId)}`);
    }
    return record;
  };

  const resolveFrameWindow = (frameId: number | null | undefined): Window => {
    return resolveFrame(frameId).windowRef;
  };

  const resolveFrameDocument = (frameId: number | null | undefined): Document => {
    return resolveFrameWindow(frameId).document;
  };

  const inferFrameId = (value: unknown, fallbackFrameId = rootFrameId): number => {
    if (value instanceof Window) {
      return frameIdForWindow(value);
    }
    if (value instanceof Node) {
      const ownerWindow = value.ownerDocument?.defaultView;
      return ownerWindow ? frameIdForWindow(ownerWindow) : fallbackFrameId;
    }
    return fallbackFrameId;
  };

  const resolveHandleRecord = (handleId: number): HandleRecord | undefined => state.handles.get(handleId);
  const resolveHandle = (handleId: number): unknown => resolveHandleRecord(handleId)?.value;

  const resolveRoot = (rootHandleId: number | null | undefined): Node => {
    if (!rootHandleId) return resolveFrameDocument(rootFrameId);
    const root = resolveHandle(rootHandleId);
    if (!root || !(root instanceof Node)) throw new Error("Root handle not found");
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

  const getInjectedScript = (frameId = rootFrameId): InjectedScriptLike => {
    const cached = state.injectedScripts.get(frameId);
    if (cached) return cached;

    const InjectedScript = loadInjectedScriptCtor();
    const targetWindow = resolveFrameWindow(frameId);
    const targetWindowAny = targetWindow as unknown as AnyRecord;
    const previousMutationObserver = targetWindowAny.MutationObserver;
    if (typeof previousMutationObserver !== "function") {
      targetWindowAny.MutationObserver = class {
        observe() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as typeof MutationObserver;
    }
    try {
      const injectedScript = new InjectedScript(targetWindow as Window & typeof globalThis, {
        isUnderTest: false,
        sdkLanguage: "javascript",
        testIdAttributeName: state.testIdAttributeName,
        stableRafCount: 1,
        browserName: "webkit",
        isUtilityWorld: false,
        customEngines: [],
      });
      state.injectedScripts.set(frameId, injectedScript);
    } finally {
      if (typeof previousMutationObserver === "function") {
        targetWindowAny.MutationObserver = previousMutationObserver;
      } else {
        delete targetWindowAny.MutationObserver;
      }
    }
    return state.injectedScripts.get(frameId)!;
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

    const parsed = getInjectedScript(rootFrameId).parseSelector(value);
    state.parsedSelectors.set(value, parsed);
    return parsed;
  };

  const querySelector = (
    selector: unknown,
    frameId: number | null | undefined,
    rootHandleId: number | null | undefined,
    strict = false
  ): Element | null => {
    const root = rootHandleId ? resolveRoot(rootHandleId) : resolveFrameDocument(frameId);
    const parsed = parseSelector(selector);
    return getInjectedScript(frameId ?? rootFrameId).querySelector(parsed, root, strict) ?? null;
  };

  const querySelectorAll = (
    selector: unknown,
    frameId: number | null | undefined,
    rootHandleId: number | null | undefined
  ): Element[] => {
    const root = rootHandleId ? resolveRoot(rootHandleId) : resolveFrameDocument(frameId);
    const parsed = parseSelector(selector);
    return getInjectedScript(frameId ?? rootFrameId).querySelectorAll(parsed, root);
  };

  const resolveTarget = (payload: MessagePayload): unknown => {
    if (typeof payloadNumber(payload, "handleId") === "number") return resolveHandle(payloadNumber(payload, "handleId"));
    if (Object.prototype.hasOwnProperty.call(payload, "selector")) {
      return querySelector(
        payload.selector,
        asNumber(payload.frameId) ?? rootFrameId,
        asNumber(payloadNumber(payload, "rootHandleId")),
        payloadBoolean(payload, "strict")
      );
    }
    return null;
  };

  const requireTarget = (payload: MessagePayload): unknown => {
    const target = resolveTarget(payload);
    if (!target) throw new Error("Target not found");
    return target;
  };

  const readElementState = (
    target: unknown,
    stateName: ElementStateName
  ): { matches: boolean; received?: string | "error:notconnected"; isRadio?: boolean } => {
    if (!(target instanceof Node)) {
      return { matches: false, received: "error:notconnected" };
    }
    return getInjectedScript(inferFrameId(target)).elementState(target, stateName);
  };

  const preview = (value: unknown): string => {
      if (value instanceof Element) {
      return getInjectedScript(inferFrameId(value)).previewNode?.(value) ?? `<${value.tagName.toLowerCase()}>`;
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

  const createHandle = (value: unknown, frameId = inferFrameId(value)) => {
    const id = state.nextHandleId++;
    state.handles.set(id, { value, frameId });
    return {
      id,
      type: value instanceof Element ? "element" : "js",
      preview: preview(value),
      frameId,
    };
  };

  const deserialize = (
    value: unknown,
    handleIds: number[],
    refs: Map<number, unknown> = new Map()
  ): unknown => {
    if (value === null || typeof value !== "object") return value;
    const serialized = asObject(value);
    if (typeof serialized.ref === "number") return refs.get(serialized.ref);
    if (typeof serialized.h === "number") return resolveHandle(handleIds[serialized.h]);
    if (Object.prototype.hasOwnProperty.call(serialized, "n")) return serialized.n;
    if (Object.prototype.hasOwnProperty.call(serialized, "b")) return serialized.b;
    if (Object.prototype.hasOwnProperty.call(serialized, "s")) return serialized.s;
    if (typeof serialized.v === "string") {
      switch (serialized.v) {
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
    if (typeof serialized.d === "string" || typeof serialized.d === "number") {
      return new Date(serialized.d);
    }
    if (typeof serialized.u === "string") {
      return new URL(serialized.u);
    }
    if (typeof serialized.bi === "string" || typeof serialized.bi === "number") {
      return BigInt(String(serialized.bi));
    }
    if (serialized.e && typeof serialized.e === "object") {
      const error = serialized.e as AnyRecord;
      const message = asString(error.m) ?? "";
      const exception = new Error(message);
      const name = asString(error.n);
      const stack = asString(error.s);
      if (name) {
        exception.name = name;
      }
      if (stack) {
        exception.stack = stack;
      }
      return exception;
    }
    if (serialized.r && typeof serialized.r === "object") {
      const regexp = serialized.r as AnyRecord;
      const pattern = asString(regexp.p) ?? "";
      const flags = asString(regexp.f) ?? "";
      return new RegExp(pattern, flags);
    }
    if (serialized.ta && typeof serialized.ta === "object") {
      const ta = serialized.ta as AnyRecord;
      const bytesValue = ta.b as { data?: unknown } | null | undefined;
      if (!bytesValue) {
        return new Uint8Array();
      }
      const byteValues = asUnknownArray(bytesValue.data ?? bytesValue).map((value) =>
        typeof value === "number" ? value : 0
      );
      const bytes = Uint8Array.from(byteValues as number[]);
      const kind = asString(ta.k);
      if (kind) {
        switch (kind) {
          case "i8":
            return new Int8Array(bytes.buffer);
          case "ui8":
            return new Uint8Array(bytes.buffer);
          case "ui8c":
            return new Uint8ClampedArray(bytes.buffer);
          case "i16":
            return new Int16Array(bytes.buffer);
          case "ui16":
            return new Uint16Array(bytes.buffer);
          case "i32":
            return new Int32Array(bytes.buffer);
          case "ui32":
            return new Uint32Array(bytes.buffer);
          case "f32":
            return new Float32Array(bytes.buffer);
          case "f64":
            return new Float64Array(bytes.buffer);
          case "bi64":
            return new BigInt64Array(bytes.buffer);
          case "bui64":
            return new BigUint64Array(bytes.buffer);
          default:
            return bytes;
        }
      }
      return bytes;
    }
    if (Array.isArray(serialized.a)) {
      const out: unknown[] = [];
      refs.set(asNumber(serialized.id) ?? -1, out);
      for (const entry of serialized.a) {
        out.push(deserialize(entry, handleIds, refs));
      }
      return out;
    }
    if (Array.isArray(serialized.o)) {
      const out: Record<string, unknown> = {};
      refs.set(asNumber(serialized.id) ?? -1, out);
      for (const entry of serialized.o) {
        const item = entry as { k?: string; v?: unknown };
        if (typeof item.k === "string") {
          out[item.k] = deserialize(item.v, handleIds, refs);
        }
      }
      return out;
    }
    return value;
  };

  const focusTarget = (target: unknown): void => {
    const targetObject = asObject(target);
    if (!target || typeof targetObject.focus !== "function") {
      throw new Error("Target is not focusable");
    }
    targetObject.focus();
  };

  const setNativeValue = (target: unknown, value: string): void => {
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
    const targetObject = asObject(target);
    if (targetObject.isContentEditable) {
      targetObject.textContent = value;
      return;
    }
    throw new Error("Target does not support textual value");
  };

  const scrollIntoViewIfNeeded = (target: unknown): void => {
    if (!(target instanceof Element)) throw new Error("Target is not an element");
    const targetAsAny = target as { scrollIntoViewIfNeeded?: () => void };
    if (typeof targetAsAny.scrollIntoViewIfNeeded === "function") {
      targetAsAny.scrollIntoViewIfNeeded();
      return;
    }
    target.scrollIntoView();
  };

  const getTextValue = (target: unknown): string => {
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return target.value;
    }
    const targetObject = asObject(target);
    if (targetObject.isContentEditable) return (targetObject.textContent as string) || "";
    return "";
  };

  const eventConstructor = (type: string, init: unknown): EventConstructorLike => {
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

  const enrichKeyboardInit = (type: string, init: unknown): AnyRecord => {
    const key = asString((init as AnyRecord).key) ?? "";
    const codePoint = keyboardCodePoint(key);
    return Object.assign(
      {
        key,
        code: keyboardCodeForKey(key),
        keyCode: codePoint,
        charCode: type === "keypress" ? codePoint : 0,
        which: codePoint,
      },
      asObject(init) || {}
    );
  };

  const dispatchSyntheticEvent = (target: unknown, type: string, init: unknown): void => {
    const EventCtor = eventConstructor(type, init);
    const defaults = {
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const targetRecord = asObject(target) as { dispatchEvent?: (event: Event) => void };
    const eventInit =
      EventCtor === KeyboardEvent
        ? Object.assign(defaults, enrichKeyboardInit(type, init))
        : Object.assign(defaults, asObject(init));
    const event = new EventCtor(type, eventInit as EventInit);
    if (typeof targetRecord.dispatchEvent === "function") {
      targetRecord.dispatchEvent(event);
    }
  };

  const typeIntoTarget = (target: unknown, text: string): string => {
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

  const pressTarget = (target: unknown, key: string): string => {
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

  const selectOptionsOnTarget = (target: unknown, payload: AnyRecord): string[] => {
    if (!(target instanceof HTMLSelectElement)) {
      throw new Error("Target is not a select element");
    }

    let selectedOptions: HTMLOptionElement[] = [];
    const optionElements = asUnknownArray(payload.optionElements).filter(
      (value: unknown): value is HTMLOptionElement => value instanceof HTMLOptionElement
    );
    if (optionElements.length) {
      selectedOptions = optionElements;
    } else {
      const specs = asUnknownArray(payload.options);
      if (!specs.length) {
        selectedOptions = [];
      } else {
        selectedOptions = Array.from(target.options).filter((option) =>
          specs.some((spec: unknown) => matchesOption(option, spec))
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
  };

  const runElementAction = (target: unknown, action: string, payload: AnyRecord): unknown => {
    switch (action) {
      case "fill":
        focusTarget(target);
        setNativeValue(target, asString(payload.value) ?? "");
        dispatchSyntheticEvent(target, "input", {});
        dispatchSyntheticEvent(target, "change", {});
        return null;
      case "type":
        return typeIntoTarget(target, asString(payload.text) ?? "");
      case "press":
        return pressTarget(target, asString(payload.key) ?? "");
      case "selectOption":
        return selectOptionsOnTarget(target, payload);
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  };

  const matchesOption = (option: unknown, spec: unknown): boolean => {
    if (!spec) return false;
    const optionRecord = asObject(option) as {
      value?: string;
      label?: string;
      parentElement?: { options?: unknown };
    };
    const specRecord = asObject(spec);
    if (specRecord.valueOrLabel !== undefined) {
      return optionRecord.value === specRecord.valueOrLabel || optionRecord.label === specRecord.valueOrLabel;
    }
    if (specRecord.value !== undefined && optionRecord.value !== specRecord.value) return false;
    if (specRecord.label !== undefined && optionRecord.label !== specRecord.label) return false;
    if (specRecord.index !== undefined) {
      const options = asUnknownArray(optionRecord.parentElement?.options);
      const expectedIndex = asNumber(specRecord.index);
      if (expectedIndex !== undefined && options.indexOf(option) !== expectedIndex) return false;
    }
    return true;
  };

  const executeExpression = (
    frameId: unknown,
    expression: unknown,
    isFunction: unknown,
    argValue: unknown,
    handleIds: unknown,
    firstArg: unknown
  ): unknown => {
    const targetWindow = resolveFrameWindow(asNumber(frameId) ?? rootFrameId);
    const arg = deserialize(argValue, asNumberArray(handleIds));
    const windowRecord = asObject(targetWindow);
    const evalInTarget = windowRecord.eval as ((code: string) => unknown) | undefined;
    if (!evalInTarget) {
      throw new Error("Window eval function is not available");
    }
    const expressionCode = asString(expression) ?? "";
    const shouldCall = isFunction === true;

    if (!shouldCall) {
      return evalInTarget(expressionCode);
    }
    const fn = evalInTarget(expressionCode) as
      | ((arg: unknown) => unknown)
      | ((firstArg: unknown, arg: unknown) => unknown);
    if (typeof fn !== "function") return undefined;
    if (firstArg === undefined) return (fn as (arg: unknown) => unknown)(arg);
    return (fn as (firstArg: unknown, arg: unknown) => unknown)(firstArg, arg);
  };

  const frameMeta = (frameId: number) => {
    const record = resolveFrame(frameId);
    let url = "about:blank";
    let name = "";
    try {
      url = record.windowRef.location.href;
      name = record.windowRef.name || "";
    } catch (error) {
      if (process.env.DEBUG) {
        void error;
      }
    }
    return {
      id: frameId,
      url,
      name,
      parentFrameId: record.parentId,
    };
  };

  const payloadNumber = (payload: MessagePayload, key: string): number | undefined =>
    typeof payload[key] === "number" ? (payload[key] as number) : undefined;
  const payloadString = (payload: MessagePayload, key: string): string | undefined =>
    typeof payload[key] === "string" ? (payload[key] as string) : undefined;
const payloadBoolean = (payload: MessagePayload, key: string): boolean =>
  typeof payload[key] === "boolean" && (payload[key] as boolean);
const payloadArray = (payload: MessagePayload, key: string): unknown[] =>
  asUnknownArray(payload[key]);

  const proxy: AnyRecord = {
    version,
    deserializeValue: state.deserializeValue,
    runElementAction,

    evaluate(payload: MessagePayload) {
      return executeExpression(
        payloadNumber(payload, "frameId") ?? rootFrameId,
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payloadArray(payload, "handleIds") || [],
        undefined
      );
    },

    evaluateHandle(payload: MessagePayload) {
      return createHandle(
        executeExpression(
          payloadNumber(payload, "frameId") ?? rootFrameId,
          payload.expression,
          payload.isFunction,
          payload.argValue,
          payloadArray(payload, "handleIds") || [],
          undefined
        ),
        payloadNumber(payload, "frameId") ?? rootFrameId
      );
    },

    evaluateOnHandle(payload: MessagePayload) {
      const handleRecord = resolveHandleRecord(payloadNumber(payload, "handleId"));
      return executeExpression(
        handleRecord?.frameId ?? payloadNumber(payload, "frameId") ?? rootFrameId,
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payloadArray(payload, "handleIds") || [],
        handleRecord?.value
      );
    },

    evaluateHandleOnHandle(payload: MessagePayload) {
      const handleRecord = resolveHandleRecord(payloadNumber(payload, "handleId"));
      return createHandle(
        executeExpression(
          handleRecord?.frameId ?? payloadNumber(payload, "frameId") ?? rootFrameId,
          payload.expression,
          payload.isFunction,
          payload.argValue,
          payloadArray(payload, "handleIds") || [],
          handleRecord?.value
        ),
        handleRecord?.frameId ?? payloadNumber(payload, "frameId") ?? rootFrameId
      );
    },

    waitForFunctionStep(payload: MessagePayload) {
      const value = executeExpression(
        payloadNumber(payload, "frameId") ?? rootFrameId,
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payloadArray(payload, "handleIds") || [],
        undefined
      );
      if (!value) return null;
      return createHandle(value);
    },

    disposeHandle(payload: MessagePayload) {
      state.handles.delete(payloadNumber(payload, "handleId"));
      return null;
    },

    jsonValue(payload: MessagePayload) {
      return resolveHandle(payloadNumber(payload, "handleId"));
    },

    getProperty(payload: MessagePayload) {
      const target = resolveHandle(payloadNumber(payload, "handleId"));
      const targetRecord = target as { [key: string]: unknown };
      const name = payloadString(payload, "name");
      return createHandle(target && name ? targetRecord[name] : undefined);
    },

    getPropertyList(payload: MessagePayload) {
      const target = resolveHandle(payloadNumber(payload, "handleId"));
      const properties: Array<{ name: string; handle: ReturnType<typeof createHandle> }> = [];
      if (!target || (typeof target !== "object" && typeof target !== "function")) {
        return properties;
      }
      for (const name in target) properties.push({ name, handle: createHandle(target[name]) });
      return properties;
    },

    querySelector(payload: MessagePayload) {
      const element = querySelector(
        payload.selector,
        payloadNumber(payload, "frameId") ?? rootFrameId,
        payloadNumber(payload, "rootHandleId"),
        payloadBoolean(payload, "strict")
      );
      return element ? createHandle(element, inferFrameId(element, payloadNumber(payload, "frameId") ?? rootFrameId)) : null;
    },

    querySelectorAll(payload: MessagePayload) {
      return querySelectorAll(payload.selector, payloadNumber(payload, "frameId") ?? rootFrameId, payloadNumber(payload, "rootHandleId")).map((element) =>
        createHandle(element, inferFrameId(element, payloadNumber(payload, "frameId") ?? rootFrameId))
      );
    },

    queryCount(payload: MessagePayload) {
      return querySelectorAll(payload.selector, payloadNumber(payload, "frameId") ?? rootFrameId, payloadNumber(payload, "rootHandleId")).length;
    },

    resolveSelector(payload: MessagePayload) {
      const frameId = payloadNumber(payload, "frameId") ?? rootFrameId;
      const element = querySelector(
        payload.selector,
        frameId,
        payloadNumber(payload, "rootHandleId"),
        payloadBoolean(payload, "strict")
      );
      if (!element) throw new Error("No element matching " + payload.selector);
      const resolvedSelector = getInjectedScript(frameId).generateSelectorSimple(element);
      if (!resolvedSelector) {
        throw new Error("Unable to generate locator for " + payload.selector);
      }
      return { resolvedSelector };
    },

    highlight(payload: MessagePayload) {
      const parsed = parseSelector(payload.selector);
      getInjectedScript(payloadNumber(payload, "frameId") ?? rootFrameId).highlight(parsed);
      return null;
    },

    resetHandles() {
      state.nextHandleId = 1;
      state.handles.clear();
      return true;
    },

    frameInfo(payload: MessagePayload) {
      return frameMeta(payloadNumber(payload, "frameId") ?? rootFrameId);
    },

    injectedScriptHandle(payload: MessagePayload) {
      const frameId = payloadNumber(payload, "frameId") ?? rootFrameId;
      return createHandle(getInjectedScript(frameId), frameId);
    },

    getContentFrame(payload: MessagePayload) {
      const target = resolveHandle(payloadNumber(payload, "handleId"));
      if (!(target instanceof HTMLIFrameElement || target instanceof HTMLFrameElement)) {
        return null;
      }
      const contentWindow = target.contentWindow;
      if (!contentWindow) {
        return null;
      }
      return frameMeta(frameIdForWindow(contentWindow));
    },

    getOwnerFrame(payload: MessagePayload) {
      const handle = resolveHandleRecord(payloadNumber(payload, "handleId"));
      if (!handle) {
        return null;
      }
      return frameMeta(handle.frameId);
    },

    getInjectedScriptHandle(payload: MessagePayload) {
      const frameId = payloadNumber(payload, "frameId") ?? rootFrameId;
      return createHandle(getInjectedScript(frameId), frameId);
    },

    cloneHandle(payload: MessagePayload) {
      const handle = resolveHandleRecord(payloadNumber(payload, "handleId"));
      if (!handle) {
        throw new Error(`Handle not found: ${String(payloadNumber(payload, "handleId"))}`);
      }
      return createHandle(handle.value, handle.frameId);
    },

    generateSelector(payload: MessagePayload) {
      const handle = resolveHandleRecord(payloadNumber(payload, "handleId"));
      if (!handle || !(handle.value instanceof Element)) {
        throw new Error("Target is not an element");
      }
      const selector = getInjectedScript(handle.frameId).generateSelectorSimple(handle.value);
      if (!selector) {
        throw new Error("Unable to generate selector");
      }
      return selector;
    },

    setTestIdAttributeName(payload: MessagePayload) {
      if (typeof payload.testIdAttributeName !== "string" || !payload.testIdAttributeName) {
        throw new Error("testIdAttributeName must be a non-empty string");
      }
      state.testIdAttributeName = payload.testIdAttributeName;
      state.injectedScripts.clear();
      state.parsedSelectors.clear();
      return null;
    },

    waitForSelectorStep(payload: MessagePayload) {
      const element = querySelector(
        payload.selector,
        payloadNumber(payload, "frameId") ?? rootFrameId,
        payloadNumber(payload, "rootHandleId"),
        payloadBoolean(payload, "strict")
      );
      const stateName = payloadString(payload, "state") ?? "visible";
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

    evalOnSelector(payload: MessagePayload) {
      const frameId = payloadNumber(payload, "frameId") ?? rootFrameId;
      const element = querySelector(payload.selector, frameId, payloadNumber(payload, "rootHandleId"), payloadBoolean(payload, "strict"));
      if (!element) {
        throw new Error(`Failed to find element matching selector "${payload.selector}"`);
      }
      return executeExpression(
        inferFrameId(element, frameId),
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payloadArray(payload, "handleIds") || [],
        element
      );
    },

    evalOnSelectorAll(payload: MessagePayload) {
      const frameId = payloadNumber(payload, "frameId") ?? rootFrameId;
      const elements = querySelectorAll(payload.selector, frameId, payloadNumber(payload, "rootHandleId"));
      return executeExpression(
        frameId,
        payload.expression,
        payload.isFunction,
        payload.argValue,
        payloadArray(payload, "handleIds") || [],
        elements
      );
    },

    textContent(payload: MessagePayload) {
      const target = resolveTarget(payload);
      if (!target) return null;
      return (target as { textContent: string | null }).textContent;
    },

    innerText(payload: MessagePayload) {
      return (requireTarget(payload) as { innerText: string }).innerText;
    },

    innerHTML(payload: MessagePayload) {
      return (requireTarget(payload) as { innerHTML: string }).innerHTML;
    },

    getAttribute(payload: MessagePayload) {
      const target = resolveTarget(payload);
      if (!target) return null;
      const name = payloadString(payload, "name");
      return name ? (target as { getAttribute(name: string): string | null }).getAttribute(name) : null;
    },

    inputValue(payload: MessagePayload) {
      return getTextValue(requireTarget(payload));
    },

    content() {
      const doc = resolveFrameDocument(rootFrameId);
      if (doc.doctype) {
        return "<!DOCTYPE " + doc.doctype.name + ">" + doc.documentElement.outerHTML;
      }
      return doc.documentElement.outerHTML;
    },

    frameContent(payload: MessagePayload) {
      const doc = resolveFrameDocument(payloadNumber(payload, "frameId") ?? rootFrameId);
      if (doc.doctype) {
        return "<!DOCTYPE " + doc.doctype.name + ">" + doc.documentElement.outerHTML;
      }
      return doc.documentElement.outerHTML;
    },

    title(payload: MessagePayload = {}) {
      return resolveFrameDocument(payloadNumber(payload, "frameId") ?? rootFrameId).title;
    },

    focus(payload: MessagePayload) {
      focusTarget(requireTarget(payload));
      return null;
    },

    blur(payload: MessagePayload) {
      const target = requireTarget(payload) as { blur?: () => void };
      if (typeof target.blur !== "function") throw new Error("Target is not blur-capable");
      target.blur();
      return null;
    },

    click(payload: MessagePayload) {
      const target = requireTarget(payload) as { click?: () => void };
      if (typeof target.click === "function") target.click();
      else dispatchSyntheticEvent(target, "click", {});
      return null;
    },

    dblclick(payload: MessagePayload) {
      const target = requireTarget(payload);
      dispatchSyntheticEvent(target, "dblclick", {});
      return null;
    },

    hover(payload: MessagePayload) {
      const target = requireTarget(payload) as { dispatchEvent?: (event: Event) => void };
      dispatchSyntheticEvent(target, "mouseover", {});
      dispatchSyntheticEvent(target, "mouseenter", {});
      return null;
    },

    scrollIntoViewIfNeeded(payload: MessagePayload) {
      scrollIntoViewIfNeeded(requireTarget(payload));
      return null;
    },

    dispatchEvent(payload: MessagePayload) {
      const init = deserialize(payload.eventInitValue, asNumberArray(payload.handleIds));
      dispatchSyntheticEvent(requireTarget(payload), payloadString(payload, "type") ?? "", init);
      return null;
    },

    fill(payload: MessagePayload) {
      return runElementAction(requireTarget(payload), "fill", payload);
    },

    type(payload: MessagePayload) {
      return runElementAction(requireTarget(payload), "type", payload);
    },

    press(payload: MessagePayload) {
      return runElementAction(requireTarget(payload), "press", payload);
    },

    check(payload: MessagePayload) {
      const target = requireTarget(payload);
      if (!(target instanceof HTMLInputElement)) {
        throw new Error("Target is not a checkbox or radio button");
      }
      const checked = payloadBoolean(payload, "checked");
      if (target.type === "radio" && checked === false) {
        throw new Error("Cannot uncheck radio button");
      }
      if (!payloadBoolean(payload, "trial") && target.checked !== checked) target.click();
      return target.checked;
    },

    selectOption(payload: MessagePayload) {
      return runElementAction(requireTarget(payload), "selectOption", {
        options: payloadArray(payload, "options"),
        optionElements: asNumberArray(payload.optionHandleIds).map((id) => resolveHandle(id)),
      });
    },

    isVisible(payload: MessagePayload) {
      const target = resolveTarget(payload);
      if (!target) return false;
      const result = readElementState(target, "visible");
      return result.received !== "error:notconnected" && result.matches;
    },

    isHidden(payload: MessagePayload) {
      const target = resolveTarget(payload);
      if (!target) return true;
      const result = readElementState(target, "hidden");
      return result.received === "error:notconnected" || result.matches;
    },

    isChecked(payload: MessagePayload) {
      const target = resolveTarget(payload);
      if (!target) return false;
      const result = readElementState(target, "checked");
      return result.received !== "error:notconnected" && result.matches;
    },

    isDisabled(payload: MessagePayload) {
      const target = resolveTarget(payload);
      if (!target) return false;
      const result = readElementState(target, "disabled");
      return result.received !== "error:notconnected" && result.matches;
    },

    isEnabled(payload: MessagePayload) {
      const target = resolveTarget(payload);
      if (!target) return false;
      const result = readElementState(target, "enabled");
      return result.received !== "error:notconnected" && result.matches;
    },

    isEditable(payload: MessagePayload) {
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
