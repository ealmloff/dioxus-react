use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wry_launch::{LaunchBuilder, WebViewBuilder};

fn main() -> wry::Result<()> {
    // Register a custom "asset" protocol that serves files from the asset
    // directory using dioxus-asset-resolver.  This lets the webview load
    // scripts, stylesheets, and other files via `asset://localhost/…` URLs
    // without any network access.
    let webview = WebViewBuilder::new()
        .with_devtools(true)
        .with_custom_protocol("asset".into(), move |_webview_id, request| {
            let path = percent_decode(request.uri().path());
            match dioxus_asset_resolver::native::serve_asset(&path) {
                Ok(r) => r.map(Into::into),
                Err(e) => http::Response::builder()
                    .status(404)
                    .header("Content-Type", "text/plain")
                    .body(format!("Asset not found: {e}").into_bytes().into())
                    .unwrap(),
            }
        });

    LaunchBuilder::new()
        .webview(webview)
        .run(|| async {
            setup_app();
            std::future::pending::<()>().await
        })
}

fn percent_decode(path: &str) -> String {
    let mut result = String::with_capacity(path.len());
    let mut chars = path.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let hi = chars.next().and_then(|c| hex_val(c));
            let lo = chars.next().and_then(|c| hex_val(c));
            if let (Some(h), Some(l)) = (hi, lo) {
                result.push((h << 4 | l) as char);
            }
        } else {
            result.push(b as char);
        }
    }
    result
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn setup_app() {
    let window = web_sys::window().expect("should have a window");
    let document = window.document().expect("window should have a document");
    let head = document.head().expect("document should have a head");
    let body = document.body().expect("document should have a body");

    // Add stylesheet via the asset protocol
    let link = document
        .create_element("link")
        .unwrap()
        .dyn_into::<web_sys::HtmlLinkElement>()
        .unwrap();
    link.set_rel("stylesheet");
    link.set_href("asset://localhost/assets/style.css");
    head.append_child(&link).unwrap();

    // Create the React mount point
    body.set_inner_html(r#"<div id="root">Loading…</div>"#);

    // Register native Rust functions on window.__native
    register_native_functions(&window);

    // Load React, ReactDOM, then the app — each via the asset protocol.
    // Scripts are chained through onload to guarantee execution order.
    js_sys::eval(
        r#"(function() {
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  loadScript('asset://localhost/assets/vendor/react.production.min.js')
    .then(function() {
      return loadScript('asset://localhost/assets/vendor/react-dom.production.min.js');
    })
    .then(function() {
      return loadScript('asset://localhost/assets/app.js');
    })
    .catch(function(err) {
      document.getElementById('root').textContent =
        'Failed to load app: ' + err.message;
    });
})();"#,
    )
    .unwrap();
}

/// Expose native Rust functions to JavaScript via `window.__native`.
///
/// React components call these functions to access native capabilities
/// (filesystem, system info, computation) unavailable in a browser sandbox.
fn register_native_functions(window: &web_sys::Window) {
    let native = js_sys::Object::new();

    // -- System info ----------------------------------------------------------
    let get_system_info = Closure::wrap(Box::new(|| -> JsValue {
        let info = serde_json::json!({
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "family": std::env::consts::FAMILY,
            "exe": std::env::current_exe()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
            "cwd": std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
        });
        JsValue::from_str(&info.to_string())
    }) as Box<dyn Fn() -> JsValue>);
    js_sys::Reflect::set(&native, &"getSystemInfo".into(), get_system_info.as_ref()).unwrap();
    get_system_info.forget();

    // -- Fibonacci (native speed) ---------------------------------------------
    let fibonacci = Closure::wrap(Box::new(|n: JsValue| -> JsValue {
        let n = n.as_f64().unwrap_or(0.0) as u64;
        let result = if n <= 1 {
            n
        } else {
            let (mut a, mut b) = (0u64, 1u64);
            for _ in 2..=n {
                let c = a.wrapping_add(b);
                a = b;
                b = c;
            }
            b
        };
        JsValue::from_f64(result as f64)
    }) as Box<dyn Fn(JsValue) -> JsValue>);
    js_sys::Reflect::set(&native, &"fibonacci".into(), fibonacci.as_ref()).unwrap();
    fibonacci.forget();

    // -- Read directory -------------------------------------------------------
    let read_dir = Closure::wrap(Box::new(|path: JsValue| -> JsValue {
        let path = path.as_string().unwrap_or_else(|| ".".to_string());
        match std::fs::read_dir(&path) {
            Ok(entries) => {
                let mut items: Vec<serde_json::Value> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| {
                        let meta = e.metadata().ok();
                        serde_json::json!({
                            "name": e.file_name().to_string_lossy(),
                            "isDir": meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                            "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
                        })
                    })
                    .collect();
                items.sort_by(|a, b| {
                    let a_dir = a["isDir"].as_bool().unwrap_or(false);
                    let b_dir = b["isDir"].as_bool().unwrap_or(false);
                    b_dir.cmp(&a_dir).then_with(|| {
                        a["name"]
                            .as_str()
                            .unwrap_or("")
                            .cmp(b["name"].as_str().unwrap_or(""))
                    })
                });
                JsValue::from_str(&serde_json::json!({ "entries": items }).to_string())
            }
            Err(e) => JsValue::from_str(
                &serde_json::json!({ "error": e.to_string() }).to_string(),
            ),
        }
    }) as Box<dyn Fn(JsValue) -> JsValue>);
    js_sys::Reflect::set(&native, &"readDir".into(), read_dir.as_ref()).unwrap();
    read_dir.forget();

    // -- Read file ------------------------------------------------------------
    let read_file = Closure::wrap(Box::new(|path: JsValue| -> JsValue {
        let path = path.as_string().unwrap_or_default();
        match std::fs::read_to_string(&path) {
            Ok(content) => {
                let truncated = content.len() > 10_000;
                let display = if truncated {
                    &content[..10_000]
                } else {
                    &content
                };
                JsValue::from_str(
                    &serde_json::json!({
                        "content": display,
                        "truncated": truncated,
                        "totalBytes": content.len(),
                    })
                    .to_string(),
                )
            }
            Err(e) => JsValue::from_str(
                &serde_json::json!({ "error": e.to_string() }).to_string(),
            ),
        }
    }) as Box<dyn Fn(JsValue) -> JsValue>);
    js_sys::Reflect::set(&native, &"readFile".into(), read_file.as_ref()).unwrap();
    read_file.forget();

    // -- Write file -----------------------------------------------------------
    let write_file = Closure::wrap(Box::new(|path: JsValue, content: JsValue| -> JsValue {
        let path = path.as_string().unwrap_or_default();
        let content = content.as_string().unwrap_or_default();
        match std::fs::write(&path, &content) {
            Ok(()) => JsValue::from_str(&serde_json::json!({ "ok": true }).to_string()),
            Err(e) => JsValue::from_str(
                &serde_json::json!({ "error": e.to_string() }).to_string(),
            ),
        }
    }) as Box<dyn Fn(JsValue, JsValue) -> JsValue>);
    js_sys::Reflect::set(&native, &"writeFile".into(), write_file.as_ref()).unwrap();
    write_file.forget();

    // -- Env vars -------------------------------------------------------------
    let get_env = Closure::wrap(Box::new(|key: JsValue| -> JsValue {
        let key = key.as_string().unwrap_or_default();
        match std::env::var(&key) {
            Ok(val) => JsValue::from_str(&val),
            Err(_) => JsValue::NULL,
        }
    }) as Box<dyn Fn(JsValue) -> JsValue>);
    js_sys::Reflect::set(&native, &"getEnv".into(), get_env.as_ref()).unwrap();
    get_env.forget();

    // Attach __native to window
    js_sys::Reflect::set(window, &"__native".into(), &native).unwrap();
}
