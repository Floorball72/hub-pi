#!/usr/bin/env bash
# Startet den Hub im Demo Modus mit einem frischen Datenverzeichnis (für Tests und Screenshots).
set -euo pipefail
VERZ="${1:-/tmp/pihub-demo}"
PORT="${PORT:-8099}"
rm -rf "$VERZ"; mkdir -p "$VERZ"
cd "$(dirname "$0")/.."
DEMO_MODUS=true DATEN_TREIBER=lokal DATEN_VERZEICHNIS="$VERZ/data" PIHUB_ENV="$VERZ/.env" PORT="$PORT" HOST=127.0.0.1 LOG_LEVEL=warn \
  exec node --disable-warning=ExperimentalWarning --max-old-space-size=200 "${EINSTIEG:-dist/server/main.js}"
