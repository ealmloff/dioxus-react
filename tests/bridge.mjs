// Test bridge client — connects to the Rust app's TCP test server and sends
// JavaScript evaluation commands into the real wry webview.
//
// Usage:
//   const bridge = new TestBridge(port);
//   await bridge.connect();
//   const value = await bridge.eval('document.querySelector("h1").textContent');
//   bridge.close();

import net from "node:net";

export class TestBridge {
  /** @param {number} port */
  constructor(port) {
    this.port = port;
    /** @type {net.Socket | null} */
    this.socket = null;
    /** @type {string} */
    this._buf = "";
    /** @type {Array<{resolve: Function, reject: Function}>} */
    this._pending = [];
  }

  /** Connect to the test bridge TCP server with retries. */
  async connect(retries = 30, intervalMs = 200) {
    for (let i = 0; i < retries; i++) {
      try {
        await this._tryConnect();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    throw new Error(
      `TestBridge: failed to connect to 127.0.0.1:${this.port} after ${retries} retries`
    );
  }

  /** @returns {Promise<void>} */
  _tryConnect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: "127.0.0.1", port: this.port });
      sock.once("connect", () => {
        this.socket = sock;
        sock.setEncoding("utf-8");
        sock.on("data", (chunk) => this._onData(chunk));
        resolve();
      });
      sock.once("error", reject);
    });
  }

  /** @param {string} chunk */
  _onData(chunk) {
    this._buf += chunk;
    let idx;
    while ((idx = this._buf.indexOf("\n")) !== -1) {
      const line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      if (line.trim() === "") continue;
      const entry = this._pending.shift();
      if (entry) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.error) {
            entry.reject(new Error(parsed.error));
          } else {
            entry.resolve(parsed.result);
          }
        } catch (e) {
          entry.reject(new Error(`bad response: ${line}`));
        }
      }
    }
  }

  /**
   * Evaluate JavaScript inside the real wry webview and return the result.
   * The JS expression is evaluated with indirect eval (global scope).
   * @param {string} js - JavaScript expression to evaluate.
   * @returns {Promise<any>} - The JSON-decoded return value.
   */
  eval(js) {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        return reject(new Error("not connected"));
      }
      this._pending.push({ resolve, reject });
      this.socket.write(JSON.stringify({ eval: js }) + "\n");
    });
  }

  /**
   * Evaluate JS and parse the result as JSON.
   * @param {string} js
   * @returns {Promise<any>}
   */
  async evalJson(js) {
    const raw = await this.eval(js);
    return JSON.parse(raw);
  }

  /** Close the TCP connection. */
  close() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
