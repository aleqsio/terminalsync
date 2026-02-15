import type { Session } from "./App";

interface SessionBarProps {
  sessions: Session[];
  attachedId: string | null;
  onSelect: (id: string) => void;
}

export default function SessionBar({
  sessions,
  attachedId,
  onSelect,
}: SessionBarProps) {
  return (
    <div id="session-bar">
      {sessions.length === 0 ? (
        <span id="no-sessions">No sessions</span>
      ) : (
        sessions.map((s) => (
          <div
            key={s.id}
            className={`session-tab${s.id === attachedId ? " attached" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <span
              className={`dot${s.status === "exited" ? " exited" : ""}`}
            />
            {s.name}{" "}
            <span style={{ color: "#666", fontSize: 10 }}>
              {s.id.slice(0, 8)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
