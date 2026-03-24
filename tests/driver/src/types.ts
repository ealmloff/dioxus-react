export interface HandleMeta {
  id: number;
  type: "element" | "js";
  preview: string;
  frameId: number;
}

export interface PropertyHandleEntry {
  name: string;
  handle: HandleMeta;
}

export interface Snapshot {
  url: string;
  title: string;
  viewportSize: {
    width: number;
    height: number;
  };
}

export interface FrameMeta {
  id: number;
  url: string;
  name: string;
  parentFrameId: number | null;
}

export type FrameInfo = FrameMeta;

export interface HandleReference {
  handleId: number;
}

export interface SerializedArgument {
  value: unknown;
  handles: HandleReference[];
}

export interface NameValue {
  name: string;
  value: string;
}

export interface SerializedErrorValue {
  error?: {
    message: string;
    stack?: string;
    name: string;
  };
  value?: unknown;
}

export interface ResourceTiming {
  startTime: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  secureConnectionStart: number;
  connectEnd: number;
  requestStart: number;
  responseStart: number;
}

export interface RequestSizes {
  requestBodySize: number;
  requestHeadersSize: number;
  responseBodySize: number;
  responseHeadersSize: number;
}

export interface NetworkRequestRecord {
  id: number;
  url: string;
  resourceType: string;
  method: string;
  postData?: Uint8Array;
  headers: NameValue[];
  isNavigationRequest: boolean;
}

export interface NetworkResponseRecord {
  url: string;
  status: number;
  statusText: string;
  headers: NameValue[];
  timing: ResourceTiming;
  fromServiceWorker: boolean;
  body: Uint8Array;
}

export interface RuntimeDialogRecord {
  id: number;
  type: string;
  message: string;
  defaultValue: string;
}

export interface RuntimeConsoleRecord {
  type: string;
  text: string;
  location: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
}

export type ControllerEvent =
  | { kind: "dialog"; dialog: RuntimeDialogRecord }
  | { kind: "console"; message: RuntimeConsoleRecord }
  | { kind: "pageerror"; error: SerializedErrorValue }
  | { kind: "filechooser"; fileChooser: { handle: HandleMeta; isMultiple: boolean } }
  | { kind: "request"; request: NetworkRequestRecord }
  | { kind: "response"; requestId: number; response: NetworkResponseRecord }
  | { kind: "requestFinished"; requestId: number; response?: NetworkResponseRecord; responseEndTiming: number }
  | { kind: "requestFailed"; requestId: number; failureText?: string; responseEndTiming: number }
  | { kind: "viewport"; viewportSize: Snapshot["viewportSize"] };
