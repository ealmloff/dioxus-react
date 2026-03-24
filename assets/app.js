"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // react-global:react
  var require_react = __commonJS({
    "react-global:react"(exports, module) {
      module.exports = React;
    }
  });

  // react-global:react-dom/client
  var require_client = __commonJS({
    "react-global:react-dom/client"(exports, module) {
      module.exports = ReactDOM;
    }
  });

  // assets/src/App.tsx
  var import_react = __toESM(require_react());
  var import_client = __toESM(require_client());
  function createNativeBridge() {
    const bridge = window.NativeBridge;
    if (!bridge) throw new Error("Native bridge is not available");
    const withFactory = bridge;
    if (typeof withFactory.new === "function") {
      return withFactory.new();
    }
    return new bridge();
  }
  function callNative(fn, ...args) {
    const bridge = createNativeBridge();
    const result = bridge[fn](...args);
    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch (_) {
        return result;
      }
    }
    return result;
  }
  var LOCATOR_FRAME_SRC_DOC = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }
      .frame-shell {
        padding: 10px;
      }
      .frame-status {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .frame-button {
        border: 0;
        border-radius: 8px;
        padding: 8px 12px;
        background: #2563eb;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
      }
      .frame-count {
        margin: 8px 0 0;
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="frame-shell">
      <p id="frame-status" class="frame-status">loading</p>
      <button id="frame-action" class="frame-button" disabled>Frame action</button>
      <p id="frame-title">Nested Frame</p>
      <p id="frame-count" class="frame-count">0</p>
    </div>
    <script>
      const status = document.getElementById("frame-status");
      const action = document.getElementById("frame-action");
      const count = document.getElementById("frame-count");
      const notifyParent = () => {
        parent.postMessage(
          { kind: "locator-frame-state", status: status.textContent, count: count.textContent },
          "*"
        );
      };
      window.setTimeout(() => {
        status.textContent = "ready";
        action.disabled = false;
        notifyParent();
      }, 120);
      action.addEventListener("click", () => {
        count.textContent = String(Number(count.textContent || "0") + 1);
        notifyParent();
      });
      notifyParent();
    <\/script>
  </body>
</html>`;
  function Tabs({ items, active, onSelect }) {
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "tabs" }, items.map((item) => /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        key: item,
        className: "tab" + (active === item ? " tab-active" : ""),
        onClick: () => onSelect(item)
      },
      item
    )));
  }
  function SystemInfo() {
    const [info, setInfo] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
      setInfo(callNative("getSystemInfo"));
    }, []);
    if (!info) return /* @__PURE__ */ import_react.default.createElement("p", null, "Loading...");
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "card" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "System Information"), /* @__PURE__ */ import_react.default.createElement("table", { className: "info-table" }, /* @__PURE__ */ import_react.default.createElement("tbody", null, Object.keys(info).map((key) => /* @__PURE__ */ import_react.default.createElement("tr", { key }, /* @__PURE__ */ import_react.default.createElement("td", { className: "info-label" }, key), /* @__PURE__ */ import_react.default.createElement("td", { className: "info-value" }, String(info[key])))))));
  }
  function FibonacciCalc() {
    const [n, setN] = (0, import_react.useState)(10);
    const [result, setResult] = (0, import_react.useState)(null);
    const [elapsed, setElapsed] = (0, import_react.useState)(null);
    const calculate = (0, import_react.useCallback)(() => {
      const start = performance.now();
      const val = createNativeBridge().fibonacci(n);
      const ms = (performance.now() - start).toFixed(3);
      setResult(val);
      setElapsed(ms);
    }, [n]);
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "card" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "Native Fibonacci"), /* @__PURE__ */ import_react.default.createElement("p", { className: "subtitle" }, "Computed in native Rust \u2014 not in JS."), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement("label", null, "n =", " ", /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        type: "number",
        min: 0,
        max: 93,
        value: n,
        onChange: (e) => setN(Number(e.target.value))
      }
    )), /* @__PURE__ */ import_react.default.createElement("button", { className: "btn", onClick: calculate }, "Calculate")), result !== null && /* @__PURE__ */ import_react.default.createElement("div", { className: "result" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "result-label" }, "Result: "), /* @__PURE__ */ import_react.default.createElement("span", { className: "result-value" }, String(result)), /* @__PURE__ */ import_react.default.createElement("span", { className: "result-time" }, " (", elapsed, " ms)")));
  }
  function FileExplorer() {
    const [currentPath, setCurrentPath] = (0, import_react.useState)(".");
    const [entries, setEntries] = (0, import_react.useState)([]);
    const [error, setError] = (0, import_react.useState)(null);
    const [fileContent, setFileContent] = (0, import_react.useState)(null);
    const [viewingFile, setViewingFile] = (0, import_react.useState)(null);
    const inputRef = (0, import_react.useRef)(null);
    const loadDir = (0, import_react.useCallback)((path) => {
      const res = callNative("readDir", path);
      if (res.error) {
        setError(res.error);
        setEntries([]);
      } else {
        setError(null);
        setEntries(res.entries || []);
        setCurrentPath(path);
      }
      setFileContent(null);
      setViewingFile(null);
    }, []);
    (0, import_react.useEffect)(() => {
      const cwd = callNative("getSystemInfo").cwd || ".";
      setCurrentPath(cwd);
      loadDir(cwd);
    }, [loadDir]);
    const openEntry = (0, import_react.useCallback)(
      (entry) => {
        var _a;
        const sep = currentPath.indexOf("\\") !== -1 ? "\\" : "/";
        const child = currentPath + sep + entry.name;
        if (entry.isDir) {
          loadDir(child);
        } else {
          const res = callNative("readFile", child);
          if (res.error) {
            setFileContent("Error: " + res.error);
          } else {
            setFileContent((_a = res.content) != null ? _a : null);
          }
          setViewingFile(entry.name);
        }
      },
      [currentPath, loadDir]
    );
    const goUp = (0, import_react.useCallback)(() => {
      const sep = currentPath.indexOf("\\") !== -1 ? "\\" : "/";
      const parts = currentPath.split(sep);
      if (parts.length > 1) {
        parts.pop();
        const parent = parts.join(sep) || sep;
        loadDir(parent);
      }
    }, [currentPath, loadDir]);
    function formatSize(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / 1048576).toFixed(1) + " MB";
    }
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "card" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "File Explorer"), /* @__PURE__ */ import_react.default.createElement("p", { className: "subtitle" }, "Browse your native filesystem from React."), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "btn btn-sm", onClick: goUp }, "\u2191", " Up"), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        ref: inputRef,
        className: "path-input",
        value: currentPath,
        onChange: (e) => setCurrentPath(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter")
            loadDir(e.target.value);
        }
      }
    ), /* @__PURE__ */ import_react.default.createElement("button", { className: "btn btn-sm", onClick: () => loadDir(currentPath) }, "Go")), error && /* @__PURE__ */ import_react.default.createElement("p", { className: "error" }, error), /* @__PURE__ */ import_react.default.createElement("div", { className: "file-list" }, entries.map((entry) => /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        key: entry.name,
        className: "file-entry" + (entry.isDir ? " file-dir" : ""),
        onClick: () => openEntry(entry)
      },
      /* @__PURE__ */ import_react.default.createElement("span", { className: "file-icon" }, entry.isDir ? "\u{1F4C1}" : "\u{1F4C4}"),
      /* @__PURE__ */ import_react.default.createElement("span", { className: "file-name" }, entry.name),
      !entry.isDir && /* @__PURE__ */ import_react.default.createElement("span", { className: "file-size" }, formatSize(entry.size))
    ))), viewingFile && /* @__PURE__ */ import_react.default.createElement("div", { className: "file-preview" }, /* @__PURE__ */ import_react.default.createElement("h3", null, viewingFile), /* @__PURE__ */ import_react.default.createElement("pre", null, fileContent)));
  }
  function Counter() {
    const [count, setCount] = (0, import_react.useState)(0);
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "card" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "Counter"), /* @__PURE__ */ import_react.default.createElement("p", { className: "subtitle" }, "Pure React state \u2014 no native calls."), /* @__PURE__ */ import_react.default.createElement("div", { className: "counter-row" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "btn", onClick: () => setCount(count - 1) }, "\u2212"), /* @__PURE__ */ import_react.default.createElement("span", { className: "counter-value" }, count), /* @__PURE__ */ import_react.default.createElement("button", { className: "btn", onClick: () => setCount(count + 1) }, "+")));
  }
  function AutomationLab() {
    const [text, setText] = (0, import_react.useState)("");
    const [checked, setChecked] = (0, import_react.useState)(false);
    const [selected, setSelected] = (0, import_react.useState)("blue");
    const [selectedMany, setSelectedMany] = (0, import_react.useState)(["beta"]);
    const [hovered, setHovered] = (0, import_react.useState)(false);
    const [doubleClicks, setDoubleClicks] = (0, import_react.useState)(0);
    const [keyLog, setKeyLog] = (0, import_react.useState)([]);
    const [submitted, setSubmitted] = (0, import_react.useState)(0);
    const [blurState, setBlurState] = (0, import_react.useState)("blurred");
    const [asyncVisible, setAsyncVisible] = (0, import_react.useState)(false);
    const [customMessage, setCustomMessage] = (0, import_react.useState)("idle");
    const [editableText, setEditableText] = (0, import_react.useState)("Editable content");
    const dispatchTargetRef = (0, import_react.useRef)(null);
    (0, import_react.useEffect)(() => {
      const target = dispatchTargetRef.current;
      if (!target) return;
      const listener = (event) => {
        var _a;
        const custom = event;
        setCustomMessage(((_a = custom.detail) == null ? void 0 : _a.message) || event.type);
      };
      target.addEventListener("lab:update", listener);
      return () => target.removeEventListener("lab:update", listener);
    }, []);
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "card automation-card", id: "automation-lab" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "Automation Lab"), /* @__PURE__ */ import_react.default.createElement("p", { className: "subtitle" }, "Controls and event targets used to validate the embedded Playwright proxy."), /* @__PURE__ */ import_react.default.createElement("div", { className: "lab-grid" }, /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "lab-form-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Form Controls"), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "lab-label", htmlFor: "lab-text" }, "Text Input"), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "lab-text",
        className: "lab-input",
        "data-kind": "text",
        value: text,
        onChange: (e) => setText(e.target.value),
        onKeyDown: (e) => {
          setKeyLog((log) => [...log.slice(-7), e.key]);
          if (e.key === "Enter") setSubmitted((count) => count + 1);
        }
      }
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "lab-label", htmlFor: "lab-checkbox" }, "Checkbox"), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "lab-checkbox",
        type: "checkbox",
        checked,
        onChange: (e) => setChecked(e.target.checked)
      }
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "lab-label", htmlFor: "lab-select" }, "Single Select"), /* @__PURE__ */ import_react.default.createElement(
      "select",
      {
        id: "lab-select",
        className: "lab-input",
        value: selected,
        onChange: (e) => setSelected(e.target.value)
      },
      /* @__PURE__ */ import_react.default.createElement("option", { value: "blue" }, "Blue"),
      /* @__PURE__ */ import_react.default.createElement("option", { value: "green" }, "Green"),
      /* @__PURE__ */ import_react.default.createElement("option", { value: "orange" }, "Orange")
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "lab-label", htmlFor: "lab-multi-select" }, "Multi Select"), /* @__PURE__ */ import_react.default.createElement(
      "select",
      {
        id: "lab-multi-select",
        className: "lab-input",
        multiple: true,
        value: selectedMany,
        onChange: (e) => setSelectedMany(
          Array.from(e.target.selectedOptions).map((option) => option.value)
        )
      },
      /* @__PURE__ */ import_react.default.createElement("option", { value: "alpha" }, "Alpha"),
      /* @__PURE__ */ import_react.default.createElement("option", { value: "beta" }, "Beta"),
      /* @__PURE__ */ import_react.default.createElement("option", { value: "gamma" }, "Gamma")
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "lab-output-list" }, /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-text-output", className: "lab-output" }, text || "empty"), /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-keylog", className: "lab-output" }, keyLog.join(",") || "empty"), /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-submit-count", className: "lab-output" }, String(submitted)), /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-checkbox-output", className: "lab-output" }, checked ? "checked" : "unchecked"), /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-select-output", className: "lab-output" }, selected), /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-multi-select-output", className: "lab-output" }, selectedMany.join(",") || "none"))), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "lab-state-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "State and Visibility"), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "lab-reveal",
        className: "btn btn-sm",
        onClick: () => {
          setAsyncVisible(false);
          window.setTimeout(() => setAsyncVisible(true), 120);
        }
      },
      "Reveal Async Note"
    ), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "lab-readonly",
        className: "lab-input",
        readOnly: true,
        value: "read-only value"
      }
    ), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "lab-disabled",
        className: "lab-input",
        disabled: true,
        value: "disabled value",
        onChange: () => {
        }
      }
    )), /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        id: "lab-editable",
        className: "lab-editable",
        contentEditable: true,
        suppressContentEditableWarning: true,
        onInput: (e) => setEditableText(
          (e.currentTarget.textContent || "").trim() || "Editable content"
        )
      },
      editableText
    ), /* @__PURE__ */ import_react.default.createElement(
      "p",
      {
        id: "lab-async-note",
        className: "lab-note" + (asyncVisible ? "" : " lab-note-hidden"),
        hidden: !asyncVisible
      },
      "Ready for waitForSelector"
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-editable-output", className: "lab-output" }, editableText)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "lab-content-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Content and Focus"), /* @__PURE__ */ import_react.default.createElement("div", { id: "lab-rich-content", className: "lab-rich-content" }, /* @__PURE__ */ import_react.default.createElement("span", null, "Hello"), " ", /* @__PURE__ */ import_react.default.createElement("strong", null, "World"), " ", /* @__PURE__ */ import_react.default.createElement("span", { hidden: true }, "Invisible")), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "lab-label", htmlFor: "lab-blur-input" }, "Blur Target"), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "lab-blur-input",
        className: "lab-input",
        value: "focus me",
        onChange: () => {
        },
        onFocus: () => setBlurState("focused"),
        onBlur: () => setBlurState("blurred")
      }
    )), /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-blur-output", className: "lab-output" }, blurState)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "lab-events-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Events"), /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        id: "lab-hover-target",
        className: "lab-event-box" + (hovered ? " lab-event-active" : ""),
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false)
      },
      "Hover target"
    ), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "lab-double-target",
        className: "btn btn-sm",
        onDoubleClick: () => setDoubleClicks((count) => count + 1)
      },
      "Double-click target"
    ), /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        id: "lab-dispatch-target",
        ref: dispatchTargetRef,
        className: "lab-event-box",
        "data-status": customMessage
      },
      "Dispatch target"
    ), /* @__PURE__ */ import_react.default.createElement("div", { className: "lab-output-list" }, /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-hover-output", className: "lab-output" }, hovered ? "hovered" : "idle"), /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-double-count", className: "lab-output" }, String(doubleClicks)), /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-dispatch-output", className: "lab-output" }, customMessage))), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "lab-handle-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Handle Scope"), /* @__PURE__ */ import_react.default.createElement("div", { id: "lab-scope", "data-scope": "root" }, /* @__PURE__ */ import_react.default.createElement("p", { id: "lab-scope-label", "data-role": "scope-label" }, "Scoped query root"), /* @__PURE__ */ import_react.default.createElement("ul", { id: "lab-list", className: "lab-list" }, /* @__PURE__ */ import_react.default.createElement("li", { className: "lab-list-item", "data-item": "one" }, "One"), /* @__PURE__ */ import_react.default.createElement("li", { className: "lab-list-item", "data-item": "two" }, "Two"), /* @__PURE__ */ import_react.default.createElement("li", { className: "lab-list-item", "data-item": "three" }, "Three"))))));
  }
  function LocatorLab() {
    const [saved, setSaved] = (0, import_react.useState)(false);
    const [selectorState, setSelectorState] = (0, import_react.useState)("idle");
    const [frameStatus, setFrameStatus] = (0, import_react.useState)("loading");
    const [frameClickCount, setFrameClickCount] = (0, import_react.useState)(0);
    const [delayedActionable, setDelayedActionable] = (0, import_react.useState)(false);
    const [delayedClicked, setDelayedClicked] = (0, import_react.useState)(false);
    (0, import_react.useEffect)(() => {
      const onMessage = (event) => {
        const data = event.data;
        if (!data || data.kind !== "locator-frame-state") {
          return;
        }
        if (typeof data.status === "string") {
          setFrameStatus(data.status);
        }
        if (typeof data.count === "string") {
          setFrameClickCount(Number(data.count));
        }
      };
      const timer = window.setTimeout(() => setDelayedActionable(true), 500);
      window.addEventListener("message", onMessage);
      return () => {
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timer);
      };
    }, []);
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "card automation-card", id: "locator-lab" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "Locator Lab"), /* @__PURE__ */ import_react.default.createElement("p", { className: "subtitle" }, "Deterministic fixtures for semantic locator coverage."), /* @__PURE__ */ import_react.default.createElement("div", { className: "lab-grid locator-grid" }, /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "locator-label-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Labels and Placeholders"), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "lab-label", id: "locator-name-label", htmlFor: "locator-name" }, "Full name"), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "locator-name",
        className: "lab-input",
        placeholder: "Ada Lovelace",
        defaultValue: "Ada Lovelace",
        readOnly: true
      }
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "row" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "lab-label", id: "locator-search-label", htmlFor: "locator-search" }, "Search sample"), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "locator-search",
        className: "lab-input",
        placeholder: "Search the catalog",
        "aria-label": "Search sample",
        defaultValue: "",
        readOnly: true
      }
    ))), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "locator-text-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Text and Title"), /* @__PURE__ */ import_react.default.createElement("p", { id: "locator-text-target", className: "lab-output" }, "Locator text target"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "locator-save",
        className: "btn btn-sm",
        title: "Save locator sample",
        onClick: () => setSaved(true)
      },
      "Save sample"
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "locator-save-output", className: "lab-output" }, saved ? "saved" : "idle"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "locator-icon",
        className: "btn btn-sm",
        title: "icon button",
        "aria-label": "icon button"
      },
      "Icon"
    )), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "locator-role-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Roles"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "locator-role-button",
        className: "btn",
        "aria-label": "role button sample"
      },
      "Role Button"
    ), /* @__PURE__ */ import_react.default.createElement("div", { id: "locator-status", role: "status", "aria-label": "save status" }, saved ? "Saved status" : "Idle status"), /* @__PURE__ */ import_react.default.createElement("a", { id: "locator-link", href: "#locator-lab", title: "jump to locator lab" }, "Locator link")), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "locator-selector-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Selector Combinators"), /* @__PURE__ */ import_react.default.createElement("p", { className: "subtitle" }, "Visible and hidden fixtures for locator filters and combinators."), /* @__PURE__ */ import_react.default.createElement("div", { className: "selector-note-row" }, /* @__PURE__ */ import_react.default.createElement("p", { className: "selector-note", "data-kind": "visible-note" }, "Visible selector note"), /* @__PURE__ */ import_react.default.createElement("p", { className: "selector-note selector-note-hidden", hidden: true, "data-kind": "hidden-note" }, "Hidden selector note")), /* @__PURE__ */ import_react.default.createElement("div", { className: "selector-card-list" }, /* @__PURE__ */ import_react.default.createElement("article", { className: "selector-card", "data-card": "alpha" }, /* @__PURE__ */ import_react.default.createElement("h4", null, "Alpha card"), /* @__PURE__ */ import_react.default.createElement("p", null, "Shared details"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        className: "btn btn-sm",
        title: "open alpha card",
        onClick: () => setSelectorState("alpha")
      },
      "Open Alpha"
    )), /* @__PURE__ */ import_react.default.createElement("article", { className: "selector-card", "data-card": "beta" }, /* @__PURE__ */ import_react.default.createElement("h4", null, "Beta card"), /* @__PURE__ */ import_react.default.createElement("p", null, "Shared details"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        className: "btn btn-sm",
        title: "open beta card",
        onClick: () => setSelectorState("beta")
      },
      "Open Beta"
    )), /* @__PURE__ */ import_react.default.createElement("article", { className: "selector-card", "data-card": "gamma" }, /* @__PURE__ */ import_react.default.createElement("h4", null, "Gamma card"), /* @__PURE__ */ import_react.default.createElement("p", null, "Unique details"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        className: "btn btn-sm",
        title: "open gamma card",
        onClick: () => setSelectorState("gamma")
      },
      "Open Gamma"
    ))), /* @__PURE__ */ import_react.default.createElement("p", { id: "selector-status", className: "lab-output" }, selectorState)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "locator-frame-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Iframe and Delayed Actionability"), /* @__PURE__ */ import_react.default.createElement("p", { className: "subtitle" }, "Nested same-origin content plus a delayed action target for proxy tests."), /* @__PURE__ */ import_react.default.createElement("div", { className: "frame-shell" }, /* @__PURE__ */ import_react.default.createElement(
      "iframe",
      {
        id: "locator-frame",
        title: "Nested action frame",
        srcDoc: LOCATOR_FRAME_SRC_DOC
      }
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "lab-output-list" }, /* @__PURE__ */ import_react.default.createElement("p", { id: "locator-frame-status", className: "lab-output" }, frameStatus), /* @__PURE__ */ import_react.default.createElement("p", { id: "locator-frame-output", className: "lab-output" }, String(frameClickCount))), /* @__PURE__ */ import_react.default.createElement("div", { className: "locator-delayed-row" }, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "locator-delayed-action",
        className: "btn btn-sm",
        hidden: !delayedActionable,
        disabled: !delayedActionable,
        onClick: () => setDelayedClicked(true)
      },
      "Delayed action"
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "locator-delayed-output", className: "lab-output" }, delayedClicked ? "clicked" : delayedActionable ? "ready" : "waiting")))));
  }
  function PlaywrightSurfaceLab() {
    const [hashValue, setHashValue] = (0, import_react.useState)(() => window.location.hash || "(none)");
    const [networkProbe, setNetworkProbe] = (0, import_react.useState)("idle");
    const [viewportValue, setViewportValue] = (0, import_react.useState)(() => `${window.innerWidth}x${window.innerHeight}`);
    const [dialogOutput, setDialogOutput] = (0, import_react.useState)("idle");
    const [keyboardOutput, setKeyboardOutput] = (0, import_react.useState)("none");
    const [selectedFile, setSelectedFile] = (0, import_react.useState)("none");
    const [geolocationOutput, setGeolocationOutput] = (0, import_react.useState)("not-run");
    const [locatorOutput, setLocatorOutput] = (0, import_react.useState)("none");
    const [consoleOutput, setConsoleOutput] = (0, import_react.useState)("idle");
    const [pageErrorOutput, setPageErrorOutput] = (0, import_react.useState)("idle");
    const [dragOutput, setDragOutput] = (0, import_react.useState)("idle");
    (0, import_react.useEffect)(() => {
      const onHashChange = () => setHashValue(window.location.hash || "(none)");
      const onResize = () => setViewportValue(`${window.innerWidth}x${window.innerHeight}`);
      onHashChange();
      onResize();
      window.addEventListener("hashchange", onHashChange);
      window.addEventListener("resize", onResize);
      return () => {
        window.removeEventListener("hashchange", onHashChange);
        window.removeEventListener("resize", onResize);
      };
    }, []);
    const runNetworkProbe = async () => {
      setNetworkProbe("running");
      try {
        const response = await fetch("data:text/plain,surface-network-probe");
        const text = await response.text();
        setNetworkProbe(text || "empty");
      } catch (error) {
        setNetworkProbe(error instanceof Error ? `error:${error.message}` : "error");
      }
    };
    const runGeolocationProbe = () => {
      if (!navigator.geolocation) {
        setGeolocationOutput("unsupported");
        return;
      }
      setGeolocationOutput("requesting");
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGeolocationOutput(
            `${position.coords.latitude.toFixed(4)},${position.coords.longitude.toFixed(4)}`
          );
        },
        () => {
          setGeolocationOutput("denied");
        }
      );
    };
    const runDialogProbe = () => {
      setDialogOutput("requested");
      const response = window.confirm("Surface dialog probe");
      setDialogOutput(response ? "confirmed" : "dismissed");
    };
    const runConsoleProbe = () => {
      console.log("surface-console-probe");
      setConsoleOutput("surface-console-probe");
    };
    const runPageErrorProbe = () => {
      setPageErrorOutput("scheduled");
      queueMicrotask(() => {
        Promise.reject(new Error("surface-page-error"));
      });
    };
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "card automation-card", id: "surface-lab" }, /* @__PURE__ */ import_react.default.createElement("h2", null, "Playwright Surface Lab"), /* @__PURE__ */ import_react.default.createElement("p", { className: "subtitle" }, "Fixture surfaces for proxy parity expansion."), /* @__PURE__ */ import_react.default.createElement("div", { className: "lab-grid" }, /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-nav-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Navigation"), /* @__PURE__ */ import_react.default.createElement("a", { id: "surface-nav-link", href: "#surface-anchor" }, "Go to hash anchor"), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-nav-output", className: "lab-output" }, hashValue), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-anchor", className: "lab-output" }, "surface anchor")), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-network-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Network Probe"), /* @__PURE__ */ import_react.default.createElement("button", { id: "surface-network-probe", className: "btn btn-sm", onClick: runNetworkProbe }, "Run fetch probe"), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-network-output", className: "lab-output" }, networkProbe)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-viewport-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Viewport Surface"), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-viewport-output", className: "lab-output" }, viewportValue)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-keyboard-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Keyboard Surface"), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "surface-keyboard-input",
        className: "lab-input",
        placeholder: "Type here",
        onKeyDown: (event) => {
          const next = keyboardOutput === "none" ? event.key : `${keyboardOutput},${event.key}`;
          setKeyboardOutput(next.split(",").slice(-8).join(","));
        }
      }
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-keyboard-output", className: "lab-output" }, keyboardOutput)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-chooser-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Chooser Surface"), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "surface-file-input",
        type: "file",
        onChange: (event) => {
          var _a, _b;
          const file = (_a = event.target.files) == null ? void 0 : _a[0];
          setSelectedFile((_b = file == null ? void 0 : file.name) != null ? _b : "none");
        }
      }
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-file-output", className: "lab-output" }, selectedFile)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-geolocation-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Geolocation Surface"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "surface-geolocation-query",
        className: "btn btn-sm",
        onClick: runGeolocationProbe
      },
      "Query geolocation"
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-geolocation-output", className: "lab-output" }, geolocationOutput)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-dialog-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Dialog Surface"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "surface-dialog-button",
        className: "btn btn-sm",
        onClick: runDialogProbe
      },
      "Open dialog"
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-dialog-output", className: "lab-output" }, dialogOutput)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-console-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Console Surface"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "surface-console-button",
        className: "btn btn-sm",
        onClick: runConsoleProbe
      },
      "Emit console log"
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-console-output", className: "lab-output" }, consoleOutput)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-error-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Page Error Surface"), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "surface-pageerror-button",
        className: "btn btn-sm",
        onClick: runPageErrorProbe
      },
      "Throw async error"
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-pageerror-output", className: "lab-output" }, pageErrorOutput)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-locator-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Locator Surface"), /* @__PURE__ */ import_react.default.createElement("div", { id: "surface-locator-list", role: "list" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "surface-locator-item", role: "listitem" }, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "surface-locator-alpha",
        className: "btn btn-sm",
        onClick: () => setLocatorOutput("alpha")
      },
      "Open Surface Alpha"
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "surface-locator-item", role: "listitem" }, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "surface-locator-beta",
        className: "btn btn-sm",
        onClick: () => setLocatorOutput("beta")
      },
      "Open Surface Beta"
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "surface-locator-item", role: "listitem" }, /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        id: "surface-locator-gamma",
        className: "btn btn-sm",
        onClick: () => setLocatorOutput("gamma")
      },
      "Open Surface Gamma"
    ))), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-locator-output", className: "lab-output" }, locatorOutput)), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-shot-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Screenshot Surface"), /* @__PURE__ */ import_react.default.createElement("div", { id: "surface-screenshot-target", className: "surface-shot-target" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "surface-shot-block surface-shot-block-red" }), /* @__PURE__ */ import_react.default.createElement("div", { className: "surface-shot-block surface-shot-block-green" }), /* @__PURE__ */ import_react.default.createElement("div", { className: "surface-shot-block surface-shot-block-blue" }))), /* @__PURE__ */ import_react.default.createElement("section", { className: "lab-panel", id: "surface-drag-panel" }, /* @__PURE__ */ import_react.default.createElement("h3", null, "Drag Surface"), /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        id: "surface-drag-source",
        className: "surface-drag-source",
        draggable: true,
        onDragStart: (event) => {
          event.dataTransfer.setData("text/plain", "surface-drag");
        }
      },
      "Drag me"
    ), /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        id: "surface-drop-target",
        className: "surface-drag-target",
        onDragOver: (event) => event.preventDefault(),
        onDrop: (event) => {
          event.preventDefault();
          setDragOutput(event.dataTransfer.getData("text/plain") || "dropped");
        }
      },
      "Drop target"
    ), /* @__PURE__ */ import_react.default.createElement("p", { id: "surface-drag-output", className: "lab-output" }, dragOutput))));
  }
  var TAB_NAMES = [
    "System Info",
    "Fibonacci",
    "File Explorer",
    "Counter",
    "Playwright Surface Lab",
    "Locator Lab",
    "Automation Lab"
  ];
  function App() {
    const [tab, setTab] = (0, import_react.useState)("Counter");
    (0, import_react.useEffect)(() => {
      document.title = "dioxus-react";
    }, []);
    let content;
    switch (tab) {
      case "System Info":
        content = /* @__PURE__ */ import_react.default.createElement(SystemInfo, null);
        break;
      case "Fibonacci":
        content = /* @__PURE__ */ import_react.default.createElement(FibonacciCalc, null);
        break;
      case "File Explorer":
        content = /* @__PURE__ */ import_react.default.createElement(FileExplorer, null);
        break;
      case "Counter":
        content = /* @__PURE__ */ import_react.default.createElement(Counter, null);
        break;
      case "Playwright Surface Lab":
        content = /* @__PURE__ */ import_react.default.createElement(PlaywrightSurfaceLab, null);
        break;
      case "Locator Lab":
        content = /* @__PURE__ */ import_react.default.createElement(LocatorLab, null);
        break;
      case "Automation Lab":
        content = /* @__PURE__ */ import_react.default.createElement(AutomationLab, null);
        break;
    }
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "app" }, /* @__PURE__ */ import_react.default.createElement("header", { className: "header" }, /* @__PURE__ */ import_react.default.createElement("h1", null, "dioxus-react"), /* @__PURE__ */ import_react.default.createElement("p", null, "React UI ", "\xB7", " Native Rust ", "\xB7", " Powered by", " ", /* @__PURE__ */ import_react.default.createElement(
      "a",
      {
        href: "https://github.com/DioxusLabs/wasm-bindgen-wry",
        target: "_blank",
        rel: "noreferrer"
      },
      "wasm-bindgen-wry"
    ))), /* @__PURE__ */ import_react.default.createElement(Tabs, { items: TAB_NAMES, active: tab, onSelect: setTab }), /* @__PURE__ */ import_react.default.createElement("main", { className: "main" }, content));
  }
  var root = import_client.default.createRoot(document.getElementById("root"));
  root.render(/* @__PURE__ */ import_react.default.createElement(App, null));
})();
