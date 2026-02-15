import { useEffect, useRef, type MutableRefObject } from "react";
import { Terminal } from "@xterm/xterm";

interface TerminalViewProps {
  attachedId: string | null;
  termSize: { cols: number; rows: number } | null;
  termRef: MutableRefObject<Terminal | null>;
  onData: (data: string) => void;
}

export default function TerminalView({
  attachedId,
  termSize,
  termRef,
  onData,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current || !containerRef.current) return;
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

    return () => {
      term.dispose();
    };
  }, [termRef, onData]);

  // Resize terminal to match server's PTY dimensions
  useEffect(() => {
    const term = termRef.current;
    if (term && termSize && termSize.cols > 0 && termSize.rows > 0) {
      term.resize(termSize.cols, termSize.rows);
    }
  }, [termSize, termRef]);

  const showTerminal = attachedId !== null;

  return (
    <div className="flex-1 overflow-auto relative" style={{ background: "var(--bg)" }}>
      <div
        ref={containerRef}
        className="inline-block min-w-full p-1"
        style={{
          display: showTerminal ? "inline-block" : "none",
        }}
      />
      {!showTerminal && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-zinc-600">
            {attachedId === null ? "Waiting for session..." : ""}
          </p>
        </div>
      )}
    </div>
  );
}
