import net from "node:net";

interface PendingEntry {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class TestBridge {
  readonly port: number;
  private socket: any = null;
  private buffer = "";
  private pending: PendingEntry[] = [];

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
        socket.on("data", (chunk: string) => this.onData(chunk));
        resolve();
      });
      socket.once("error", reject);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");

    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.trim() !== "") {
        const pending = this.pending.shift();
        if (pending) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.error) {
              pending.reject(new Error(parsed.error));
            } else {
              pending.resolve(parsed.result);
            }
          } catch {
            pending.reject(new Error(`bad response: ${line}`));
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

      this.pending.push({ resolve, reject });
      this.socket.write(JSON.stringify({ eval: js }) + "\n");
    });
  }

  async evalJson(js: string): Promise<unknown> {
    const raw = await this.eval(js);
    return JSON.parse(String(raw));
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
