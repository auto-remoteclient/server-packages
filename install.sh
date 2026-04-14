#!/bin/bash
set -e

echo "================================="
echo "  Remote Dev Agent Installer"
echo "================================="

INSTALL_DIR="$HOME/.remote-dev-agent"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "[error] Node.js is required. Install it first:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi

# Check git
if ! command -v git &> /dev/null; then
  echo "[error] git is required. Install it: sudo apt-get install -y git"
  exit 1
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "[info] Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "[info] Installing to $INSTALL_DIR..."
  git clone https://github.com/YOUR_USER/remote-dev-agent.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
npm install --production

# Create systemd service
echo "[info] Creating systemd service..."
sudo tee /etc/systemd/system/remote-dev-agent.service > /dev/null <<EOF
[Unit]
Description=Remote Dev Agent
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) $INSTALL_DIR/src/index.js
Restart=always
RestartSec=10
Environment=BACKEND_URL=ws://YOUR_BACKEND_URL:3001
Environment=SCAN_DIRS=/var/www,/home/$USER/projects

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable remote-dev-agent
sudo systemctl start remote-dev-agent

echo ""
echo "================================="
echo "  Agent installed and running!"
echo "================================="
echo ""
echo "Check status:  sudo systemctl status remote-dev-agent"
echo "View logs:     sudo journalctl -u remote-dev-agent -f"
echo "Pairing code:  cat $INSTALL_DIR/.agent-config.json"
echo ""
