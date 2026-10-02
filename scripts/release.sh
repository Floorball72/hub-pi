#!/usr/bin/env bash
# Baut ein Release aus einem Quellordner, schaltet um und prüft die Gesundheit.
# Schlägt der Gesundheitscheck fehl, wird auf die vorherige Version zurückgeschaltet.
# Aufruf (als root): pihub-release /opt/pihub/quelle
set -euo pipefail
QUELLE="${1:?Quellordner fehlt}"
BASIS=/opt/pihub
BENUTZER=pihub
STEMPEL=$(date +%Y%m%d-%H%M%S)
ZIEL="$BASIS/releases/$STEMPEL"
PORT=$(grep -E '^PORT=' "$BASIS/.env" 2>/dev/null | cut -d= -f2 || true); PORT=${PORT:-8080}
LOG="$BASIS/logs/release.log"

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
# Befehle als Dienstbenutzer mit sauberer Umgebung (keine Einstellungen von root übernehmen)
als() {
  local extra=()
  for v in HTTPS_PROXY https_proxy HTTP_PROXY http_proxy NO_PROXY no_proxy NODE_EXTRA_CA_CERTS; do
    [[ -n "${!v:-}" ]] && extra+=("$v=${!v}")
  done
  runuser -u "$BENUTZER" -- env -i HOME="$BASIS" PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
    npm_config_cache="$BASIS/.npm" NODE_OPTIONS="${NODE_OPTIONS:-}" "${extra[@]}" "$@"
}

log "Release $STEMPEL aus $QUELLE"
mkdir -p "$ZIEL"
rsync -a --exclude node_modules --exclude .git --exclude data --exclude .env --exclude screenshots "$QUELLE"/ "$ZIEL"/
chown -R "$BENUTZER:$BENUTZER" "$ZIEL"

cd "$ZIEL"
export NODE_OPTIONS="--max-old-space-size=600"
export npm_config_cache="$BASIS/.npm"
if [[ -f dist/web/index.html && -f dist/server/main.js ]]; then
  log "Fertiger Build vorhanden, nur Laufzeitpakete installieren"
  als npm ci --omit=dev --no-audit --no-fund --loglevel=error
else
  log "Installiere Pakete und baue (dauert auf dem Pi 3 einige Minuten)"
  als npm ci --no-audit --no-fund --loglevel=error
  als npm run build
  als npm prune --omit=dev --no-audit --no-fund --loglevel=error
fi
unset NODE_OPTIONS

VORHER=$(readlink -f "$BASIS/current" 2>/dev/null || true)
ln -sfn "$ZIEL" "$BASIS/current.neu" && mv -T "$BASIS/current.neu" "$BASIS/current"
systemctl restart pihub.service

gesund() {
  for _ in $(seq 1 30); do
    sleep 2
    # Erst gesund, wenn das erwartete Release antwortet (nicht eine alte Instanz)
    curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/gesundheit" 2>/dev/null | grep -q "\"release\":\"$1\"" && return 0
  done
  return 1
}

if gesund "$STEMPEL"; then
  log "Gesundheitscheck ok, Release $STEMPEL aktiv"
else
  log "Gesundheitscheck fehlgeschlagen"
  if [[ -n "$VORHER" && -d "$VORHER" ]]; then
    ln -sfn "$VORHER" "$BASIS/current.neu" && mv -T "$BASIS/current.neu" "$BASIS/current"
    systemctl restart pihub.service
    log "Zurück auf $(basename "$VORHER")"
    gesund "$(basename "$VORHER")" && log "Vorherige Version läuft wieder" || log "Auch die vorherige Version startet nicht. journalctl -u pihub prüfen."
  fi
  exit 1
fi

# Alte Releases aufräumen (die letzten 3 bleiben)
ls -1dt "$BASIS"/releases/*/ | tail -n +4 | xargs -r rm -rf
