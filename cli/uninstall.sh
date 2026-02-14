#!/bin/sh
set -e

INSTALL_DIR="$HOME/.terminalsync"
SENTINEL_BEGIN="# >>> terminalsync >>>"
SENTINEL_END="# <<< terminalsync <<<"

# --- Helpers ---

info() { printf "\033[0;34m%s\033[0m\n" "$1"; }
ok()   { printf "\033[0;32m%s\033[0m\n" "$1"; }

# --- Stop running server ---

PID_FILE="$INSTALL_DIR/server.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    info "Stopping server (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    ok "Server stopped"
  fi
fi

# --- Remove shell hooks ---

remove_hook() {
  RC_FILE="$1"
  if [ ! -f "$RC_FILE" ]; then
    return
  fi

  if grep -q "$SENTINEL_BEGIN" "$RC_FILE" 2>/dev/null; then
    sed -i.bak "/$SENTINEL_BEGIN/,/$SENTINEL_END/d" "$RC_FILE"
    rm -f "${RC_FILE}.bak"
    ok "Removed shell hook from $RC_FILE"
  fi
}

remove_hook "$HOME/.zshrc"
remove_hook "$HOME/.bashrc"

# --- Remove install directory ---

if [ -d "$INSTALL_DIR" ]; then
  info "Removing $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
  ok "Removed $INSTALL_DIR"
fi

# --- Done ---

echo ""
ok "TerminalSync uninstalled."
info "Open a new terminal for changes to take effect."
