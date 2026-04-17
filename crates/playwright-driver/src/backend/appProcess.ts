import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { BIN, ROOT } from "../constants";
import { TestBridge } from "../bridge";
import { deserializeBridgeValue } from "../internals";
import { RUNTIME_BOOTSTRAP } from "../runtime";

/**
 * Owns the lifetime of a single wry app process plus its TCP bridge.
 * Extracted from the old controller.ts so the backend wiring can stay
 * focused on Playwright plumbing.
 */
export class AppProcess {
  private process: ChildProcess | null = null;
  readonly bridge: TestBridge;
  private runtimeInstalled = false;
  private runtimeInstallPromise: Promise<void> | null = null;
  private stderrLines: string[] = [];

  constructor(private readonly port: number) {
    this.bridge = new TestBridge(port);
  }

  async start(): Promise<void> {
    this.process = spawn(BIN, ["--test-port", String(this.port)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process.stderr?.setEncoding("utf-8");
    this.process.stderr?.on("data", (chunk: string) => {
      this.stderrLines.push(chunk);
      if (this.stderrLines.length > 200) this.stderrLines.shift();
      if (process.env.DEBUG) process.stderr.write(chunk);
    });

    await this.bridge.connect();
    await this.waitForApp();
    await this.installRuntime();
  }

  private async waitForApp(): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const raw = await this.bridge.eval(
          "typeof document !== 'undefined' && document.readyState !== 'loading'",
        );
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (deserializeBridgeValue(parsed) === true) return;
      } catch {
        /* keep polling */
      }
      await sleep(50);
    }
    throw new Error(`wry app did not become ready; stderr tail:\n${this.stderrLines.slice(-10).join("")}`);
  }

  async installRuntime(): Promise<void> {
    if (this.runtimeInstalled) return;
    if (!this.runtimeInstallPromise) {
      this.runtimeInstallPromise = this.bridge
        .eval(RUNTIME_BOOTSTRAP)
        .then(() => {
          this.runtimeInstalled = true;
        });
    }
    await this.runtimeInstallPromise;
  }

  async close(): Promise<void> {
    this.bridge.close();
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
