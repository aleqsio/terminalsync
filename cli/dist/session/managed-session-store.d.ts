import { EventEmitter } from "node:events";
import { ManagedSession, type ManagedSessionOptions } from "./managed-session.js";
export declare class ManagedSessionStore extends EventEmitter {
    private sessions;
    create(opts: ManagedSessionOptions): ManagedSession;
    getRunningCount(): number;
    get(id: string): ManagedSession | undefined;
    list(): ManagedSession[];
    remove(id: string): boolean;
    shutdown(): void;
}
