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
  const wrapperRef = useRef<HTMLDivElement>(null);
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

    // xterm 6.x has built-in Gesture-based touch scrolling with inertia.
    // We add two things on top:
    // 1. Alt-buffer support: intercept gesture events → arrow key sequences
    // 2. Horizontal scrolling: track raw touch events → update wrapper scrollLeft
    const screenEl = term.screenElement;
    if (screenEl) {
      const core = (term as any)._core;
      const GESTURE_CHANGE = "-xterm-gesturechange";
      const GESTURE_START = "-xterm-gesturestart";
      let accumY = 0;

      const getCellHeight = (): number =>
        core?._renderService?.dimensions?.css?.cell?.height ?? 16;

      // Reset accumulator on gesture start
      screenEl.addEventListener(GESTURE_START, () => {
        accumY = 0;
      });

      // Alt buffer: intercept gesture change → arrow key sequences
      screenEl.addEventListener(GESTURE_CHANGE, ((e: Event) => {
        if (term.buffer.active.type !== "normal") {
          const ge = e as Event & { translationY: number };
          e.stopImmediatePropagation();
          e.preventDefault();

          const cellH = getCellHeight();
          accumY += ge.translationY;
          const lines = Math.trunc(accumY / cellH);
          if (lines !== 0) {
            accumY -= lines * cellH;
            const seq = lines < 0 ? "\x1b[B" : "\x1b[A";
            for (let i = 0; i < Math.abs(lines); i++) {
              onData(seq);
            }
          }
        }
      }) as EventListener);

      // Horizontal scrolling via raw touch events.
      // xterm's Gesture class handles vertical; we handle horizontal on
      // the overflow-x-auto wrapper. touch-action:none blocks native scroll.
      let lastTouchX: number | null = null;
      const getHScrollEl = (): HTMLElement | null =>
        containerRef.current?.parentElement ?? null;

      screenEl.addEventListener("touchstart", (e: TouchEvent) => {
        lastTouchX = e.touches[0].clientX;
      }, { passive: true });

      screenEl.addEventListener("touchmove", (e: TouchEvent) => {
        if (lastTouchX !== null) {
          const x = e.touches[0].clientX;
          const dx = lastTouchX - x;
          lastTouchX = x;
          if (dx !== 0) {
            const el = getHScrollEl();
            if (el) el.scrollLeft += dx;
          }
        }
      }, { passive: true });

      screenEl.addEventListener("touchend", () => {
        lastTouchX = null;
      }, { passive: true });
    }

    // Pin the wrapper's vertical scroll to the bottom so the cursor row
    // is always visible when the terminal is taller than the viewport.
    const pinToBottom = () => {
      const w = wrapperRef.current;
      if (w) w.scrollTop = w.scrollHeight;
    };
    pinToBottom();
    // Re-pin whenever the terminal renders new content
    const resizeObs = new ResizeObserver(pinToBottom);
    if (term.element) resizeObs.observe(term.element);

    // Flush any buffered data that arrived before the terminal was ready
    onReady();

    return () => {
      resizeObs.disconnect();
      term.dispose();
      termRef.current = null;
      initRef.current = false;
    };
    // termSize intentionally excluded — the resize effect handles size changes.
    // Including it here would destroy & recreate the terminal on every resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTerminal, termRef, onData, onReady]);

  // Resize terminal to match server's PTY dimensions
  useEffect(() => {
    const term = termRef.current;
    if (term && termSize && termSize.cols > 0 && termSize.rows > 0) {
      term.resize(termSize.cols, termSize.rows);
      // Re-pin scroll to bottom after resize
      const w = wrapperRef.current;
      if (w) w.scrollTop = w.scrollHeight;
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
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      <div ref={wrapperRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-auto relative">
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
