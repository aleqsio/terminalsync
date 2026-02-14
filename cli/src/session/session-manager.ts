import type { WebSocket } from "ws";
import type { Config } from "../config.js";
import type { ManagedSessionStore } from "./managed-session-store.js";
import type { TmuxProvider } from "../tmux/tmux-provider.js";
import { ClientSession } from "./client-session.js";

export class SessionManager {
  private clients = new Map<string, ClientSession>();
  private config: Config;
  private store: ManagedSessionStore;
  private tmux: TmuxProvider;
  private onIdle: (() => void) | null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    config: Config,
    store: ManagedSessionStore,
    tmux: TmuxProvider,
    onIdle?: () => void,
  ) {
    this.config = config;
    this.store = store;
    this.tmux = tmux;
    this.onIdle = onIdle ?? null;

    store.on("idle", () => this.checkIdle());
    store.on("active", () => this.cancelIdleTimer());
  }

  addClient(ws: WebSocket): ClientSession | null {
    if (this.clients.size >= this.config.maxClients) {
      return null;
    }

    this.cancelIdleTimer();

    const session = new ClientSession(ws, this.config, this.store, this.tmux);
    this.clients.set(session.id, session);

    ws.on("close", () => {
      this.clients.delete(session.id);
      console.log(
        `Client ${session.id} disconnected (${this.clients.size} active)`,
      );
      this.checkIdle();
    });

    console.log(
      `Client ${session.id} connected (${this.clients.size} active)`,
    );
    return session;
  }

  private checkIdle(): void {
    if (this.clients.size === 0 && this.store.getRunningCount() === 0 && this.onIdle) {
      if (!this.idleTimer) {
        console.log("Server idle, shutting down in 5s...");
        this.idleTimer = setTimeout(() => {
          console.log("Idle timeout reached, shutting down.");
          this.onIdle!();
        }, 5000);
      }
    }
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
      console.log("Idle timer cancelled.");
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  shutdown(): void {
    this.cancelIdleTimer();
    for (const [id, session] of this.clients) {
      session.cleanup();
      session.ws.close(1001, "Server shutting down");
      this.clients.delete(id);
    }
    this.store.shutdown();
  }
}
