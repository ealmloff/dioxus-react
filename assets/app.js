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
  function callNative(fn, ...args) {
    const result = window.__native[fn](...args);
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
      const val = window.__native.fibonacci(n);
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
    const [currentPath, setCurrentPath] = (0, import_react.useState)(
      callNative("getSystemInfo").cwd || "."
    );
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
      loadDir(currentPath);
    }, []);
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
  var TAB_NAMES = ["System Info", "Fibonacci", "File Explorer", "Counter"];
  function App() {
    const [tab, setTab] = (0, import_react.useState)(TAB_NAMES[0]);
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
