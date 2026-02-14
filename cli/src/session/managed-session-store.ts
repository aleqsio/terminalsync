import { EventEmitter } from "node:events";
import { ManagedSession, type ManagedSessionOptions } from "./managed-session.js";

export class ManagedSessionStore extends EventEmitter {
  private sessions = new Map<string, ManagedSession>();

  create(opts: ManagedSessionOptions): ManagedSession {
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

  getRunningCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (!session.hasExited()) count++;
    }
    return count;
  }

  get(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  list(): ManagedSession[] {
    return Array.from(this.sessions.values());
  }

  remove(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.kill();
    session.removeAllListeners();
    return this.sessions.delete(id);
  }

  shutdown(): void {
    for (const [id, session] of this.sessions) {
      session.kill();
      session.removeAllListeners();
      this.sessions.delete(id);
    }
  }
}
