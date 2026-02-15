#!/bin/sh
set -e

# curl -fsSL https://raw.githubusercontent.com/aleqsio/terminalsync/main/install.sh | bash

REPO="https://github.com/aleqsio/terminalsync.git"
INSTALL_DIR="$HOME/.terminalsync"
REPO_DIR="$INSTALL_DIR/repo"
BIN_DIR="$INSTALL_DIR/bin"
WRAPPER="$BIN_DIR/terminalsync"

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

# --- Done ---

ok "TerminalSync installed!"
info "Add to your PATH: export PATH=\"\$HOME/.terminalsync/bin:\$PATH\""
