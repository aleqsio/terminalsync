#!/bin/sh
set -e

INSTALL_DIR="$HOME/.terminalsync"
REPO_DIR="$INSTALL_DIR/repo"
BIN_DIR="$INSTALL_DIR/bin"
WRAPPER="$BIN_DIR/terminalsync"

SENTINEL_BEGIN="# >>> terminalsync >>>"
SENTINEL_END="# <<< terminalsync <<<"

# --- Helpers ---

info() { printf "\033[0;34m%s\033[0m\n" "$1"; }
ok()   { printf "\033[0;32m%s\033[0m\n" "$1"; }
err()  { printf "\033[0;31mError: %s\033[0m\n" "$1" >&2; exit 1; }

# --- Pre-checks ---

info "Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required but not found. Install Node.js >= 18 first."
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 required (found v$(node -v))"
fi
ok "Node.js v$(node -v | tr -d v) OK"

# --- Install repo ---

info "Setting up $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR" "$BIN_DIR"

if [ -d "$REPO_DIR/.git" ]; then
  info "Updating existing repo..."
  cd "$REPO_DIR"
  git pull --ff-only
else
  # If running from a git checkout, copy it; otherwise clone
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"terminalsync"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
    info "Copying from local checkout..."
    rm -rf "$REPO_DIR"
    mkdir -p "$REPO_DIR"
    # Copy everything except node_modules and dist
    cd "$SCRIPT_DIR"
    tar cf - --exclude node_modules --exclude dist --exclude .git . | (cd "$REPO_DIR" && tar xf -)
  else
    err "Please run install.sh from the terminalsync project directory."
  fi
fi

# --- Build ---

info "Installing dependencies..."
cd "$REPO_DIR"
npm install

info "Building..."
npm run build

# --- Wrapper script ---

cat > "$WRAPPER" <<'WRAP'
#!/bin/sh
exec node "$HOME/.terminalsync/repo/dist/cli/connect.js" "$@"
WRAP
chmod +x "$WRAPPER"
ok "Created wrapper at $WRAPPER"

# --- Shell hook ---

HOOK_BLOCK="$SENTINEL_BEGIN
export PATH=\"\$HOME/.terminalsync/bin:\$PATH\"
if [ -z \"\$TERMINALSYNC_SESSION\" ] && command -v terminalsync >/dev/null 2>&1; then
  exec terminalsync share
fi
$SENTINEL_END"

install_hook() {
  RC_FILE="$1"
  if [ ! -f "$RC_FILE" ]; then
    return
  fi

  # Remove old manual terminalsync lines (TERMINALSYNC_TOKEN=test, etc.)
  # and any existing sentinel block
  if grep -q "$SENTINEL_BEGIN" "$RC_FILE" 2>/dev/null; then
    # Remove existing sentinel block
    sed -i.bak "/$SENTINEL_BEGIN/,/$SENTINEL_END/d" "$RC_FILE"
    rm -f "${RC_FILE}.bak"
    info "Replaced existing terminalsync block in $RC_FILE"
  fi

  printf "\n%s\n" "$HOOK_BLOCK" >> "$RC_FILE"
  ok "Added shell hook to $RC_FILE"
}

# Detect shell rc files
if [ -f "$HOME/.zshrc" ]; then
  install_hook "$HOME/.zshrc"
fi
if [ -f "$HOME/.bashrc" ]; then
  install_hook "$HOME/.bashrc"
fi

# --- Done ---

echo ""
ok "TerminalSync installed!"
info "Open a new terminal to start using it."
info "The server will auto-start on first connect and auto-stop when idle."
