import { useState, useRef, useCallback, useEffect } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import Drawer from "./Drawer";
import TerminalView from "./Terminal";
import { Menu, Wifi, WifiOff, Loader2 } from "lucide-react";

export interface Session {
  id: string;
  name: string;
  status: string;
  attachedClients: number;
  source: string;
}

type ConnStatus = "connecting" | "connected" | "disconnected" | "error";

function parseHash(): { token: string; sessionId: string | null } {
  if (location.hash.length <= 1) return { token: "", sessionId: null };
  const val = decodeURIComponent(location.hash.slice(1));
  const idx = val.indexOf("/");
  if (idx !== -1)
    return { token: val.slice(0, idx), sessionId: val.slice(idx + 1) };
  return { token: val, sessionId: null };
}

export default function App() {
  const { token, sessionId: hashSessionId } = parseHash();

  const [status, setStatus] = useState<ConnStatus>("disconnected");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attachedId, setAttachedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [termSize, setTermSize] = useState<{
    cols: number;
    rows: number;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAttachRef = useRef<string | null>(hashSessionId);
  const reattachRef = useRef<string | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const attachedIdRef = useRef<string | null>(null);
  const pendingDataRef = useRef<Uint8Array[]>([]);

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
      // Send cols=0, rows=0 — we adopt the session's size
      sendMsg({
        type: "attach",
        payload: { target: id, cols: 0, rows: 0 },
      });
      setDrawerOpen(false);
    },
    [sendMsg],
  );

  const handleMessage = useCallback(
    (msg: { type: string; payload: Record<string, unknown> }) => {
      switch (msg.type) {
        case "session_list": {
          const list = msg.payload.sessions as Session[];
          setSessions(list);
          // Try auto-attach from URL hash
          const auto = autoAttachRef.current;
          if (auto && !attachedIdRef.current) {
            const target = list.find(
              (s) => s.id === auto || s.id.startsWith(auto),
            );
            if (target) {
              autoAttachRef.current = null;
              attachTo(target.id);
              break;
            }
          }
          // Re-attach after reconnect
          const reattach = reattachRef.current;
          if (reattach && !attachedIdRef.current) {
            const target = list.find((s) => s.id === reattach);
            if (target) {
              reattachRef.current = null;
              attachTo(target.id);
              break;
            }
            // Session gone — clear cached state
            reattachRef.current = null;
            setAttachedId(null);
            setTermSize(null);
          }
          // Auto-attach to first session if only one exists
          if (!auto && !reattach && !attachedIdRef.current && list.length === 1) {
            attachTo(list[0].id);
          }
          break;
        }
        case "session_created":
          listSessions();
          break;
        case "attached": {
          const target = msg.payload.target as string;
          const cols = msg.payload.cols as number;
          const rows = msg.payload.rows as number;
          const isReattach = reattachRef.current === target;
          reattachRef.current = null;
          setAttachedId(target);
          setTermSize({ cols, rows });
          const term = termRef.current;
          if (term) {
            if (!isReattach) term.clear();
            term.focus();
          }
          break;
        }
        case "detached":
          setAttachedId(null);
          setTermSize(null);
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
      setStatus("connecting");

      ws.addEventListener("open", () => {
        setStatus("connected");
        sendMsg({ type: "list_sessions", payload: {} });
        pollRef.current = setInterval(listSessions, 3000);
      });

      ws.addEventListener("message", (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          const data = new Uint8Array(evt.data);
          if (termRef.current) {
            termRef.current.write(data);
          } else {
            pendingDataRef.current.push(data);
          }
          return;
        }
        handleMessage(JSON.parse(evt.data));
      });

      ws.addEventListener("close", () => {
        setStatus("disconnected");
        wsRef.current = null;
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        // Remember what we were attached to so we can re-attach after reconnect
        if (attachedIdRef.current) {
          reattachRef.current = attachedIdRef.current;
        }
        // Keep sessions/attachedId/termSize cached — UI stays stable during brief disconnects
        // Reconnect after 2s
        setTimeout(() => {
          if (tok) doConnect(tok);
        }, 2000);
      });

      ws.addEventListener("error", () => {
        setStatus("error");
      });
    },
    [sendMsg, listSessions, handleMessage],
  );

  // Auto-connect on mount
  useEffect(() => {
    if (token) doConnect(token);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track visual viewport so the layout (and shortcut bar) stays above the iOS keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.getElementById("root");
    if (!root) return;

    const update = () => {
      root.style.height = `${vv.height}px`;
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  const handleTermData = useCallback(
    (data: string) => {
      if (
        wsRef.current?.readyState === WebSocket.OPEN &&
        attachedIdRef.current
      ) {
        sendMsg({ type: "input", payload: { data } });
      }
    },
    [sendMsg],
  );

  const handleTermReady = useCallback(() => {
    const pending = pendingDataRef.current;
    if (pending.length > 0 && termRef.current) {
      for (const chunk of pending) {
        termRef.current.write(chunk);
      }
      pendingDataRef.current = [];
    }
  }, []);

  const StatusIcon = () => {
    if (status === "connecting")
      return <Loader2 size={14} className="animate-spin text-yellow-400" />;
    if (status === "connected")
      return <Wifi size={14} className="text-emerald-400" />;
    if (status === "error")
      return <WifiOff size={14} className="text-red-400" />;
    return <WifiOff size={14} className="text-zinc-500" />;
  };

  return (
    <>
      {/* Header */}
      <header className="flex items-center h-11 px-3 gap-3 shrink-0" style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className="p-1.5 rounded-md hover:bg-white/5 transition-colors"
        >
          <Menu size={18} className="text-zinc-400" />
        </button>
        <span className="text-sm font-medium text-zinc-300">
          TerminalSync
        </span>
        <div className="flex-1" />
        <StatusIcon />
      </header>

      {/* Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sessions={sessions}
        attachedId={attachedId}
        onSelect={attachTo}
      />

      {/* Terminal */}
      <TerminalView
        attachedId={attachedId}
        termSize={termSize}
        termRef={termRef}
        onData={handleTermData}
        onReady={handleTermReady}
        connected={status === "connected"}
        sessionCount={sessions.length}
      />
    </>
  );
}
