import { DEFAULT_PROXY_PORT, randomPort } from "./constants";
import { ProxyAppController } from "./controller";
import {
  DispatcherConnection,
  RootDispatcher,
  wsServer,
} from "./internals";
import { ProxyPlaywrightDispatcher } from "./dispatchers/browser";

interface ProxyOptions {
  appPort?: number;
  proxyPort?: number;
}

export class PlaywrightWryProxy {
  private controller: ProxyAppController;
  private proxyPort: number;
  private server: any = null;
  private connections = new Set<any>();

  constructor({ appPort = randomPort(), proxyPort = DEFAULT_PROXY_PORT }: ProxyOptions = {}) {
    this.proxyPort = proxyPort;
    this.controller = new ProxyAppController({ appPort });
  }

  async start(): Promise<string> {
    await this.controller.start();
    this.server = new wsServer({ port: this.proxyPort });
    this.server.on("connection", (socket: any) => {
      const connection = new DispatcherConnection();
      this.connections.add(connection);
      const root = new RootDispatcher(connection, async (scope: any) => {
        return new ProxyPlaywrightDispatcher(scope, this.controller);
      });

      connection.onmessage = (message: unknown) => {
        socket.send(JSON.stringify(message));
      };

      socket.on("message", async (data: unknown) => {
        const message = JSON.parse(String(data));
        await connection.dispatch(message);
      });

      socket.on("close", () => {
        this.connections.delete(connection);
        root._dispose();
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
    for (const connection of this.connections) {
      connection.onmessage = () => {};
    }
    this.connections.clear();

    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }

    await this.controller.close();
  }
}
