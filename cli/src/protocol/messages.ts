// --- Shared types ---

export interface SessionInfo {
  id: string;
  name: string;
  status: "running" | "exited";
  attachedClients: number;
  source: "managed" | "tmux";
}

// --- Client → Server ---

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

export type ClientMessage =
  | ListSessionsMessage
  | CreateSessionMessage
  | AttachMessage
  | InputMessage
  | ResizeMessage
  | DetachMessage;

// --- Server → Client ---

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

export interface SessionRemovedResponse {
  type: "session_removed";
  seq: number;
  payload: {
    id: string;
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

export type ServerMessage =
  | SessionListResponse
  | SessionCreatedResponse
  | SessionRemovedResponse
  | AttachedResponse
  | ResizedResponse
  | DetachedResponse
  | ErrorResponse;

export function parseClientMessage(data: string): ClientMessage {
  const msg = JSON.parse(data);

  if (!msg.type || typeof msg.seq !== "number") {
    throw new Error("Invalid message: missing type or seq");
  }

  switch (msg.type) {
    case "list_sessions":
    case "create_session":
    case "attach":
    case "input":
    case "resize":
    case "detach":
      return msg as ClientMessage;
    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
