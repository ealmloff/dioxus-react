import { DEFAULT_PROXY_PORT, randomPort } from "./constants";
import { ProxyAppController } from "./controller";
import {
  DispatcherConnection,
  RootDispatcher,
  type DispatcherConnectionLike,
  type DispatcherLike,
  wsServer,
} from "./internals";
import { ProxyPlaywrightDispatcher } from "./dispatchers/browser";

interface ProxyOptions {
  proxyPort?: number;
}

interface WebSocketLike {
  send(data: string): void;
  on(event: "message", listener: (data: unknown) => void): this;
  on(event: "close", listener: () => void): this;
  close(): void;
  terminate?: () => void;
}

interface WsServerLike {
  on(event: "connection", listener: (socket: WebSocketLike) => void): this;
  once(event: "listening", listener: () => void): this;
  address(): { port: number } | string | null;
  close(callback: () => void): void;
}

export class PlaywrightWryProxy {
  private proxyPort: number;
  private server: WsServerLike | null = null;
  private connections = new Map<DispatcherConnectionLike, ProxyAppController>();
  private sockets = new Set<WebSocketLike>();

  constructor({ proxyPort = DEFAULT_PROXY_PORT }: ProxyOptions = {}) {
    this.proxyPort = proxyPort;
  }

  async start(): Promise<string> {
    this.server = new wsServer({ port: this.proxyPort }) as WsServerLike;
    this.server.on("connection", (socket: WebSocketLike) => {
      if (process.env.DEBUG) {
        console.error("[proxy] ws client connected");
      }
      this.sockets.add(socket);
      const controller = new ProxyAppController({ appPort: randomPort() });
      const connection = new DispatcherConnection();
      this.connections.set(connection, controller);
      const connectionLike = connection as {
        onmessage?: (message?: unknown) => void;
      };

      const init = controller.start();

      const root = new RootDispatcher(
        connection,
        async (scope: DispatcherLike) => {
          await init;
          return new ProxyPlaywrightDispatcher(scope, controller);
        }
      );

      connectionLike.onmessage = (message?: unknown) => {
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

    await new Promise<void>((resolve) => this.server?.once("listening", () => resolve()));
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
      } catch (error) {
        if (process.env.DEBUG) {
          console.error("proxy: socket.close failed", error);
        }
      }
      try {
        socket.terminate?.();
      } catch (error) {
        if (process.env.DEBUG) {
          console.error("proxy: socket.terminate failed", error);
        }
      }
    }
    this.sockets.clear();

    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = null;
    }

    await Promise.all(controllers.map((c) => c.close()));
  }
}
