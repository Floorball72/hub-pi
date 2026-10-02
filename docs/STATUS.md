# Status

Stand der Entwicklung. Wird nach jeder Phase aktualisiert.

## Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Kern: Gerüst, Module, Daten, Login, Alarmzentrale, Systemstatus, Statusseite, install.sh, Deploy, Tailscale | fertig |
| 2 | Webseiten Wächter, Kunden und Domains, Qualitätscheck | offen |
| 3 | Karte, Wetter, Drohnen Planung | offen |
| 4 | Rettung | offen |
| 5 | swiss unihockey, Unihockey, Timeline, Briefing | offen |
| 6 | Zeiterfassung, Drohnen Extras, Toolbox, Berichte, öffentliche Statusseite | offen |

## Speicherverbrauch (RSS des Hub Prozesses)

Gemessen in der Entwicklungsumgebung (x86_64, Node 24 bzw. 22). Auf dem Pi 3 (ARM64) ist mit ähnlichen
Werten zu rechnen, die Messung auf dem Pi steht noch aus (siehe «Zuhause prüfen»).

| Phase | Normalbetrieb | Bemerkung |
|---|---|---|
| 1 | 88 MB | installierte Version, Node 24, nach Start und einigen Anfragen |

Ziel: unter 300 MB. Zusätzlich begrenzt systemd den Dienst (`MemoryHigh=320M`, `MemoryMax=400M`).

## Geprüft

- Typecheck (tsc, svelte-check), Lint (Biome), Tests (`npm test`): grün
- Supabase Treiber und Migrationen gegen ein echtes Postgres 16 (lokal): Migrationen laufen, auch mehrfach, RLS auf allen Tabellen aktiv
- `install.sh` auf Ubuntu 24.04 (x86_64) als Root durchgelaufen: Pakete, Node 24 Download mit Prüfsumme, Benutzer, .env, Build auf dem Gerät, Start, Gesundheitscheck. systemd selbst war in der Testumgebung nicht verfügbar (Attrappe), die Unit Dateien sind darum nur syntaktisch geprüft.
- Rückfall bei kaputtem Release: erkannt, alte Version läuft weiter
- Backup Skript und Selbsttest auf der installierten Version
- Playwright Screenshots mobil und breit: Start, Alarme, Status, System, Einrichtung, Karte

## Ungetestet

- systemd Units (`deploy/*.service`, `.timer`, `.path`) auf echtem systemd
- `npm run deploy` (braucht SSH Zugang zum Pi)
- Supabase Auth Login (braucht ein Supabase Projekt)
- ntfy Versand an einen echten Empfänger (Code gegen die dokumentierte JSON API gebaut)
- Tailscale Befehle (docs/TAILSCALE.md)

## Zuhause prüfen

- RAM Verbrauch auf dem Pi messen: Seite «System», Wert «RAM des Hubs»
- `sudo systemctl status pihub pihub-backup.timer pihub-aktualisieren.path` zeigt alles aktiv
- Temperatur und Drosselung werden auf dem Pi angezeigt (`vcgencmd` braucht die Gruppe `video`, install.sh fügt sie hinzu)
- Tailscale Funnel Syntax für die öffentliche Statusseite (siehe docs/TAILSCALE.md)
- In Supabase Registrierungen deaktivieren (Authentication, Sign In / Providers). Der Einrichtungsassistent warnt, wenn sie offen sind.

## Bekannte Grenzen

- `node:sqlite` ist in Node noch experimentell markiert (funktioniert, Warnung unterdrückt)
- Der Button «Deploy (Git Pull)» funktioniert nur, wenn `/opt/pihub/quelle` ein Git Clone mit Lesezugriff auf das Repository ist (Deploy Key). Sonst `npm run deploy` vom Laptop.
