interface ToolbarProps {
  token: string;
  onTokenChange: (v: string) => void;
  onConnect: () => void;
  connected: boolean;
  status: { text: string; color: string };
}

export default function Toolbar({
  token,
  onTokenChange,
  onConnect,
  connected,
  status,
}: ToolbarProps) {
  return (
    <div id="toolbar">
      <h1>TerminalSync</h1>
      <input
        id="token-input"
        type="password"
        placeholder="Token"
        value={token}
        onChange={(e) => onTokenChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConnect();
        }}
      />
      <button
        id="btn-connect"
        className={connected ? "active" : ""}
        onClick={onConnect}
      >
        {connected ? "Disconnect" : "Connect"}
      </button>
      <div className="spacer" />
      <span id="status" style={{ color: status.color }}>
        {status.text}
      </span>
    </div>
  );
}
