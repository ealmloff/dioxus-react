# dioxus-react

Use **React** for your UI while accessing **native Rust** capabilities — powered by [wasm-bindgen-wry](https://github.com/DioxusLabs/wasm-bindgen-wry).

This project demonstrates the approach [suggested by @ealmloff](https://github.com/DioxusLabs/dioxus/discussions/5392): instead of using Dioxus RSX for rendering, use a JavaScript UI framework (React) with `wasm-bindgen-wry` to get the same webview layer with typed bindings into native Rust.

## How it works

```
┌─────────────────────────────────────────┐
│           Native Rust Binary            │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │         wry webview              │   │
│  │                                  │   │
│  │  React 18 (vendored, offline)    │   │
│  │         ↕ calls                  │   │
│  │  window.__native.*()             │   │
│  │         ↕ wasm-bindgen-wry IPC   │   │
│  └──────────────────────────────────┘   │
│                                         │
│  Native Rust functions:                 │
│  • File system access (read/write)      │
│  • System info                          │
│  • Native-speed computation             │
│  • Environment variables                │
└─────────────────────────────────────────┘
```

`wasm-bindgen-wry` re-implements the `wasm-bindgen` API surface so that Rust code runs **natively** (not in WASM) while still communicating with JavaScript through WRY's embedded webview. This gives you:

- Full native threading and system access from Rust
- The familiar `web-sys` / `js-sys` API from Rust
- Any JavaScript UI framework in the webview (React, Vue, Svelte, etc.)

## Demo features

| Tab | Description |
|-----|-------------|
| **System Info** | Reads OS, arch, executable path, and working directory via native Rust |
| **Fibonacci** | Computes Fibonacci numbers in native Rust — compare the speed to a JS implementation |
| **File Explorer** | Browse and read files from the native filesystem |
| **Counter** | Pure React state management — proves React works normally |

## Prerequisites

- Rust (edition 2024)
- System dependencies for [WRY](https://github.com/nicegui-native/nicegui-native):
  - **Linux**: `libwebkit2gtk-4.1-dev libgtk-3-dev`
  - **macOS**: Xcode command line tools
  - **Windows**: WebView2 (pre-installed on Windows 11)

## Building and running

```bash
cargo run
```

React 18 is vendored in `ui/vendor/` and embedded into the binary at compile time — no internet connection is needed at runtime.

## Project structure

```
├── Cargo.toml          # Dependencies on wry-launch + wasm-bindgen-wry patches
├── src/
│   └── main.rs         # Rust entry point: sets up webview, registers native functions
└── ui/
    ├── app.js          # React application (pure JS, no build step needed)
    ├── style.css       # Application styles
    └── vendor/         # Vendored React 18 production builds (embedded at compile time)
        ├── react.production.min.js
        └── react-dom.production.min.js
```

## Adding native functions

Expose new Rust functions to React by adding closures in `register_native_functions`:

```rust
let my_func = Closure::wrap(Box::new(|arg: JsValue| -> JsValue {
    let input = arg.as_string().unwrap_or_default();
    // Do native stuff: threads, filesystem, networking, FFI...
    let result = expensive_native_operation(&input);
    JsValue::from_str(&serde_json::json!({ "result": result }).to_string())
}) as Box<dyn Fn(JsValue) -> JsValue>);

js_sys::Reflect::set(&native, &"myFunc".into(), my_func.as_ref()).unwrap();
my_func.forget();
```

Then call it from React:

```js
var result = JSON.parse(window.__native.myFunc("hello"));
```

## Using a bundled React app (Vite/Bun)

For larger apps, you can use a proper build tool:

1. Create a `ui/` project with Vite, Bun, or your preferred bundler
2. Build to a single JS bundle (e.g., `dist/app.js`)
3. Embed it via `include_str!("../ui/dist/app.js")` in `main.rs`

## Updating vendored React

```bash
cd ui/vendor
npm init -y && npm install react@18 react-dom@18
cp node_modules/react/umd/react.production.min.js .
cp node_modules/react-dom/umd/react-dom.production.min.js .
rm -rf node_modules package.json package-lock.json
```

## Credits

- [wasm-bindgen-wry](https://github.com/DioxusLabs/wasm-bindgen-wry) by DioxusLabs — the core bridge between native Rust and webview JavaScript
- [Dioxus](https://github.com/DioxusLabs/dioxus) — the broader Rust UI ecosystem
- Inspired by the [discussion on React + Dioxus integration](https://github.com/DioxusLabs/dioxus/discussions/5392)
