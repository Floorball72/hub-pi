#!/usr/bin/env bash
# Aktualisierung per Button im Hub: git pull in /opt/pihub/quelle, dann Release mit Gesundheitscheck.
# Gestartet von pihub-aktualisieren.path, wenn data/aktualisieren.anfrage geschrieben wird.
set -euo pipefail
BASIS=/opt/pihub
rm -f "$BASIS/data/aktualisieren.anfrage"
if [[ ! -d "$BASIS/quelle/.git" ]]; then
  echo "Kein Git Repository in $BASIS/quelle. Deploy vom Laptop mit npm run deploy verwenden."
  exit 1
fi
runuser -u pihub -- git -C "$BASIS/quelle" pull --ff-only
/usr/local/sbin/pihub-release "$BASIS/quelle"
