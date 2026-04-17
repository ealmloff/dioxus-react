import type { TestBridge } from "../bridge";
import { deserializeBridgeValue } from "../internals";

interface BridgeErrorShape {
  __error?: unknown;
  __stack?: unknown;
}

function asBridgeError(value: unknown): BridgeErrorShape | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.__error !== "string") return null;
  return record as BridgeErrorShape;
}

export class RuntimeEvalError extends Error {
  constructor(message: string, stack?: string) {
    super(message);
    this.name = "RuntimeEvalError";
    if (stack) this.stack = stack;
  }
}

/**
 * Thin wrapper around TestBridge that issues calls to window.__pwx.<method>(...)
 * inside the webview and returns the deserialized result.
 *
 * Wire: bridge.eval(js) -> runtime runs js -> serializeBridgeValue wraps result
 * -> node side JSON.parse + parseSerializedValue unwraps back to the JS value.
 */
export class WryRuntime {
  constructor(private readonly bridge: TestBridge) {}

  async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    const encodedArgs = args.map((arg) => JSON.stringify(arg)).join(", ");
    const expression = `window.__pwx.${method}(${encodedArgs})`;
    const raw = await this.bridge.eval(expression);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

    const bridgeError = asBridgeError(parsed);
    if (bridgeError) {
      throw new RuntimeEvalError(
        String(bridgeError.__error),
        typeof bridgeError.__stack === "string" ? bridgeError.__stack : undefined,
      );
    }

    return deserializeBridgeValue(parsed) as T;
  }
}
