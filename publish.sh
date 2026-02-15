#!/bin/sh
set -e

# publish.sh — Build and package terminalsync as a standalone tarball.
# The primary install method is:
#   curl -fsSL https://raw.githubusercontent.com/aleqsio/terminalsync/main/install.sh | bash
#
# This script creates an alternative offline tarball for machines without git:
#   curl -L <url>/terminalsync.tar.gz | tar xz && cd terminalsync && ./install.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$SCRIPT_DIR/cli"
STAGE_DIR="$CLI_DIR/.bundle-stage"
OUT_FILE="$SCRIPT_DIR/terminalsync.tar.gz"

# --- Helpers ---

info() { printf "\033[0;34m%s\033[0m\n" "$1"; }
ok()   { printf "\033[0;32m%s\033[0m\n" "$1"; }
err()  { printf "\033[0;31mError: %s\033[0m\n" "$1" >&2; exit 1; }

# --- Pre-checks ---

command -v node >/dev/null 2>&1 || err "node not found"
command -v npm  >/dev/null 2>&1 || err "npm not found"

# --- Build server ---

info "Installing server dependencies..."
cd "$CLI_DIR"
npm install

info "Building server (tsc)..."
npm run build:server

# --- Build web UI ---

info "Installing web-ui dependencies..."
cd "$CLI_DIR/web-ui"
npm install

info "Building web UI (vite)..."
npm run build

# --- Verify outputs ---

[ -f "$CLI_DIR/dist/cli/connect.js" ] || err "Server build missing dist/cli/connect.js"
[ -f "$CLI_DIR/dist/web/index.html" ] || err "Web build missing dist/web/index.html"

ok "Build complete"

# --- Stage tarball ---
# The tarball contains pre-built dist + a minimal install script that
# only needs node/npm (no git, no build tools) on the target machine.

info "Staging bundle..."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/terminalsync"

cp -r "$CLI_DIR/dist"         "$STAGE_DIR/terminalsync/dist"
cp    "$CLI_DIR/package.json" "$STAGE_DIR/terminalsync/package.json"

[ -f "$CLI_DIR/package-lock.json" ] && cp "$CLI_DIR/package-lock.json" "$STAGE_DIR/terminalsync/package-lock.json"
[ -f "$CLI_DIR/uninstall.sh" ]      && cp "$CLI_DIR/uninstall.sh"      "$STAGE_DIR/terminalsync/uninstall.sh"

# Generate a minimal install script for the tarball (no git/build needed)
cat > "$STAGE_DIR/terminalsync/install.sh" <<'TARBALL_INSTALL'
#!/bin/sh
set -e

INSTALL_DIR="$HOME/.terminalsync"
REPO_DIR="$INSTALL_DIR/repo"
BIN_DIR="$INSTALL_DIR/bin"
WRAPPER="$BIN_DIR/terminalsync"

SENTINEL_BEGIN="# >>> terminalsync >>>"
SENTINEL_END="# <<< terminalsync <<<"

info() { printf "\033[0;34m%s\033[0m\n" "$1"; }
ok()   { printf "\033[0;32m%s\033[0m\n" "$1"; }
err()  { printf "\033[0;31mError: %s\033[0m\n" "$1" >&2; exit 1; }

info "Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required but not found. Install Node.js >= 18 first."
fi
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[ "$NODE_MAJOR" -lt 18 ] && err "Node.js >= 18 required (found v$(node -v))"
ok "Node.js v$(node -v | tr -d v) OK"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -d "$SCRIPT_DIR/dist" ] || err "Pre-built dist/ not found."

info "Setting up $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
rm -rf "$REPO_DIR"
mkdir -p "$REPO_DIR"

cp -r "$SCRIPT_DIR/dist"         "$REPO_DIR/dist"
cp    "$SCRIPT_DIR/package.json" "$REPO_DIR/package.json"
[ -f "$SCRIPT_DIR/package-lock.json" ] && cp "$SCRIPT_DIR/package-lock.json" "$REPO_DIR/package-lock.json"
[ -f "$SCRIPT_DIR/uninstall.sh" ]      && cp "$SCRIPT_DIR/uninstall.sh"      "$REPO_DIR/uninstall.sh"

info "Installing production dependencies..."
cd "$REPO_DIR"
npm install --omit=dev

cat > "$WRAPPER" <<'WRAP'
#!/bin/sh
exec node "$HOME/.terminalsync/repo/dist/cli/connect.js" "$@"
WRAP
chmod +x "$WRAPPER"
ok "Created $WRAPPER"

HOOK_BLOCK="$SENTINEL_BEGIN
export PATH=\"\$HOME/.terminalsync/bin:\$PATH\"
if [ -z \"\$TERMINALSYNC_SESSION\" ] && command -v terminalsync >/dev/null 2>&1; then
  exec terminalsync share
fi
$SENTINEL_END"

install_hook() {
  RC_FILE="$1"
  [ -f "$RC_FILE" ] || return 0
  if grep -q "$SENTINEL_BEGIN" "$RC_FILE" 2>/dev/null; then
    sed -i.bak "/$SENTINEL_BEGIN/,/$SENTINEL_END/d" "$RC_FILE"
    rm -f "${RC_FILE}.bak"
  fi
  printf "\n%s\n" "$HOOK_BLOCK" >> "$RC_FILE"
  ok "Added shell hook to $RC_FILE"
}

[ -f "$HOME/.zshrc" ]  && install_hook "$HOME/.zshrc"
[ -f "$HOME/.bashrc" ] && install_hook "$HOME/.bashrc"

echo ""
ok "TerminalSync installed!"
info "Open a new terminal to start using it."
TARBALL_INSTALL

chmod +x "$STAGE_DIR/terminalsync/install.sh"
[ -f "$STAGE_DIR/terminalsync/uninstall.sh" ] && chmod +x "$STAGE_DIR/terminalsync/uninstall.sh"

# --- Create tarball ---

info "Creating tarball..."
cd "$STAGE_DIR"
tar czf "$OUT_FILE" terminalsync

rm -rf "$STAGE_DIR"

SIZE=$(wc -c < "$OUT_FILE" | tr -d ' ')
SIZE_KB=$((SIZE / 1024))

echo ""
ok "Bundle created: $OUT_FILE (${SIZE_KB} KB)"
echo ""
info "Install on a target machine (no git needed):"
echo "  curl -L <url>/terminalsync.tar.gz | tar xz && cd terminalsync && ./install.sh"
