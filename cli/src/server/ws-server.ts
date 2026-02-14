import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config.js";
import { SessionManager } from "../session/session-manager.js";
import { ManagedSessionStore } from "../session/managed-session-store.js";
import { TmuxProvider } from "../tmux/tmux-provider.js";

function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a compare to avoid timing leak on length
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function extractToken(req: IncomingMessage): string | null {
  // Check query param
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}

export async function createWSServer(config: Config): Promise<{
  start: () => void;
  shutdown: () => void;
}> {
  const store = new ManagedSessionStore();
  const tmux = new TmuxProvider();

  const tmuxAvailable = await tmux.isAvailable();
  console.log(`tmux: ${tmuxAvailable ? "available" : "not found (managed sessions only)"}`);
  console.log(`Default shell: ${config.defaultShell}`);

  let serverRef: { shutdown: () => void } | null = null;

  const sessionManager = new SessionManager(config, store, tmux, () => {
    serverRef?.shutdown();
    process.exit(0);
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const webIndexPath = resolve(__dirname, "../web/index.html");
  let cachedHtml: string | null = null;
  function getHtml(): string {
    if (!cachedHtml) {
      cachedHtml = readFileSync(webIndexPath, "utf-8");
    }
    return cachedHtml;
  }

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          clients: sessionManager.getClientCount(),
        }),
      );
      return;
    }

    const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
    if (pathname === "/" || pathname === "/index.html") {
      try {
        const html = getHtml();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end("Web UI not found");
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const token = extractToken(req);

    if (!token || !constantTimeCompare(token, config.authToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const client = sessionManager.addClient(ws);
      if (!client) {
        ws.close(1013, "Maximum clients reached");
        return;
      }
    });
  });

  const server = {
    start() {
      httpServer.listen(config.port, config.host, () => {
        console.log(
          `TerminalSync listening on ws://${config.host}:${config.port}`,
        );
      });
    },
    shutdown() {
      sessionManager.shutdown();
      wss.close();
      httpServer.close();
      console.log("TerminalSync shut down");
    },
  };

  serverRef = server;
  return server;
}
