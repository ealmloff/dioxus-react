import { randomPort } from "../constants";
import {
  DispatcherConnection,
  Playwright,
  PlaywrightDispatcher,
  RootDispatcher,
  type DispatcherConnectionLike,
  type DispatcherLike,
  wsServer,
} from "../internals";
import { AppProcess } from "./appProcess";
import { WryBrowser, WryBrowserContext } from "./browser";
import { WryPageDelegate } from "./page";
import { WryRuntime } from "./runtime";

interface PlaywrightCtor {
  new (options: { sdkLanguage: string; isServer?: boolean }): PlaywrightInstance;
}

interface PlaywrightInstance {
  webkit: unknown;
  attribution: { playwright?: unknown };
}

interface PlaywrightDispatcherCtor {
  new (
    scope: DispatcherLike,
    playwright: PlaywrightInstance,
    options?: Record<string, unknown>,
  ): DispatcherLike;
}

const PlaywrightCtor = Playwright as unknown as PlaywrightCtor;
const PlaywrightDispatcherCtor = PlaywrightDispatcher as unknown as PlaywrightDispatcherCtor;

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

const WsServerCtor = wsServer as unknown as new (opts: { port: number }) => WsServerLike;

interface WrySessionBundle {
  app: AppProcess;
  playwright: PlaywrightInstance;
  browser: WryBrowser;
  delegate: WryPageDelegate;
}

async function createSession(appPort: number): Promise<WrySessionBundle> {
  const app = new AppProcess(appPort);
  await app.start();
  const runtime = new WryRuntime(app.bridge);
  const playwright = new PlaywrightCtor({ sdkLanguage: "javascript" });
  const browser = new WryBrowser(playwright);
  const context = new WryBrowserContext(browser);
  browser._registerContext(context);
  const delegate = new WryPageDelegate(context, runtime);
  context._registerPage(delegate._page);
  await delegate.initialize();
  return { app, playwright, browser, delegate };
}

export interface PlaywrightWryProxyOptions {
  proxyPort?: number;
}

/**
 * WebSocket server that speaks Playwright's dispatcher protocol and binds each
 * connection to a prelaunched WryBrowser. Drop-in replacement for the old
 * proxy.ts + controller.ts + dispatchers/browser.ts pipeline — now there's no
 * custom per-method dispatch layer, just Playwright's own dispatchers backed
 * by our 5-method execution-context delegate.
 */
export class PlaywrightWryProxy {
  private readonly proxyPort: number;
  private server: WsServerLike | null = null;
  private readonly sockets = new Set<WebSocketLike>();
  private readonly sessions = new Set<WrySessionBundle>();

  constructor({ proxyPort = 0 }: PlaywrightWryProxyOptions = {}) {
    this.proxyPort = proxyPort;
  }

  async start(): Promise<string> {
    this.server = new WsServerCtor({ port: this.proxyPort });
    this.server.on("connection", (socket: WebSocketLike) => {
      this.sockets.add(socket);

      const connection = new DispatcherConnection() as DispatcherConnectionLike & {
        onmessage?: (message?: unknown) => void;
      };
      const sessionPromise = createSession(randomPort());

      const root = new RootDispatcher(connection, async (scope: DispatcherLike) => {
        const session = await sessionPromise;
        return new PlaywrightDispatcherCtor(scope, session.playwright, {
          preLaunchedBrowser: session.browser,
          denyLaunch: true,
          sharedBrowser: true,
        });
      });

      connection.onmessage = (message?: unknown) => socket.send(JSON.stringify(message));

      socket.on("message", async (data: unknown) => {
        try {
          const message = JSON.parse(String(data));
          await connection.dispatch(message);
        } catch (error) {
          if (process.env.DEBUG) console.error("proxy: dispatch failure", error);
        }
      });

      socket.on("close", () => {
        this.sockets.delete(socket);
        root._dispose();
        void sessionPromise.then((session) => {
          this.sessions.delete(session);
          session.delegate.stopEventFerry();
          return session.app.close();
        }).catch(() => {});
      });

      void sessionPromise.then((session) => this.sessions.add(session)).catch(() => {});
    });

    await new Promise<void>((resolve) => this.server?.once("listening", () => resolve()));
    return this.wsEndpoint();
  }

  wsEndpoint(): string {
    const address = this.server?.address();
    if (!address || typeof address === "string") {
      throw new Error("Proxy websocket server is not listening");
    }
    return `ws://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      try {
        socket.terminate?.();
      } catch {
        /* ignore */
      }
    }
    this.sockets.clear();

    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = null;
    }

    const sessions = [...this.sessions];
    this.sessions.clear();
    for (const session of sessions) session.delegate.stopEventFerry();
    await Promise.all(sessions.map((session) => session.app.close()));
  }
}
