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
  const [hostCols, setHostCols] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAttachRef = useRef<string | null>(hashSessionId);
  const reattachRef = useRef<string | null>(null);
  const switchingRef = useRef(false);
  const termRef = useRef<XTerm | null>(null);
  const attachedIdRef = useRef<string | null>(null);
  // Tracks whether we've received "attached" on the CURRENT WS connection.
  // Prevents sending resize/input to the server during reconnect when
  // attachedIdRef still holds the old session ID for UI stability.
  const wsAttachedRef = useRef(false);
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
        // Mark that we're switching so the "detached" handler doesn't
        // clear attachedId (which would destroy and re-create the terminal).
        switchingRef.current = true;
        sendMsg({ type: "detach", payload: {} });
      }
      // Send cols=0, rows=0 — adopt the host's width, then send fitted rows
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
          // Re-attach after reconnect (wsAttachedRef is false during reconnect
          // even though attachedIdRef is kept for visual stability)
          const reattach = reattachRef.current;
          if (reattach && !wsAttachedRef.current) {
            const target = list.find((s) => s.id === reattach);
            if (target) {
              reattachRef.current = null;
              attachTo(target.id);
              break;
            }
            // Session gone — clear cached state
            reattachRef.current = null;
            setAttachedId(null);
          }
          // Auto-attach to first available session on load
          if (!auto && !reattach && !wsAttachedRef.current && list.length >= 1) {
            attachTo(list[0].id);
          }
          break;
        }
        case "session_created":
          listSessions();
          break;
        case "attached": {
          const target = msg.payload.target as string;
          const isReattach = reattachRef.current === target;
          reattachRef.current = null;
          switchingRef.current = false;
          wsAttachedRef.current = true;
          setAttachedId(target);
          // Adopt the host's column width
          const cols = msg.payload.cols as number;
          if (cols > 0) setHostCols(cols);
          const term = termRef.current;
          if (term) {
            if (!isReattach) term.clear();
            // Resize terminal immediately so incoming data renders at correct width
            if (cols > 0 && cols !== term.cols) {
              term.resize(cols, term.rows);
            }
            // Flush buffered data (buffered during session switch)
            const pending = pendingDataRef.current;
            if (pending.length > 0) {
              for (const chunk of pending) {
                term.write(chunk);
              }
              pendingDataRef.current = [];
            }
            term.focus();
          }
          break;
        }
        case "resized": {
          // Host resized — adopt their new column width
          const rCols = msg.payload.cols as number;
          if (rCols > 0) setHostCols(rCols);
          break;
        }
        case "detached":
          wsAttachedRef.current = false;
          if (switchingRef.current) {
            // Switching sessions — don't clear state (avoids terminal destroy/recreate)
            // Don't reset switchingRef here; it stays true so binary data is
            // buffered until the attached handler processes the new session.
          } else {
            setAttachedId(null);
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
      setStatus("connecting");

      ws.addEventListener("open", () => {
        setStatus("connected");
        sendMsg({ type: "list_sessions", payload: {} });
        pollRef.current = setInterval(listSessions, 3000);
      });

      ws.addEventListener("message", (evt) => {
        if (evt.data instanceof ArrayBuffer) {
          const data = new Uint8Array(evt.data);
          // During session switch, buffer data until the attached handler
          // clears the terminal — otherwise term.clear() wipes it.
          if (termRef.current && !switchingRef.current) {
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
        wsAttachedRef.current = false;
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
      if (wsRef.current?.readyState === WebSocket.OPEN && wsAttachedRef.current) {
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
          tabIndex={-1}
          onClick={() => setDrawerOpen(!drawerOpen)}
          className="p-2.5 -m-1 rounded-md hover:bg-white/5 active:bg-white/10 transition-colors"
        >
          <Menu size={20} className="text-zinc-400" />
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
        termRef={termRef}
        hostCols={hostCols}
        onData={handleTermData}
        onReady={handleTermReady}
        connected={status === "connected"}
        sessionCount={sessions.length}
      />
    </>
  );
}
