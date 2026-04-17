/**
 * Minimal in-webview runtime for the wry Playwright backend.
 * Exposes window.__pwx with 5 eval ops backing ExecutionContext.delegate,
 * plus event ferrying (console/pageerror/lifecycle) consumed by the Node side.
 * Everything else — selectors, actionability, locators — is driven by
 * Playwright-core's own InjectedScript loaded through rawEvaluateHandle.
 */

/* eslint-disable @typescript-eslint/no-explicit-any, no-eval */

type Remote = {
  type: string;
  subtype?: string;
  objectId?: string;
  preview?: string;
  description?: string;
  value?: unknown;
  unserializableValue?: string;
};

type Event =
  | { kind: "console"; type: string; text: string }
  | { kind: "pageerror"; name: string; message: string; stack: string }
  | { kind: "lifecycle"; event: "load" | "domcontentloaded" };

declare global {
  interface Window {
    __pwx?: any;
    __pwxInstalled?: number;
  }
}

export default function installPlaywrightRuntime(version: number): true {
  if (window.__pwxInstalled === version) return true;
  window.__pwxInstalled = version;

  const handles = new Map<string, unknown>();
  let nextId = 1;

  const typeInfo = (v: unknown): { type: string; subtype?: string } => {
    if (v === null) return { type: "object", subtype: "null" };
    if (v === undefined) return { type: "undefined" };
    const t = typeof v;
    if (t !== "object" && t !== "function") return { type: t };
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
    return { type: t === "function" ? "function" : "object" };
  };

  const unserializable = (v: unknown): string | undefined => {
    if (typeof v !== "number") return;
    if (Number.isNaN(v)) return "NaN";
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "-Infinity";
    if (Object.is(v, -0)) return "-0";
  };

  const preview = (v: any, info: { type: string; subtype?: string }): string => {
    const { type, subtype } = info;
    try {
      if (type === "undefined") return "undefined";
      if (subtype === "null") return "null";
      if (type === "string") {
        const s = String(v);
        return s.length > 80 ? JSON.stringify(s.slice(0, 80)) + "…" : JSON.stringify(s);
      }
      if (type === "number" || type === "boolean" || type === "bigint") return String(v);
      if (type === "function") return `function ${v.name || ""}()`;
      if (subtype === "node") return v.nodeType === 1 && v.tagName ? `<${v.tagName.toLowerCase()}>` : `#node(${v.nodeType})`;
      if (subtype === "array") return `Array(${v.length})`;
      if (subtype === "date" || subtype === "regexp") return v.toString();
      if (subtype === "error") return `${v.name}: ${v.message}`;
      if (subtype === "map" || subtype === "set") return `${subtype === "map" ? "Map" : "Set"}(${v.size})`;
      if (subtype === "promise") return "Promise";
      if (type === "object") {
        const keys = Object.keys(v).slice(0, 5).join(", ");
        return keys ? `{${keys}}` : "Object";
      }
    } catch { /* fall through */ }
    return type;
  };

  const byValue = (value: unknown): Remote => {
    const info = typeInfo(value);
    const u = unserializable(value);
    const r: Remote = { type: info.type };
    if (info.subtype) r.subtype = info.subtype;
    if (u !== undefined) { r.unserializableValue = u; return r; }
    if (info.type === "bigint") { r.value = (value as bigint).toString(); return r; }
    try {
      const json = JSON.stringify(value);
      r.value = json === undefined ? undefined : JSON.parse(json);
    } catch (e) {
      throw new Error(`Value is not JSON-serializable: ${(e as Error).message}`);
    }
    return r;
  };

  const asHandle = (value: unknown): Remote => {
    const info = typeInfo(value);
    const u = unserializable(value);
    const p = preview(value, info);
    const r: Remote = { type: info.type, preview: p, description: p };
    if (info.subtype) r.subtype = info.subtype;
    if (u !== undefined) { r.unserializableValue = u; return r; }
    if (info.subtype === "null") { r.value = null; return r; }
    if (info.type === "string" || info.type === "number" || info.type === "boolean" || info.type === "undefined") {
      r.value = value; return r;
    }
    if (info.type === "bigint") { r.value = (value as bigint).toString(); return r; }
    const id = `pwx:${nextId++}`;
    handles.set(id, value);
    r.objectId = id;
    return r;
  };

  const resolveArg = (arg: any): unknown => {
    if (arg && typeof arg === "object" && arg.objectId) {
      if (!handles.has(arg.objectId)) throw new Error(`Unknown objectId ${arg.objectId}`);
      return handles.get(arg.objectId);
    }
    return arg?.value;
  };

  // Event ferry
  const events: Event[] = [];
  const push = (e: Event) => { events.push(e); if (events.length > 500) events.shift(); };
  const fmt = (v: unknown) => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
    try { return JSON.stringify(v); } catch { return String(v); }
  };

  for (const kind of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    const orig = (console as any)[kind] as ((...args: unknown[]) => void) | undefined;
    (console as any)[kind] = function (...args: unknown[]) {
      const text = args.map(fmt).join(" ");
      push({ kind: "console", type: kind, text });
      // Frame.setContent signals completion via console.debug(tag); emit the
      // lifecycle events a real browser would fire after doc.close().
      if (kind === "debug" && text.startsWith("--playwright--set--content--")) {
        push({ kind: "lifecycle", event: "domcontentloaded" });
        push({ kind: "lifecycle", event: "load" });
      }
      orig?.apply(console, args);
    };
  }
  window.addEventListener("error", (e) => {
    const err = e.error as Error | undefined;
    push({ kind: "pageerror", name: err?.name || "Error", message: err?.message || e.message || "", stack: err?.stack || "" });
  });
  window.addEventListener("unhandledrejection", (e: any) => {
    const r = e.reason as { name?: string; message?: string; stack?: string } | undefined;
    push({ kind: "pageerror", name: r?.name || "UnhandledRejection", message: r?.message || String(e.reason), stack: r?.stack || "" });
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => push({ kind: "lifecycle", event: "domcontentloaded" }));
  } else push({ kind: "lifecycle", event: "domcontentloaded" });
  if (document.readyState === "complete") push({ kind: "lifecycle", event: "load" });
  else window.addEventListener("load", () => push({ kind: "lifecycle", event: "load" }));

  window.__pwx = {
    rawEvaluateJSON(expr: string) { return byValue((0, eval)(expr)); },
    rawEvaluateHandle(expr: string) { return asHandle((0, eval)(expr)); },
    async callFunctionOn(p: any) {
      if (!handles.has(p.objectId)) throw new Error(`Unknown objectId ${p.objectId}`);
      const fn = (0, eval)(`(${p.functionDeclaration})`);
      if (typeof fn !== "function") throw new Error("functionDeclaration did not resolve to a function");
      let result = fn.apply(handles.get(p.objectId), p.arguments.map(resolveArg));
      if (p.awaitPromise && result instanceof Promise) result = await result;
      return p.returnByValue ? byValue(result) : asHandle(result);
    },
    getProperties(objectId: string) {
      const t = handles.get(objectId);
      if (!t || (typeof t !== "object" && typeof t !== "function")) return [];
      return Object.keys(t as any).map((name) => ({ name, handle: asHandle((t as any)[name]) }));
    },
    releaseHandle(objectId: string) { return handles.delete(objectId); },
    takeEvents() { return events.splice(0, events.length); },
  };
  return true;
}
