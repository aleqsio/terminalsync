#!/bin/sh
set -e

# TerminalSync installer
# Usage: curl -fsSL https://raw.githubusercontent.com/aleqsio/terminalsync/main/install.sh | bash
#
# This script clones the repo, builds everything, and installs to ~/.terminalsync.
# Requirements: node >= 18, npm, git

REPO="https://github.com/aleqsio/terminalsync.git"
BRANCH="main"
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

info "Checking dependencies..."

command -v git >/dev/null 2>&1 || err "git is required but not found."

if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required but not found. Install Node.js >= 18 first."
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 required (found v$(node -v))"
fi

command -v npm >/dev/null 2>&1 || err "npm is required but not found."

ok "node $(node -v), npm $(npm -v), git $(git --version | cut -d' ' -f3)"

# --- Clone / update ---

info "Setting up $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR" "$BIN_DIR"

if [ -d "$REPO_DIR/.git" ]; then
  info "Updating existing installation..."
  cd "$REPO_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  info "Cloning repository..."
  rm -rf "$REPO_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$REPO_DIR"
fi

# --- Build server ---

info "Installing server dependencies..."
cd "$REPO_DIR/cli"
npm install

info "Building server..."
npm run build:server

# --- Build web UI ---

info "Installing web UI dependencies..."
cd "$REPO_DIR/cli/web-ui"
npm install

info "Building web UI..."
npm run build

# --- Verify ---

[ -f "$REPO_DIR/cli/dist/cli/connect.js" ] || err "Build failed: dist/cli/connect.js missing"
[ -f "$REPO_DIR/cli/dist/web/index.html" ]  || err "Build failed: dist/web/index.html missing"

ok "Build complete"

# --- Wrapper script ---

cat > "$WRAPPER" <<'WRAP'
#!/bin/sh
exec node "$HOME/.terminalsync/repo/cli/dist/cli/connect.js" "$@"
WRAP
chmod +x "$WRAPPER"
ok "Created $WRAPPER"

# --- Shell hook ---

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
    info "Replaced existing terminalsync block in $RC_FILE"
  fi

  printf "\n%s\n" "$HOOK_BLOCK" >> "$RC_FILE"
  ok "Added shell hook to $RC_FILE"
}

[ -f "$HOME/.zshrc" ]  && install_hook "$HOME/.zshrc"
[ -f "$HOME/.bashrc" ] && install_hook "$HOME/.bashrc"

# --- Done ---

echo ""
ok "TerminalSync installed!"
info "Open a new terminal to start using it."
info "The server will auto-start on first connect and auto-stop when idle."
