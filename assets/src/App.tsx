// React app loaded via wasm-bindgen-wry.
// Native Rust functions are available on window.__native.

import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NativeBridge {
  getSystemInfo(): string;
  fibonacci(n: number): number;
  readDir(path: string): string;
  readFile(path: string): string;
  writeFile(path: string, content: string): string;
  getEnv(key: string): string | null;
}

declare global {
  interface Window {
    __native: NativeBridge;
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
// Helper: call a native Rust function and parse the JSON result
// ---------------------------------------------------------------------------

function callNative(fn: string, ...args: unknown[]): unknown {
  const result = (window.__native as unknown as Record<string, Function>)[fn](...args);
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
    const val = window.__native.fibonacci(n);
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
  const [currentPath, setCurrentPath] = useState(
    (callNative("getSystemInfo") as SystemInfoData).cwd || "."
  );
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
    loadDir(currentPath);
  }, []);

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
// App shell
// ---------------------------------------------------------------------------

const TAB_NAMES = ["System Info", "Fibonacci", "File Explorer", "Counter"];

function App() {
  const [tab, setTab] = useState(TAB_NAMES[0]);

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