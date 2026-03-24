import { DEFAULT_PROXY_PORT, randomPort } from "./constants";
import { ProxyAppController } from "./controller";
import {
  DispatcherConnection,
  RootDispatcher,
  wsServer,
} from "./internals";
import { ProxyPlaywrightDispatcher } from "./dispatchers/browser";

interface ProxyOptions {
  proxyPort?: number;
}

export class PlaywrightWryProxy {
  private proxyPort: number;
  private server: any = null;
  private connections = new Map<any, ProxyAppController>();
  private sockets = new Set<any>();

  constructor({ proxyPort = DEFAULT_PROXY_PORT }: ProxyOptions = {}) {
    this.proxyPort = proxyPort;
  }

  async start(): Promise<string> {
    this.server = new wsServer({ port: this.proxyPort });
    this.server.on("connection", (socket: any) => {
      if (process.env.DEBUG) {
        console.error("[proxy] ws client connected");
      }
      this.sockets.add(socket);
      const controller = new ProxyAppController({ appPort: randomPort() });
      const connection = new DispatcherConnection();
      this.connections.set(connection, controller);

      const init = controller.start();

      const root = new RootDispatcher(connection, async (scope: any) => {
        await init;
        return new ProxyPlaywrightDispatcher(scope, controller);
      });

      connection.onmessage = (message: unknown) => {
        socket.send(JSON.stringify(message));
      };

      socket.on("message", async (data: unknown) => {
        if (process.env.DEBUG) {
          console.error(`[proxy] ws message ${String(data).slice(0, 200)}`);
        }
        const message = JSON.parse(String(data));
        await init;
        await connection.dispatch(message);
      });

      socket.on("close", () => {
        this.sockets.delete(socket);
        this.connections.delete(connection);
        root._dispose();
        controller.close();
      });
    });

    await new Promise((resolve) => this.server.once("listening", resolve));
    return this.wsEndpoint();
  }

  wsEndpoint(): string {
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Proxy websocket server is not listening");
    }

    return `ws://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    for (const [connection] of this.connections) {
      connection.onmessage = () => {};
    }
    const controllers = [...this.connections.values()];
    this.connections.clear();

    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {}
      try {
        socket.terminate?.();
      } catch {}
    }
    this.sockets.clear();

    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }

    await Promise.all(controllers.map((c) => c.close()));
  }
}
