import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HELPER_MANIFEST = path.join(ROOT, "scripts", "bridge-types", "Cargo.toml");
const HELPER_WASM_BASENAME = "dioxus_react_bridge_types";
const HELPER_WASM = path.join(
  ROOT,
  "scripts",
  "bridge-types",
  "target",
  "wasm32-unknown-unknown",
  "release",
  `${HELPER_WASM_BASENAME}.wasm`
);
const TEMP_BINDGEN_OUT = path.join(ROOT, "target", "bridge-types-bindings");
const RAW_DECL = path.join(TEMP_BINDGEN_OUT, "native_bridge.d.ts");
const GEN_DECL = path.join(ROOT, "assets", "src", "nativeBridge.generated.d.ts");
const PUBLIC_DECL = path.join(ROOT, "assets", "src", "nativeBridge.d.ts");

function run(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`command failed: ${command} ${args.join(" ")}`);
  }
}

run("cargo", [
  "build",
  "--manifest-path",
  HELPER_MANIFEST,
  "--release",
  "--target",
  "wasm32-unknown-unknown",
]);

const wasmBindgen = process.env.WASM_BINDGEN || "wasm-bindgen";
run(wasmBindgen, [
  HELPER_WASM,
  "--typescript",
  "--out-dir",
  TEMP_BINDGEN_OUT,
  "--out-name",
  "native_bridge",
]);

if (!fs.existsSync(RAW_DECL)) {
  throw new Error(`wasm-bindgen did not emit ${RAW_DECL}`);
}

fs.copyFileSync(RAW_DECL, GEN_DECL);

const out = `// Auto-generated from src/native_bridge.rs via wasm-bindgen.
export type { NativeBridge } from "./nativeBridge.generated";

declare global {
  interface Window {
    NativeBridge: {
      new(): import("./nativeBridge.generated").NativeBridge;
    };
  }
}

export {};
`;

fs.writeFileSync(PUBLIC_DECL, out);
console.log(`Generated ${PUBLIC_DECL} from ${GEN_DECL}`);
