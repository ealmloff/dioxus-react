import path from "node:path";
import { createRequire } from "node:module";

/* eslint-disable @typescript-eslint/no-explicit-any */

const require = createRequire(import.meta.url);
const ROOT = path.dirname(require.resolve("playwright-core/package.json"));

function load(relPath: string): any {
  return require(path.join(ROOT, relPath));
}

export const { wsServer } = load("lib/utilsBundle.js");
export const { Dispatcher, DispatcherConnection, RootDispatcher } = load("lib/server/dispatchers/dispatcher.js");
export const { parseSerializedValue, serializeValue } = load("lib/protocol/serializers.js");
export const { SdkObject, createRootSdkObject } = load("lib/server/instrumentation.js");
export const { TargetClosedError, TimeoutError } = load("lib/server/errors.js");

export const {
  JSHandle,
  JavaScriptErrorInEvaluate,
  parseUnserializableValue,
  sparseArrayToString,
} = load("lib/server/javascript.js");

export const { ElementHandle, FrameExecutionContext } = load("lib/server/dom.js");

export const { parseEvaluationResultValue } = load("lib/utils/isomorphic/utilityScriptSerializers.js");

export const { Browser } = load("lib/server/browser.js");
export const { BrowserContext } = load("lib/server/browserContext.js");
export const { Page } = load("lib/server/page.js");
export const { Playwright } = load("lib/server/playwright.js");

export const { PlaywrightDispatcher } = load("lib/server/dispatchers/playwrightDispatcher.js");
export const { BrowserDispatcher } = load("lib/server/dispatchers/browserDispatcher.js");

export function deserializeBridgeValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const keys = ["ref", "n", "s", "b", "v", "d", "u", "bi", "e", "r", "ta", "a", "o", "h"];
  for (const key of keys) if (key in value) return parseSerializedValue(value as any, []);
  return value;
}
