declare module "node:child_process" {
  interface ReadableLike {
    setEncoding(encoding: string): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export interface ChildProcess {
    kill(signal?: string): boolean;
    once(event: string, listener: (...args: unknown[]) => void): this;
    stdout?: ReadableLike;
    stderr?: ReadableLike;
  }

  export function spawn(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      stdio?: string | string[];
    }
  ): ChildProcess;
}

declare module "node:module" {
  export interface RequireFn {
    (id: string): unknown;
    resolve(id: string): string;
  }

  export function createRequire(url: string): RequireFn;
}

declare module "node:net" {
  export interface Socket {
    once(event: string, listener: (...args: unknown[]) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    setEncoding(encoding: string): void;
    write(chunk: string): void;
    destroy(): void;
  }

  export function createConnection(options: {
    host: string;
    port: number;
  }): Socket;

  const net: {
    createConnection: typeof createConnection;
  };

  export default net;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;

  const path: {
    dirname: typeof dirname;
    join: typeof join;
    resolve: typeof resolve;
  };

  export default path;
}

declare module "node:timers/promises" {
  export function setTimeout<T = void>(delay: number, value?: T): Promise<T>;
}

declare const process: {
  env: Record<string, string | undefined>;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
};

interface ImportMeta {
  url: string;
  dirname: string;
}

declare module "virtual:driver-runtime-bootstrap" {
  const source: string;
  export default source;
}

declare module "virtual:driver-playwright-injected-source" {
  const source: string;
  export default source;
}
