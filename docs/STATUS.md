# Status

Stand der Entwicklung. Wird nach jeder Phase aktualisiert.

## Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Kern: Gerüst, Module, Daten, Login, Alarmzentrale, Systemstatus, Statusseite, install.sh, Deploy, Tailscale | fertig |
| 2 | Webseiten Wächter, Kunden und Domains, Qualitätscheck | fertig |
| 3 | Karte, Wetter, Drohnen Planung | fertig |
| 4 | Rettung | fertig |
| 5 | swiss unihockey, Unihockey, Timeline, Briefing | fertig |
| 6 | Zeiterfassung, Drohnen Extras, Toolbox, Berichte, öffentliche Statusseite | fertig |
| 7 | Sonnenuntergangs Prognose, Event Zentrale, Content Kalender, Veranstaltungen, Parkplätze | fertig |

## Speicherverbrauch (RSS des Hub Prozesses)

Gemessen in der Entwicklungsumgebung (x86_64, Node 24 bzw. 22). Auf dem Pi 3 (ARM64) ist mit ähnlichen
Werten zu rechnen, die Messung auf dem Pi steht noch aus (siehe «Zuhause prüfen»).

| Phase | Normalbetrieb | Bemerkung |
|---|---|---|
| 1 | 88 MB | installierte Version, Node 24, nach Start und einigen Anfragen |
| 7 | 99 MB (Spitze 112 MB) | Demo mit 12 Modulen, Content Kalender, Event Zentrale, Parkhaus Karte |
| 6 | 96 MB (Spitze 107 MB) | Demo, alle Seiten und Tabs mit Playwright geprüft |
| 5 | 95 MB (Spitze 109 MB) | Demo mit 8 Modulen, Timeline und Briefing |
| 4 | 94 MB (Spitze 104 MB) | Demo mit allen Modulen, Heli Verfolgung alle 30 s, Karte |
| 3 | 88 MB (Spitze 100 MB) | Demo, Karte mit Ebenen, Wetter und Drohne |
| 2 | 84 MB (Spitze 95 MB) | Demo Modus mit 4 Seiten und 7 Tagen Verlauf, Screenshots aller scont Ansichten |

Ziel: unter 300 MB. Zusätzlich begrenzt systemd den Dienst (`MemoryHigh=320M`, `MemoryMax=400M`).

## Geprüft

- Typecheck (tsc, svelte-check), Lint (Biome), Tests (`npm test`): grün
- Supabase Treiber und Migrationen gegen ein echtes Postgres 16 (lokal): Migrationen laufen, auch mehrfach, RLS auf allen Tabellen aktiv
- `install.sh` auf Ubuntu 24.04 (x86_64) als Root durchgelaufen: Pakete, Node 24 Download mit Prüfsumme, Benutzer, .env, Build auf dem Gerät, Start, Gesundheitscheck. systemd selbst war in der Testumgebung nicht verfügbar (Attrappe), die Unit Dateien sind darum nur syntaktisch geprüft.
- Rückfall bei kaputtem Release: erkannt, alte Version läuft weiter
- Backup Skript und Selbsttest auf der installierten Version
- Playwright Screenshots mobil und breit: Start, Alarme, Status, System, Einrichtung, Karte, scont, Wetter, Drohne
- Open-Meteo, NOAA KP Index, geo.admin.ch Drohnenzonen, RainViewer: echt abgerufen, Antworten als Fixtures in den Tests
- Sonnenberechnung (NOAA Algorithmus) gegen PyEphem und Open-Meteo: Abweichung unter 10 Sekunden

## Ungetestet

- Veranstaltungsquellen (iCal, RSS) mit echten Anbietern: Parser mit eigenen Fixtures geprüft

- Overpass API (Spitäler, Rettungswachen, Landeplätze, Defis): von hier nicht erreichbar, gebaut nach der Overpass Dokumentation
- MeteoAlarm Schweiz: Feed war beim Bau leer, Format am deutschen Feed geprüft. Gebietsnamen der Schweiz unbekannt (Filter `WARN_GEBIETE`)
- SLF Lawinenbulletin: im Oktober leer, Felder nach CAAML v6

- PageSpeed Insights: von hier aus ohne Schlüssel immer HTTP 429 (Kontingent erschöpft). Gebaut nach der Dokumentation der API v5 (`lighthouseResult.categories.*.score`, `audits.*.numericValue`). Mit eigenem Schlüssel zuhause prüfen.
- SSL Prüfung: In der Entwicklungsumgebung fängt ein Proxy TLS ab, darum sah der Test nur dessen Zertifikat. Logik geprüft, echte Ablaufdaten zuhause prüfen.

- systemd Units (`deploy/*.service`, `.timer`, `.path`) auf echtem systemd
- `npm run deploy` (braucht SSH Zugang zum Pi)
- Supabase Auth Login (braucht ein Supabase Projekt)
- ntfy Versand an einen echten Empfänger (Code gegen die dokumentierte JSON API gebaut)
- Tailscale Befehle (docs/TAILSCALE.md)

## Zuhause prüfen

- Sonnenuntergang: einige Abende mit Sternen bewerten (Drohne, Tab Sonne). Nach etwa 10 Bewertungen zeigt der Vergleich, ob die Gewichte passen (docs/SONNENUNTERGANG.md)
- Veranstaltungen: Es gibt keine offene, ausdrücklich erlaubte Quelle für Anlässe in St. Gallen (geprüft: Opendatasoft der Stadt, opendata.swiss). Eigene iCal oder RSS Quellen von Vereinen und Veranstaltern erfassen, Nutzungsbedingungen prüfen und das Häkchen setzen
- Parkplätze: Daten der Stadt St. Gallen sind CC BY-NC (nur private Nutzung). Typische Belegung wird nach etwa 2 Wochen aussagekräftig

- swiss unihockey: Format deiner Kalendereinträge. Erkannt wird «swiss unihockey |» am Anfang, Typ (Resultatpost, Matchbericht) und Status (fix, evtl., Ersatz für ...) irgendwo in Titel oder Beschreibung. Postzeit wird als Terminbeginn plus 3 Stunden geschätzt (Annahme: Termin = Anspielzeit des letzten Spiels). Ligen (z.B. «Herren NLB») in der Beschreibung werden in «Spiele des Tages» hervorgehoben.
- swiss unihockey: `docs/swissunihockey-ablauf.md` mit dem Ablauf von Marion füllen, danach im Modul «Aus Ablauf Datei laden»
- Unihockey: Team IDs prüfen (Standard Vipers 416423 «UHC Jonschwil Vipers II, Herren KF 2. Liga», Toggenburg 429092 «Herren GF 2. Liga»)

- Rega Kennzeichen (Modul Rettung, Tab Kennzeichen): Standard HB-ZR* und HB-TI* aus öffentlichen Flottenangaben, ergänzen um Air Zermatt, Air Glaciers, Polizei falls gewünscht
- Unwetter: bei der nächsten Warnung prüfen, wie MeteoAlarm die Gebiete benennt, und `WARN_GEBIETE` anpassen
- Im Winter: Lawinenbulletin Liste im Modul Rettung kontrollieren
- Kartenebenen Spitäler, Rettungswachen, Landeplätze, Defis einmal einschalten (Overpass)

- scont: eine echte Kundenseite anlegen, nach einigen Minuten Antwortzeit und SSL Tage kontrollieren (Seite scont, Klick auf die Seite)
- PageSpeed API Schlüssel eintragen (Google Cloud Console, «PageSpeed Insights API» aktivieren, Schlüssel erstellen) und eine Messung auslösen

- RAM Verbrauch auf dem Pi messen: Seite «System», Wert «RAM des Hubs»
- `sudo systemctl status pihub pihub-backup.timer pihub-aktualisieren.path` zeigt alles aktiv
- Temperatur und Drosselung werden auf dem Pi angezeigt (`vcgencmd` braucht die Gruppe `video`, install.sh fügt sie hinzu)
- Tailscale Funnel Syntax für die öffentliche Statusseite (siehe docs/TAILSCALE.md)
- In Supabase Registrierungen deaktivieren (Authentication, Sign In / Providers). Der Einrichtungsassistent warnt, wenn sie offen sind.

## Rettungs Toolbox: vor dem Gebrauch prüfen

Alle Rechner sind als «Hilfsmittel, ersetzt keine Entscheidung» gekennzeichnet. Bitte jede Formel gegen die
Vorgaben deines Rettungsdienstes prüfen (Code: `src/server/geteilt/toolbox.ts`, Tests: `test/phase6.test.ts`).

| Rechner | Formel | Quelle | Prüfen |
|---|---|---|---|
| GCS | Augen 1 bis 4 + Verbal 1 bis 5 + Motorik 1 bis 6; Einteilung SHT 13 bis 15 leicht, 9 bis 12 mittel, 3 bis 8 schwer | Teasdale & Jennett 1974, glasgowcomascale.org | deutsche Bezeichnungen der Stufen |
| NEWS2 | Punktetabelle für AF, SpO2 (Skala 1 und 2), O2, BD sys, Puls, Bewusstsein (ACVPU), Temperatur; Risiko 0 bis 4 niedrig, ein Parameter mit 3 niedrig bis mittel, 5 bis 6 mittel, ab 7 hoch | Royal College of Physicians 2017 | alle Grenzwerte, besonders Skala 2 |
| Tropfen | Tropfen/min = ml × Tropffaktor / min; ml/h = ml / min × 60 | Tropfformel, ISO 8536-4 (20 Tropfen pro ml) | Tropffaktor eurer Infusionsbestecke |
| Dosis | mg = mg/kg × kg; ml = mg / (mg/ml) | Dreisatz | Maximaldosen sind nicht hinterlegt |
| Sauerstoff | Minuten = Flaschenliter × (Druck minus Restdruck) / Fluss | Boyle Mariotte Näherung | Restdruck nach eurer Vorgabe |
| Umrechnen | °C und °F, kg und lb (0,45359237), kPa und mmHg (0,133322), cm und inch, Glukose mmol/l und mg/dl (18,016), mg und µg | Definitionen und Normwerte | Glukose Faktor |

## Bekannte Grenzen

- `node:sqlite` ist in Node noch experimentell markiert (funktioniert, Warnung unterdrückt)
- Der Button «Deploy (Git Pull)» funktioniert nur, wenn `/opt/pihub/quelle` ein Git Clone mit Lesezugriff auf das Repository ist (Deploy Key). Sonst `npm run deploy` vom Laptop.
