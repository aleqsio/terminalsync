import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ChevronUp, ChevronDown, ArrowLeftToLine, CornerDownLeft, Minus } from "lucide-react";

interface TerminalViewProps {
  attachedId: string | null;
  termRef: MutableRefObject<Terminal | null>;
  hostCols: number | null;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: () => void;
  connected: boolean;
  sessionCount: number;
}

export default function TerminalView({
  attachedId,
  termRef,
  hostCols,
  onData,
  onResize,
  onReady,
  connected,
  sessionCount,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);
  const hostColsRef = useRef<number | null>(hostCols);
  const fitAddonRef = useRef<FitAddon | null>(null);

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
      cols: 80,
      rows: 24,
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    // Hide xterm content until first fit to prevent jittery reflow.
    // Use opacity so the container still occupies space for measurement.
    containerRef.current.style.opacity = "0";
    term.open(containerRef.current);
    termRef.current = term;
    term.onData(onData);

    // Fit rows to container height, keep host's cols for width (horizontal scroll).
    // Only send resize to server when we have hostCols — otherwise we'd shrink
    // the PTY to the narrow mobile screen width before the host width arrives.
    const fitRows = () => {
      const dims = fitAddon.proposeDimensions();
      if (!dims) return;
      const hCols = hostColsRef.current;
      const cols = hCols || dims.cols;
      const rows = dims.rows;
      if (cols !== term.cols || rows !== term.rows) {
        term.resize(cols, rows);
      }
      // Only notify server when we know the host width
      if (hCols) onResize(cols, rows);
    };
    fitRows();
    // Reveal after initial fit
    requestAnimationFrame(() => {
      if (containerRef.current) containerRef.current.style.opacity = "1";
    });
    const resizeObs = new ResizeObserver(() => fitRows());
    resizeObs.observe(containerRef.current);

    // Suppress Safari's form accessory bar
    if (term.textarea) {
      term.textarea.setAttribute("autocorrect", "off");
      term.textarea.setAttribute("autocapitalize", "off");
      term.textarea.setAttribute("spellcheck", "false");
      term.textarea.setAttribute("autocomplete", "off");
    }

    // xterm 6.x has built-in Gesture-based touch scrolling with inertia.
    // We add alt-buffer support: intercept gesture events → arrow key sequences
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

      // Tap to focus — open keyboard on iOS (must be on touchend in the
      // same gesture to count as a user-initiated focus for iOS Safari).
      // Track movement to distinguish taps from scrolls.
      let touchStartX = 0;
      let touchStartY = 0;
      let touchMoved = false;
      const TAP_THRESHOLD = 10; // px

      screenEl.addEventListener("touchstart", (e) => {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          touchMoved = false;
        }
      }, { passive: true });

      screenEl.addEventListener("touchmove", (e) => {
        if (e.touches.length === 1) {
          const dx = Math.abs(e.touches[0].clientX - touchStartX);
          const dy = Math.abs(e.touches[0].clientY - touchStartY);
          if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) {
            touchMoved = true;
          }
          // Horizontal scroll on wrapper
          if (wrapperRef.current) {
            const scrollDx = touchStartX - e.touches[0].clientX;
            wrapperRef.current.scrollLeft += scrollDx;
            touchStartX = e.touches[0].clientX;
          }
        }
      }, { passive: true });

      screenEl.addEventListener("touchend", () => {
        if (!touchMoved) {
          term.focus();
        }
      }, { passive: true });
    }

    // Flush any buffered data that arrived before the terminal was ready
    onReady();

    return () => {
      resizeObs.disconnect();
      term.dispose();
      termRef.current = null;
      initRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTerminal, termRef, onData, onReady]);

  // When host cols arrive/change, refit with host width
  useEffect(() => {
    hostColsRef.current = hostCols;
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon || !hostCols) return;
    const dims = fitAddon.proposeDimensions();
    if (!dims) return;
    const rows = dims.rows;
    if (hostCols !== term.cols || rows !== term.rows) {
      term.resize(hostCols, rows);
    }
    onResize(hostCols, rows);
  }, [hostCols, termRef, onResize]);

  const sendKey = useCallback(
    (seq: string) => {
      onData(seq);
    },
    [onData],
  );

  const keys: { label: string; icon: React.ReactNode; seq: string }[] = [
    { label: "Enter", icon: <CornerDownLeft size={14} />, seq: "\r" },
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
      <div ref={wrapperRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden relative">
        <div
          ref={containerRef}
          className="min-w-full h-full"
          style={{
            display: showTerminal ? "block" : "none",
            background: "#0a0a0f",
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
