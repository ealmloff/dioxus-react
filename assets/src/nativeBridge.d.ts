// Auto-generated from src/native_bridge.rs via wasm-bindgen.
export type { NativeBridge } from "./nativeBridge.generated";

declare global {
  interface Window {
    NativeBridge: {
      new(): import("./nativeBridge.generated").NativeBridge;
    };
  }
}

export {};
