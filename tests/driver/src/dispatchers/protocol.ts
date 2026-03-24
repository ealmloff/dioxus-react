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
