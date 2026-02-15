import { EventEmitter } from "node:events";
import { ManagedSession } from "./managed-session.js";
export class ManagedSessionStore extends EventEmitter {
    sessions = new Map();
    create(opts) {
        const session = new ManagedSession(opts);
        session.on("exit", () => {
            // Keep exited sessions in the store for a while so clients can see the exit status.
            // They'll be cleaned up on next shutdown or explicit removal.
            if (this.getRunningCount() === 0) {
                this.emit("idle");
            }
        });
        this.sessions.set(session.id, session);
        this.emit("active");
        return session;
    }
    getRunningCount() {
        let count = 0;
        for (const session of this.sessions.values()) {
            if (!session.hasExited())
                count++;
        }
        return count;
    }
    get(id) {
        return this.sessions.get(id);
    }
    list() {
        return Array.from(this.sessions.values());
    }
    remove(id) {
        const session = this.sessions.get(id);
        if (!session)
            return false;
        session.kill();
        session.removeAllListeners();
        return this.sessions.delete(id);
    }
    shutdown() {
        for (const [id, session] of this.sessions) {
            session.kill();
            session.removeAllListeners();
            this.sessions.delete(id);
        }
    }
}
//# sourceMappingURL=managed-session-store.js.map