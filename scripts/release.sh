#!/usr/bin/env bash
# Baut ein Release aus einem Quellordner in einem eigenen Ordner, sichert die Daten, wendet Migrationen an,
# schaltet um und prüft Gesundheit und Selbsttest. Schlägt etwas fehl, wird auf die vorherige Version
# zurückgeschaltet. Die letzten 3 Versionen bleiben erhalten.
# Aufruf (als root): pihub-release /opt/pihub/quelle
set -euo pipefail
QUELLE="${1:?Quellordner fehlt}"
BASIS=/opt/pihub
BENUTZER=pihub
STEMPEL=$(date +%Y%m%d-%H%M%S)
ZIEL="$BASIS/releases/$STEMPEL"
PORT=$(grep -E '^PORT=' "$BASIS/.env" 2>/dev/null | cut -d= -f2 || true); PORT=${PORT:-8080}
TREIBER=$(grep -E '^DATEN_TREIBER=' "$BASIS/.env" 2>/dev/null | cut -d= -f2 || true)
LOG="$BASIS/logs/release.log"
ERGEBNIS="$BASIS/data/aktualisieren.ergebnis.json"
SCHRITT=start
VORHER=$(readlink -f "$BASIS/current" 2>/dev/null || true)

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
ergebnis() {
  # $1 ok (true/false), $2 Meldung
  local commit=""
  [[ -f "$ZIEL/RELEASE_COMMIT" ]] && commit=$(cat "$ZIEL/RELEASE_COMMIT")
  printf '{"zeit":"%s","ok":%s,"schritt":"%s","meldung":"%s","von":"%s","nach":"%s","commit":"%s"}\n' \
    "$(date -Iseconds)" "$1" "$SCHRITT" "${2//\"/\'}" "$(basename "${VORHER:-}")" "$STEMPEL" "$commit" > "$ERGEBNIS"
  chown "$BENUTZER:$BENUTZER" "$ERGEBNIS" 2>/dev/null || true
}
# Befehle als Dienstbenutzer mit sauberer Umgebung (keine Einstellungen von root übernehmen)
als() {
  local extra=()
  for v in HTTPS_PROXY https_proxy HTTP_PROXY http_proxy NO_PROXY no_proxy NODE_EXTRA_CA_CERTS; do
    [[ -n "${!v:-}" ]] && extra+=("$v=${!v}")
  done
  runuser -u "$BENUTZER" -- env -i HOME="$BASIS" PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
    PIHUB_ENV="$BASIS/.env" DATEN_VERZEICHNIS="$BASIS/data" \
    npm_config_cache="$BASIS/.npm" NODE_OPTIONS="${NODE_OPTIONS:-}" "${extra[@]}" "$@"
}
fehler() {
  log "Fehler im Schritt $SCHRITT"
  ergebnis false "Fehler im Schritt $SCHRITT, alte Version läuft weiter"
  rm -rf "$ZIEL"
  exit 1
}

log "Release $STEMPEL aus $QUELLE"
trap fehler ERR
SCHRITT=kopieren
mkdir -p "$ZIEL"
rsync -a --exclude node_modules --exclude .git --exclude data --exclude .env --exclude screenshots --exclude auslieferung "$QUELLE"/ "$ZIEL"/
if git -C "$QUELLE" rev-parse HEAD >/dev/null 2>&1; then git -C "$QUELLE" rev-parse HEAD > "$ZIEL/RELEASE_COMMIT"; fi
chown -R "$BENUTZER:$BENUTZER" "$ZIEL"

SCHRITT=bauen
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

SCHRITT=backup
log "Backup vor dem Umschalten"
als node --disable-warning=ExperimentalWarning scripts/backup.ts

if [[ "$TREIBER" == "supabase" ]]; then
  SCHRITT=migration
  # Migrationen sind rückwärts kompatibel (nur hinzufügen), die alte Version läuft auch mit dem neuen Schema
  log "Supabase Migrationen anwenden"
  als node --disable-warning=ExperimentalWarning scripts/migrate.ts
fi
trap - ERR

SCHRITT=umschalten
ln -sfn "$ZIEL" "$BASIS/current.neu" && mv -T "$BASIS/current.neu" "$BASIS/current"
systemctl restart pihub.service

gesund() {
  for _ in $(seq 1 45); do
    sleep 2
    # Erst gesund, wenn das erwartete Release antwortet (nicht eine alte Instanz)
    curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/gesundheit" 2>/dev/null | grep -q "\"release\":\"$1\"" && return 0
  done
  return 1
}

zurueck() {
  log "$1"
  if [[ -n "$VORHER" && -d "$VORHER" ]]; then
    ln -sfn "$VORHER" "$BASIS/current.neu" && mv -T "$BASIS/current.neu" "$BASIS/current"
    systemctl restart pihub.service
    log "Zurück auf $(basename "$VORHER")"
    if gesund "$(basename "$VORHER")"; then
      log "Vorherige Version läuft wieder"
      ergebnis false "$1. Automatisch auf $(basename "$VORHER") zurückgeschaltet."
    else
      log "Auch die vorherige Version startet nicht. journalctl -u pihub prüfen."
      ergebnis false "$1. Auch die vorherige Version startet nicht."
    fi
  else
    ergebnis false "$1"
  fi
  exit 1
}

SCHRITT=gesundheit
gesund "$STEMPEL" || zurueck "Gesundheitscheck fehlgeschlagen"
SCHRITT=selbsttest
if ! (cd "$ZIEL" && als node --disable-warning=ExperimentalWarning scripts/selbsttest.ts --kern >> "$LOG" 2>&1); then
  zurueck "Selbsttest nach dem Update rot"
fi

log "Release $STEMPEL aktiv"
SCHRITT=fertig
ergebnis true "Update auf $STEMPEL erfolgreich"

# Alte Releases aufräumen (die letzten 3 bleiben)
ls -1dt "$BASIS"/releases/*/ | tail -n +4 | xargs -r rm -rf
