// React app loaded via wasm-bindgen-wry.
// Native Rust functions are exposed via the NativeBridge wasm-bindgen class,
// which the runtime automatically places on `window.NativeBridge`.

import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface INativeBridge {
  getSystemInfo(): string;
  fibonacci(n: number): number;
  readDir(path: string): string;
  readFile(path: string): string;
  writeFile(path: string, content: string): string;
  getEnv(key: string): string | null;
}

declare global {
  interface Window {
    NativeBridge?: {
      new(): INativeBridge;
    };
  }
}

interface SystemInfoData {
  [key: string]: string;
}

interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
}

interface ReadDirResult {
  entries?: DirEntry[];
  error?: string;
}

interface ReadFileResult {
  content?: string;
  error?: string;
  truncated?: boolean;
  totalBytes?: number;
}

// ---------------------------------------------------------------------------
// Singleton bridge instance — created once from the wasm-bindgen class.
// ---------------------------------------------------------------------------

function createNativeBridge(): INativeBridge {
  if (window.NativeBridge) return window.NativeBridge.new();
  throw new Error("Native bridge is not available");
}

let native: INativeBridge | null = null;

function getNativeBridge(): INativeBridge {
  if (!native) native = createNativeBridge();
  return native;
}

// ---------------------------------------------------------------------------
// Helper: call a native Rust function and parse the JSON result
// ---------------------------------------------------------------------------

function callNative(fn: string, ...args: unknown[]): unknown {
  const result = (getNativeBridge() as unknown as Record<string, Function>)[fn](...args);
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch (_) {
      return result;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

interface TabsProps {
  items: string[];
  active: string;
  onSelect: (tab: string) => void;
}

function Tabs({ items, active, onSelect }: TabsProps) {
  return (
    <div className="tabs">
      {items.map((item) => (
        <button
          key={item}
          className={"tab" + (active === item ? " tab-active" : "")}
          onClick={() => onSelect(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Info panel
// ---------------------------------------------------------------------------

function SystemInfo() {
  const [info, setInfo] = useState<SystemInfoData | null>(null);

  useEffect(() => {
    setInfo(callNative("getSystemInfo") as SystemInfoData);
  }, []);

  if (!info) return <p>Loading...</p>;

  return (
    <div className="card">
      <h2>System Information</h2>
      <table className="info-table">
        <tbody>
          {Object.keys(info).map((key) => (
            <tr key={key}>
              <td className="info-label">{key}</td>
              <td className="info-value">{String(info[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fibonacci calculator — runs in native Rust
// ---------------------------------------------------------------------------

function FibonacciCalc() {
  const [n, setN] = useState(10);
  const [result, setResult] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);

  const calculate = useCallback(() => {
    const start = performance.now();
    const val = getNativeBridge().fibonacci(n);
    const ms = (performance.now() - start).toFixed(3);
    setResult(val);
    setElapsed(ms);
  }, [n]);

  return (
    <div className="card">
      <h2>Native Fibonacci</h2>
      <p className="subtitle">Computed in native Rust — not in JS.</p>
      <div className="row">
        <label>
          n ={" "}
          <input
            type="number"
            min={0}
            max={93}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
          />
        </label>
        <button className="btn" onClick={calculate}>
          Calculate
        </button>
      </div>
      {result !== null && (
        <div className="result">
          <span className="result-label">Result: </span>
          <span className="result-value">{String(result)}</span>
          <span className="result-time"> ({elapsed} ms)</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File Explorer — reads the native filesystem via Rust
// ---------------------------------------------------------------------------

function FileExplorer() {
  const [currentPath, setCurrentPath] = useState(".");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDir = useCallback((path: string) => {
    const res = callNative("readDir", path) as ReadDirResult;
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

  useEffect(() => {
    const cwd = (callNative("getSystemInfo") as SystemInfoData).cwd || ".";
    setCurrentPath(cwd);
    loadDir(cwd);
  }, [loadDir]);

  const openEntry = useCallback(
    (entry: DirEntry) => {
      const sep = currentPath.indexOf("\\") !== -1 ? "\\" : "/";
      const child = currentPath + sep + entry.name;
      if (entry.isDir) {
        loadDir(child);
      } else {
        const res = callNative("readFile", child) as ReadFileResult;
        if (res.error) {
          setFileContent("Error: " + res.error);
        } else {
          setFileContent(res.content ?? null);
        }
        setViewingFile(entry.name);
      }
    },
    [currentPath, loadDir]
  );

  const goUp = useCallback(() => {
    const sep = currentPath.indexOf("\\") !== -1 ? "\\" : "/";
    const parts = currentPath.split(sep);
    if (parts.length > 1) {
      parts.pop();
      const parent = parts.join(sep) || sep;
      loadDir(parent);
    }
  }, [currentPath, loadDir]);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  return (
    <div className="card">
      <h2>File Explorer</h2>
      <p className="subtitle">Browse your native filesystem from React.</p>
      <div className="row">
        <button className="btn btn-sm" onClick={goUp}>
          {"\u2191"} Up
        </button>
        <input
          ref={inputRef}
          className="path-input"
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter")
              loadDir((e.target as HTMLInputElement).value);
          }}
        />
        <button className="btn btn-sm" onClick={() => loadDir(currentPath)}>
          Go
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="file-list">
        {entries.map((entry) => (
          <div
            key={entry.name}
            className={"file-entry" + (entry.isDir ? " file-dir" : "")}
            onClick={() => openEntry(entry)}
          >
            <span className="file-icon">
              {entry.isDir ? "\uD83D\uDCC1" : "\uD83D\uDCC4"}
            </span>
            <span className="file-name">{entry.name}</span>
            {!entry.isDir && (
              <span className="file-size">{formatSize(entry.size)}</span>
            )}
          </div>
        ))}
      </div>
      {viewingFile && (
        <div className="file-preview">
          <h3>{viewingFile}</h3>
          <pre>{fileContent}</pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Counter — pure React state, proving React works in wry
// ---------------------------------------------------------------------------

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="card">
      <h2>Counter</h2>
      <p className="subtitle">Pure React state — no native calls.</p>
      <div className="counter-row">
        <button className="btn" onClick={() => setCount(count - 1)}>
          {"\u2212"}
        </button>
        <span className="counter-value">{count}</span>
        <button className="btn" onClick={() => setCount(count + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Automation Lab — interactive controls used by the Playwright proxy tests
// ---------------------------------------------------------------------------

function AutomationLab() {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState("blue");
  const [selectedMany, setSelectedMany] = useState<string[]>(["beta"]);
  const [hovered, setHovered] = useState(false);
  const [doubleClicks, setDoubleClicks] = useState(0);
  const [keyLog, setKeyLog] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(0);
  const [asyncVisible, setAsyncVisible] = useState(false);
  const [customMessage, setCustomMessage] = useState("idle");
  const [editableText, setEditableText] = useState("Editable content");
  const dispatchTargetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = dispatchTargetRef.current;
    if (!target) return;

    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string }>;
      setCustomMessage(custom.detail?.message || event.type);
    };

    target.addEventListener("lab:update", listener as EventListener);
    return () =>
      target.removeEventListener("lab:update", listener as EventListener);
  }, []);

  return (
    <div className="card automation-card" id="automation-lab">
      <h2>Automation Lab</h2>
      <p className="subtitle">
        Controls and event targets used to validate the embedded Playwright
        proxy.
      </p>

      <div className="lab-grid">
        <section className="lab-panel" id="lab-form-panel">
          <h3>Form Controls</h3>
          <div className="row">
            <label className="lab-label" htmlFor="lab-text">
              Text Input
            </label>
            <input
              id="lab-text"
              className="lab-input"
              data-kind="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                setKeyLog((log) => [...log.slice(-7), e.key]);
                if (e.key === "Enter") setSubmitted((count) => count + 1);
              }}
            />
          </div>

          <div className="row">
            <label className="lab-label" htmlFor="lab-checkbox">
              Checkbox
            </label>
            <input
              id="lab-checkbox"
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
          </div>

          <div className="row">
            <label className="lab-label" htmlFor="lab-select">
              Single Select
            </label>
            <select
              id="lab-select"
              className="lab-input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="blue">Blue</option>
              <option value="green">Green</option>
              <option value="orange">Orange</option>
            </select>
          </div>

          <div className="row">
            <label className="lab-label" htmlFor="lab-multi-select">
              Multi Select
            </label>
            <select
              id="lab-multi-select"
              className="lab-input"
              multiple
              value={selectedMany}
              onChange={(e) =>
                setSelectedMany(
                  Array.from(e.target.selectedOptions).map((option) => option.value)
                )
              }
            >
              <option value="alpha">Alpha</option>
              <option value="beta">Beta</option>
              <option value="gamma">Gamma</option>
            </select>
          </div>

          <div className="lab-output-list">
            <p id="lab-text-output" className="lab-output">
              {text || "empty"}
            </p>
            <p id="lab-keylog" className="lab-output">
              {keyLog.join(",") || "empty"}
            </p>
            <p id="lab-submit-count" className="lab-output">
              {String(submitted)}
            </p>
            <p id="lab-checkbox-output" className="lab-output">
              {checked ? "checked" : "unchecked"}
            </p>
            <p id="lab-select-output" className="lab-output">
              {selected}
            </p>
            <p id="lab-multi-select-output" className="lab-output">
              {selectedMany.join(",") || "none"}
            </p>
          </div>
        </section>

        <section className="lab-panel" id="lab-state-panel">
          <h3>State and Visibility</h3>
          <div className="row">
            <button
              id="lab-reveal"
              className="btn btn-sm"
              onClick={() => {
                setAsyncVisible(false);
                window.setTimeout(() => setAsyncVisible(true), 120);
              }}
            >
              Reveal Async Note
            </button>
            <input
              id="lab-readonly"
              className="lab-input"
              readOnly
              value="read-only value"
            />
            <input
              id="lab-disabled"
              className="lab-input"
              disabled
              value="disabled value"
              onChange={() => {}}
            />
          </div>

          <div
            id="lab-editable"
            className="lab-editable"
            contentEditable
            suppressContentEditableWarning
            onInput={(e) =>
              setEditableText(
                (e.currentTarget.textContent || "").trim() || "Editable content"
              )
            }
          >
            {editableText}
          </div>

          <p
            id="lab-async-note"
            className={"lab-note" + (asyncVisible ? "" : " lab-note-hidden")}
            hidden={!asyncVisible}
          >
            Ready for waitForSelector
          </p>

          <p id="lab-editable-output" className="lab-output">
            {editableText}
          </p>
        </section>

        <section className="lab-panel" id="lab-events-panel">
          <h3>Events</h3>
          <div
            id="lab-hover-target"
            className={"lab-event-box" + (hovered ? " lab-event-active" : "")}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            Hover target
          </div>

          <button
            id="lab-double-target"
            className="btn btn-sm"
            onDoubleClick={() => setDoubleClicks((count) => count + 1)}
          >
            Double-click target
          </button>

          <div
            id="lab-dispatch-target"
            ref={dispatchTargetRef}
            className="lab-event-box"
            data-status={customMessage}
          >
            Dispatch target
          </div>

          <div className="lab-output-list">
            <p id="lab-hover-output" className="lab-output">
              {hovered ? "hovered" : "idle"}
            </p>
            <p id="lab-double-count" className="lab-output">
              {String(doubleClicks)}
            </p>
            <p id="lab-dispatch-output" className="lab-output">
              {customMessage}
            </p>
          </div>
        </section>

        <section className="lab-panel" id="lab-handle-panel">
          <h3>Handle Scope</h3>
          <div id="lab-scope" data-scope="root">
            <p id="lab-scope-label" data-role="scope-label">
              Scoped query root
            </p>
            <ul id="lab-list" className="lab-list">
              <li className="lab-list-item" data-item="one">
                One
              </li>
              <li className="lab-list-item" data-item="two">
                Two
              </li>
              <li className="lab-list-item" data-item="three">
                Three
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

const TAB_NAMES = [
  "System Info",
  "Fibonacci",
  "File Explorer",
  "Counter",
  "Automation Lab",
];

function App() {
  const [tab, setTab] = useState(TAB_NAMES[0]);

  useEffect(() => {
    document.title = "dioxus-react";
  }, []);

  let content: React.ReactNode;
  switch (tab) {
    case "System Info":
      content = <SystemInfo />;
      break;
    case "Fibonacci":
      content = <FibonacciCalc />;
      break;
    case "File Explorer":
      content = <FileExplorer />;
      break;
    case "Counter":
      content = <Counter />;
      break;
    case "Automation Lab":
      content = <AutomationLab />;
      break;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>dioxus-react</h1>
        <p>
          React UI {"\u00B7"} Native Rust {"\u00B7"} Powered by{" "}
          <a
            href="https://github.com/DioxusLabs/wasm-bindgen-wry"
            target="_blank"
          >
            wasm-bindgen-wry
          </a>
        </p>
      </header>
      <Tabs items={TAB_NAMES} active={tab} onSelect={setTab} />
      <main className="main">{content}</main>
    </div>
  );
}

// Mount
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<App />);
