import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { timingSafeEqual } from "node:crypto";
import { tunnel as cloudflaredTunnel } from "cloudflared";
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

  let tunnelUrl: string | null = null;
  let stopTunnel: (() => void) | null = null;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const webRoot = resolve(__dirname, "../web");

  const MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };

  function serveFile(res: ServerResponse, filePath: string): boolean {
    // Path traversal protection: ensure resolved path stays within webRoot
    const resolved = normalize(resolve(webRoot, filePath));
    if (!resolved.startsWith(webRoot)) {
      res.writeHead(403);
      res.end();
      return true;
    }
    if (!existsSync(resolved)) return false;
    try {
      const content = readFileSync(resolved);
      const ext = extname(resolved);
      const mime = MIME_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(content);
      return true;
    } catch {
      return false;
    }
  }

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          clients: sessionManager.getClientCount(),
          tunnelUrl: tunnelUrl ?? undefined,
        }),
      );
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let pathname = decodeURIComponent(url.pathname);

    // Serve exact file if it exists
    if (pathname === "/") pathname = "/index.html";
    const relPath = pathname.slice(1); // strip leading /
    if (serveFile(res, relPath)) return;

    // SPA fallback: serve index.html for unknown paths
    if (serveFile(res, "index.html")) return;

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

        if (config.tunnel) {
          const localUrl = `http://localhost:${config.port}`;
          console.log(`Starting tunnel to ${localUrl}...`);

          const { url: urlPromise, stop } = cloudflaredTunnel({
            "--url": localUrl,
          });
          stopTunnel = stop;

          urlPromise.then((url) => {
            tunnelUrl = url;
            console.log(`Tunnel active: ${url}`);
          }).catch((err) => {
            console.error(`Tunnel failed: ${err}`);
          });
        }
      });
    },
    shutdown() {
      if (stopTunnel) {
        stopTunnel();
        stopTunnel = null;
      }
      sessionManager.shutdown();
      wss.close();
      httpServer.close();
      console.log("TerminalSync shut down");
    },
  };

  serverRef = server;
  return server;
}
