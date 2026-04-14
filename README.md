# Remote Dev Agent (Linux)

Şirket backend’inize WebSocket ile bağlanan Node agent. Son kullanıcı kendi sunucusunda kurar.

## Gereksinimler

- Linux + `systemd`
- `curl`, `tar`, `bash`
- Node.js 18+

## Tek komut kurulum

1. **Repoda bir kez:** `install.sh` içindeki `DEFAULT_ARCHIVE_URL` satırını, bu monoreponun GitHub **archive** adresiyle değiştirin (repo herkese açık olmalı veya kurulumda `INSTALL_ARCHIVE_URL` kullanın):

   `https://github.com/ORG/REPO/archive/refs/heads/main.tar.gz`

2. **Kullanıcı sunucusunda** (BACKEND_URL = sizin `wss://` backend adresiniz):

```bash
curl -fsSL https://raw.githubusercontent.com/ORG/REPO/main/server-packages/install.sh | env BACKEND_URL=wss://api.sirketiniz.com bash
```

`ORG/REPO` ve branch adını kendi repoya göre düzenleyin.

### İsteğe bağlı ortam değişkenleri

| Değişken | Açıklama |
|----------|----------|
| `BACKEND_URL` | **Zorunlu.** Şirket backend WebSocket URL’si (`wss://...`). |
| `INSTALL_ARCHIVE_URL` | Repo kökü arşivi; `DEFAULT_ARCHIVE_URL` yerine kullanılır. |
| `INSTALL_DIR` | Varsayılan: `$HOME/.remote-dev-agent` |
| `SCAN_DIRS` | Taranacak dizinler, virgülle. Varsayılan: `/var/www,/home/$USER/projects` |

Örnek:

```bash
curl -fsSL .../install.sh | env \
  BACKEND_URL=wss://api.sirketiniz.com \
  INSTALL_ARCHIVE_URL=https://github.com/acme/monorepo/archive/refs/heads/main.tar.gz \
  SCAN_DIRS=/home/deploy/repos,/var/www \
  bash
```

## Elle / git ile geliştirme

Repoyu klonlayıp:

```bash
cd server-packages
export BACKEND_URL=wss://...
# install.sh içinde DEFAULT_ARCHIVE_URL doğruysa:
bash install.sh
```

## Servis

```bash
sudo systemctl status remote-dev-agent
journalctl -u remote-dev-agent -f
```

Pairing kodu: `cat ~/.remote-dev-agent/.agent-config.json`

## Özel durumlar

- **Private repo:** Arşivi token ile indirip `INSTALL_ARCHIVE_URL` yerine dosya yolunu kullanmak veya scripti repoya gömülü dağıtmak gerekir; ham `curl | bash` public raw ile çalışmaz.
- **systemd yok:** `install.sh` şu an yalnızca systemd yazar; container/WSL için `npm start` ile manuel çalıştırıp `BACKEND_URL` export edin (ileride `INSTALL_SKIP_SYSTEMD=1` eklenebilir).
