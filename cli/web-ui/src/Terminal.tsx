import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { ChevronUp, ChevronDown, ArrowLeftToLine, CornerDownLeft, Minus } from "lucide-react";

interface TerminalViewProps {
  attachedId: string | null;
  termSize: { cols: number; rows: number } | null;
  termRef: MutableRefObject<Terminal | null>;
  onData: (data: string) => void;
  onReady: () => void;
  connected: boolean;
  sessionCount: number;
}

export default function TerminalView({
  attachedId,
  termSize,
  termRef,
  onData,
  onReady,
  connected,
  sessionCount,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);

  const showTerminal = attachedId !== null;

  // Only open xterm once the container is visible — opening in a display:none
  // container breaks character measurement and corrupts layout on reload.
  useEffect(() => {
    if (!showTerminal || initRef.current || !containerRef.current) return;
    initRef.current = true;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
      theme: {
        background: "#0a0a0f",
        foreground: "#e4e4e7",
        cursor: "#6366f1",
        selectionBackground: "#6366f140",
      },
      scrollback: 5000,
    });
    term.open(containerRef.current);
    termRef.current = term;
    term.onData(onData);

    // Suppress Safari's form accessory bar
    if (term.textarea) {
      term.textarea.setAttribute("autocorrect", "off");
      term.textarea.setAttribute("autocapitalize", "off");
      term.textarea.setAttribute("spellcheck", "false");
      term.textarea.setAttribute("autocomplete", "off");
    }

    // Completely take over touch scrolling from xterm.
    // xterm's built-in touch handler manipulates a hidden scrollTop div which
    // is sluggish on mobile Safari. We intercept all touch events in the
    // capture phase, stop them from reaching xterm, and scroll programmatically
    // with momentum/inertia for a native feel.
    const screenEl = term.element?.querySelector(".xterm-screen") as HTMLElement | null;
    if (screenEl) {
      let lastY = 0;
      let accum = 0;
      let velocity = 0;
      let lastTime = 0;
      let momentumRaf = 0;
      const FRICTION = 0.92;
      const MIN_VELOCITY = 0.5;

      const getCellHeight = (): number => {
        const core = (term as any)._core;
        return core?._renderService?.dimensions?.css?.cell?.height ?? 16;
      };

      const isAltBuffer = (): boolean =>
        term.buffer.active.type !== "normal";

      const scrollByPixels = (px: number) => {
        const cellH = getCellHeight();
        accum += px;
        const lines = Math.trunc(accum / cellH);
        if (lines === 0) return;
        accum -= lines * cellH;

        if (isAltBuffer()) {
          // Alt buffer: send up/down key sequences
          const seq = lines > 0 ? "\x1b[B" : "\x1b[A";
          for (let i = 0; i < Math.abs(lines); i++) {
            onData(seq);
          }
        } else {
          // Normal buffer: use xterm's scrollLines API
          term.scrollLines(lines);
        }
      };

      const stopMomentum = () => {
        if (momentumRaf) {
          cancelAnimationFrame(momentumRaf);
          momentumRaf = 0;
        }
        velocity = 0;
      };

      const momentumStep = () => {
        velocity *= FRICTION;
        if (Math.abs(velocity) < MIN_VELOCITY) {
          velocity = 0;
          momentumRaf = 0;
          return;
        }
        scrollByPixels(velocity);
        momentumRaf = requestAnimationFrame(momentumStep);
      };

      const onStart = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        stopMomentum();
        lastY = e.touches[0].clientY;
        lastTime = Date.now();
        velocity = 0;
        accum = 0;
      };

      const onMove = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const y = e.touches[0].clientY;
        const now = Date.now();
        const dy = lastY - y; // positive = scrolling down (content moves up)
        const dt = Math.max(now - lastTime, 1);

        // Exponential moving average for smooth velocity
        const instantV = dy / dt * 16; // normalize to ~per-frame
        velocity = velocity * 0.4 + instantV * 0.6;

        lastY = y;
        lastTime = now;

        if (dy !== 0) scrollByPixels(dy);
      };

      const onEnd = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Kick off momentum if there's enough velocity
        if (Math.abs(velocity) > MIN_VELOCITY) {
          momentumRaf = requestAnimationFrame(momentumStep);
        }
      };

      // Capture phase + stopPropagation prevents xterm's broken handlers from firing
      screenEl.addEventListener("touchstart", onStart, { capture: true, passive: false });
      screenEl.addEventListener("touchmove", onMove, { capture: true, passive: false });
      screenEl.addEventListener("touchend", onEnd, { capture: true, passive: false });
      screenEl.addEventListener("touchcancel", onEnd, { capture: true, passive: false });
    }

    // Apply size immediately if already known
    if (termSize && termSize.cols > 0 && termSize.rows > 0) {
      term.resize(termSize.cols, termSize.rows);
    }

    // Flush any buffered data that arrived before the terminal was ready
    onReady();

    return () => {
      term.dispose();
    };
  }, [showTerminal, termRef, onData, onReady, termSize]);

  // Resize terminal to match server's PTY dimensions
  useEffect(() => {
    const term = termRef.current;
    if (term && termSize && termSize.cols > 0 && termSize.rows > 0) {
      term.resize(termSize.cols, termSize.rows);
    }
  }, [termSize, termRef]);

  const sendKey = useCallback(
    (seq: string) => {
      onData(seq);
      termRef.current?.focus();
    },
    [onData, termRef],
  );

  const keys: { label: string; icon: React.ReactNode; seq: string }[] = [
    { label: "Tab", icon: <ArrowLeftToLine size={14} />, seq: "\t" },
    { label: "S-Tab", icon: <span className="text-[10px] font-mono leading-none">S-Tab</span>, seq: "\x1b[Z" },
    { label: "Up", icon: <ChevronUp size={14} />, seq: "\x1b[A" },
    { label: "Down", icon: <ChevronDown size={14} />, seq: "\x1b[B" },
    { label: "Esc", icon: <span className="text-[10px] font-mono leading-none">Esc</span>, seq: "\x1b" },
    { label: "Ctrl-C", icon: <span className="text-[10px] font-mono leading-none">^C</span>, seq: "\x03" },
    { label: "Ctrl-D", icon: <span className="text-[10px] font-mono leading-none">^D</span>, seq: "\x04" },
    { label: "Dash", icon: <Minus size={14} />, seq: "-" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      <div className="flex-1 overflow-x-auto overflow-y-hidden relative">
        <div
          ref={containerRef}
          className="inline-block min-w-full p-1"
          style={{
            display: showTerminal ? "inline-block" : "none",
          }}
        />
        {!showTerminal && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            {connected && sessionCount === 0 ? (
              <div className="text-center max-w-xs space-y-3">
                <p className="text-sm text-zinc-400">No shared terminals</p>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Run <code className="px-1.5 py-0.5 rounded text-zinc-400" style={{ background: "var(--bg-elevated)" }}>terminalsync share</code> in
                  a terminal to start sharing. The session will appear here automatically.
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-600">Connecting...</p>
            )}
          </div>
        )}
      </div>

      {showTerminal && (
        <div
          className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto shrink-0"
          style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}
        >
          {keys.map((k) => (
            <button
              key={k.label}
              tabIndex={-1}
              onPointerDown={(e) => {
                e.preventDefault();
                sendKey(k.seq);
              }}
              className="flex items-center justify-center h-8 min-w-[2.5rem] px-2 rounded-md text-zinc-400 active:bg-white/10 hover:bg-white/5 transition-colors select-none"
              style={{ background: "var(--bg-elevated)" }}
            >
              {k.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
