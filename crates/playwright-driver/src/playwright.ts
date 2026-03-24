import { requirePlaywrightInternal } from "./internals";

export interface PlaywrightSelectorsInstance {
  parseSelector(selector: string, strict?: boolean): unknown;
  setTestIdAttributeName(testIdAttributeName: string): void;
  testIdAttributeName(): string;
}

export type PlaywrightSelectorsCtor = new (
  engines: unknown[],
  testIdAttributeName?: string
) => PlaywrightSelectorsInstance;

export interface PlaywrightFrameSelectorsInstance {
  query(selector: string, options?: unknown, scope?: unknown): Promise<unknown>;
  queryAll(selector: string, scope?: unknown): Promise<unknown[]>;
  queryArrayInMainWorld(selector: string, scope?: unknown): Promise<unknown>;
  queryCount(selector: string, options?: unknown): Promise<number>;
  resolveInjectedForSelector(
    selector: string,
    options?: unknown,
    scope?: unknown
  ): Promise<
    {
    frame: { _context(world: "main" | "utility"): Promise<{ injectedScript: () => Promise<unknown> }> };
    info: {
      parsed: unknown;
      world: "main" | "utility";
      [key: string]: unknown;
    };
    injected: {
      evaluate<T = unknown>(
        pageFunction: unknown,
        arg: unknown
      ): Promise<T>;
      evaluateHandle<T = unknown>(
        pageFunction: unknown,
        arg: unknown
      ): Promise<T>;
    };
    scope?: unknown;
  } | undefined
  >;
  resolveFrameForSelector(
    selector: string,
    options?: unknown,
    scope?: unknown
  ): Promise<unknown>;
}

export type PlaywrightFrameSelectorsCtor = new (frame: unknown) => PlaywrightFrameSelectorsInstance;

export const { Selectors } = requirePlaywrightInternal("lib/server/selectors.js") as {
  Selectors: PlaywrightSelectorsCtor;
};
export const { FrameSelectors } = requirePlaywrightInternal("lib/server/frameSelectors.js") as {
  FrameSelectors: PlaywrightFrameSelectorsCtor;
};
