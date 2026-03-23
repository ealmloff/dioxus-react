import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const BIN = path.join(ROOT, "target", "debug", "dioxus-react");
export const DEFAULT_PROXY_PORT = 0;
export const RUNTIME_VERSION = 2;

export function randomPort(): number {
  return 10_000 + Math.floor(Math.random() * 40_000);
}
