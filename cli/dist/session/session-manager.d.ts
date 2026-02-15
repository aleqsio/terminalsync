import type { WebSocket } from "ws";
import type { Config } from "../config.js";
import type { ManagedSessionStore } from "./managed-session-store.js";
import type { TmuxProvider } from "../tmux/tmux-provider.js";
import { ClientSession } from "./client-session.js";
export declare class SessionManager {
    private clients;
    private config;
    private store;
    private tmux;
    private onIdle;
    private idleTimer;
    constructor(config: Config, store: ManagedSessionStore, tmux: TmuxProvider, onIdle?: () => void);
    addClient(ws: WebSocket): ClientSession | null;
    private checkIdle;
    private cancelIdleTimer;
    getClientCount(): number;
    shutdown(): void;
}
