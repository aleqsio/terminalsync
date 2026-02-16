import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ManagedSessionStore } from "../session/managed-session-store.js";
import { TmuxProvider } from "../tmux/tmux-provider.js";
import { SessionManager } from "../session/session-manager.js";
import type { Config } from "../config.js";
import type { ServerMessage } from "../protocol/messages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = "test-token-12345";

function testConfig(overrides?: Partial<Config>): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    authToken: TEST_TOKEN,
    maxClients: 10,
    defaultScrollbackLines: 100,
    defaultShell: process.env.SHELL ?? "/bin/sh",
    tunnel: false,
    ...overrides,
  };
}

function startTestServer(config: Config): Promise<{
  httpServer: HttpServer;
  wss: WebSocketServer;
  manager: SessionManager;
  store: ManagedSessionStore;
  port: number;
  close: () => void;
}> {
  return new Promise((resolve) => {
    const store = new ManagedSessionStore();
    const tmux = new TmuxProvider();
    const manager = new SessionManager(config, store, tmux);

    const httpServer = createServer();
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      const token = url.searchParams.get("token");
      if (token !== config.authToken) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        manager.addClient(ws);
      });
    });

    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" ? addr!.port : 0;
      resolve({
        httpServer,
        wss,
        manager,
        store,
        port,
        close() {
          manager.shutdown();
          wss.close();
          httpServer.close();
        },
      });
    });
  });
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?token=${TEST_TOKEN}`,
    );
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  ws.send(JSON.stringify(msg));
}

function waitForMsg(
  ws: WebSocket,
  type: string,
  timeoutMs = 5000,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for "${type}"`)),
      timeoutMs,
    );

    const handler = (data: Buffer | string) => {
      if (Buffer.isBuffer(data)) {
        try {
          JSON.parse(data.toString());
        } catch {
          return;
        }
      }
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

function collectMessages(
  ws: WebSocket,
  durationMs: number,
): Promise<ServerMessage[]> {
  return new Promise((resolve) => {
    const msgs: ServerMessage[] = [];
    const handler = (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        msgs.push(msg);
      } catch {
        // binary frame
      }
    };
    ws.on("message", handler);
    setTimeout(() => {
      ws.removeListener("message", handler);
      resolve(msgs);
    }, durationMs);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let server: Awaited<ReturnType<typeof startTestServer>>;

beforeAll(async () => {
  server = await startTestServer(testConfig());
});

afterAll(() => {
  server.close();
});

describe("connection & auth", () => {
  it("connects with valid token", async () => {
    const ws = await connectClient(server.port);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("rejects invalid token", async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}?token=bad-token`,
    );
    await expect(
      new Promise((_, reject) => {
        ws.on("error", reject);
        ws.on("close", () => reject(new Error("closed")));
      }),
    ).rejects.toThrow();
  });
});

describe("session lifecycle", () => {
  it("lists sessions (initially empty)", async () => {
    const ws = await connectClient(server.port);
    send(ws, { type: "list_sessions", seq: 1, payload: {} });
    const msg = await waitForMsg(ws, "session_list");
    expect(msg.payload).toHaveProperty("sessions");
    expect(Array.isArray((msg.payload as any).sessions)).toBe(true);
    ws.close();
  });

  it("creates a session and lists it", async () => {
    const ws = await connectClient(server.port);

    send(ws, {
      type: "create_session",
      seq: 1,
      payload: { name: "test-session", cols: 80, rows: 24 },
    });
    const created = await waitForMsg(ws, "session_created");
    expect((created.payload as any).name).toBe("test-session");
    const sessionId = (created.payload as any).id;

    send(ws, { type: "list_sessions", seq: 2, payload: {} });
    const list = await waitForMsg(ws, "session_list");
    const sessions = (list.payload as any).sessions as any[];
    const found = sessions.find((s: any) => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.status).toBe("running");

    ws.close();
  });

  it("attaches to a session", async () => {
    const ws = await connectClient(server.port);

    send(ws, {
      type: "create_session",
      seq: 1,
      payload: { name: "attach-test", cols: 80, rows: 24 },
    });
    const created = await waitForMsg(ws, "session_created");
    const sessionId = (created.payload as any).id;

    send(ws, {
      type: "attach",
      seq: 2,
      payload: { target: sessionId, cols: 80, rows: 24 },
    });
    const attached = await waitForMsg(ws, "attached");
    expect((attached.payload as any).target).toBe(sessionId);

    ws.close();
  });

  it("detaches from a session", async () => {
    const ws = await connectClient(server.port);

    send(ws, {
      type: "create_session",
      seq: 1,
      payload: { name: "detach-test", cols: 80, rows: 24 },
    });
    const created = await waitForMsg(ws, "session_created");
    const sessionId = (created.payload as any).id;

    send(ws, {
      type: "attach",
      seq: 2,
      payload: { target: sessionId, cols: 80, rows: 24 },
    });
    await waitForMsg(ws, "attached");

    send(ws, { type: "detach", seq: 3, payload: {} });
    const detached = await waitForMsg(ws, "detached");
    expect((detached.payload as any).reason).toBe("client_request");

    ws.close();
  });

  it("errors when attaching to non-existent session", async () => {
    const ws = await connectClient(server.port);
    send(ws, {
      type: "attach",
      seq: 1,
      payload: { target: "non-existent-id", cols: 80, rows: 24 },
    });
    const err = await waitForMsg(ws, "error");
    expect((err.payload as any).code).toBe("SESSION_NOT_FOUND");
    ws.close();
  });

  it("errors on input when not attached", async () => {
    const ws = await connectClient(server.port);
    send(ws, { type: "input", seq: 1, payload: { data: "hello" } });
    const err = await waitForMsg(ws, "error");
    expect((err.payload as any).code).toBe("NOT_ATTACHED");
    ws.close();
  });

  it("errors on resize when not attached", async () => {
    const ws = await connectClient(server.port);
    send(ws, {
      type: "resize",
      seq: 1,
      payload: { cols: 100, rows: 40 },
    });
    const err = await waitForMsg(ws, "error");
    expect((err.payload as any).code).toBe("NOT_ATTACHED");
    ws.close();
  });
});

describe("resize: host dictates size", () => {
  it("session starts with the creation size", async () => {
    const host = await connectClient(server.port);

    send(host, {
      type: "create_session",
      seq: 1,
      payload: { name: "size-test", cols: 120, rows: 40 },
    });
    const created = await waitForMsg(host, "session_created");
    const sessionId = (created.payload as any).id;

    send(host, {
      type: "attach",
      seq: 2,
      payload: { target: sessionId, cols: 120, rows: 40 },
    });
    const attached = await waitForMsg(host, "attached");
    expect((attached.payload as any).cols).toBe(120);
    expect((attached.payload as any).rows).toBe(40);

    host.close();
  });

  it("host resize → all clients notified", async () => {
    const host = await connectClient(server.port);

    send(host, {
      type: "create_session",
      seq: 1,
      payload: { name: "host-resize", cols: 80, rows: 24 },
    });
    const created = await waitForMsg(host, "session_created");
    const sessionId = (created.payload as any).id;

    send(host, {
      type: "attach",
      seq: 2,
      payload: { target: sessionId, cols: 80, rows: 24 },
    });
    await waitForMsg(host, "attached");

    // Web client joins
    const web = await connectClient(server.port);
    send(web, {
      type: "attach",
      seq: 1,
      payload: { target: sessionId, cols: 0, rows: 0 },
    });
    const webAttached = await waitForMsg(web, "attached");
    // Web receives the current PTY size
    expect((webAttached.payload as any).cols).toBe(80);
    expect((webAttached.payload as any).rows).toBe(24);

    // Host resizes their terminal — both should be notified
    const hostResizePromise = waitForMsg(host, "resized");
    const webResizePromise = waitForMsg(web, "resized");
    send(host, {
      type: "resize",
      seq: 3,
      payload: { cols: 160, rows: 48 },
    });

    const hostResized = await hostResizePromise;
    expect((hostResized.payload as any).cols).toBe(160);
    expect((hostResized.payload as any).rows).toBe(48);

    const webResized = await webResizePromise;
    expect((webResized.payload as any).cols).toBe(160);
    expect((webResized.payload as any).rows).toBe(48);

    host.close();
    web.close();
  });

  it("web client joining does NOT change the PTY size", async () => {
    const host = await connectClient(server.port);

    send(host, {
      type: "create_session",
      seq: 1,
      payload: { name: "no-shrink", cols: 200, rows: 60 },
    });
    const created = await waitForMsg(host, "session_created");
    const sessionId = (created.payload as any).id;

    send(host, {
      type: "attach",
      seq: 2,
      payload: { target: sessionId, cols: 200, rows: 60 },
    });
    await waitForMsg(host, "attached");

    // Collect messages on host for a short period
    const msgs = collectMessages(host, 500);

    // Web client attaches with 0x0 (doesn't report size)
    const web = await connectClient(server.port);
    send(web, {
      type: "attach",
      seq: 1,
      payload: { target: sessionId, cols: 0, rows: 0 },
    });
    await waitForMsg(web, "attached");

    const hostMsgs = await msgs;
    const resizeMsgs = hostMsgs.filter((m) => m.type === "resized");
    expect(resizeMsgs.length).toBe(0);

    // PTY stays at host size
    const session = server.store.get(sessionId);
    expect(session?.cols).toBe(200);
    expect(session?.rows).toBe(60);

    host.close();
    web.close();
  });

  it("web client leaving does NOT change the PTY size", async () => {
    const host = await connectClient(server.port);

    send(host, {
      type: "create_session",
      seq: 1,
      payload: { name: "no-grow", cols: 120, rows: 40 },
    });
    const created = await waitForMsg(host, "session_created");
    const sessionId = (created.payload as any).id;

    send(host, {
      type: "attach",
      seq: 2,
      payload: { target: sessionId, cols: 120, rows: 40 },
    });
    await waitForMsg(host, "attached");

    const web = await connectClient(server.port);
    send(web, {
      type: "attach",
      seq: 1,
      payload: { target: sessionId, cols: 0, rows: 0 },
    });
    await waitForMsg(web, "attached");

    // Collect messages on host
    const msgs = collectMessages(host, 500);

    // Web client leaves
    send(web, { type: "detach", seq: 2, payload: {} });
    await waitForMsg(web, "detached");

    const hostMsgs = await msgs;
    const resizeMsgs = hostMsgs.filter((m) => m.type === "resized");
    expect(resizeMsgs.length).toBe(0);

    // PTY unchanged
    const session = server.store.get(sessionId);
    expect(session?.cols).toBe(120);
    expect(session?.rows).toBe(40);

    host.close();
    web.close();
  });

  it("host resize after web joins → web gets new size", async () => {
    const host = await connectClient(server.port);

    send(host, {
      type: "create_session",
      seq: 1,
      payload: { name: "resize-after-join", cols: 100, rows: 30 },
    });
    const created = await waitForMsg(host, "session_created");
    const sessionId = (created.payload as any).id;

    send(host, {
      type: "attach",
      seq: 2,
      payload: { target: sessionId, cols: 100, rows: 30 },
    });
    await waitForMsg(host, "attached");

    const web = await connectClient(server.port);
    send(web, {
      type: "attach",
      seq: 1,
      payload: { target: sessionId, cols: 0, rows: 0 },
    });
    await waitForMsg(web, "attached");

    // Host resizes
    const webResizePromise = waitForMsg(web, "resized");
    send(host, {
      type: "resize",
      seq: 3,
      payload: { cols: 200, rows: 60 },
    });

    const webResized = await webResizePromise;
    expect((webResized.payload as any).cols).toBe(200);
    expect((webResized.payload as any).rows).toBe(60);

    host.close();
    web.close();
  });

  it("multiple host resizes → web tracks each one", async () => {
    const host = await connectClient(server.port);

    send(host, {
      type: "create_session",
      seq: 1,
      payload: { name: "multi-resize", cols: 80, rows: 24 },
    });
    const created = await waitForMsg(host, "session_created");
    const sessionId = (created.payload as any).id;

    send(host, {
      type: "attach",
      seq: 2,
      payload: { target: sessionId, cols: 80, rows: 24 },
    });
    await waitForMsg(host, "attached");

    const web = await connectClient(server.port);
    send(web, {
      type: "attach",
      seq: 1,
      payload: { target: sessionId, cols: 0, rows: 0 },
    });
    await waitForMsg(web, "attached");

    // First resize
    let webResizePromise = waitForMsg(web, "resized");
    send(host, { type: "resize", seq: 3, payload: { cols: 120, rows: 40 } });
    let webResized = await webResizePromise;
    expect((webResized.payload as any).cols).toBe(120);

    // Second resize
    webResizePromise = waitForMsg(web, "resized");
    send(host, { type: "resize", seq: 4, payload: { cols: 200, rows: 60 } });
    webResized = await webResizePromise;
    expect((webResized.payload as any).cols).toBe(200);

    // Third resize (shrink)
    webResizePromise = waitForMsg(web, "resized");
    send(host, { type: "resize", seq: 5, payload: { cols: 60, rows: 20 } });
    webResized = await webResizePromise;
    expect((webResized.payload as any).cols).toBe(60);
    expect((webResized.payload as any).rows).toBe(20);

    host.close();
    web.close();
  });
});

describe("input / output via WebSocket", () => {
  it("input reaches PTY and output comes back", async () => {
    const ws = await connectClient(server.port);

    send(ws, {
      type: "create_session",
      seq: 1,
      payload: { name: "io-test", cols: 80, rows: 24 },
    });
    const created = await waitForMsg(ws, "session_created");
    const sessionId = (created.payload as any).id;

    send(ws, {
      type: "attach",
      seq: 2,
      payload: { target: sessionId, cols: 80, rows: 24 },
    });
    await waitForMsg(ws, "attached");

    const marker = `MARKER_${Date.now()}`;
    const outputPromise = new Promise<string>((resolve) => {
      let collected = "";
      const handler = (data: Buffer | string) => {
        if (Buffer.isBuffer(data)) {
          collected += data.toString();
          if (collected.includes(marker)) {
            ws.removeListener("message", handler);
            resolve(collected);
          }
        }
      };
      ws.on("message", handler);
    });

    send(ws, {
      type: "input",
      seq: 3,
      payload: { data: `echo ${marker}\n` },
    });

    const output = await outputPromise;
    expect(output).toContain(marker);

    ws.close();
  });
});
