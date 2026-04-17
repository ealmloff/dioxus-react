import {
  ElementHandle,
  FrameExecutionContext,
  JSHandle,
  JavaScriptErrorInEvaluate,
  type JSHandleLike,
  parseEvaluationResultValue,
  parseUnserializableValue,
  sparseArrayToString,
} from "../internals";
import { RuntimeEvalError, WryRuntime } from "./runtime";

/**
 * Shape returned by __pwx runtime calls that produce a handle. Mirrors CDP's
 * Runtime.RemoteObject so that Playwright-core's createHandle logic fits without
 * reinterpretation.
 */
interface RemoteObject {
  type: string;
  subtype?: string;
  objectId?: string;
  preview?: string;
  description?: string;
  value?: unknown;
  unserializableValue?: string;
}

interface PropertyEntry {
  name: string;
  handle: RemoteObject;
}

interface CallFunctionArg {
  value?: unknown;
  objectId?: string;
}

/**
 * Playwright ExecutionContext delegate backed by the wry webview bridge.
 *
 * Implements the 5-method contract documented in
 * node_modules/playwright-core/lib/server/javascript.js:47 and modeled on
 * node_modules/playwright-core/lib/server/chromium/crExecutionContext.js.
 *
 * Once plugged into a Playwright ExecutionContext, every higher-level API
 * (evaluate, evaluateHandle, getProperties, $, $$, waitForSelector, locator
 * actions, expect matchers, selector engines, actionability) works for free.
 */
export class WryExecutionContextDelegate {
  constructor(private readonly runtime: WryRuntime) {}

  async rawEvaluateJSON(expression: string): Promise<unknown> {
    try {
      const remote = await this.runtime.call<RemoteObject>("rawEvaluateJSON", expression);
      return potentiallyUnserializableValue(remote);
    } catch (error) {
      throw rewriteError(error);
    }
  }

  async rawEvaluateHandle(context: unknown, expression: string): Promise<JSHandleLike> {
    try {
      const remote = await this.runtime.call<RemoteObject>("rawEvaluateHandle", expression);
      return createHandle(context, remote);
    } catch (error) {
      throw rewriteError(error);
    }
  }

  async evaluateWithArguments(
    expression: string,
    returnByValue: boolean,
    utilityScript: JSHandleLike,
    values: unknown[],
    handles: JSHandleLike[],
  ): Promise<unknown> {
    const utilityObjectId = utilityScript._objectId;
    if (!utilityObjectId) {
      throw new JavaScriptErrorInEvaluate("UtilityScript handle is missing an objectId");
    }
    const args: CallFunctionArg[] = [
      { objectId: utilityObjectId },
      ...values.map((value) => ({ value })),
      ...handles.map((handle) => {
        if (!handle._objectId) {
          throw new JavaScriptErrorInEvaluate("Handle argument is missing an objectId");
        }
        return { objectId: handle._objectId };
      }),
    ];

    try {
      const remote = await this.runtime.call<RemoteObject>("callFunctionOn", {
        functionDeclaration: expression,
        objectId: utilityObjectId,
        arguments: args,
        returnByValue,
        awaitPromise: true,
      });

      if (returnByValue) {
        return parseEvaluationResultValue(remote.value);
      }
      return createHandle(utilityScript._context, remote);
    } catch (error) {
      throw rewriteError(error);
    }
  }

  async getProperties(object: JSHandleLike): Promise<Map<string, JSHandleLike>> {
    if (!object._objectId) return new Map();
    const properties = await this.runtime.call<PropertyEntry[]>("getProperties", object._objectId);
    const result = new Map<string, JSHandleLike>();
    for (const entry of properties) {
      result.set(entry.name, createHandle(object._context, entry.handle));
    }
    return result;
  }

  async releaseHandle(handle: JSHandleLike): Promise<void> {
    if (!handle._objectId) return;
    await this.runtime.call("releaseHandle", handle._objectId).catch(() => {
      // Matches crExecutionContext: release best-effort.
    });
  }
}

function createHandle(context: unknown, remote: RemoteObject): JSHandleLike {
  if (remote.subtype === "node") {
    if (!(context instanceof (FrameExecutionContext as unknown as { new (...args: unknown[]): unknown }))) {
      throw new JavaScriptErrorInEvaluate(
        "Node handles require a FrameExecutionContext",
      );
    }
    if (!remote.objectId) {
      throw new JavaScriptErrorInEvaluate("Node handle is missing an objectId");
    }
    return new ElementHandle(context, remote.objectId);
  }

  return new JSHandle(
    context,
    remote.subtype || remote.type,
    renderPreview(remote),
    remote.objectId,
    potentiallyUnserializableValue(remote),
  );
}

function potentiallyUnserializableValue(remote: RemoteObject): unknown {
  if (remote.unserializableValue !== undefined) {
    return parseUnserializableValue(remote.unserializableValue);
  }
  return remote.value;
}

function renderPreview(remote: RemoteObject): string {
  if (remote.type === "undefined") return "undefined";
  if ("value" in remote && remote.value !== undefined) return String(remote.value);
  if (remote.unserializableValue) return String(remote.unserializableValue);
  if (remote.preview) return remote.preview;
  if (remote.description) return remote.description;
  if (remote.subtype === "array") {
    return sparseArrayToString([]);
  }
  return remote.type;
}

function rewriteError(error: unknown): Error {
  if (error instanceof RuntimeEvalError) {
    const wrapped = new JavaScriptErrorInEvaluate(error.message);
    if (error.stack) wrapped.stack = error.stack;
    return wrapped;
  }
  if (error instanceof Error) return error;
  return new JavaScriptErrorInEvaluate(String(error));
}
