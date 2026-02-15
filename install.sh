#!/bin/sh
set -e

# curl -fsSL https://raw.githubusercontent.com/aleqsio/terminalsync/main/install.sh | bash

REPO="https://github.com/aleqsio/terminalsync.git"
INSTALL_DIR="$HOME/.terminalsync"
REPO_DIR="$INSTALL_DIR/repo"
BIN_DIR="$INSTALL_DIR/bin"
WRAPPER="$BIN_DIR/terminalsync"

SENTINEL_BEGIN="# >>> terminalsync >>>"
SENTINEL_END="# <<< terminalsync <<<"

info() { printf "\033[0;34m%s\033[0m\n" "$1"; }
ok()   { printf "\033[0;32m%s\033[0m\n" "$1"; }
err()  { printf "\033[0;31mError: %s\033[0m\n" "$1" >&2; exit 1; }

# --- Check deps ---

command -v git  >/dev/null 2>&1 || err "git is required"
command -v node >/dev/null 2>&1 || err "Node.js >= 18 is required"
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[ "$NODE_MAJOR" -lt 18 ] && err "Node.js >= 18 required (found $(node -v))"

# --- Clone or update ---

mkdir -p "$INSTALL_DIR" "$BIN_DIR"

if [ -d "$REPO_DIR/.git" ]; then
  info "Updating..."
  cd "$REPO_DIR"
  git pull --ff-only
else
  info "Cloning..."
  rm -rf "$REPO_DIR"
  git clone --depth 1 "$REPO" "$REPO_DIR"
fi

# --- Install runtime deps ---

info "Installing dependencies..."
cd "$REPO_DIR/cli"
npm install --omit=dev

# --- Wrapper ---

cat > "$WRAPPER" <<'WRAP'
#!/bin/sh
exec node "$HOME/.terminalsync/repo/cli/dist/cli/connect.js" "$@"
WRAP
chmod +x "$WRAPPER"

# --- Shell hook ---

HOOK="$SENTINEL_BEGIN
export PATH=\"\$HOME/.terminalsync/bin:\$PATH\"
if [ -z \"\$TERMINALSYNC_SESSION\" ] && command -v terminalsync >/dev/null 2>&1; then
  exec terminalsync share
fi
$SENTINEL_END"

add_hook() {
  [ -f "$1" ] || return 0
  if grep -q "$SENTINEL_BEGIN" "$1" 2>/dev/null; then
    sed -i.bak "/$SENTINEL_BEGIN/,/$SENTINEL_END/d" "$1"
    rm -f "$1.bak"
  fi
  printf "\n%s\n" "$HOOK" >> "$1"
}

add_hook "$HOME/.zshrc"
add_hook "$HOME/.bashrc"

# --- Done ---

ok "TerminalSync installed! Open a new terminal to start."
