import { useEffect, useRef, type MutableRefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  attachedId: string | null;
  splashText: string;
  termRef: MutableRefObject<Terminal | null>;
  fitRef: MutableRefObject<FitAddon | null>;
  onResize: () => void;
  onData: (data: string) => void;
}

export default function TerminalView({
  attachedId,
  splashText,
  termRef,
  fitRef,
  onResize,
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
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#e94560",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    term.onData(onData);

    const handleResize = () => onResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, [termRef, fitRef, onResize, onData]);

  const showTerminal = attachedId !== null;

  return (
    <div id="terminal-container">
      <div
        ref={containerRef}
        style={{ height: "100%", display: showTerminal ? "" : "none" }}
      />
      {!showTerminal && <div id="splash">{splashText}</div>}
    </div>
  );
}
