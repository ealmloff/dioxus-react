import type { TestBridge } from "../bridge";
import { deserializeBridgeValue } from "../internals";

export class RuntimeEvalError extends Error {
  constructor(message: string, stack?: string) {
    super(message);
    this.name = "RuntimeEvalError";
    if (stack) this.stack = stack;
  }
}

/** Node-side wrapper: bridge.eval(`window.__pwx.${method}(...)`) + unwrap. */
export class WryRuntime {
  constructor(private readonly bridge: TestBridge) {}

  async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    const js = `window.__pwx.${method}(${args.map((a) => JSON.stringify(a)).join(", ")})`;
    const raw = await this.bridge.eval(js);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && "__error" in parsed) {
      const r = parsed as { __error: unknown; __stack?: unknown };
      throw new RuntimeEvalError(String(r.__error), typeof r.__stack === "string" ? r.__stack : undefined);
    }
    return deserializeBridgeValue(parsed) as T;
  }
}
