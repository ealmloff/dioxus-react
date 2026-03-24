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
    if (window.NativeBridge) return window.NativeBridge.new();
    throw new Error("Native bridge is not available");
  }
  function callNative(fn, ...args) {
    const result = createNativeBridge()[fn](...args);
    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch (_) {
        return result;
      }
    }
    return result;
  }
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
    ))), /* @__PURE__ */ import_react.default.createElement("p", { id: "selector-status", className: "lab-output" }, selectorState))));
  }
  var TAB_NAMES = [
    "System Info",
    "Fibonacci",
    "File Explorer",
    "Counter",
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
        target: "_blank"
      },
      "wasm-bindgen-wry"
    ))), /* @__PURE__ */ import_react.default.createElement(Tabs, { items: TAB_NAMES, active: tab, onSelect: setTab }), /* @__PURE__ */ import_react.default.createElement("main", { className: "main" }, content));
  }
  var root = import_client.default.createRoot(document.getElementById("root"));
  root.render(/* @__PURE__ */ import_react.default.createElement(App, null));
})();
