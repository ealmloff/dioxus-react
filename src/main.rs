use wasm_bindgen::prelude::*;

fn main() -> wry::Result<()> {
    wry_launch::run(|| async {
        setup_app();
        std::future::pending::<()>().await
    })
}

fn setup_app() {
    let window = web_sys::window().expect("should have a window");
    let document = window.document().expect("window should have a document");
    let head = document.head().expect("document should have a head");
    let body = document.body().expect("document should have a body");

    // Inject styles
    let style = document.create_element("style").unwrap();
    style.set_text_content(Some(include_str!("../ui/style.css")));
    head.append_child(&style).unwrap();

    // Create the React mount point
    body.set_inner_html(r#"<div id="root"></div>"#);

    // Register native Rust functions on window.__native
    register_native_functions(&window);

    // Load vendored React and ReactDOM (embedded at compile time — no network needed)
    js_sys::eval(include_str!("../ui/vendor/react.production.min.js")).unwrap();
    js_sys::eval(include_str!("../ui/vendor/react-dom.production.min.js")).unwrap();

    // Load the React application
    js_sys::eval(include_str!("../ui/app.js")).unwrap();
}

/// Expose native Rust functions to JavaScript via `window.__native`.
///
/// This is the key integration point: React components call these functions
/// to access native capabilities (filesystem, system info, heavy computation)
/// that aren't available in a browser sandbox.
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
        let result = {
            if n <= 1 {
                n
            } else {
                let (mut a, mut b) = (0u64, 1u64);
                for _ in 2..=n {
                    let c = a.wrapping_add(b);
                    a = b;
                    b = c;
                }
                b
            }
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
                // Truncate large files for display
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
