import type { SerializedArgument } from "../types";

export interface EvalParams {
  expression: string;
  isFunction: boolean;
  arg: SerializedArgument;
}

export interface SelectorParams {
  selector: string;
}

export interface SelectorParamsWithStrict extends SelectorParams {
  strict?: boolean;
}

export interface WaitSelectorParams extends SelectorParamsWithStrict {
  state?: string;
  timeout?: number;
}

export interface SelectorEvalParams extends SelectorParamsWithStrict {
  expression: string;
  isFunction: boolean;
  arg: SerializedArgument;
}

export interface NameParams {
  name: string;
}

export interface GetAttributeParams {
  name: string;
}

export interface FillParams extends SelectorParamsWithStrict {
  value: string;
}

export interface TypeParams extends SelectorParamsWithStrict {
  text: string;
}

export interface PressParams extends SelectorParamsWithStrict {
  key: string;
}

export interface CheckParams extends SelectorParamsWithStrict {
  trial?: boolean;
}

export interface SelectOptionParams extends SelectorParamsWithStrict {
  options?: unknown[];
  elements?: Array<{ handleId: number }>;
}

export interface SetInputFilesParams extends SelectorParamsWithStrict {
  payloads?: Array<{
    name: string;
    mimeType?: string;
    buffer: Uint8Array;
  }>;
}

export interface TimeoutParams {
  timeout?: number;
}

export interface WaitForTimeoutParams {
  waitTimeout: number;
}

export interface WaitForFunctionParams {
  expression: string;
  isFunction: boolean;
  arg: SerializedArgument;
  timeout?: number;
  pollingInterval?: number;
}

export interface DispatchEventParams {
  type: string;
  eventInit: SerializedArgument;
}

export interface DispatchPageEventParams extends SelectorParamsWithStrict, DispatchEventParams {}

export interface TestIdAttributeNameParams {
  testIdAttributeName: string;
}

export interface ContentParams {
  html: string;
}

export interface GotoParams {
  url: string;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface SetViewportSizeParams {
  viewportSize: ViewportSize;
}

export interface GrantPermissionsParams {
  permissions: string[];
  origin?: string;
}

export interface Geolocation {
  latitude: number;
  longitude: number;
}

export interface SetGeolocationParams {
  geolocation?: Geolocation;
}

export interface DragAndDropParams extends SelectorParamsWithStrict {
  source: string;
  target: string;
}

export interface ScreenshotParams {
  type?: "png" | "jpeg";
  quality?: number;
  fullPage?: boolean;
  omitBackground?: boolean;
  animations?: "disabled" | "allow";
  caret?: "hide" | "initial";
  scale?: "css" | "device";
  timeout?: number;
}

export interface ResolveParams {
  selector: string;
}

export interface QueryCountParams {
  selector: string;
}

export interface HighlightParams {
  selector: string;
}

export interface ExpectParams {
  [key: string]: unknown;
}
