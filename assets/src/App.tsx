// React app loaded via wasm-bindgen-wry.
// Native Rust functions are exposed via the NativeBridge wasm-bindgen class,
// which the runtime automatically places on `window.NativeBridge`.

import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import type { NativeBridge } from "./nativeBridge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
// Native bridge factory — the Rust bridge is stateless, so use fresh handles.
// ---------------------------------------------------------------------------

function createNativeBridge(): NativeBridge {
  const bridge: unknown = window.NativeBridge;
  if (!bridge) throw new Error("Native bridge is not available");

  const withFactory = bridge as { new(): NativeBridge };
  if (typeof (withFactory as { new?: unknown }).new === "function") {
    return withFactory.new();
  }

  return new (bridge as { new(): NativeBridge })();
}

// ---------------------------------------------------------------------------
// Helper: call a native Rust function and parse the JSON result
// ---------------------------------------------------------------------------

function callNative(fn: string, ...args: unknown[]): unknown {
  const bridge = createNativeBridge() as Record<string, (...args: unknown[]) => unknown>;
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

const LOCATOR_FRAME_SRC_DOC = `<!doctype html>
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
    </script>
  </body>
</html>`;

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
    const val = createNativeBridge().fibonacci(n);
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
  const [blurState, setBlurState] = useState("blurred");
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

        <section className="lab-panel" id="lab-content-panel">
          <h3>Content and Focus</h3>
          <div id="lab-rich-content" className="lab-rich-content">
            <span>Hello</span> <strong>World</strong>{" "}
            <span hidden>Invisible</span>
          </div>
          <div className="row">
            <label className="lab-label" htmlFor="lab-blur-input">
              Blur Target
            </label>
            <input
              id="lab-blur-input"
              className="lab-input"
              value="focus me"
              onChange={() => {}}
              onFocus={() => setBlurState("focused")}
              onBlur={() => setBlurState("blurred")}
            />
          </div>
          <p id="lab-blur-output" className="lab-output">
            {blurState}
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
// Locator Lab — semantic fixtures for label/text/title/placeholder/role testing
// ---------------------------------------------------------------------------

function LocatorLab() {
  const [saved, setSaved] = useState(false);
  const [selectorState, setSelectorState] = useState("idle");
  const [frameStatus, setFrameStatus] = useState("loading");
  const [frameClickCount, setFrameClickCount] = useState(0);
  const [delayedActionable, setDelayedActionable] = useState(false);
  const [delayedClicked, setDelayedClicked] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { kind?: string; status?: string; count?: string } | undefined;
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

  return (
    <div className="card automation-card" id="locator-lab">
      <h2>Locator Lab</h2>
      <p className="subtitle">
        Deterministic fixtures for semantic locator coverage.
      </p>

      <div className="lab-grid locator-grid">
        <section className="lab-panel" id="locator-label-panel">
          <h3>Labels and Placeholders</h3>
          <div className="row">
            <label className="lab-label" id="locator-name-label" htmlFor="locator-name">
              Full name
            </label>
            <input
              id="locator-name"
              className="lab-input"
              placeholder="Ada Lovelace"
              defaultValue="Ada Lovelace"
              readOnly
            />
          </div>
          <div className="row">
            <label className="lab-label" id="locator-search-label" htmlFor="locator-search">
              Search sample
            </label>
            <input
              id="locator-search"
              className="lab-input"
              placeholder="Search the catalog"
              aria-label="Search sample"
              defaultValue=""
              readOnly
            />
          </div>
        </section>

        <section className="lab-panel" id="locator-text-panel">
          <h3>Text and Title</h3>
          <p id="locator-text-target" className="lab-output">
            Locator text target
          </p>
          <button
            id="locator-save"
            className="btn btn-sm"
            title="Save locator sample"
            onClick={() => setSaved(true)}
          >
            Save sample
          </button>
          <p id="locator-save-output" className="lab-output">
            {saved ? "saved" : "idle"}
          </p>
          <button
            id="locator-icon"
            className="btn btn-sm"
            title="icon button"
            aria-label="icon button"
          >
            Icon
          </button>
        </section>

        <section className="lab-panel" id="locator-role-panel">
          <h3>Roles</h3>
          <button
            id="locator-role-button"
            className="btn"
            aria-label="role button sample"
          >
            Role Button
          </button>
          <div id="locator-status" role="status" aria-label="save status">
            {saved ? "Saved status" : "Idle status"}
          </div>
          <a id="locator-link" href="#locator-lab" title="jump to locator lab">
            Locator link
          </a>
        </section>

        <section className="lab-panel" id="locator-selector-panel">
          <h3>Selector Combinators</h3>
          <p className="subtitle">
            Visible and hidden fixtures for locator filters and combinators.
          </p>

          <div className="selector-note-row">
            <p className="selector-note" data-kind="visible-note">
              Visible selector note
            </p>
            <p className="selector-note selector-note-hidden" hidden data-kind="hidden-note">
              Hidden selector note
            </p>
          </div>

          <div className="selector-card-list">
            <article className="selector-card" data-card="alpha">
              <h4>Alpha card</h4>
              <p>Shared details</p>
              <button
                className="btn btn-sm"
                title="open alpha card"
                onClick={() => setSelectorState("alpha")}
              >
                Open Alpha
              </button>
            </article>

            <article className="selector-card" data-card="beta">
              <h4>Beta card</h4>
              <p>Shared details</p>
              <button
                className="btn btn-sm"
                title="open beta card"
                onClick={() => setSelectorState("beta")}
              >
                Open Beta
              </button>
            </article>

            <article className="selector-card" data-card="gamma">
              <h4>Gamma card</h4>
              <p>Unique details</p>
              <button
                className="btn btn-sm"
                title="open gamma card"
                onClick={() => setSelectorState("gamma")}
              >
                Open Gamma
              </button>
            </article>
          </div>

          <p id="selector-status" className="lab-output">
            {selectorState}
          </p>
        </section>

        <section className="lab-panel" id="locator-frame-panel">
          <h3>Iframe and Delayed Actionability</h3>
          <p className="subtitle">
            Nested same-origin content plus a delayed action target for proxy tests.
          </p>

          <div className="frame-shell">
            <iframe
              id="locator-frame"
              title="Nested action frame"
              srcDoc={LOCATOR_FRAME_SRC_DOC}
            />
          </div>

          <div className="lab-output-list">
            <p id="locator-frame-status" className="lab-output">
              {frameStatus}
            </p>
            <p id="locator-frame-output" className="lab-output">
              {String(frameClickCount)}
            </p>
          </div>

          <div className="locator-delayed-row">
            <button
              id="locator-delayed-action"
              className="btn btn-sm"
              hidden={!delayedActionable}
              disabled={!delayedActionable}
              onClick={() => setDelayedClicked(true)}
            >
              Delayed action
            </button>
            <p id="locator-delayed-output" className="lab-output">
              {delayedClicked ? "clicked" : delayedActionable ? "ready" : "waiting"}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

function PlaywrightSurfaceLab() {
  const [hashValue, setHashValue] = useState(() => window.location.hash || "(none)");
  const [networkProbe, setNetworkProbe] = useState("idle");
  const [viewportValue, setViewportValue] = useState(() => `${window.innerWidth}x${window.innerHeight}`);
  const [dialogOutput, setDialogOutput] = useState("idle");
  const [keyboardOutput, setKeyboardOutput] = useState("none");
  const [selectedFile, setSelectedFile] = useState("none");
  const [geolocationOutput, setGeolocationOutput] = useState("not-run");
  const [locatorOutput, setLocatorOutput] = useState("none");
  const [consoleOutput, setConsoleOutput] = useState("idle");
  const [pageErrorOutput, setPageErrorOutput] = useState("idle");
  const [dragOutput, setDragOutput] = useState("idle");

  useEffect(() => {
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

  return (
    <div className="card automation-card" id="surface-lab">
      <h2>Playwright Surface Lab</h2>
      <p className="subtitle">Fixture surfaces for proxy parity expansion.</p>

      <div className="lab-grid">
        <section className="lab-panel" id="surface-nav-panel">
          <h3>Navigation</h3>
          <a id="surface-nav-link" href="#surface-anchor">
            Go to hash anchor
          </a>
          <p id="surface-nav-output" className="lab-output">
            {hashValue}
          </p>
          <p id="surface-anchor" className="lab-output">
            surface anchor
          </p>
        </section>

        <section className="lab-panel" id="surface-network-panel">
          <h3>Network Probe</h3>
          <button id="surface-network-probe" className="btn btn-sm" onClick={runNetworkProbe}>
            Run fetch probe
          </button>
          <p id="surface-network-output" className="lab-output">
            {networkProbe}
          </p>
        </section>

        <section className="lab-panel" id="surface-viewport-panel">
          <h3>Viewport Surface</h3>
          <p id="surface-viewport-output" className="lab-output">
            {viewportValue}
          </p>
        </section>

        <section className="lab-panel" id="surface-keyboard-panel">
          <h3>Keyboard Surface</h3>
          <input
            id="surface-keyboard-input"
            className="lab-input"
            placeholder="Type here"
            onKeyDown={(event) => {
              const next = keyboardOutput === "none"
                ? event.key
                : `${keyboardOutput},${event.key}`;
              setKeyboardOutput(next.split(",").slice(-8).join(","));
            }}
          />
          <p id="surface-keyboard-output" className="lab-output">
            {keyboardOutput}
          </p>
        </section>

        <section className="lab-panel" id="surface-chooser-panel">
          <h3>Chooser Surface</h3>
          <input
            id="surface-file-input"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setSelectedFile(file?.name ?? "none");
            }}
          />
          <p id="surface-file-output" className="lab-output">
            {selectedFile}
          </p>
        </section>

        <section className="lab-panel" id="surface-geolocation-panel">
          <h3>Geolocation Surface</h3>
          <button
            id="surface-geolocation-query"
            className="btn btn-sm"
            onClick={runGeolocationProbe}
          >
            Query geolocation
          </button>
          <p id="surface-geolocation-output" className="lab-output">
            {geolocationOutput}
          </p>
        </section>

        <section className="lab-panel" id="surface-dialog-panel">
          <h3>Dialog Surface</h3>
          <button
            id="surface-dialog-button"
            className="btn btn-sm"
            onClick={runDialogProbe}
          >
            Open dialog
          </button>
          <p id="surface-dialog-output" className="lab-output">
            {dialogOutput}
          </p>
        </section>

        <section className="lab-panel" id="surface-console-panel">
          <h3>Console Surface</h3>
          <button
            id="surface-console-button"
            className="btn btn-sm"
            onClick={runConsoleProbe}
          >
            Emit console log
          </button>
          <p id="surface-console-output" className="lab-output">
            {consoleOutput}
          </p>
        </section>

        <section className="lab-panel" id="surface-error-panel">
          <h3>Page Error Surface</h3>
          <button
            id="surface-pageerror-button"
            className="btn btn-sm"
            onClick={runPageErrorProbe}
          >
            Throw async error
          </button>
          <p id="surface-pageerror-output" className="lab-output">
            {pageErrorOutput}
          </p>
        </section>

        <section className="lab-panel" id="surface-locator-panel">
          <h3>Locator Surface</h3>
          <div id="surface-locator-list" role="list">
            <div className="surface-locator-item" role="listitem">
              <button
                id="surface-locator-alpha"
                className="btn btn-sm"
                onClick={() => setLocatorOutput("alpha")}
              >
                Open Surface Alpha
              </button>
            </div>
            <div className="surface-locator-item" role="listitem">
              <button
                id="surface-locator-beta"
                className="btn btn-sm"
                onClick={() => setLocatorOutput("beta")}
              >
                Open Surface Beta
              </button>
            </div>
            <div className="surface-locator-item" role="listitem">
              <button
                id="surface-locator-gamma"
                className="btn btn-sm"
                onClick={() => setLocatorOutput("gamma")}
              >
                Open Surface Gamma
              </button>
            </div>
          </div>
          <p id="surface-locator-output" className="lab-output">
            {locatorOutput}
          </p>
        </section>

        <section className="lab-panel" id="surface-shot-panel">
          <h3>Screenshot Surface</h3>
          <div id="surface-screenshot-target" className="surface-shot-target">
            <div className="surface-shot-block surface-shot-block-red" />
            <div className="surface-shot-block surface-shot-block-green" />
            <div className="surface-shot-block surface-shot-block-blue" />
          </div>
        </section>

        <section className="lab-panel" id="surface-drag-panel">
          <h3>Drag Surface</h3>
          <div
            id="surface-drag-source"
            className="surface-drag-source"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", "surface-drag");
            }}
          >
            Drag me
          </div>
          <div
            id="surface-drop-target"
            className="surface-drag-target"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setDragOutput(event.dataTransfer.getData("text/plain") || "dropped");
            }}
          >
            Drop target
          </div>
          <p id="surface-drag-output" className="lab-output">
            {dragOutput}
          </p>
        </section>
      </div>
    </div>
  );
}

const TAB_NAMES = [
  "System Info",
  "Fibonacci",
  "File Explorer",
  "Counter",
  "Playwright Surface Lab",
  "Locator Lab",
  "Automation Lab",
];

function App() {
  const [tab, setTab] = useState("Counter");

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
    case "Playwright Surface Lab":
      content = <PlaywrightSurfaceLab />;
      break;
    case "Locator Lab":
      content = <LocatorLab />;
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
            rel="noreferrer"
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
