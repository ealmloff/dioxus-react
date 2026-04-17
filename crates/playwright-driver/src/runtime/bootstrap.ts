/**
 * Minimal in-webview runtime for the wry Playwright backend.
 *
 * Exposes window.__pwx with five eval operations that back the Playwright
 * ExecutionContext delegate (see backend/executionContext.ts), plus event
 * ferrying (console, pageerror, dialog, lifecycle) consumed by the Node side.
 *
 * Everything beyond these primitives — selectors, actionability, locator
 * matchers, waitForSelector, expect, etc. — is handled by Playwright-core
 * itself, which loads its own InjectedScript through rawEvaluateHandle.
 */

interface RemoteObject {
  type: string;
  subtype?: string;
  objectId?: string;
  preview?: string;
  description?: string;
  value?: unknown;
  unserializableValue?: string;
}

interface PropertyEntry {
  name: string;
  handle: RemoteObject;
}

interface CallFunctionArg {
  value?: unknown;
  objectId?: string;
}

interface CallFunctionPayload {
  functionDeclaration: string;
  objectId: string;
  arguments: CallFunctionArg[];
  returnByValue: boolean;
  awaitPromise?: boolean;
}

type ConsoleEvent = { kind: "console"; type: string; text: string };
type PageErrorEvent = { kind: "pageerror"; name: string; message: string; stack: string };
type LifecycleEvent = { kind: "lifecycle"; event: "load" | "domcontentloaded" };
type DialogEvent = { kind: "dialog"; id: number; type: string; message: string; defaultValue: string };
type RuntimeEvent = ConsoleEvent | PageErrorEvent | LifecycleEvent | DialogEvent;

interface PwxRuntime {
  rawEvaluateJSON(expression: string): RemoteObject;
  rawEvaluateHandle(expression: string): RemoteObject;
  callFunctionOn(payload: CallFunctionPayload): Promise<RemoteObject>;
  getProperties(objectId: string): PropertyEntry[];
  releaseHandle(objectId: string): boolean;
  takeEvents(): RuntimeEvent[];
}

declare global {
  interface Window {
    __pwx?: PwxRuntime;
    __pwxInstalled?: number;
  }
}

export default function installPlaywrightRuntime(version: number): true {
  if (window.__pwxInstalled === version) return true;
  window.__pwxInstalled = version;

  const handles = new Map<string, unknown>();
  let nextHandleId = 1;

  const typeInfo = (v: unknown): { type: string; subtype?: string } => {
    if (v === null) return { type: "object", subtype: "null" };
    if (v === undefined) return { type: "undefined" };
    const t = typeof v;
    if (t === "boolean" || t === "number" || t === "string" || t === "bigint" || t === "symbol" || t === "function") {
      return { type: t };
    }
    if (Array.isArray(v)) return { type: "object", subtype: "array" };
    if (typeof Node !== "undefined" && v instanceof Node) return { type: "object", subtype: "node" };
    if (v instanceof Error) return { type: "object", subtype: "error" };
    if (v instanceof Promise) return { type: "object", subtype: "promise" };
    if (v instanceof Date) return { type: "object", subtype: "date" };
    if (v instanceof RegExp) return { type: "object", subtype: "regexp" };
    if (v instanceof Map) return { type: "object", subtype: "map" };
    if (v instanceof Set) return { type: "object", subtype: "set" };
    if (typeof ArrayBuffer !== "undefined" && v instanceof ArrayBuffer) return { type: "object", subtype: "arraybuffer" };
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(v)) return { type: "object", subtype: "typedarray" };
    return { type: "object" };
  };

  const unserializableOf = (v: unknown): string | undefined => {
    if (typeof v === "number") {
      if (Number.isNaN(v)) return "NaN";
      if (v === Infinity) return "Infinity";
      if (v === -Infinity) return "-Infinity";
      if (Object.is(v, -0)) return "-0";
    }
    return undefined;
  };

  const previewOf = (v: unknown, info: { type: string; subtype?: string }): string => {
    const { type, subtype } = info;
    try {
      if (type === "undefined") return "undefined";
      if (subtype === "null") return "null";
      if (type === "string") {
        const s = String(v);
        return s.length > 80 ? JSON.stringify(s.slice(0, 80)) + "…" : JSON.stringify(s);
      }
      if (type === "number" || type === "boolean" || type === "bigint") return String(v);
      if (type === "function") return `function ${(v as { name?: string }).name || ""}()`;
      if (subtype === "node" && v && typeof v === "object") {
        const node = v as { nodeType?: number; tagName?: string };
        if (node.nodeType === 1 && node.tagName) return `<${node.tagName.toLowerCase()}>`;
        return `#node(${node.nodeType ?? "?"})`;
      }
      if (subtype === "array") return `Array(${(v as unknown[]).length})`;
      if (subtype === "date") return (v as Date).toString();
      if (subtype === "regexp") return (v as RegExp).toString();
      if (subtype === "error") {
        const err = v as Error;
        return `${err.name}: ${err.message}`;
      }
      if (subtype === "map") return `Map(${(v as Map<unknown, unknown>).size})`;
      if (subtype === "set") return `Set(${(v as Set<unknown>).size})`;
      if (subtype === "promise") return "Promise";
      if (type === "object" && v) {
        const keys = Object.keys(v as Record<string, unknown>).slice(0, 5).join(", ");
        return keys ? `{${keys}}` : "Object";
      }
    } catch {
      return type;
    }
    return type;
  };

  const makeRemote = (value: unknown): RemoteObject => {
    const info = typeInfo(value);
    const unserializable = unserializableOf(value);
    const preview = previewOf(value, info);
    const remote: RemoteObject = { type: info.type, preview, description: preview };
    if (info.subtype) remote.subtype = info.subtype;
    if (unserializable !== undefined) {
      remote.unserializableValue = unserializable;
      return remote;
    }
    if (info.subtype === "null") {
      remote.value = null;
      return remote;
    }
    if (info.type === "string" || info.type === "number" || info.type === "boolean" || info.type === "undefined") {
      remote.value = value;
      return remote;
    }
    if (info.type === "bigint") {
      remote.value = (value as bigint).toString();
      return remote;
    }
    const id = `pwx:${nextHandleId++}`;
    handles.set(id, value);
    remote.objectId = id;
    return remote;
  };

  const resolveArg = (arg: CallFunctionArg): unknown => {
    if (arg && typeof arg === "object" && "objectId" in arg && arg.objectId) {
      if (!handles.has(arg.objectId)) throw new Error(`Unknown objectId ${arg.objectId}`);
      return handles.get(arg.objectId);
    }
    return (arg as { value?: unknown }).value;
  };

  const jsonSafe = (value: unknown): unknown => {
    const json = JSON.stringify(value);
    if (json === undefined) return undefined;
    return JSON.parse(json);
  };

  const toByValueRemote = (value: unknown): RemoteObject => {
    const info = typeInfo(value);
    const unserializable = unserializableOf(value);
    const remote: RemoteObject = { type: info.type };
    if (info.subtype) remote.subtype = info.subtype;
    if (unserializable !== undefined) {
      remote.unserializableValue = unserializable;
      return remote;
    }
    if (info.type === "bigint") {
      remote.value = (value as bigint).toString();
      return remote;
    }
    try {
      remote.value = jsonSafe(value);
    } catch (error) {
      throw new Error(`Value is not JSON-serializable: ${(error as Error).message}`);
    }
    return remote;
  };

  // --- Event ferry ---
  const events: RuntimeEvent[] = [];
  const pushEvent = (event: RuntimeEvent): void => {
    events.push(event);
    if (events.length > 500) events.shift();
  };

  const formatArg = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const consoleTypes: Array<"log" | "info" | "warn" | "error" | "debug" | "trace"> = [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "trace",
  ];
  for (const kind of consoleTypes) {
    const original = console[kind] as ((...args: unknown[]) => void) | undefined;
    console[kind] = function (...args: unknown[]): void {
      const text = args.map(formatArg).join(" ");
      pushEvent({ kind: "console", type: kind, text });
      // Playwright's Frame.setContent relies on console.debug with this tag to
      // signal that document.write/close has committed. Emit matching lifecycle
      // events so waitForLoadState('load') resolves — a real browser would
      // naturally fire both as part of doc.close().
      if (kind === "debug" && text.startsWith("--playwright--set--content--")) {
        pushEvent({ kind: "lifecycle", event: "domcontentloaded" });
        pushEvent({ kind: "lifecycle", event: "load" });
      }
      original?.apply(console, args);
    };
  }

  window.addEventListener("error", (event: ErrorEvent) => {
    const error = event.error as Error | undefined;
    pushEvent({
      kind: "pageerror",
      name: error?.name || "Error",
      message: error?.message || event.message || "",
      stack: error?.stack || "",
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason as { name?: string; message?: string; stack?: string } | undefined;
    pushEvent({
      kind: "pageerror",
      name: reason?.name || "UnhandledRejection",
      message: reason?.message || String(event.reason),
      stack: reason?.stack || "",
    });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => pushEvent({ kind: "lifecycle", event: "domcontentloaded" }));
  } else {
    pushEvent({ kind: "lifecycle", event: "domcontentloaded" });
  }
  if (document.readyState === "complete") {
    pushEvent({ kind: "lifecycle", event: "load" });
  } else {
    window.addEventListener("load", () => pushEvent({ kind: "lifecycle", event: "load" }));
  }

  // --- Runtime surface ---
  const runtime: PwxRuntime = {
    rawEvaluateJSON(expression: string): RemoteObject {
      // eslint-disable-next-line no-eval
      const value = (0, eval)(expression);
      return toByValueRemote(value);
    },

    rawEvaluateHandle(expression: string): RemoteObject {
      // eslint-disable-next-line no-eval
      const value = (0, eval)(expression);
      return makeRemote(value);
    },

    async callFunctionOn(payload: CallFunctionPayload): Promise<RemoteObject> {
      const { functionDeclaration, objectId, arguments: args, returnByValue, awaitPromise } = payload;
      if (!handles.has(objectId)) throw new Error(`Unknown objectId ${objectId}`);
      const thisObj = handles.get(objectId);
      // eslint-disable-next-line no-eval
      const fn = (0, eval)(`(${functionDeclaration})`) as (...values: unknown[]) => unknown;
      if (typeof fn !== "function") throw new Error("functionDeclaration did not resolve to a function");
      const resolved = args.map(resolveArg);
      let result: unknown = fn.apply(thisObj, resolved);
      if (awaitPromise && result instanceof Promise) result = await result;
      return returnByValue ? toByValueRemote(result) : makeRemote(result);
    },

    getProperties(objectId: string): PropertyEntry[] {
      const target = handles.get(objectId);
      if (!target || (typeof target !== "object" && typeof target !== "function")) return [];
      const out: PropertyEntry[] = [];
      for (const name of Object.keys(target as Record<string, unknown>)) {
        out.push({ name, handle: makeRemote((target as Record<string, unknown>)[name]) });
      }
      return out;
    },

    releaseHandle(objectId: string): boolean {
      return handles.delete(objectId);
    },

    takeEvents(): RuntimeEvent[] {
      return events.splice(0, events.length);
    },
  };

  window.__pwx = runtime;
  return true;
}
