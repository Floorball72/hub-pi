#!/usr/bin/env bash
# Befehl «pihub» auf dem Pi. Wird von install.sh nach /usr/local/bin/pihub kopiert.
set -euo pipefail
BASIS=/opt/pihub
als_dienst() {
  cd "$BASIS/current"
  sudo -u pihub env -i HOME="$BASIS" PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 PIHUB_ENV="$BASIS/.env" DATEN_VERZEICHNIS="$BASIS/data" \
    /usr/local/bin/node --disable-warning=ExperimentalWarning "$@"
}
case "${1:-hilfe}" in
  selbsttest) shift; als_dienst scripts/selbsttest.ts "$@" ;;
  backup) als_dienst scripts/backup.ts ;;
  migrate) als_dienst scripts/migrate.ts ;;
  passwort) als_dienst scripts/passwort.ts ;;
  status) systemctl --no-pager status pihub pihub-backup.timer pihub-aktualisieren.path | head -40 ;;
  logs) journalctl -u pihub -n "${2:-100}" --no-pager ;;
  logs-live) journalctl -u pihub -f ;;
  neustart) sudo systemctl restart pihub && echo "Dienst neu gestartet" ;;
  update)
    # Neue Version aus einem entpackten Ordner (z.B. aus der ZIP Datei) einspielen
    ziel="${2:?Ordner angeben, z.B. pihub update ~/pi-hub}"
    sudo /usr/local/sbin/pihub-release "$(cd "$ziel" && pwd)" ;;
  updates-einrichten)
    # Macht /opt/pihub/quelle zu einem Git Clone des erlaubten Repositorys (Voraussetzung für Updates aus dem Hub).
    # Private Repositories: vorher «sudo -u pihub git config --global credential.helper store» und Token eingeben.
    repo=$(grep -E '^UPDATE_REPO=' "$BASIS/.env" | cut -d= -f2); repo=${repo:-Floorball72/hub-pi}
    zweig=$(grep -E '^UPDATE_BRANCH=' "$BASIS/.env" | cut -d= -f2); zweig=${zweig:-main}
    sudo rm -rf "$BASIS/quelle.neu"
    sudo -u pihub env HOME="$BASIS" git clone --branch "$zweig" "https://github.com/$repo.git" "$BASIS/quelle.neu"
    sudo rm -rf "$BASIS/quelle" && sudo mv "$BASIS/quelle.neu" "$BASIS/quelle"
    echo "Fertig. Updates holen jetzt aus $repo ($zweig). Im Hub unter «Sichere Updates» einschalten." ;;
  speicher) ps -o rss=,cmd= -u pihub | awk '{printf "%d MB  %s\n", $1/1024, $2" "$3" "$4}' ;;
  *)
    cat <<'HILFE'
pihub selbsttest [--ohne-push]   Prüft Speicher, Temperatur, Datenbank, Push und alle Datenquellen
pihub status                     Zustand der Dienste
pihub logs [Anzahl]              Letzte Log Zeilen
pihub logs-live                  Log live mitlesen (Ctrl+C beendet)
pihub neustart                   Dienst neu starten
pihub backup                     Backup jetzt erstellen
pihub migrate                    Supabase Migrationen anwenden
pihub passwort                   Passwort Hash für die .env erzeugen
pihub update <Ordner>            Neue Version aus einem Ordner einspielen (mit Rückfall)
pihub updates-einrichten         Repository für Updates aus dem Hub einrichten (git clone)
pihub speicher                   RAM Verbrauch des Hubs
HILFE
    ;;
esac
