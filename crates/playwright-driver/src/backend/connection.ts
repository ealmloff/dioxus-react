import { randomPort } from "../constants";
import {
  DispatcherConnection,
  Playwright,
  PlaywrightDispatcher,
  RootDispatcher,
  wsServer,
} from "../internals";
import { AppProcess } from "./appProcess";
import { WryBrowser, WryBrowserContext } from "./browser";
import { WryPageDelegate } from "./page";
import { WryRuntime } from "./runtime";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Session {
  app: AppProcess;
  playwright: any;
  browser: WryBrowser;
  delegate: WryPageDelegate;
}

async function createSession(appPort: number): Promise<Session> {
  const app = new AppProcess(appPort);
  await app.start();
  const runtime = new WryRuntime(app.bridge);
  const playwright = new (Playwright as any)({ sdkLanguage: "javascript" });
  const browser = new WryBrowser(playwright);
  const context = new WryBrowserContext(browser);
  browser._registerContext(context);
  const delegate = new WryPageDelegate(context, runtime);
  context._registerPage(delegate._page);
  await delegate.initialize();
  return { app, playwright, browser, delegate };
}

/**
 * WebSocket server speaking Playwright's dispatcher protocol. Each incoming
 * connection gets its own prelaunched WryBrowser; Playwright's real
 * BrowserDispatcher/PageDispatcher/FrameDispatcher/etc. wrap our subclasses
 * and handle every wire message.
 */
export class PlaywrightWryProxy {
  private server: any = null;
  private readonly sockets = new Set<any>();
  private readonly sessions = new Set<Session>();

  constructor(private options: { proxyPort?: number } = {}) {}

  async start(): Promise<string> {
    this.server = new (wsServer as any)({ port: this.options.proxyPort ?? 0 });
    this.server.on("connection", (socket: any) => {
      this.sockets.add(socket);
      const connection: any = new (DispatcherConnection as any)();
      const sessionPromise = createSession(randomPort());

      const root = new (RootDispatcher as any)(connection, async (scope: any) => {
        const s = await sessionPromise;
        return new (PlaywrightDispatcher as any)(scope, s.playwright, {
          preLaunchedBrowser: s.browser,
          denyLaunch: true,
          sharedBrowser: true,
        });
      });

      connection.onmessage = (m: unknown) => socket.send(JSON.stringify(m));
      socket.on("message", async (data: unknown) => {
        try { await connection.dispatch(JSON.parse(String(data))); }
        catch (error) { if (process.env.DEBUG) console.error("proxy: dispatch failure", error); }
      });
      socket.on("close", () => {
        this.sockets.delete(socket);
        root._dispose();
        void sessionPromise.then((s) => {
          this.sessions.delete(s);
          s.delegate.stopEventFerry();
          return s.app.close();
        }).catch(() => {});
      });

      void sessionPromise.then((s) => this.sessions.add(s)).catch(() => {});
    });

    await new Promise<void>((resolve) => this.server.once("listening", resolve));
    return this.wsEndpoint();
  }

  wsEndpoint(): string {
    const a = this.server?.address();
    if (!a || typeof a === "string") throw new Error("Proxy websocket server is not listening");
    return `ws://127.0.0.1:${a.port}`;
  }

  async close(): Promise<void> {
    for (const s of this.sockets) { try { s.close(); } catch {} try { s.terminate?.(); } catch {} }
    this.sockets.clear();
    if (this.server) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
      this.server = null;
    }
    const sessions = [...this.sessions];
    this.sessions.clear();
    for (const s of sessions) s.delegate.stopEventFerry();
    await Promise.all(sessions.map((s) => s.app.close()));
  }
}
