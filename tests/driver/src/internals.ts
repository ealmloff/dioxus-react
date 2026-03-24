import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_CORE_ROOT = path.dirname(require.resolve("playwright-core/package.json"));

type AnyRecord = Record<string, unknown>;
type UnknownConstructor = new (...args: unknown[]) => unknown;

export function requirePlaywrightInternal<T = AnyRecord>(relativePath: string): T {
  return require(path.join(PLAYWRIGHT_CORE_ROOT, relativePath)) as T;
}

export interface SdkObjectLike {
  guid: string;
  closeReason?: () => unknown;
}

type SdkObjectCtor = new (parent: unknown, guidPrefix?: string, guid?: string) => SdkObjectLike;

export interface DispatcherConnectionLike {
  onmessage?: (message?: unknown) => void;
  dispatch(message: unknown): Promise<unknown>;
  registerDispatcher(dispatcher: DispatcherLike): void;
}

type DispatcherConnectionCtor = new (isLocal?: boolean) => DispatcherConnectionLike;

export interface DispatcherLike {
  [key: string]: unknown;
  _object: unknown;
  _type?: string;
  connection: DispatcherConnectionLike;
  parentScope(): DispatcherLike | undefined;
  adopt(child: DispatcherLike): void;
  _dispatchEvent(method: string, params?: unknown): void;
  _dispose(reason?: unknown): void;
}

type DispatcherCtor = new (
  parent: DispatcherLike | DispatcherConnectionLike,
  object: object,
  type: string,
  initializer: AnyRecord,
  gcBucket?: unknown
) => DispatcherLike;

export interface RootDispatcherLike extends DispatcherLike {
  initialize(params?: AnyRecord): Promise<{ playwright: unknown }>;
  createPlaywright: ((scope: DispatcherLike, params?: unknown) => Promise<unknown>) | undefined;
}

type RootDispatcherCtor = new (
  connection: DispatcherConnectionLike,
  createPlaywright: (scope: DispatcherLike, params?: unknown) => Promise<unknown>
) => RootDispatcherLike;

type ParseSerializedValue = (value: unknown, ...rest: unknown[]) => unknown;
type SerializeValue = (value: unknown, ...rest: unknown[]) => unknown;
type ErrorCtor = new (message?: string) => Error;

export const { wsServer } = requirePlaywrightInternal<{ wsServer: UnknownConstructor }>(
  "lib/utilsBundle.js"
);

export const {
  Dispatcher,
  DispatcherConnection,
  RootDispatcher,
} = requirePlaywrightInternal<{
  Dispatcher: DispatcherCtor;
  DispatcherConnection: DispatcherConnectionCtor;
  RootDispatcher: RootDispatcherCtor;
}>("lib/server/dispatchers/dispatcher.js");

export const { parseSerializedValue, serializeValue } = requirePlaywrightInternal<{
  parseSerializedValue: ParseSerializedValue;
  serializeValue: SerializeValue;
}>("lib/protocol/serializers.js");

export const { SdkObject } = requirePlaywrightInternal<{ SdkObject: SdkObjectCtor }>(
  "lib/server/instrumentation.js"
);

export const { TargetClosedError, TimeoutError } = requirePlaywrightInternal<{
  TargetClosedError: ErrorCtor;
  TimeoutError: ErrorCtor;
}>("lib/server/errors.js");

export function serializeResult(value: unknown): unknown {
  return serializeValue(value, (fallThrough: unknown) => ({ fallThrough }));
}

export function serializeProtocolValue(value: unknown, handleSerializer: (value: unknown) => unknown): unknown {
  return serializeValue(value, handleSerializer);
}

export function deserializeBridgeValue(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const serialKeys = [
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
  ] as const;

  for (const key of serialKeys) {
    if (key in value) {
      return parseSerializedValue(value, []);
    }
  }

  return value;
}

