#!/usr/bin/env bash
# Aktualisierung aus dem Hub (Button oder automatisch im Nachtfenster).
# Gestartet von pihub-aktualisieren.path, wenn data/aktualisieren.anfrage geschrieben wird.
# Holt nur aus dem erlaubten Repository (UPDATE_REPO in der .env, Standard Floorball72/hub-pi) und nur
# Commits, die auf dem erlaubten Branch liegen. Vorher muss der Selbsttest der laufenden Version grün sein.
set -euo pipefail
BASIS=/opt/pihub
ANFRAGE="$BASIS/data/aktualisieren.anfrage"
ERGEBNIS="$BASIS/data/aktualisieren.ergebnis.json"
REPO=$(grep -E '^UPDATE_REPO=' "$BASIS/.env" 2>/dev/null | cut -d= -f2 || true); REPO=${REPO:-Floorball72/hub-pi}
ZWEIG=$(grep -E '^UPDATE_BRANCH=' "$BASIS/.env" 2>/dev/null | cut -d= -f2 || true); ZWEIG=${ZWEIG:-main}
COMMIT=$(grep -oE '"commit":"[0-9a-f]{7,40}"' "$ANFRAGE" 2>/dev/null | cut -d'"' -f4 || true)
rm -f "$ANFRAGE"

melden() {
  printf '{"zeit":"%s","ok":false,"schritt":"%s","meldung":"%s","von":"","nach":"","commit":"%s"}\n' "$(date -Iseconds)" "$1" "$2" "$COMMIT" > "$ERGEBNIS"
  chown pihub:pihub "$ERGEBNIS" 2>/dev/null || true
  echo "$2"
  exit 1
}

[[ -d "$BASIS/quelle/.git" ]] || melden vorbereitung "Kein Git Repository in $BASIS/quelle (siehe docs/HEIMSETUP.md, Abschnitt Updates)"
URL=$(runuser -u pihub -- git -C "$BASIS/quelle" remote get-url origin)
# Nur das erlaubte Repository (https oder ssh Schreibweise)
echo "$URL" | grep -qiE "github\.com[:/]$REPO(\.git)?$" || melden vorbereitung "Quelle $URL ist nicht das erlaubte Repository $REPO"

cd "$BASIS/current"
runuser -u pihub -- env PIHUB_ENV="$BASIS/.env" DATEN_VERZEICHNIS="$BASIS/data" \
  node --disable-warning=ExperimentalWarning scripts/selbsttest.ts --kern >/dev/null 2>&1 \
  || melden selbsttest "Selbsttest der laufenden Version ist rot, Update ausgelassen"

runuser -u pihub -- git -C "$BASIS/quelle" fetch --quiet origin "$ZWEIG" || melden holen "git fetch fehlgeschlagen"
ZIELCOMMIT=${COMMIT:-$(runuser -u pihub -- git -C "$BASIS/quelle" rev-parse "origin/$ZWEIG")}
runuser -u pihub -- git -C "$BASIS/quelle" merge-base --is-ancestor "$ZIELCOMMIT" "origin/$ZWEIG" \
  || melden holen "Commit $ZIELCOMMIT liegt nicht auf $ZWEIG"
runuser -u pihub -- git -C "$BASIS/quelle" checkout --quiet --detach "$ZIELCOMMIT"
/usr/local/sbin/pihub-release "$BASIS/quelle"
