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

    // Replace xterm's touch scrolling by monkey-patching the internal
    // viewport methods. xterm's built-in handler manipulates a hidden
    // scrollTop div which is sluggish on mobile Safari. We replace it
    // with term.scrollLines() + momentum, and add alt-buffer key support.
    const core = (term as any)._core;
    const viewport = core?._viewport;
    const hScrollEl = containerRef.current?.parentElement;
    if (viewport) {
      // Ring buffer of recent touch samples for velocity calculation.
      // Quick swipes may only produce 1-2 touchmove events, so EMA
      // doesn't work. Instead we store recent positions and compute
      // velocity from the samples at touchend.
      const samples: { x: number; y: number; t: number }[] = [];
      const MAX_SAMPLES = 5;
      const SAMPLE_WINDOW = 100; // only use samples from last 100ms

      let accumY = 0;
      let velocityX = 0;
      let velocityY = 0;
      let momentumRaf = 0;
      const FRICTION = 0.95;
      const MIN_VELOCITY = 0.5;

      const getCellHeight = (): number =>
        core?._renderService?.dimensions?.css?.cell?.height ?? 16;

      const scrollVertical = (px: number) => {
        const cellH = getCellHeight();
        accumY += px;
        const lines = Math.trunc(accumY / cellH);
        if (lines === 0) return;
        accumY -= lines * cellH;

        if (term.buffer.active.type !== "normal") {
          const seq = lines > 0 ? "\x1b[B" : "\x1b[A";
          for (let i = 0; i < Math.abs(lines); i++) {
            onData(seq);
          }
        } else {
          term.scrollLines(lines);
        }
      };

      const scrollHorizontal = (px: number) => {
        if (hScrollEl) hScrollEl.scrollLeft += px;
      };

      const stopMomentum = () => {
        if (momentumRaf) {
          cancelAnimationFrame(momentumRaf);
          momentumRaf = 0;
        }
        velocityX = 0;
        velocityY = 0;
      };

      const momentumStep = () => {
        velocityX *= FRICTION;
        velocityY *= FRICTION;
        if (Math.abs(velocityX) < MIN_VELOCITY && Math.abs(velocityY) < MIN_VELOCITY) {
          momentumRaf = 0;
          return;
        }
        if (Math.abs(velocityY) >= MIN_VELOCITY) scrollVertical(velocityY);
        if (Math.abs(velocityX) >= MIN_VELOCITY) scrollHorizontal(velocityX);
        momentumRaf = requestAnimationFrame(momentumStep);
      };

      const addSample = (x: number, y: number) => {
        samples.push({ x, y, t: Date.now() });
        if (samples.length > MAX_SAMPLES) samples.shift();
      };

      const computeVelocity = () => {
        const now = Date.now();
        // Find the oldest sample within the time window
        let oldest = samples.length - 1;
        for (let i = 0; i < samples.length; i++) {
          if (now - samples[i].t <= SAMPLE_WINDOW) {
            oldest = i;
            break;
          }
        }
        const last = samples[samples.length - 1];
        const first = samples[oldest];
        if (!last || !first || last === first) return;
        const dt = Math.max(last.t - first.t, 1);
        // pixels per frame (~16ms)
        velocityX = ((first.x - last.x) / dt) * 16;
        velocityY = ((first.y - last.y) / dt) * 16;
      };

      viewport.handleTouchStart = (ev: TouchEvent) => {
        stopMomentum();
        samples.length = 0;
        accumY = 0;
        addSample(ev.touches[0].clientX, ev.touches[0].clientY);
      };

      viewport.handleTouchMove = (ev: TouchEvent): boolean => {
        const x = ev.touches[0].clientX;
        const y = ev.touches[0].clientY;
        const prev = samples[samples.length - 1];
        if (prev) {
          const dx = prev.x - x;
          const dy = prev.y - y;
          if (dy !== 0) scrollVertical(dy);
          if (dx !== 0) scrollHorizontal(dx);
        }
        addSample(x, y);
        return false; // tell xterm to preventDefault
      };

      const screenEl = term.element?.querySelector(".xterm-screen");
      if (screenEl) {
        screenEl.addEventListener("touchend", (ev: TouchEvent) => {
          // Record final position from changedTouches
          if (ev.changedTouches.length > 0) {
            addSample(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY);
          }
          computeVelocity();
          if (Math.abs(velocityX) > MIN_VELOCITY || Math.abs(velocityY) > MIN_VELOCITY) {
            momentumRaf = requestAnimationFrame(momentumStep);
          }
        }, { passive: true });
      }
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
