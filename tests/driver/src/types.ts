export interface HandleMeta {
  id: number;
  type: "element" | "js";
  preview: string;
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

export interface HandleReference {
  handleId: number;
}

export interface SerializedArgument {
  value: unknown;
  handles: HandleReference[];
}
