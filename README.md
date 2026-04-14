# Remote Dev Agent (Linux)

Node agent that connects to your company backend over WebSocket. End users install it on their own Linux server.

Repository: [github.com/auto-remoteclient/server-packages](https://github.com/auto-remoteclient/server-packages)

## Requirements

- Linux with `systemd`
- `curl`, `tar`, `bash`
- Node.js 18+

## One-line install (public repo)

On the user’s server, set `BACKEND_URL` to your WebSocket URL (`wss://...`):

```bash
curl -fsSL https://raw.githubusercontent.com/auto-remoteclient/server-packages/main/install.sh | env BACKEND_URL=wss://api.example.com bash
```

The script downloads this repo’s source tarball, installs dependencies, and registers a `systemd` service.

### Optional environment variables

| Variable | Description |
|----------|-------------|
| `BACKEND_URL` | **Required.** Your backend WebSocket URL (`wss://...`). |
| `INSTALL_ARCHIVE_URL` | Source tarball URL, or absolute path to a local `.tar.gz` file. Defaults to this repo’s GitHub archive. |
| `GITHUB_TOKEN` | For private GitHub archives or raw URLs: sent as `Authorization: Bearer`. |
| `INSTALL_DIR` | Install location. Default: `$HOME/.remote-dev-agent` |
| `SCAN_DIRS` | Comma-separated directories to scan for projects. Default: `/var/www,/home/$USER/projects` |
| `FRONTEND_PAIR_BASE_URL` | Web UI pairing page base (shown at end of install). Default: `https://promptier.dev/pair` — link becomes `?code=<pairingCode>`. |

Example with extra scan paths:

```bash
curl -fsSL https://raw.githubusercontent.com/auto-remoteclient/server-packages/main/install.sh | env \
  BACKEND_URL=wss://api.example.com \
  SCAN_DIRS=/home/deploy/repos,/var/www \
  bash
```

## Private GitHub repository

Unauthenticated requests to `raw.githubusercontent.com` and `github.com/.../archive/...` return 404 for private repos. Options:

**1) Fine-grained PAT (recommended)**  
Create a token with **Contents: Read** for that repo only. On the server, export it for the session only (do not hardcode in scripts):

```bash
export GITHUB_TOKEN=ghp_xxxxxxxx
ARCHIVE="https://github.com/OWNER/REPO/archive/refs/heads/main.tar.gz"
RAW="https://raw.githubusercontent.com/OWNER/REPO/main/install.sh"

curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "$RAW" | \
  env BACKEND_URL=wss://api.example.com \
      GITHUB_TOKEN="$GITHUB_TOKEN" \
      INSTALL_ARCHIVE_URL="$ARCHIVE" \
      bash
```

**2) Copy the archive yourself**  
Download the `.tar.gz` locally or in CI, `scp` it to the server, then:

```bash
env BACKEND_URL=wss://api.example.com INSTALL_ARCHIVE_URL=/path/to/repo.tar.gz bash install.sh
```

## Development (clone + run)

```bash
git clone https://github.com/auto-remoteclient/server-packages.git
cd server-packages
export BACKEND_URL=wss://api.example.com
bash install.sh
```

### Local test (monorepo + `playground/`)

If your checkout is the **full monorepo** with a git repo in `playground/` next to `server-packages/`, run the agent from `server-packages` so only that folder is scanned (skips `/var/www` and `/home`):

```bash
cd server-packages
export BACKEND_URL=ws://localhost:3001
npm run start:local
```

This sets `SCAN_DIRS` to `…/playground` and `LOCAL_PLAYGROUND_ONLY=1`.

## Service

```bash
sudo systemctl status remote-dev-agent
journalctl -u remote-dev-agent -f
```

Pairing code: `cat ~/.remote-dev-agent/.agent-config.json`

## Notes

- **No systemd** (containers, some WSL setups): run `npm start` with `BACKEND_URL` set instead of using `install.sh` as-is.
- This install path supports both **this standalone repo** (archive root contains `package.json`) and a **monorepo** tarball where the agent lives under a `server-packages/` directory.
