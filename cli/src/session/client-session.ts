import type { WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  SessionInfo,
} from "../protocol/messages.js";
import { parseClientMessage } from "../protocol/messages.js";
import type { Config } from "../config.js";
import type { ManagedSessionStore } from "./managed-session-store.js";
import type { ManagedSession } from "./managed-session.js";
import type { TmuxProvider } from "../tmux/tmux-provider.js";
import {
  spawnAttach,
  captureScrollback,
  detachGracefully,
} from "../tmux/attach.js";
import type { IPty } from "node-pty";

type ClientState = "BROWSING" | "ATTACHED";

export class ClientSession {
  readonly id: string;
  private state: ClientState = "BROWSING";
  private config: Config;
  private store: ManagedSessionStore;
  private tmux: TmuxProvider;

  // When attached to a managed session
  private attachedSession: ManagedSession | null = null;
  private dataListener: ((data: string) => void) | null = null;
  private exitListener: ((exitCode: number) => void) | null = null;
  private resizeListener: ((cols: number, rows: number) => void) | null = null;

  // When attached to a tmux session (legacy path)
  private tmuxPty: IPty | null = null;
  private attachedTarget: string | null = null;

  constructor(
    readonly ws: WebSocket,
    config: Config,
    store: ManagedSessionStore,
    tmux: TmuxProvider,
  ) {
    this.id = crypto.randomUUID();
    this.config = config;
    this.store = store;
    this.tmux = tmux;

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      try {
        const msg = parseClientMessage(data.toString());
        this.handleMessage(msg);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.sendJSON({
          type: "error",
          seq: 0,
          payload: { code: "PARSE_ERROR", message },
        });
      }
    });

    ws.on("close", () => this.cleanup());
    ws.on("error", () => this.cleanup());
  }

  private handleMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case "list_sessions":
        this.handleListSessions(msg.seq);
        break;
      case "create_session":
        this.handleCreateSession(
          msg.seq,
          msg.payload.name,
          msg.payload.cols,
          msg.payload.rows,
        );
        break;
      case "attach":
        this.handleAttach(
          msg.seq,
          msg.payload.target,
          msg.payload.cols,
          msg.payload.rows,
        );
        break;
      case "input":
        this.handleInput(msg.seq, msg.payload.data);
        break;
      case "resize":
        this.handleResize(msg.seq, msg.payload.cols, msg.payload.rows);
        break;
      case "detach":
        this.handleDetach(msg.seq);
        break;
    }
  }

  private async handleListSessions(seq: number): Promise<void> {
    try {
      const managed: SessionInfo[] = this.store.list().map((s) => ({
        id: s.id,
        name: s.name,
        status: s.getStatus(),
        attachedClients: s.getAttachedClientCount(),
        source: s.source,
      }));

      const tmuxSessions = await this.tmux.listSessions();
      const sessions = [...managed, ...tmuxSessions];

      this.sendJSON({
        type: "session_list",
        seq,
        payload: { sessions },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJSON({
        type: "error",
        seq,
        payload: { code: "LIST_ERROR", message },
      });
    }
  }

  private handleCreateSession(
    seq: number,
    name: string,
    cols: number,
    rows: number,
  ): void {
    try {
      const session = this.store.create({
        name,
        shell: this.config.defaultShell,
        cols,
        rows,
      });

      this.sendJSON({
        type: "session_created",
        seq,
        payload: { id: session.id, name: session.name },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJSON({
        type: "error",
        seq,
        payload: { code: "CREATE_FAILED", message },
      });
    }
  }

  private async handleAttach(
    seq: number,
    target: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    if (this.state === "ATTACHED") {
      this.sendJSON({
        type: "error",
        seq,
        payload: {
          code: "ALREADY_ATTACHED",
          message: "Already attached to a session. Detach first.",
        },
      });
      return;
    }

    // Route: tmux session (target starts with "tmux:")
    if (target.startsWith("tmux:")) {
      await this.attachTmux(seq, target.slice(5), cols, rows);
      return;
    }

    // Route: managed session (target is a UUID)
    const session = this.store.get(target);
    if (!session) {
      this.sendJSON({
        type: "error",
        seq,
        payload: { code: "SESSION_NOT_FOUND", message: `No session with id: ${target}` },
      });
      return;
    }

    if (session.hasExited()) {
      this.sendJSON({
        type: "error",
        seq,
        payload: { code: "SESSION_EXITED", message: "Session has already exited" },
      });
      return;
    }

    this.attachedSession = session;
    session.attachClient(this.id);
    this.state = "ATTACHED";

    // Send buffered output so reconnecting clients see prior content
    const buffered = session.getBufferedOutput();
    if (buffered) {
      this.ws.send(Buffer.from(buffered), { binary: true });
    }

    // Subscribe to live output
    this.dataListener = (data: string) => {
      if (this.ws.readyState === this.ws.OPEN) {
        this.ws.send(Buffer.from(data), { binary: true });
      }
    };
    this.exitListener = (exitCode: number) => {
      if (this.state === "ATTACHED") {
        this.detachFromManaged();
        this.sendJSON({
          type: "detached",
          seq: 0,
          payload: {
            reason: "session_exit",
            message: `Process exited with code ${exitCode}`,
          },
        });
      }
    };
    this.resizeListener = (cols: number, rows: number) => {
      this.sendJSON({
        type: "resized",
        seq: 0,
        payload: { cols, rows },
      });
    };

    session.on("data", this.dataListener);
    session.on("exit", this.exitListener);
    session.on("resize", this.resizeListener);

    this.sendJSON({
      type: "attached",
      seq,
      payload: { target, cols: session.cols, rows: session.rows },
    });
  }

  private async attachTmux(
    seq: number,
    tmuxTarget: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    try {
      const scrollback = await captureScrollback(
        tmuxTarget,
        this.config.defaultScrollbackLines,
      );

      const ptyProcess = spawnAttach(tmuxTarget, cols, rows);
      this.tmuxPty = ptyProcess;
      this.attachedTarget = `tmux:${tmuxTarget}`;
      this.state = "ATTACHED";

      if (scrollback) {
        this.ws.send(Buffer.from(scrollback), { binary: true });
      }

      ptyProcess.onData((data: string) => {
        if (this.ws.readyState === this.ws.OPEN) {
          this.ws.send(Buffer.from(data), { binary: true });
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        if (this.state === "ATTACHED") {
          this.state = "BROWSING";
          this.tmuxPty = null;
          this.attachedTarget = null;
          this.sendJSON({
            type: "detached",
            seq: 0,
            payload: {
              reason: "session_exit",
              message: `Process exited with code ${exitCode}`,
            },
          });
        }
      });

      this.sendJSON({
        type: "attached",
        seq,
        payload: { target: `tmux:${tmuxTarget}`, cols, rows },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendJSON({
        type: "error",
        seq,
        payload: { code: "ATTACH_FAILED", message },
      });
    }
  }

  private handleInput(seq: number, data: string): void {
    if (this.state !== "ATTACHED") {
      this.sendJSON({
        type: "error",
        seq,
        payload: { code: "NOT_ATTACHED", message: "Not attached to any session" },
      });
      return;
    }

    if (this.attachedSession) {
      this.attachedSession.write(data);
    } else if (this.tmuxPty) {
      this.tmuxPty.write(data);
    }
  }

  private handleResize(seq: number, cols: number, rows: number): void {
    if (this.state !== "ATTACHED") {
      this.sendJSON({
        type: "error",
        seq,
        payload: { code: "NOT_ATTACHED", message: "Not attached to any session" },
      });
      return;
    }

    if (this.attachedSession) {
      this.attachedSession.resize(cols, rows);
    } else if (this.tmuxPty) {
      this.tmuxPty.resize(cols, rows);
    }
  }

  private handleDetach(seq: number): void {
    if (this.state !== "ATTACHED") {
      this.sendJSON({
        type: "error",
        seq,
        payload: { code: "NOT_ATTACHED", message: "Not attached to any session" },
      });
      return;
    }

    if (this.attachedSession) {
      this.detachFromManaged();
    } else if (this.tmuxPty) {
      this.detachFromTmux();
    }

    this.sendJSON({
      type: "detached",
      seq,
      payload: { reason: "client_request" },
    });
  }

  private detachFromManaged(): void {
    if (this.attachedSession) {
      if (this.dataListener) {
        this.attachedSession.removeListener("data", this.dataListener);
      }
      if (this.exitListener) {
        this.attachedSession.removeListener("exit", this.exitListener);
      }
      if (this.resizeListener) {
        this.attachedSession.removeListener("resize", this.resizeListener);
      }
      this.attachedSession.detachClient(this.id);
    }
    this.attachedSession = null;
    this.dataListener = null;
    this.exitListener = null;
    this.resizeListener = null;
    this.state = "BROWSING";
  }

  private detachFromTmux(): void {
    if (this.tmuxPty) {
      detachGracefully(this.tmuxPty);
      const pty = this.tmuxPty;
      setTimeout(() => {
        try {
          pty.kill();
        } catch {
          // already dead
        }
      }, 500);
    }
    this.tmuxPty = null;
    this.attachedTarget = null;
    this.state = "BROWSING";
  }

  cleanup(): void {
    if (this.attachedSession) {
      this.detachFromManaged();
    }
    if (this.tmuxPty) {
      this.detachFromTmux();
    }
    this.state = "BROWSING";
  }

  sendJSON(msg: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
