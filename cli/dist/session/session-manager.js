import { ClientSession } from "./client-session.js";
export class SessionManager {
    clients = new Map();
    config;
    store;
    tmux;
    onIdle;
    idleTimer = null;
    constructor(config, store, tmux, onIdle) {
        this.config = config;
        this.store = store;
        this.tmux = tmux;
        this.onIdle = onIdle ?? null;
        store.on("idle", () => this.checkIdle());
        store.on("active", () => this.cancelIdleTimer());
        store.on("session_removed", (sessionId) => {
            // Notify all clients so they refresh their session list
            for (const client of this.clients.values()) {
                client.sendJSON({
                    type: "session_removed",
                    seq: 0,
                    payload: { id: sessionId },
                });
            }
        });
    }
    addClient(ws) {
        if (this.clients.size >= this.config.maxClients) {
            return null;
        }
        this.cancelIdleTimer();
        const session = new ClientSession(ws, this.config, this.store, this.tmux);
        this.clients.set(session.id, session);
        ws.on("close", () => {
            this.clients.delete(session.id);
            console.log(`Client ${session.id} disconnected (${this.clients.size} active)`);
            this.checkIdle();
        });
        console.log(`Client ${session.id} connected (${this.clients.size} active)`);
        return session;
    }
    checkIdle() {
        if (this.clients.size === 0 && this.store.getRunningCount() === 0 && this.onIdle) {
            if (!this.idleTimer) {
                console.log("Server idle, shutting down in 5s...");
                this.idleTimer = setTimeout(() => {
                    console.log("Idle timeout reached, shutting down.");
                    this.onIdle();
                }, 5000);
            }
        }
    }
    cancelIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
            console.log("Idle timer cancelled.");
        }
    }
    getClientCount() {
        return this.clients.size;
    }
    shutdown() {
        this.cancelIdleTimer();
        for (const [id, session] of this.clients) {
            session.cleanup();
            session.ws.close(1001, "Server shutting down");
            this.clients.delete(id);
        }
        this.store.shutdown();
    }
}
//# sourceMappingURL=session-manager.js.map