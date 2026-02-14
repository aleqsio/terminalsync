import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionInfo {
  id: string;
  name: string;
  status: "running" | "exited";
  attachedClients: number;
  source: "managed" | "tmux";
}

interface ServerMessage {
  type: string;
  seq: number;
  payload: Record<string, unknown>;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

let seqCounter = 0;
function nextSeq() {
  return ++seqCounter;
}

function isJsonMessage(data: string): boolean {
  const trimmed = data.trimStart();
  return trimmed.startsWith("{");
}

export function useTerminalSync() {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [attachedSession, setAttachedSession] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState("");
  const outputRef = useRef("");

  const appendOutput = useCallback((text: string) => {
    outputRef.current += text;
    if (outputRef.current.length > 50000) {
      outputRef.current = outputRef.current.slice(-40000);
    }
    setTerminalOutput(outputRef.current);
  }, []);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log(`[TS] >>> SEND ${msg.type} seq=${msg.seq}`);
      ws.send(JSON.stringify(msg));
    } else {
      console.warn(`[TS] SEND FAILED (readyState=${ws?.readyState}) ${msg.type}`);
    }
  }, []);

  const connect = useCallback((wsUrl: string, token: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const separator = wsUrl.includes("?") ? "&" : "?";
    const url = `${wsUrl}${separator}token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    // RN ignores binaryType, always delivers strings
    wsRef.current = ws;
    setStatus("connecting");
    console.log(`[TS] Connecting: wsUrl=${wsUrl} token=${token ? token.slice(0, 4) + "..." : "(empty)"}`);

    ws.onopen = () => {
      console.log("[TS] WS onopen fired");
      setStatus("connected");
      send({ type: "list_sessions", seq: nextSeq(), payload: {} });
    };

    ws.onmessage = (event) => {
      const raw = event.data;

      // RN WebSocket delivers everything as strings.
      // Binary terminal data is raw text, JSON messages start with {
      if (typeof raw === "string") {
        if (isJsonMessage(raw)) {
          try {
            const msg: ServerMessage = JSON.parse(raw);
            console.log(`[TS] <<< RECV ${msg.type} seq=${msg.seq} payload=${JSON.stringify(msg.payload).slice(0, 120)}`);
            switch (msg.type) {
              case "session_list":
                setSessions(
                  (msg.payload as { sessions: SessionInfo[] }).sessions
                );
                break;
              case "attached":
                setAttachedSession(
                  (msg.payload as { target: string }).target
                );
                break;
              case "detached":
                setAttachedSession(null);
                break;
              case "error":
                console.error(`[TS] ERROR: ${(msg.payload as { message: string }).message}`);
                break;
            }
          } catch (e) {
            // Not valid JSON — treat as terminal output
            console.log(`[TS] <<< TEXT (json parse failed) ${raw.length} chars`);
            appendOutput(raw);
          }
        } else {
          // Terminal output
          console.log(`[TS] <<< TEXT ${raw.length} chars`);
          appendOutput(raw);
        }
        return;
      }

      // ArrayBuffer (unlikely in RN but handle anyway)
      if (raw instanceof ArrayBuffer) {
        const text = new TextDecoder().decode(raw);
        console.log(`[TS] <<< BINARY ${raw.byteLength}B`);
        appendOutput(text);
        return;
      }

      console.warn(`[TS] <<< UNKNOWN data type: ${typeof raw}`);
    };

    ws.onclose = (ev) => {
      console.log(`[TS] WS onclose code=${ev.code} reason=${ev.reason}`);
      setStatus("disconnected");
      setAttachedSession(null);
    };

    ws.onerror = (ev) => {
      console.error(`[TS] WS onerror: ${JSON.stringify(ev).slice(0, 200)}`);
      setStatus("disconnected");
    };
  }, [send, appendOutput]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("disconnected");
    setAttachedSession(null);
  }, []);

  const listSessions = useCallback(() => {
    send({ type: "list_sessions", seq: nextSeq(), payload: {} });
  }, [send]);

  const attach = useCallback(
    (sessionId: string, cols: number, rows: number) => {
      console.log(`[TS] attach() called for ${sessionId} cols=${cols} rows=${rows}`);
      outputRef.current = "";
      setTerminalOutput("");
      send({
        type: "attach",
        seq: nextSeq(),
        payload: { target: sessionId, cols, rows },
      });
    },
    [send]
  );

  const resize = useCallback(
    (cols: number, rows: number) => {
      send({ type: "resize", seq: nextSeq(), payload: { cols, rows } });
    },
    [send]
  );

  const detach = useCallback(() => {
    console.log("[TS] detach() called");
    send({ type: "detach", seq: nextSeq(), payload: {} });
  }, [send]);

  const sendInput = useCallback(
    (data: string) => {
      send({ type: "input", seq: nextSeq(), payload: { data } });
    },
    [send]
  );

  // Auto-refresh session list
  useEffect(() => {
    if (status !== "connected" || attachedSession) return;
    const interval = setInterval(listSessions, 3000);
    return () => clearInterval(interval);
  }, [status, attachedSession, listSessions]);

  return {
    status,
    sessions,
    attachedSession,
    terminalOutput,
    connect,
    disconnect,
    listSessions,
    attach,
    resize,
    detach,
    sendInput,
  };
}
