use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use wry_launch::{LaunchBuilder, WebViewBuilder, WindowBuilder};

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read as _, Write};
use std::sync::{Arc, Condvar, Mutex};

// ---------------------------------------------------------------------------
// Native bridge — exported to JavaScript via wasm-bindgen as a proper class.
// The wry-bindgen runtime automatically places this on `window.NativeBridge`.
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub struct NativeBridge {}

#[wasm_bindgen]
impl NativeBridge {
    #[wasm_bindgen(constructor)]
    pub fn new() -> NativeBridge {
        NativeBridge {}
    }

    #[wasm_bindgen(js_name = "getSystemInfo")]
    pub fn get_system_info(&self) -> String {
        serde_json::json!({
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "family": std::env::consts::FAMILY,
            "exe": std::env::current_exe()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
            "cwd": std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
        })
        .to_string()
    }

    pub fn fibonacci(&self, n: f64) -> f64 {
        let n = n as u64;
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
        result as f64
    }

    #[wasm_bindgen(js_name = "readDir")]
    pub fn read_dir(&self, path: String) -> String {
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
                serde_json::json!({ "entries": items }).to_string()
            }
            Err(e) => serde_json::json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[wasm_bindgen(js_name = "readFile")]
    pub fn read_file(&self, path: String) -> String {
        match std::fs::read_to_string(&path) {
            Ok(content) => {
                let truncated = content.len() > 10_000;
                let display = if truncated {
                    &content[..10_000]
                } else {
                    &content
                };
                serde_json::json!({
                    "content": display,
                    "truncated": truncated,
                    "totalBytes": content.len(),
                })
                .to_string()
            }
            Err(e) => serde_json::json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[wasm_bindgen(js_name = "writeFile")]
    pub fn write_file(&self, path: String, content: String) -> String {
        match std::fs::write(&path, &content) {
            Ok(()) => serde_json::json!({ "ok": true }).to_string(),
            Err(e) => serde_json::json!({ "error": e.to_string() }).to_string(),
        }
    }

    #[wasm_bindgen(js_name = "getEnv")]
    pub fn get_env(&self, key: String) -> Option<String> {
        std::env::var(&key).ok()
    }
}

/// Shared state for the test automation bridge.
/// External tests send JS commands via TCP; the webview polls for them
/// via the "test" custom protocol, executes them, and posts results back.
struct TestBridge {
    /// Queue of JS strings waiting to be executed in the webview.
    commands: VecDeque<(u64, String)>,
    /// Completed results keyed by command id.
    results: HashMap<u64, String>,
}

fn main() -> wry_launch::wry::Result<()> {
    let test_port: Option<u16> = std::env::args()
        .position(|a| a == "--test-port")
        .and_then(|i| std::env::args().nth(i + 1))
        .and_then(|v| v.parse().ok());

    // Shared bridge state (only allocated when running in test mode).
    let bridge: Option<Arc<(Mutex<TestBridge>, Condvar)>> = test_port.map(|_| {
        Arc::new((
            Mutex::new(TestBridge {
                commands: VecDeque::new(),
                results: HashMap::new(),
            }),
            Condvar::new(),
        ))
    });

    // Start the TCP test server if --test-port is provided.
    if let (Some(port), Some(bridge)) = (test_port, bridge.clone()) {
        std::thread::spawn(move || run_test_server(port, bridge));
    }

    // Register a custom "asset" protocol that serves files from the assets
    // directory next to the binary. This lets the webview load scripts,
    // stylesheets, and other files via `asset://localhost/…` URLs without
    // any network access.
    let webview = WebViewBuilder::new()
        .with_devtools(true)
        .with_custom_protocol("asset".into(), move |_webview_id, request| {
            let uri_path = percent_decode(request.uri().path());
            // Serve assets from the `assets/` directory next to the binary.
            let base = std::env::current_exe()
                .expect("current_exe")
                .parent()
                .expect("exe parent")
                .to_path_buf();
            let relative = uri_path.strip_prefix('/').unwrap_or(&uri_path);
            let file_path = base.join(relative);
            match std::fs::read(&file_path) {
                Ok(bytes) => {
                    let mime = match file_path.extension().and_then(|e| e.to_str()) {
                        Some("js") => "text/javascript; charset=utf-8",
                        Some("css") => "text/css; charset=utf-8",
                        Some("html") => "text/html; charset=utf-8",
                        Some("json") => "application/json; charset=utf-8",
                        Some("svg") => "image/svg+xml; charset=utf-8",
                        Some("png") => "image/png",
                        Some("jpg" | "jpeg") => "image/jpeg",
                        Some("wasm") => "application/wasm",
                        _ => "application/octet-stream",
                    };
                    http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes.into())
                        .unwrap()
                }
                Err(e) => http::Response::builder()
                    .status(404)
                    .header("Content-Type", "text/plain")
                    .body(format!("Asset not found: {e}").into_bytes().into())
                    .unwrap(),
            }
        });

    // When running in test mode, start an HTTP server on a second port for the
    // webview polling bridge. We deliberately avoid custom protocols for this
    // because concurrent custom-protocol requests can corrupt wry-bindgen's
    // internal IPC buffer, causing "u32 buffer empty" panics.
    let http_bridge_port: Option<u16> = if let Some(ref bridge) = bridge {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .expect("bind ephemeral port for HTTP bridge");
        let port = listener.local_addr().unwrap().port();
        let bridge = bridge.clone();
        std::thread::spawn(move || run_http_bridge(listener, bridge));
        Some(port)
    } else {
        None
    };

    let mut builder = LaunchBuilder::new().webview(webview);
    if test_port.is_some() {
        builder = builder.window(WindowBuilder::new().with_visible(false));
    }
    builder.run(move || async move {
        setup_app(http_bridge_port);
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

fn read_http_request(stream: &mut std::net::TcpStream) -> Option<(String, String)> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break pos + 4;
        }
        if buffer.len() > 1024 * 1024 {
            return None;
        }
    };

    let headers = String::from_utf8_lossy(&buffer[..header_end]).into_owned();
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if !name.eq_ignore_ascii_case("content-length") {
                return None;
            }
            value.trim().parse::<usize>().ok()
        })
        .unwrap_or(0);

    while buffer.len() < header_end + content_length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..n]);
    }

    let body_end = (header_end + content_length).min(buffer.len());
    let body = String::from_utf8_lossy(&buffer[header_end..body_end]).into_owned();
    Some((headers, body))
}

/// Minimal HTTP/1.1 server for the webview polling bridge.
///
/// The webview polls `GET /poll?result=<prev_result>` to deliver results and
/// receive the next command. Responses are JSON `{"cmd":"..."}` or `{}`.
///
/// This avoids custom protocol requests that conflict with wry-bindgen's
/// internal `wry://` protocol and cause IPC buffer corruption.
fn run_http_bridge(listener: std::net::TcpListener, bridge: Arc<(Mutex<TestBridge>, Condvar)>) {
    let port = listener.local_addr().unwrap().port();
    eprintln!("[test-bridge] HTTP bridge listening on 127.0.0.1:{port}");
    let mut request_count = 0usize;

    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let bridge = bridge.clone();

        // Handle each request synchronously on the listener thread since the
        // webview only sends one request at a time.
        let Some((request, body)) = read_http_request(&mut stream) else {
            continue;
        };

        // Extract the path from "POST /poll HTTP/1.1" and accept the previous
        // eval result in either the request body or the legacy query string.
        let first_line = request.lines().next().unwrap_or("");
        let path = first_line.split_whitespace().nth(1).unwrap_or("/");
        request_count += 1;
        if request_count <= 5 {
            eprintln!("[test-bridge] HTTP poll #{request_count}: {path}");
        }

        if let Some(decoded) = if !body.is_empty() {
            Some(body)
        } else if let Some(idx) = path.find("?result=") {
            let encoded = &path[idx + 8..];
            Some(percent_decode(encoded))
        } else {
            None
        } {
            if request_count <= 5 || decoded.contains("__error") {
                eprintln!("[test-bridge] HTTP result #{request_count}: {decoded}");
            }
            if let Ok(posted) = serde_json::from_str::<serde_json::Value>(&decoded) {
                if let Some(id) = posted.get("id").and_then(|v| v.as_u64()) {
                    if let Some(result) = posted.get("result") {
                        let (lock, cvar) = &*bridge;
                        let mut state = lock.lock().unwrap();
                        state
                            .results
                            .insert(id, serde_json::to_string(result).unwrap_or_else(|_| "null".into()));
                        cvar.notify_all();
                    }
                }
            }
        }

        let (lock, _) = &*bridge;
        let mut state = lock.lock().unwrap();
        let body = match state.commands.pop_front() {
            Some((id, cmd)) => serde_json::json!({ "id": id, "cmd": cmd }).to_string(),
            None => "{}".to_string(),
        };
        drop(state);

        let response = format!(
            "HTTP/1.1 200 OK\r\n\
             Content-Type: application/json\r\n\
             Access-Control-Allow-Origin: *\r\n\
             Content-Length: {}\r\n\
             Connection: close\r\n\
             \r\n\
             {}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
    }
}

/// TCP server for the test bridge.
///
/// External test process (Node.js) connects via plain TCP and sends
/// newline-delimited JSON commands:
///   → {"eval": "<javascript>"}\n
///   ← {"result": "<json-encoded return value>"}\n
///
/// The server enqueues the JS into the shared bridge, waits for the
/// webview polling script to execute it and post the result, then returns it.
fn run_test_server(port: u16, bridge: Arc<(Mutex<TestBridge>, Condvar)>) {
    let listener = std::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .unwrap_or_else(|e| panic!("test server: failed to bind port {port}: {e}"));
    eprintln!("[test-bridge] listening on 127.0.0.1:{port}");

    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let bridge = bridge.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stream.try_clone().unwrap());
            let mut writer = stream;
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }
                let cmd: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(e) => {
                        let err = serde_json::json!({"error": e.to_string()}).to_string();
                        let _ = writeln!(writer, "{err}");
                        continue;
                    }
                };
                let id = cmd.get("id").and_then(|v| v.as_u64());
                if let (Some(id), Some(js)) = (id, cmd.get("eval").and_then(|v| v.as_str())) {
                    let (lock, cvar) = &*bridge;
                    {
                        let mut state = lock.lock().unwrap();
                        state.results.remove(&id);
                        state.commands.push_back((id, js.to_string()));
                    }
                    let result = {
                        let mut state = lock.lock().unwrap();
                        let timeout = std::time::Duration::from_secs(15);
                        let deadline = std::time::Instant::now() + timeout;
                        loop {
                            if let Some(r) = state.results.remove(&id) {
                                break r;
                            }
                            let remaining =
                                deadline.saturating_duration_since(std::time::Instant::now());
                            if remaining.is_zero() {
                                break serde_json::json!({"error": "timeout"}).to_string();
                            }
                            let (s, _) = cvar.wait_timeout(state, remaining).unwrap();
                            state = s;
                        }
                    };
                    let resp = serde_json::json!({ "id": id, "result": result }).to_string();
                    let _ = writeln!(writer, "{resp}");
                } else {
                    let err =
                        serde_json::json!({"id": id, "error": "expected {\"id\": n, \"eval\": \"...\"}"}).to_string();
                    let _ = writeln!(writer, "{err}");
                }
            }
        });
    }
}

fn setup_app(http_bridge_port: Option<u16>) {
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

    // The NativeBridge struct is exported as a JS class by wasm-bindgen-wry.
    // The React app creates an instance lazily with `window.NativeBridge.new()`.

    // Load React, ReactDOM, then the app — each via the asset protocol.
    // Scripts are chained through onload to guarantee execution order.
    // In test mode, install the logging/polling bridge before loading assets
    // so startup failures remain observable.
    let mut script = String::from(
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
"#,
    );

    if let Some(port) = http_bridge_port {
        let bridge_snippet = format!(
            r#"
  window.__testBridgeLogs = [];
  (function() {{
    var logs = window.__testBridgeLogs;
    function serialize(value) {{
      if (value && value.stack) {{
        return String(value.stack);
      }}
      if (typeof value === 'string') {{
        return value;
      }}
      try {{
        return JSON.stringify(value);
      }} catch (_) {{
        return String(value);
      }}
    }}

    function serializeBridgeValue(value, visitor) {{
      var state = visitor || {{
        lastId: 0,
        visited: new Map()
      }};

      if (typeof value === 'symbol' || typeof value === 'function') {{
        return {{ v: 'undefined' }};
      }}
      if (typeof value === 'undefined') {{
        return {{ v: 'undefined' }};
      }}
      if (value === null) {{
        return {{ v: 'null' }};
      }}
      if (Number.isNaN(value)) {{
        return {{ v: 'NaN' }};
      }}
      if (value === Infinity) {{
        return {{ v: 'Infinity' }};
      }}
      if (value === -Infinity) {{
        return {{ v: '-Infinity' }};
      }}
      if (Object.is(value, -0)) {{
        return {{ v: '-0' }};
      }}
      if (typeof value === 'boolean') {{
        return {{ b: value }};
      }}
      if (typeof value === 'number') {{
        return {{ n: value }};
      }}
      if (typeof value === 'string') {{
        return {{ s: value }};
      }}
      if (typeof value === 'bigint') {{
        return {{ bi: value.toString() }};
      }}
      if (value instanceof Date) {{
        return {{ d: value.toJSON() }};
      }}
      if (value instanceof URL) {{
        return {{ u: value.toJSON() }};
      }}
      if (value instanceof RegExp) {{
        return {{ r: {{ p: value.source, f: value.flags }} }};
      }}
      if (value instanceof Error) {{
        return {{
          e: {{
            n: value.name,
            m: value.message,
            s: value.stack || ''
          }}
        }};
      }}
      if (Array.isArray(value)) {{
        if (state.visited.has(value)) {{
          return {{ ref: state.visited.get(value) }};
        }}
        var arrayId = ++state.lastId;
        state.visited.set(value, arrayId);
        return {{
          a: value.map(function(entry) {{
            return serializeBridgeValue(entry, state);
          }}),
          id: arrayId
        }};
      }}
      if (value && typeof value === 'object') {{
        if (state.visited.has(value)) {{
          return {{ ref: state.visited.get(value) }};
        }}
        var objectId = ++state.lastId;
        state.visited.set(value, objectId);
        var entries = [];
        Object.keys(value).forEach(function(key) {{
          entries.push({{
            k: key,
            v: serializeBridgeValue(value[key], state)
          }});
        }});
        return {{
          o: entries,
          id: objectId
        }};
      }}
      return {{ s: String(value) }};
    }}

    function pushLog(type, argsLike) {{
      var parts = [];
      for (var i = 0; i < argsLike.length; i += 1) {{
        parts.push(serialize(argsLike[i]));
      }}
      logs.push({{
        type: type,
        message: parts.join(' '),
        timestamp: Date.now()
      }});
      if (logs.length > 200) {{
        logs.shift();
      }}
    }}

    ['log', 'warn', 'error'].forEach(function(type) {{
      var original = console[type];
      console[type] = function() {{
        pushLog(type, arguments);
        if (original) {{
          return original.apply(this, arguments);
        }}
      }};
    }});

    window.addEventListener('error', function(event) {{
      pushLog('error', [
        event.message || 'window error',
        event.error && event.error.stack ? event.error.stack : ''
      ]);
    }});

    window.addEventListener('unhandledrejection', function(event) {{
      var reason = event.reason;
      pushLog('error', [
        'unhandledrejection',
        reason && reason.stack ? reason.stack : serialize(reason)
      ]);
    }});

    console.log('[test-bridge] polling script starting on port {port}');
    var lastResult = null;
    function setBridgeResult(id, value) {{
      lastResult = JSON.stringify({{
        id: id,
        result: serializeBridgeValue(value)
      }});
      setTimeout(poll, 0);
    }}
    function setBridgeError(id, error) {{
      lastResult = JSON.stringify({{
        id: id,
        result: {{
          __error: error && error.message ? error.message : String(error),
          __stack: error && error.stack ? error.stack : ''
        }}
      }});
      setTimeout(poll, 0);
    }}
    function poll() {{
      var url = 'http://127.0.0.1:{port}/poll';
      var payload = lastResult !== null ? lastResult : '';
      lastResult = null;
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      xhr.onload = function() {{
        var data;
        try {{
          data = JSON.parse(xhr.responseText);
        }} catch(e) {{
          console.error('[test-bridge] parse failure', xhr.responseText, e);
          data = {{}};
        }}
        if (data.cmd) {{
          try {{
            Promise.resolve((0, eval)(data.cmd)).then(function(value) {{
              setBridgeResult(data.id, value);
            }}, function(error) {{
              setBridgeError(data.id, error);
            }});
          }} catch (e) {{
            setBridgeError(data.id, e);
          }}
        }} else {{
          setTimeout(poll, 30);
        }}
      }};
      xhr.onerror = function() {{ setTimeout(poll, 100); }};
      xhr.send(payload);
    }}
    poll();
  }})();
"#
        );
        script.push_str(&bridge_snippet);
    }

    script.push_str(
        r#"
  loadScript('asset://localhost/assets/vendor/react.production.min.js')
    .then(function() {
      return loadScript('asset://localhost/assets/vendor/react-dom.production.min.js');
    })
    .then(function() {
      return loadScript('asset://localhost/assets/app.js');
    })"#,
    );

    script.push_str(
        r#"
    .catch(function(err) {
      if (window.__testBridgeLogs) {
        window.__testBridgeLogs.push({
          type: 'error',
          message: 'bootstrap failure: ' + err.message,
          timestamp: Date.now()
        });
      }
      console.error('[bootstrap]', err);
      document.getElementById('root').textContent =
        'Failed to load app: ' + err.message;
    })
})();"#,
    );

    js_sys::eval(&script).unwrap();
}
