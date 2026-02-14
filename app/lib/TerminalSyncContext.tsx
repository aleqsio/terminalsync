import React, { createContext, useContext, type ReactNode } from "react";
import { useTerminalSync } from "./useTerminalSync";

type TerminalSyncValue = ReturnType<typeof useTerminalSync>;

const TerminalSyncContext = createContext<TerminalSyncValue | null>(null);

export function TerminalSyncProvider({ children }: { children: ReactNode }) {
  const value = useTerminalSync();
  return (
    <TerminalSyncContext.Provider value={value}>
      {children}
    </TerminalSyncContext.Provider>
  );
}

export function useTerminalSyncContext() {
  const ctx = useContext(TerminalSyncContext);
  if (!ctx)
    throw new Error(
      "useTerminalSyncContext must be used within TerminalSyncProvider"
    );
  return ctx;
}
