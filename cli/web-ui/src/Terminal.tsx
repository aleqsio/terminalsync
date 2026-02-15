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
      scrollSensitivity: 3,
      fastScrollSensitivity: 10,
    });
    term.open(containerRef.current);
    termRef.current = term;
    term.onData(onData);

    // Suppress Safari's form accessory bar (< > Done) by making the
    // textarea the only tabbable element and disabling autocorrect
    if (term.textarea) {
      term.textarea.setAttribute("autocorrect", "off");
      term.textarea.setAttribute("autocapitalize", "off");
      term.textarea.setAttribute("spellcheck", "false");
      term.textarea.setAttribute("autocomplete", "off");
    }

    // Improved touch scrolling (port of xtermjs/xterm.js#5685).
    // xterm 5.5.0's built-in touch handler only scrolls the viewport, which
    // does nothing in alt-buffer apps (vim, less, tmux). We intercept touch
    // events in the capture phase and, when in alt buffer, convert them to
    // up/down key sequences — matching what the wheel handler already does.
    const screenEl = term.element?.querySelector(".xterm-screen") as HTMLElement | null;
    if (screenEl) {
      let lastTouchY = 0;
      let touchAccum = 0;

      const getCellHeight = (): number => {
        // Access internal render dimensions via the undocumented _core
        const core = (term as any)._core;
        return core?._renderService?.dimensions?.css?.cell?.height ?? 16;
      };

      const onTouchStart = (e: TouchEvent) => {
        lastTouchY = e.touches[0].pageY;
        touchAccum = 0;
      };

      const onTouchMove = (e: TouchEvent) => {
        const currentY = e.touches[0].pageY;
        const deltaY = lastTouchY - currentY;
        lastTouchY = currentY;

        if (deltaY === 0) return;

        // Alt buffer (no scrollback) — send up/down arrow sequences
        if (!term.buffer.normal.length || term.buffer.active.type !== "normal") {
          e.preventDefault();
          e.stopPropagation();

          const cellHeight = getCellHeight();
          touchAccum += deltaY;
          const lines = Math.trunc(touchAccum / cellHeight);
          if (lines === 0) return;
          touchAccum -= lines * cellHeight;

          const seq = lines < 0 ? "\x1b[A" : "\x1b[B";
          for (let i = 0; i < Math.abs(lines); i++) {
            onData(seq);
          }
          return;
        }

        // Normal buffer — let xterm's built-in handler scroll the viewport
        // (don't stop propagation so xterm's touchmove listener fires)
      };

      screenEl.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
      screenEl.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
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
