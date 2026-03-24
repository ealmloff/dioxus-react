import * as net from "node:net";

interface PendingEntry {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface BridgeResponse {
  id?: number;
  error?: string;
  result?: unknown;
}

export class TestBridge {
  readonly port: number;
  private socket: net.Socket | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingEntry>();

  constructor(port: number) {
    this.port = port;
  }

  async connect(retries = 30, intervalMs = 200): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        await this.tryConnect();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    throw new Error(
      `TestBridge: failed to connect to 127.0.0.1:${this.port} after ${retries} retries`
    );
  }

  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: this.port });
      socket.once("connect", () => {
        this.socket = socket;
        socket.setEncoding("utf-8");
        socket.on("data", (chunk: unknown) => this.onData(String(chunk)));
        resolve();
      });
      socket.once("error", reject);
    });
  }

  private onData(chunk: string): void {
    if (process.env.DEBUG) {
      console.error(`[bridge] recv ${chunk.slice(0, 200)}`);
    }
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");

    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.trim() !== "") {
        try {
          const parsed = JSON.parse(line) as BridgeResponse;
          if (typeof parsed.id !== "number") {
            continue;
          }
          const pending = this.pending.get(parsed.id);
          if (!pending) {
            continue;
          }
          this.pending.delete(parsed.id);
          if (parsed.error) {
            pending.reject(new Error(parsed.error));
          } else {
            pending.resolve(parsed.result);
          }
        } catch {
          for (const [id, pending] of this.pending) {
            pending.reject(new Error(`bad response: ${line}`));
            this.pending.delete(id);
          }
        }
      }

      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  eval(js: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("not connected"));
        return;
      }

      if (process.env.DEBUG) {
        console.error(`[bridge] send ${js.slice(0, 200)}`);
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.socket.write(JSON.stringify({ id, eval: js }) + "\n");
    });
  }

  async evalJson(js: string): Promise<unknown> {
    const raw = await this.eval(js);
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  close(): void {
    for (const [id, pending] of this.pending) {
      pending.reject(new Error("bridge closed"));
      this.pending.delete(id);
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
