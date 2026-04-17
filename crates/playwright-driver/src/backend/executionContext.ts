import {
  ElementHandle,
  FrameExecutionContext,
  JSHandle,
  JavaScriptErrorInEvaluate,
  parseEvaluationResultValue,
  parseUnserializableValue,
} from "../internals";
import { RuntimeEvalError, WryRuntime } from "./runtime";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Playwright ExecutionContext delegate backed by the wry eval bridge.
 * Mirrors node_modules/playwright-core/lib/server/chromium/crExecutionContext.js.
 * Once this is plugged in, every Playwright evaluate/query/locator/action
 * path runs for free.
 */
export class WryExecutionContextDelegate {
  constructor(private readonly runtime: WryRuntime) {}

  async rawEvaluateJSON(expression: string): Promise<unknown> {
    return unwrap(await this.call("rawEvaluateJSON", expression));
  }

  async rawEvaluateHandle(context: unknown, expression: string): Promise<any> {
    return toHandle(context, await this.call("rawEvaluateHandle", expression));
  }

  async evaluateWithArguments(
    expression: string,
    returnByValue: boolean,
    utilityScript: any,
    values: unknown[],
    handles: any[],
  ): Promise<unknown> {
    const objectId = utilityScript._objectId;
    if (!objectId) throw new JavaScriptErrorInEvaluate("UtilityScript handle is missing an objectId");
    const remote = await this.call("callFunctionOn", {
      functionDeclaration: expression,
      objectId,
      arguments: [
        { objectId },
        ...values.map((value) => ({ value })),
        ...handles.map((h) => ({ objectId: h._objectId })),
      ],
      returnByValue,
      awaitPromise: true,
    });
    return returnByValue ? parseEvaluationResultValue(remote.value) : toHandle(utilityScript._context, remote);
  }

  async getProperties(object: any): Promise<Map<string, any>> {
    if (!object._objectId) return new Map();
    const properties = await this.call<Array<{ name: string; handle: any }>>("getProperties", object._objectId);
    const result = new Map<string, any>();
    for (const { name, handle } of properties) result.set(name, toHandle(object._context, handle));
    return result;
  }

  async releaseHandle(handle: any): Promise<void> {
    if (!handle._objectId) return;
    await this.call("releaseHandle", handle._objectId).catch(() => {});
  }

  private async call<T = any>(method: string, ...args: unknown[]): Promise<T> {
    try {
      return await this.runtime.call<T>(method, ...args);
    } catch (error) {
      if (error instanceof RuntimeEvalError) {
        const err = new JavaScriptErrorInEvaluate(error.message);
        if (error.stack) err.stack = error.stack;
        throw err;
      }
      throw error;
    }
  }
}

function toHandle(context: unknown, remote: any): any {
  if (remote.subtype === "node") {
    if (!(context instanceof (FrameExecutionContext as any))) {
      throw new JavaScriptErrorInEvaluate("Node handles require a FrameExecutionContext");
    }
    return new (ElementHandle as any)(context, remote.objectId);
  }
  return new (JSHandle as any)(
    context,
    remote.subtype || remote.type,
    renderPreview(remote),
    remote.objectId,
    unwrap(remote),
  );
}

function unwrap(remote: any): unknown {
  if (remote.unserializableValue !== undefined) return parseUnserializableValue(remote.unserializableValue);
  return remote.value;
}

function renderPreview(remote: any): string {
  if (remote.type === "undefined") return "undefined";
  if (remote.value !== undefined) return String(remote.value);
  if (remote.unserializableValue) return String(remote.unserializableValue);
  return remote.preview || remote.description || remote.type;
}
