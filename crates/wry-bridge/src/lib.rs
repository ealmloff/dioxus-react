use wasm_bindgen::prelude::*;

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
        #[cfg(not(target_arch = "wasm32"))]
        {
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

        #[cfg(target_arch = "wasm32")]
        {
            serde_json::json!({
                "os": "wasm32-unknown-unknown",
                "arch": "wasm32",
                "family": "browser",
            })
            .to_string()
        }
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
        #[cfg(not(target_arch = "wasm32"))]
        {
            let mut entries: Vec<serde_json::Value> = std::fs::read_dir(&path)
                .ok()
                .into_iter()
                .flat_map(|entries| entries)
                .filter_map(|entry| entry.ok())
                .map(|entry| {
                    let meta = entry.metadata().ok();
                    serde_json::json!({
                        "name": entry.file_name().to_string_lossy(),
                        "isDir": meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                        "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    })
                })
                .collect();
            entries.sort_by(|a, b| {
                let a_dir = a["isDir"].as_bool().unwrap_or(false);
                let b_dir = b["isDir"].as_bool().unwrap_or(false);
                b_dir.cmp(&a_dir).then_with(|| {
                    a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
                })
            });
            serde_json::json!({ "entries": entries }).to_string()
        }

        #[cfg(target_arch = "wasm32")]
        {
            serde_json::json!({ "error": "readDir is not available in this target" }).to_string()
        }
    }

    #[wasm_bindgen(js_name = "readFile")]
    pub fn read_file(&self, path: String) -> String {
        #[cfg(not(target_arch = "wasm32"))]
        {
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

        #[cfg(target_arch = "wasm32")]
        {
            serde_json::json!({ "error": "readFile is not available in this target" }).to_string()
        }
    }

    #[wasm_bindgen(js_name = "writeFile")]
    pub fn write_file(&self, path: String, content: String) -> String {
        #[cfg(not(target_arch = "wasm32"))]
        {
            match std::fs::write(&path, &content) {
                Ok(()) => serde_json::json!({ "ok": true }).to_string(),
                Err(e) => serde_json::json!({ "error": e.to_string() }).to_string(),
            }
        }

        #[cfg(target_arch = "wasm32")]
        {
            serde_json::json!({ "error": "writeFile is not available in this target" }).to_string()
        }
    }

    #[wasm_bindgen(js_name = "getEnv")]
    pub fn get_env(&self, key: String) -> Option<String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            std::env::var(&key).ok()
        }

        #[cfg(target_arch = "wasm32")]
        {
            None
        }
    }
}
