#!/usr/bin/env bash
set -euo pipefail

echo "================================="
echo "  Remote Dev Agent — install"
echo "================================="

INSTALL_DIR="${INSTALL_DIR:-$HOME/.remote-dev-agent}"
TMP="${TMPDIR:-/tmp}/remote-agent-install.$$"
mkdir -p "$TMP"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "[error] Required command not found: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd tar

if ! command -v node &>/dev/null; then
  echo "[error] Node.js is required. Example (Debian/Ubuntu):"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi

if [ -z "${BACKEND_URL:-}" ]; then
  echo "[error] BACKEND_URL is not set."
  echo "  Your company backend WebSocket URL, e.g.: wss://api.example.com"
  echo ""
  echo "  One-liner example:"
  echo "    curl -fsSL https://raw.githubusercontent.com/auto-remoteclient/server-packages/main/install.sh | env BACKEND_URL=wss://api.example.com bash"
  exit 1
fi

# Default: this repository’s source archive. Override at install time with INSTALL_ARCHIVE_URL=...
DEFAULT_ARCHIVE_URL="${DEFAULT_ARCHIVE_URL:-https://github.com/auto-remoteclient/server-packages/archive/refs/heads/main.tar.gz}"
INSTALL_ARCHIVE_URL="${INSTALL_ARCHIVE_URL:-$DEFAULT_ARCHIVE_URL}"

echo "[info] Install directory: $INSTALL_DIR"
echo "[info] Archive: $INSTALL_ARCHIVE_URL"

ARCHIVE_FILE="$TMP/repo.tar.gz"
if [[ "$INSTALL_ARCHIVE_URL" == /* ]] || [[ "$INSTALL_ARCHIVE_URL" == file://* ]]; then
  LOCAL_PATH="${INSTALL_ARCHIVE_URL#file://}"
  if [[ ! -f "$LOCAL_PATH" ]]; then
    echo "[error] Archive file not found: $LOCAL_PATH"
    exit 1
  fi
  cp "$LOCAL_PATH" "$ARCHIVE_FILE"
else
  CURL_AUTH=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    CURL_AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi
  curl -fsSL "${CURL_AUTH[@]}" -L "$INSTALL_ARCHIVE_URL" -o "$ARCHIVE_FILE"
fi
tar -xzf "$ARCHIVE_FILE" -C "$TMP"

# Monorepo layout: .../server-packages/package.json — standalone repo: .../server-packages-main/package.json
PKG_DIR=""
while IFS= read -r -d '' d; do
  if [[ -f "$d/package.json" ]]; then
    PKG_DIR="$d"
    break
  fi
done < <(find "$TMP" -maxdepth 5 -type d -name server-packages -print0 2>/dev/null)
if [[ -z "$PKG_DIR" ]]; then
  TOP=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1)
  if [[ -n "$TOP" && -f "$TOP/package.json" ]]; then
    PKG_DIR="$TOP"
  fi
fi
if [ -z "$PKG_DIR" ] || [ ! -f "$PKG_DIR/package.json" ]; then
  echo "[error] Could not find the agent package (package.json) inside the archive."
  exit 1
fi

rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -a "$PKG_DIR"/. "$INSTALL_DIR/"

cd "$INSTALL_DIR"
echo "[info] npm install --omit=dev ..."
npm install --omit=dev

NODE_BIN=$(command -v node)
SCAN_DIRS_VALUE="${SCAN_DIRS:-/var/www,/home/$USER/projects}"

echo "[info] Writing systemd unit (sudo required)..."
sudo tee /etc/systemd/system/remote-dev-agent.service >/dev/null <<EOF
[Unit]
Description=Remote Dev Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=BACKEND_URL=$BACKEND_URL
Environment=SCAN_DIRS=$SCAN_DIRS_VALUE

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable remote-dev-agent
sudo systemctl restart remote-dev-agent

FRONTEND_PAIR_BASE="${FRONTEND_PAIR_BASE_URL:-https://promptier.dev/pair}"
PAIR_CODE=""
AGENT_CFG="$INSTALL_DIR/.agent-config.json"
for _ in {1..20}; do
  if [ -f "$AGENT_CFG" ]; then
    PAIR_CODE=$("$NODE_BIN" -e 'const fs=require("fs"); const p=process.argv[1]; try { const j=JSON.parse(fs.readFileSync(p,"utf8")); process.stdout.write(String(j.pairingCode||"")); } catch (e) { process.exit(1); }' "$AGENT_CFG" 2>/dev/null) || PAIR_CODE=""
    [ -n "$PAIR_CODE" ] && break
  fi
  sleep 0.25
done

echo ""
echo "================================="
echo "  Install complete"
echo "================================="
echo "Directory:   $INSTALL_DIR"
echo "BACKEND_URL: $BACKEND_URL"
echo "Service:     sudo systemctl status remote-dev-agent"
echo "Logs:        journalctl -u remote-dev-agent -f"
echo "Pairing:     cat $INSTALL_DIR/.agent-config.json"
echo ""
echo "────────────────────────────────────────────────────────"
if [ -n "$PAIR_CODE" ]; then
  echo "Your pair code:     $PAIR_CODE"
  echo "Your client link:   ${FRONTEND_PAIR_BASE}?code=${PAIR_CODE}"
else
  echo "Your pair code:     (read after start)  cat $INSTALL_DIR/.agent-config.json"
  echo "Your client link:   ${FRONTEND_PAIR_BASE}?code=<pair code>"
fi
echo ""
