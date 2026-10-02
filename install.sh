#!/usr/bin/env bash
# Pi Hub Installation für Raspberry Pi OS Lite 64 Bit.
# Aufruf im geklonten Projektordner:  sudo ./install.sh
# Das Skript kann beliebig oft laufen. Bestehende Daten und die .env bleiben erhalten.
set -euo pipefail

BASIS=/opt/pihub
BENUTZER=pihub
NODE_MAJOR=24
PORT_STANDARD=8080
QUELLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

gruen() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
gelb() { printf '\033[33m! %s\033[0m\n' "$*"; }
rot() { printf '\033[31m✗ %s\033[0m\n' "$*"; }
schritt() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then rot "Bitte mit sudo starten: sudo ./install.sh"; exit 1; fi

schritt "Voraussetzungen prüfen"
ARCH="$(uname -m)"
if [[ "$ARCH" != "aarch64" ]]; then gelb "Architektur $ARCH (erwartet aarch64, Pi OS 64 Bit). Es wird trotzdem versucht."; else gruen "64 Bit System ($ARCH)"; fi
if ! command -v apt-get >/dev/null; then rot "apt-get fehlt. Erwartet wird Raspberry Pi OS (Debian)."; exit 1; fi
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
gruen "RAM: ${RAM_MB} MB"
FREI_MB=$(df -Pm / | awk 'NR==2 {print $4}')
if (( FREI_MB < 1500 )); then rot "Zu wenig Speicher frei (${FREI_MB} MB, nötig 1500 MB)"; exit 1; fi
gruen "Speicher frei: ${FREI_MB} MB"
if ! curl -fsS --max-time 10 https://nodejs.org >/dev/null 2>&1; then rot "Keine Internetverbindung (nodejs.org nicht erreichbar)"; exit 1; fi
gruen "Internet erreichbar"

schritt "Systempakete"
PAKETE=(git rsync curl ca-certificates xz-utils logrotate)
FEHLEN=()
for p in "${PAKETE[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || FEHLEN+=("$p"); done
if (( ${#FEHLEN[@]} )); then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${FEHLEN[@]}"
fi
gruen "Pakete vorhanden: ${PAKETE[*]}"

schritt "Swap für den Build"
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if (( SWAP_MB < 400 )) && [[ -f /etc/dphys-swapfile ]]; then
  sed -i 's/^#\?CONF_SWAPSIZE=.*/CONF_SWAPSIZE=512/' /etc/dphys-swapfile
  dphys-swapfile setup >/dev/null && dphys-swapfile swapon
  gruen "Swap auf 512 MB erhöht"
else
  gruen "Swap: ${SWAP_MB} MB"
fi

schritt "Node.js ${NODE_MAJOR} LTS"
# Der Dienst nutzt immer /usr/local/bin/node (Node 24 führt die TypeScript Werkzeuge direkt aus)
AKTUELL=0
if [[ -x /usr/local/bin/node ]]; then AKTUELL=$(/usr/local/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0); fi
if (( AKTUELL < NODE_MAJOR )); then
  case "$ARCH" in aarch64) NARCH=arm64 ;; x86_64) NARCH=x64 ;; armv7l) NARCH=armv7l ;; *) rot "Keine Node Version für $ARCH"; exit 1 ;; esac
  TMP=$(mktemp -d)
  BASIS_URL="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  curl -fsSL "$BASIS_URL/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  DATEI=$(grep -o "node-v[0-9.]*-linux-${NARCH}.tar.xz" "$TMP/SHASUMS256.txt" | head -1)
  curl -fsSL "$BASIS_URL/$DATEI" -o "$TMP/$DATEI"
  (cd "$TMP" && grep " $DATEI\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || { rot "Prüfsumme von Node stimmt nicht"; exit 1; }
  mkdir -p /usr/local/lib/nodejs
  tar -xJf "$TMP/$DATEI" -C /usr/local/lib/nodejs
  ORDNER="/usr/local/lib/nodejs/${DATEI%.tar.xz}"
  for b in node npm npx; do ln -sfn "$ORDNER/bin/$b" "/usr/local/bin/$b"; done
  rm -rf "$TMP"
  gruen "Node $(/usr/local/bin/node -v) installiert"
else
  gruen "Node $(/usr/local/bin/node -v) vorhanden"
fi

schritt "Benutzer und Verzeichnisse"
id "$BENUTZER" >/dev/null 2>&1 || useradd --system --home-dir "$BASIS" --shell /usr/sbin/nologin "$BENUTZER"
# Für vcgencmd (Drosselung) braucht der Dienst die Gruppe video
getent group video >/dev/null && usermod -aG video "$BENUTZER"
mkdir -p "$BASIS"/{releases,data,logs,quelle}
gruen "Benutzer $BENUTZER und $BASIS bereit"

schritt "Quellcode übernehmen"
if [[ "$QUELLE" != "$BASIS/quelle" ]]; then
  rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude screenshots "$QUELLE"/ "$BASIS/quelle"/
fi
chown -R "$BENUTZER:$BENUTZER" "$BASIS"
gruen "Quelle in $BASIS/quelle"

schritt "Konfiguration (.env)"
if [[ ! -f "$BASIS/.env" ]]; then
  cp "$BASIS/quelle/.env.example" "$BASIS/.env"
  GEHEIM=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$GEHEIM|; s|^DATEN_VERZEICHNIS=.*|DATEN_VERZEICHNIS=$BASIS/data|" "$BASIS/.env"
  gruen ".env angelegt (Einrichtung über /einrichtung)"
else
  grep -q '^SESSION_SECRET=.\+' "$BASIS/.env" || sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')|" "$BASIS/.env"
  gruen ".env vorhanden, bleibt unverändert"
fi
chown "$BENUTZER:$BENUTZER" "$BASIS/.env"
chmod 600 "$BASIS/.env"
PORT=$(grep -E '^PORT=' "$BASIS/.env" | cut -d= -f2 || true); PORT=${PORT:-$PORT_STANDARD}

schritt "systemd Dienste"
for d in pihub.service pihub-backup.service pihub-backup.timer pihub-aktualisieren.service pihub-aktualisieren.path; do
  install -m 644 "$BASIS/quelle/deploy/$d" "/etc/systemd/system/$d"
done
install -m 755 "$BASIS/quelle/scripts/release.sh" /usr/local/sbin/pihub-release
install -m 755 "$BASIS/quelle/scripts/aktualisieren.sh" /usr/local/sbin/pihub-aktualisieren
install -m 755 "$BASIS/quelle/scripts/pihub-befehl.sh" /usr/local/bin/pihub
mkdir -p /etc/systemd/journald.conf.d
install -m 644 "$BASIS/quelle/deploy/journald-pihub.conf" /etc/systemd/journald.conf.d/pihub.conf
install -m 644 "$BASIS/quelle/deploy/logrotate-pihub" /etc/logrotate.d/pihub
systemctl daemon-reload
systemctl restart systemd-journald
systemctl enable --quiet pihub.service pihub-backup.timer pihub-aktualisieren.path
systemctl start pihub-backup.timer pihub-aktualisieren.path
gruen "Dienste installiert (pihub, Backup täglich 03:30, Aktualisieren per Button)"

schritt "Release bauen und starten"
/usr/local/sbin/pihub-release "$BASIS/quelle"

schritt "Fertig"
IP=$(hostname -I | awk '{print $1}')
gruen "Pi Hub läuft: http://${IP}:${PORT}"
echo "Nächste Schritte:"
echo "  1. Tailscale einrichten (docs/TAILSCALE.md)"
echo "  2. Einrichtungsassistent öffnen: http://${IP}:${PORT}/einrichtung"
echo "  3. Selbsttest: pihub selbsttest"
echo "  Hilfe zu allen Befehlen: pihub"
