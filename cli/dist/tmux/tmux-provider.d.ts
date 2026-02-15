import type { SessionInfo } from "../protocol/messages.js";
export declare class TmuxProvider {
    private available;
    isAvailable(): Promise<boolean>;
    listSessions(): Promise<SessionInfo[]>;
}
