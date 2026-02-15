import type { Session } from "./App";
import { TerminalSquare, X } from "lucide-react";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  sessions: Session[];
  attachedId: string | null;
  onSelect: (id: string) => void;
}

export default function Drawer({
  open,
  onClose,
  sessions,
  attachedId,
  onSelect,
}: DrawerProps) {
  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className="fixed top-0 left-0 h-full w-72 z-50 flex flex-col transition-transform duration-200 ease-out"
        style={{
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between h-11 px-4 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Sessions
          </span>
          <button
            tabIndex={-1}
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/5 transition-colors"
          >
            <X size={16} className="text-zinc-500" />
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 ? (
            <p className="text-xs text-zinc-600 px-4 py-6 text-center">
              No sessions
            </p>
          ) : (
            sessions.map((s) => {
              const active = s.id === attachedId;
              return (
                <button
                  key={s.id}
                  tabIndex={-1}
                  onClick={() => onSelect(s.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    active
                      ? "bg-indigo-500/10 text-indigo-300"
                      : "text-zinc-400 hover:bg-white/3 hover:text-zinc-200"
                  }`}
                >
                  <TerminalSquare size={15} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{s.name}</div>
                    <div className="text-[10px] text-zinc-600 font-mono">
                      {s.id.slice(0, 8)}
                    </div>
                  </div>
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background:
                        s.status === "exited"
                          ? "var(--red)"
                          : "var(--green)",
                    }}
                  />
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
