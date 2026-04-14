#!/usr/bin/env bash
set -euo pipefail

echo "================================="
echo "  Remote Dev Agent — kurulum"
echo "================================="

INSTALL_DIR="${INSTALL_DIR:-$HOME/.remote-dev-agent}"
TMP="${TMPDIR:-/tmp}/remote-agent-install.$$"
mkdir -p "$TMP"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "[error] Gerekli komut yok: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd tar

if ! command -v node &>/dev/null; then
  echo "[error] Node.js gerekli. Örnek (Debian/Ubuntu):"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi

if [ -z "${BACKEND_URL:-}" ]; then
  echo "[error] BACKEND_URL tanımlı değil."
  echo "  Şirket backend WebSocket adresiniz, örn: wss://api.sirketiniz.com"
  echo ""
  echo "  Tek satır örnek:"
  echo "    curl -fsSL <install.sh-URL> | env BACKEND_URL=wss://api.sirketiniz.com bash"
  exit 1
fi

# Yayıncı: repoda bu varsayılanı kendi archive URL'niz ile değiştirin (opsiyonel).
# Kurulum anında: INSTALL_ARCHIVE_URL=... ile override edilir.
DEFAULT_ARCHIVE_URL="${DEFAULT_ARCHIVE_URL:-https://github.com/YOUR_ORG/auto-remoteclient/archive/refs/heads/main.tar.gz}"
INSTALL_ARCHIVE_URL="${INSTALL_ARCHIVE_URL:-$DEFAULT_ARCHIVE_URL}"

if [[ "$INSTALL_ARCHIVE_URL" == *"YOUR_ORG"* ]] || [[ "$INSTALL_ARCHIVE_URL" == *"YOUR_"* ]]; then
  echo "[error] install.sh içindeki DEFAULT_ARCHIVE_URL henüz gerçek repo adresiyle güncellenmemiş,"
  echo "  veya kurulumda şunu verin:"
  echo "    INSTALL_ARCHIVE_URL=https://github.com/ORG/REPO/archive/refs/heads/main.tar.gz"
  exit 1
fi

echo "[info] Hedef dizin: $INSTALL_DIR"
echo "[info] Arşiv: $INSTALL_ARCHIVE_URL"

ARCHIVE_FILE="$TMP/repo.tar.gz"
curl -fsSL "$INSTALL_ARCHIVE_URL" -o "$ARCHIVE_FILE"
tar -xzf "$ARCHIVE_FILE" -C "$TMP"

PKG_DIR=$(find "$TMP" -maxdepth 5 -type d -name server-packages 2>/dev/null | head -1)
if [ -z "$PKG_DIR" ] || [ ! -f "$PKG_DIR/package.json" ]; then
  echo "[error] Arşivde server-packages/ bulunamadı. Repo yapısını kontrol edin."
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

echo "[info] systemd servisi yazılıyor (sudo gerekir)..."
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

echo ""
echo "================================="
echo "  Kurulum tamam"
echo "================================="
echo "Dizin:        $INSTALL_DIR"
echo "BACKEND_URL:  $BACKEND_URL"
echo "Servis:       sudo systemctl status remote-dev-agent"
echo "Log:          journalctl -u remote-dev-agent -f"
echo "Pairing:      cat $INSTALL_DIR/.agent-config.json"
echo ""
