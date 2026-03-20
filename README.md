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
│  │  React 18 (served via protocol)  │   │
│  │         ↕ calls                  │   │
│  │  window.__native.*()             │   │
│  │         ↕ wasm-bindgen-wry IPC   │   │
│  └──────────────────────────────────┘   │
│                                         │
│  Custom "asset://" wry protocol         │
│  served by dioxus-asset-resolver        │
│                                         │
│  Native Rust functions:                 │
│  • File system access (read/write)      │
│  • System info                          │
│  • Native-speed computation             │
│  • Environment variables                │
└─────────────────────────────────────────┘
```

Assets (React, the app JS, CSS) are served through a custom wry protocol handler backed by [`dioxus-asset-resolver`](https://docs.rs/dioxus-asset-resolver). This means:

- **Fully offline** — no CDN or network access needed
- **Proper MIME types** — scripts and stylesheets load with correct content types
- **Standard web loading** — `<script src="asset://localhost/...">` and `<link href="asset://localhost/...">`

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

The `build.rs` copies assets next to the output binary so `dioxus-asset-resolver` can find them at runtime.

## Project structure

```
├── Cargo.toml          # Dependencies on wry-launch, dioxus-asset-resolver, patches
├── build.rs            # Copies assets/ to the target directory at build time
├── src/
│   └── main.rs         # Rust entry point: custom wry protocol + native function bindings
└── assets/
    ├── app.js          # React application (pure JS, no build step needed)
    ├── style.css       # Application styles
    └── vendor/         # Vendored React 18 production builds
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

## Adding assets

Place files in the `assets/` directory. They're automatically served via the custom
`asset://` protocol at `asset://localhost/assets/<path>`.

```html
<!-- In your JS code -->
<link rel="stylesheet" href="asset://localhost/assets/my-styles.css">
<script src="asset://localhost/assets/my-script.js"></script>
<img src="asset://localhost/assets/logo.png">
```

## Using a bundled React app (Vite/Bun)

For larger apps, use a proper bundler:

1. Create a frontend project with Vite, Bun, or your preferred tool
2. Build to `assets/dist/`
3. Reference the bundle as `asset://localhost/assets/dist/app.js`

## Updating vendored React

```bash
cd assets/vendor
npm init -y && npm install react@18 react-dom@18
cp node_modules/react/umd/react.production.min.js .
cp node_modules/react-dom/umd/react-dom.production.min.js .
rm -rf node_modules package.json package-lock.json
```

## Credits

- [wasm-bindgen-wry](https://github.com/DioxusLabs/wasm-bindgen-wry) by DioxusLabs
- [dioxus-asset-resolver](https://docs.rs/dioxus-asset-resolver) for asset serving
- [Dioxus](https://github.com/DioxusLabs/dioxus)
- Inspired by [DioxusLabs/dioxus#5392](https://github.com/DioxusLabs/dioxus/discussions/5392)
