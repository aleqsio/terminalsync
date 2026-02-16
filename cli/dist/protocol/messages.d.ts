export interface SessionInfo {
    id: string;
    name: string;
    status: "running" | "exited";
    attachedClients: number;
    source: "managed" | "tmux";
}
export interface ListSessionsMessage {
    type: "list_sessions";
    seq: number;
    payload: Record<string, never>;
}
export interface CreateSessionMessage {
    type: "create_session";
    seq: number;
    payload: {
        name: string;
        cols: number;
        rows: number;
    };
}
export interface AttachMessage {
    type: "attach";
    seq: number;
    payload: {
        target: string;
        cols: number;
        rows: number;
    };
}
export interface InputMessage {
    type: "input";
    seq: number;
    payload: {
        data: string;
    };
}
export interface ResizeMessage {
    type: "resize";
    seq: number;
    payload: {
        cols: number;
        rows: number;
    };
}
export interface DetachMessage {
    type: "detach";
    seq: number;
    payload: Record<string, never>;
}
export type ClientMessage = ListSessionsMessage | CreateSessionMessage | AttachMessage | InputMessage | ResizeMessage | DetachMessage;
export interface SessionListResponse {
    type: "session_list";
    seq: number;
    payload: {
        sessions: SessionInfo[];
    };
}
export interface SessionCreatedResponse {
    type: "session_created";
    seq: number;
    payload: {
        id: string;
        name: string;
    };
}
export interface AttachedResponse {
    type: "attached";
    seq: number;
    payload: {
        target: string;
        cols: number;
        rows: number;
    };
}
export interface DetachedResponse {
    type: "detached";
    seq: number;
    payload: {
        reason: "client_request" | "session_exit" | "error";
        message?: string;
    };
}
export interface ResizedResponse {
    type: "resized";
    seq: number;
    payload: {
        cols: number;
        rows: number;
    };
}
export interface ErrorResponse {
    type: "error";
    seq: number;
    payload: {
        code: string;
        message: string;
    };
}
export type ServerMessage = SessionListResponse | SessionCreatedResponse | AttachedResponse | ResizedResponse | DetachedResponse | ErrorResponse;
export declare function parseClientMessage(data: string): ClientMessage;
