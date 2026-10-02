#!/usr/bin/env bash
# Deploy vom Laptop auf den Pi: lokal prüfen und bauen, per rsync hochladen, auf dem Pi Release mit
# Gesundheitscheck. Schlägt der Check fehl, schaltet der Pi automatisch auf die vorherige Version zurück.
# Ziel einstellen in .env (DEPLOY_ZIEL=pi@pihub, DEPLOY_PFAD=/opt/pihub) oder als Umgebungsvariable.
set -euo pipefail
cd "$(dirname "$0")/.."
wert() { grep -E "^$1=" .env 2>/dev/null | cut -d= -f2- || true; }
ZIEL="${DEPLOY_ZIEL:-$(wert DEPLOY_ZIEL)}"; ZIEL="${ZIEL:-pi@pihub}"
PFAD="${DEPLOY_PFAD:-$(wert DEPLOY_PFAD)}"; PFAD="${PFAD:-/opt/pihub}"

echo "== Prüfen (Typecheck, Lint, Tests)"
npm run --silent pruefen
echo "== Bauen"
npm run --silent build
echo "== Hochladen nach $ZIEL:$PFAD/upload"
ssh "$ZIEL" "sudo mkdir -p $PFAD/upload && sudo chown \$(id -un) $PFAD/upload"
rsync -az --delete --exclude node_modules --exclude .git --exclude data --exclude .env --exclude screenshots ./ "$ZIEL:$PFAD/upload/"
echo "== Release auf dem Pi"
if ssh -t "$ZIEL" "sudo /usr/local/sbin/pihub-release $PFAD/upload"; then
  echo "✓ Deploy erfolgreich"
else
  echo "✗ Deploy fehlgeschlagen. Der Pi läuft mit der vorherigen Version. Log: $PFAD/logs/release.log"
  exit 1
fi
