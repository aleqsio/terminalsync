import { useState, useRef, useCallback, useEffect } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import Toolbar from "./Toolbar";
import SessionBar from "./SessionBar";
import TerminalView from "./Terminal";

export interface Session {
  id: string;
  name: string;
  status: string;
  attachedClients: number;
  source: string;
}

function parseHash(): { token: string; sessionId: string | null } {
  if (location.hash.length <= 1) return { token: "", sessionId: null };
  const val = decodeURIComponent(location.hash.slice(1));
  const idx = val.indexOf("/");
  if (idx !== -1) {
    return { token: val.slice(0, idx), sessionId: val.slice(idx + 1) };
  }
  return { token: val, sessionId: null };
}

export default function App() {
  const { token: hashToken, sessionId: hashSessionId } = parseHash();

  const [token, setToken] = useState(hashToken);
  const [status, setStatus] = useState<{ text: string; color: string }>({
    text: "disconnected",
    color: "#888",
  });
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attachedId, setAttachedId] = useState<string | null>(null);
  const [splashText, setSplashText] = useState(
    "No session attached. Connect and click a session above.",
  );

  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAttachRef = useRef<string | null>(hashSessionId);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const attachedIdRef = useRef<string | null>(null);

  // Keep ref in sync
  useEffect(() => {
    attachedIdRef.current = attachedId;
  }, [attachedId]);

  const sendMsg = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ...msg, seq: ++seqRef.current }));
    }
  }, []);

  const listSessions = useCallback(() => {
    sendMsg({ type: "list_sessions", payload: {} });
  }, [sendMsg]);

  const attachTo = useCallback(
    (id: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (attachedIdRef.current) {
        sendMsg({ type: "detach", payload: {} });
      }
      const fit = fitRef.current;
      if (fit) fit.fit();
      const term = termRef.current;
      sendMsg({
        type: "attach",
        payload: {
          target: id,
          cols: term?.cols ?? 80,
          rows: term?.rows ?? 24,
        },
      });
    },
    [sendMsg],
  );

  const handleMessage = useCallback(
    (msg: { type: string; payload: Record<string, unknown> }) => {
      switch (msg.type) {
        case "session_list": {
          const list = msg.payload.sessions as Session[];
          setSessions(list);
          const auto = autoAttachRef.current;
          if (auto && !attachedIdRef.current) {
            const target = list.find(
              (s) => s.id === auto || s.id.startsWith(auto),
            );
            if (target) {
              autoAttachRef.current = null;
              attachTo(target.id);
            }
          }
          break;
        }
        case "session_created":
          listSessions();
          break;
        case "attached": {
          const target = msg.payload.target as string;
          setAttachedId(target);
          setSplashText("");
          const term = termRef.current;
          const fit = fitRef.current;
          if (term) {
            term.clear();
            if (fit) fit.fit();
            term.focus();
          }
          break;
        }
        case "detached":
          setAttachedId(null);
          if (msg.payload.reason === "session_exit") {
            setSplashText("Session exited.");
          } else {
            setSplashText(
              "No session attached. Connect and click a session above.",
            );
          }
          listSessions();
          break;
        case "error":
          console.error("Server error:", msg.payload.message);
          break;
      }
    },
    [attachTo, listSessions],
  );

  const doConnect = useCallback(
    (tok: string) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${proto}://${location.host}?token=${encodeURIComponent(tok)}`,
      );
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      setStatus({ text: "connecting...", color: "#e9a945" });
      setConnected(true);

      ws.addEventListener("open", () => {
        setStatus({ text: "connected", color: "#4caf50" });
        sendMsg({ type: "list_sessions", payload: {} });
        pollRef.current = setInterval(listSessions, 3000);
      });

      ws.addEventListener("message", (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          termRef.current?.write(new Uint8Array(evt.data));
          return;
        }
        handleMessage(JSON.parse(evt.data));
      });

      ws.addEventListener("close", () => {
        setStatus({ text: "disconnected", color: "#888" });
        setConnected(false);
        wsRef.current = null;
        setAttachedId(null);
        setSessions([]);
        setSplashText(
          "No session attached. Connect and click a session above.",
        );
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      });

      ws.addEventListener("error", () => {
        setStatus({ text: "error", color: "#e94560" });
      });
    },
    [sendMsg, listSessions, handleMessage],
  );

  const handleConnectToggle = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close();
      return;
    }
    if (!token.trim()) return;
    doConnect(token.trim());
  }, [token, doConnect]);

  // Resize handler
  const handleTermResize = useCallback(() => {
    const fit = fitRef.current;
    if (fit) fit.fit();
    const term = termRef.current;
    if (term && wsRef.current?.readyState === WebSocket.OPEN && attachedIdRef.current) {
      sendMsg({
        type: "resize",
        payload: { cols: term.cols, rows: term.rows },
      });
    }
  }, [sendMsg]);

  // Terminal input handler
  const handleTermData = useCallback(
    (data: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && attachedIdRef.current) {
        sendMsg({ type: "input", payload: { data } });
      }
    },
    [sendMsg],
  );

  return (
    <>
      <Toolbar
        token={token}
        onTokenChange={setToken}
        onConnect={handleConnectToggle}
        connected={connected}
        status={status}
      />
      <SessionBar
        sessions={sessions}
        attachedId={attachedId}
        onSelect={attachTo}
      />
      <TerminalView
        attachedId={attachedId}
        splashText={splashText}
        termRef={termRef}
        fitRef={fitRef}
        onResize={handleTermResize}
        onData={handleTermData}
      />
    </>
  );
}
