// End-to-end tests that run against the real wry webview.
//
// These tests launch the actual Rust binary with --test-port, connect to the
// embedded test bridge, and execute JavaScript directly inside the webview.
// No stubs — every native call (filesystem, system info, fibonacci) hits real
// Rust code running in the wry/wasm-bindgen-wry environment.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { TestBridge } from "./bridge.mjs";

const PORT = 9199;
const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(ROOT, "target", "debug", "dioxus-react");

/** @type {import("node:child_process").ChildProcess | null} */
let app = null;
/** @type {TestBridge} */
let bridge;

// ---------------------------------------------------------------------------
// Helpers for evaluating JS in the webview
// ---------------------------------------------------------------------------

/** Evaluate JS in the webview and return the raw string result. */
async function evalJs(js) {
  return bridge.eval(js);
}

/** Query a DOM element's text content. */
async function textContent(selector) {
  return JSON.parse(
    await evalJs(
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`
    )
  );
}

/** Query element count. */
async function elementCount(selector) {
  return JSON.parse(
    await evalJs(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`
    )
  );
}

/** Check if an element exists and is visible. */
async function isVisible(selector) {
  return JSON.parse(
    await evalJs(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  );
}

/** Check if element has a CSS class. */
async function hasClass(selector, cls) {
  return JSON.parse(
    await evalJs(
      `document.querySelector(${JSON.stringify(selector)})?.classList.contains(${JSON.stringify(cls)}) ?? false`
    )
  );
}

/** Click an element matching a selector. */
async function click(selector) {
  await evalJs(
    `document.querySelector(${JSON.stringify(selector)})?.click()`
  );
}

/** Click a tab button by its visible text. */
async function clickTab(name) {
  await evalJs(`
    Array.from(document.querySelectorAll('.tab'))
      .find(el => el.textContent === ${JSON.stringify(name)})
      ?.click()
  `);
  switch (name) {
    case "System Info":
      await waitFor(async () => (await textContent("h2")) === "System Information");
      break;
    case "Fibonacci":
      await waitFor(async () => (await textContent("h2")) === "Native Fibonacci");
      break;
    case "File Explorer":
      await waitFor(async () => (await inputValue(".path-input")) !== null);
      break;
    case "Counter":
      await waitFor(async () => (await textContent(".counter-value")) !== null);
      break;
    default:
      await sleep(100);
      break;
  }
}

/** Click a .btn by its text content (substring match). */
async function clickBtn(text) {
  await evalJs(`
    Array.from(document.querySelectorAll('.btn'))
      .find(el => el.textContent.includes(${JSON.stringify(text)}))
      ?.click()
  `);
  await sleep(50);
}

/** Click a .file-entry by name. */
async function clickFileEntry(name) {
  await evalJs(`
    Array.from(document.querySelectorAll('.file-entry'))
      .find(el => el.querySelector('.file-name')?.textContent === ${JSON.stringify(name)})
      ?.click()
  `);
  await sleep(100);
}

/** Set an input's value (works with React controlled components). */
async function setInputValue(selector, value) {
  await evalJs(`
    (function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return;
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await sleep(50);
}

/** Get an input's current value. */
async function inputValue(selector) {
  return JSON.parse(
    await evalJs(
      `document.querySelector(${JSON.stringify(selector)})?.value ?? null`
    )
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait until a condition function returns true (polls every intervalMs). */
async function waitFor(fn, timeoutMs = 5000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(intervalMs);
  }
  throw new Error("waitFor timed out");
}

// ---------------------------------------------------------------------------
// Lifecycle: build, launch, connect, teardown
// ---------------------------------------------------------------------------

describe("Embedded app e2e", { concurrency: false }, () => {
before(async () => {
  bridge = new TestBridge(PORT);

  // Launch the real app binary with the test bridge enabled.
  app = spawn(BIN, ["--test-port", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  app.stderr.on("data", (chunk) => {
    const msg = chunk.toString();
    if (process.env.DEBUG) process.stderr.write(`[app] ${msg}`);
  });

  // Connect to the test bridge (retries until the app is ready).
  await bridge.connect(50, 200);

  // Wait for the React app to be fully mounted.
  await waitFor(async () => {
    const h1 = await textContent("h1");
    return h1 === "dioxus-react";
  }, 10000);
});

after(() => {
  bridge.close();
  if (app) {
    app.kill("SIGTERM");
    app = null;
  }
});

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

describe("App shell", () => {
  it("renders header and all four tabs", async () => {
    assert.equal(await textContent("h1"), "dioxus-react");
    assert.equal(await elementCount(".tab"), 4);
  });

  it("System Info tab is active by default", async () => {
    assert.ok(
      await hasClass(".tab:first-child", "tab-active"),
      "First tab should have tab-active class"
    );
  });

  it("clicking a tab switches content", async () => {
    await clickTab("Counter");
    assert.equal(await textContent("h2"), "Counter");

    // Switch back to System Info for subsequent tests.
    await clickTab("System Info");
    await sleep(100);
  });
});

// ---------------------------------------------------------------------------
// System Info tab — REAL native data
// ---------------------------------------------------------------------------

describe("System Info", () => {
  it("displays real system information from native Rust", async () => {
    await clickTab("System Info");
    assert.equal(await textContent("h2"), "System Information");

    assert.ok(await isVisible(".info-table"), "info-table should exist");

    // These are the REAL values from std::env::consts on this machine.
    const tableText = await textContent(".info-table");
    assert.ok(
      tableText.includes("macos") || tableText.includes("linux") || tableText.includes("windows"),
      `System info table should contain a real OS name, got: ${tableText}`
    );
    assert.ok(
      tableText.includes("aarch64") || tableText.includes("x86_64"),
      `System info table should contain a real arch, got: ${tableText}`
    );
  });
});

// ---------------------------------------------------------------------------
// Fibonacci tab — REAL native computation
// ---------------------------------------------------------------------------

describe("Fibonacci", () => {
  beforeEach(async () => {
    await clickTab("Fibonacci");
  });

  it("calculates fibonacci with default input (n=10)", async () => {
    await clickBtn("Calculate");
    await waitFor(async () => (await textContent(".result-value")) !== null);
    assert.equal(await textContent(".result-value"), "55");
  });

  it("calculates fibonacci for custom input", async () => {
    await setInputValue('input[type="number"]', "20");
    await clickBtn("Calculate");
    await waitFor(async () => (await textContent(".result-value")) !== null);
    assert.equal(await textContent(".result-value"), "6765");
  });

  it("calculates fibonacci(0) = 0", async () => {
    await setInputValue('input[type="number"]', "0");
    await clickBtn("Calculate");
    await waitFor(async () => (await textContent(".result-value")) !== null);
    assert.equal(await textContent(".result-value"), "0");
  });

  it("calculates fibonacci(1) = 1", async () => {
    await setInputValue('input[type="number"]', "1");
    await clickBtn("Calculate");
    await waitFor(async () => (await textContent(".result-value")) !== null);
    assert.equal(await textContent(".result-value"), "1");
  });

  it("shows timing information", async () => {
    await clickBtn("Calculate");
    await waitFor(async () => await isVisible(".result-time"));
    const timeText = await textContent(".result-time");
    assert.ok(timeText && timeText.includes("ms"), `Expected timing info, got: ${timeText}`);
  });
});

// ---------------------------------------------------------------------------
// File Explorer tab — REAL filesystem access
// ---------------------------------------------------------------------------

describe("File Explorer", () => {
  beforeEach(async () => {
    await clickTab("File Explorer");
    await sleep(200);
  });

  it("loads real directory listing from native filesystem", async () => {
    // The initial path is the real cwd.
    const pathVal = await inputValue(".path-input");
    assert.ok(pathVal && pathVal.length > 0, "path input should have a value");

    // There should be at least one file entry.
    await waitFor(async () => (await elementCount(".file-entry")) > 0, 5000);
    const count = await elementCount(".file-entry");
    assert.ok(count > 0, `Expected file entries, got ${count}`);
  });

  it("shows real files from this project directory", async () => {
    // Navigate to the project root so we know what to expect.
    await setInputValue(".path-input", ROOT);
    await clickBtn("Go");
    await sleep(300);

    // We know Cargo.toml and src/ exist in this project.
    const entries = await evalJs(`
      JSON.stringify(
        Array.from(document.querySelectorAll('.file-entry .file-name'))
          .map(el => el.textContent)
      )
    `);
    const names = JSON.parse(entries);
    assert.ok(names.includes("Cargo.toml"), `Expected Cargo.toml in listing, got: ${names}`);
    assert.ok(names.includes("src"), `Expected src/ in listing, got: ${names}`);
  });

  it("directories are styled differently from files", async () => {
    await setInputValue(".path-input", ROOT);
    await clickBtn("Go");
    await sleep(300);

    // src/ should have the file-dir class
    const srcIsDir = JSON.parse(
      await evalJs(`
        (function() {
          var el = Array.from(document.querySelectorAll('.file-entry'))
            .find(e => e.querySelector('.file-name')?.textContent === 'src');
          return el ? el.classList.contains('file-dir') : false;
        })()
      `)
    );
    assert.ok(srcIsDir, "src/ should have file-dir class");

    // Cargo.toml should NOT have the file-dir class
    const cargoIsDir = JSON.parse(
      await evalJs(`
        (function() {
          var el = Array.from(document.querySelectorAll('.file-entry'))
            .find(e => e.querySelector('.file-name')?.textContent === 'Cargo.toml');
          return el ? el.classList.contains('file-dir') : false;
        })()
      `)
    );
    assert.ok(!cargoIsDir, "Cargo.toml should NOT have file-dir class");
  });

  it("clicking a directory navigates into it", async () => {
    await setInputValue(".path-input", ROOT);
    await clickBtn("Go");
    await sleep(300);

    await clickFileEntry("src");
    await sleep(200);

    const newPath = await inputValue(".path-input");
    assert.ok(
      newPath && newPath.endsWith("/src"),
      `Expected path ending in /src, got: ${newPath}`
    );

    // main.rs should be visible inside src/
    await waitFor(async () => {
      const text = await evalJs(`
        JSON.stringify(
          Array.from(document.querySelectorAll('.file-entry .file-name'))
            .map(el => el.textContent)
        )
      `);
      return JSON.parse(text).includes("main.rs");
    });
  });

  it("clicking a file shows its real content", async () => {
    await setInputValue(".path-input", ROOT);
    await clickBtn("Go");
    await sleep(300);

    await clickFileEntry("Cargo.toml");
    await sleep(300);

    assert.ok(await isVisible(".file-preview"), "file preview should be visible");
    assert.equal(await textContent(".file-preview h3"), "Cargo.toml");

    const preview = await textContent(".file-preview pre");
    assert.ok(
      preview && preview.includes("dioxus-react"),
      `Cargo.toml preview should contain 'dioxus-react', got: ${preview?.slice(0, 100)}`
    );
  });

  it("Up button navigates to parent directory", async () => {
    // Navigate into src/ first
    await setInputValue(".path-input", path.join(ROOT, "src"));
    await clickBtn("Go");
    await sleep(200);

    // Click Up
    await clickBtn("Up");
    await sleep(200);

    const newPath = await inputValue(".path-input");
    assert.ok(
      newPath && !newPath.endsWith("/src"),
      `After Up, path should not end with /src, got: ${newPath}`
    );
  });

  it("shows error for invalid path", async () => {
    await setInputValue(".path-input", "/nonexistent/path/that/does/not/exist");
    await clickBtn("Go");
    await sleep(200);

    assert.ok(await isVisible(".error"), "error message should be visible");
    const errText = await textContent(".error");
    assert.ok(errText && errText.length > 0, `Expected error text, got: ${errText}`);
  });
});

// ---------------------------------------------------------------------------
// Counter tab — pure React state
// ---------------------------------------------------------------------------

describe("Counter", () => {
  beforeEach(async () => {
    await clickTab("Counter");
  });

  it("starts at zero", async () => {
    assert.equal(await textContent(".counter-value"), "0");
  });

  it("increments on + click", async () => {
    await clickBtn("+");
    assert.equal(await textContent(".counter-value"), "1");

    await clickBtn("+");
    assert.equal(await textContent(".counter-value"), "2");
  });

  it("decrements on \u2212 click", async () => {
    // Counter may have state from previous test; read current and subtract.
    await clickBtn("\u2212");
    const val = parseInt(await textContent(".counter-value"), 10);
    // Just verify it went down by 1 from whatever it was.
    await clickBtn("\u2212");
    assert.equal(
      await textContent(".counter-value"),
      String(val - 1)
    );
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("Tab switching", () => {
  it("switching tabs replaces content", async () => {
    await clickTab("System Info");
    assert.equal(await textContent("h2"), "System Information");

    await clickTab("Counter");
    assert.equal(await textContent("h2"), "Counter");
    assert.ok(
      !(await isVisible(".info-table")),
      "info-table should not be visible on Counter tab"
    );

    await clickTab("Fibonacci");
    assert.equal(await textContent("h2"), "Native Fibonacci");

    await clickTab("System Info");
    assert.equal(await textContent("h2"), "System Information");
  });
});
});
