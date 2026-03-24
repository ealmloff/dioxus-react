import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_CORE_ROOT = path.dirname(
  require.resolve("playwright-core/package.json")
);

export function requirePlaywrightInternal(relativePath: string): any {
  return require(path.join(PLAYWRIGHT_CORE_ROOT, relativePath));
}

const { wsServer } = requirePlaywrightInternal("lib/utilsBundle.js") as any;
const {
  Dispatcher,
  DispatcherConnection,
  RootDispatcher,
} = requirePlaywrightInternal("lib/server/dispatchers/dispatcher.js") as any;
const { parseSerializedValue, serializeValue } = requirePlaywrightInternal(
  "lib/protocol/serializers.js"
) as any;
const { SdkObject } = requirePlaywrightInternal(
  "lib/server/instrumentation.js"
) as any;
const { TargetClosedError, TimeoutError } = requirePlaywrightInternal(
  "lib/server/errors.js"
) as any;

export function serializeResult(value: unknown): unknown {
  return serializeValue(value, (fallThrough: unknown) => ({ fallThrough }));
}

export function deserializeBridgeValue(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  for (const key of [
    "ref",
    "n",
    "s",
    "b",
    "v",
    "d",
    "u",
    "bi",
    "e",
    "r",
    "ta",
    "a",
    "o",
    "h",
  ]) {
    if (key in value) {
      return parseSerializedValue(value, []);
    }
  }

  return value;
}

export {
  Dispatcher,
  DispatcherConnection,
  RootDispatcher,
  SdkObject,
  TargetClosedError,
  TimeoutError,
  wsServer,
};
