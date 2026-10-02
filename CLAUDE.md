# Pi Hub

Persönliche Zentrale von Jerome. Eine Webseite, die 24/7 auf einem Raspberry Pi 3 läuft und Anzeige, Überwachung, Karten, Tools und Push Meldungen in Modulen bündelt. Das Ziel: Beim Vorzeigen soll es «oha» auslösen und im Alltag wirklich genutzt werden.

## Rahmen

* Hardware: Raspberry Pi 3, 1 GB RAM, 64 GB Speicher, Pi OS Lite 64 Bit. Keine Hardware Käufe.
* Der Betrieb muss mit wenig RAM laufen (Ziel: unter 300 MB im Normalbetrieb). Alles Neue wird auf diese Grenze geprüft.
* Kein Docker auf dem Pi. Betrieb als systemd Dienst.
* Datenbank: Supabase extern (Cloud), nicht auf dem Pi. Free Tier beachten (500 MB).
* Zugriff: Tailscale, HTTPS über `tailscale serve`. Kein Portforwarding.
* Push: ntfy.
* Entwicklung mit Claude Code, Deploy auf den Pi mit einem einzigen Befehl. Installation auf dem Pi über ein `install.sh`.
* Sprache: Oberfläche und Kommentare auf Deutsch, Schweizer Schreibweise (kein ß). In Texten der Oberfläche keine Gedankenstriche.

## Stack

* Backend: Node.js mit TypeScript und Fastify
* Frontend: Vite Build (Svelte), vom Backend ausgeliefert, mobil zuerst, dunkles Design, als PWA installierbar
* Karten: Leaflet, Ebenen einzeln ein und ausschaltbar
* Hintergrundjobs im selben Prozess mit einem Scheduler
* Supabase für Datenbank und Login. Service Role Key nur im Backend (`.env`, nie im Git, nie im Frontend). Row Level Security auf allen Tabellen.

## Architektur

* Modul System: Jedes Modul liegt in `src/modules/<name>/` mit eigenen Routen, Jobs, Datenbank Migrationen und einer Kachel im Frontend. Der Kern lädt Module über ein Manifest.
* Datenquellen Schicht: Jede externe Quelle (ADS-B, Wetter, Verkehr, Alertswiss, iCal usw.) läuft über einen Adapter mit Cache, Timeout und Statusmeldung. Fällt eine Quelle aus, zeigt der Hub das an, statt kaputt zu gehen. Quellen müssen austauschbar sein.
* Datenzugriff läuft zentral über ein eigenes Modul, nicht verstreut im Code.
* Offline Puffer: Messwerte werden lokal kurz zwischengespeichert und nachgeschickt, wenn Supabase wieder erreichbar ist.
* Verdichtung: Ein täglicher Job fasst Rohdaten nach einigen Wochen zu Stunden oder Tageswerten zusammen und löscht die alten.
* Alle Benachrichtigungen laufen über eine Alarmzentrale mit Regeln (Priorität, Ruhezeiten, Quelle). Module senden Ereignisse, die Zentrale entscheidet über ntfy.
* Aktivitätslog: Was der Hub wann getan hat.

## Module

### Zentrale

* Startseite mit Morgenbriefing: Wetter, Termine, Ausfälle, Einsätze der Nacht, nächster swiss unihockey Einsatz
* Alarmzentrale
* Aktionen per Button (Dienste neu starten, Backup auslösen, Deploy), nur mit Login und Bestätigung
* Globale Suche, Kiosk Modus, Fokusmodus
* Gemeinsame Timeline: swiss unihockey Einsätze, Kundendrehs, Vipers Spiele, Fristen und Ablaufdaten
* Systemstatus des Pi (Temperatur, RAM, Speicher, Tailscale, Backup Alter)
* Statusseite für Jerome selbst: Welche Module laufen, welche Datenquellen sind ausgefallen
* Backup Übersicht
* Schnellnotizen, die an Orte, Kunden oder Einsätze gehängt werden

### scont

* Webseiten Wächter: Statusprüfung definierter Seiten, Antwortzeit, SSL Ablauf, Verfügbarkeit in Prozent, Push bei Ausfall
* Kunden und Domains mit Ablaufdaten, Kostenübersicht (Domains, Hosting, Abos)
* PageSpeed Verlauf
* Qualitätscheck pro Kundenseite: defekte Links, Sicherheits Header, Cookie Hinweis
* Öffentliche Statusseite für Kunden (eigene, stark eingeschränkte Route ohne Login, zeigt nur Verfügbarkeit)
* Monatsreport pro Kunde als PDF
* Zeiterfassung pro Kunde per Knopfdruck

### Rettung

* Karte mit Helikoptern über ADS-B (Rega, Air Zermatt, Air Glaciers, Polizei), gefiltert auf Kennzeichen und Region. Es sind nur Fahrzeuge sichtbar, die einen Transponder senden.
* Erkennung von Start und Landung, Push bei Heli Aktivität in der Region
* Rega Statistik aus den erfassten Flügen: Tageszeit, Wochentag, Region, Heatmap
* Einsatzauswertungen der Blaulichtorganisationen der Region aus öffentlichen Quellen (Medienmitteilungen, RSS). Zeitverzögert, das wird in der Oberfläche so angeschrieben.
* Alertswiss Meldungen mit Push
* Kartenebenen: Unwetter, Naturgefahren, Lawinen, Pegel und Hochwasser, Blitze live, Regenradar, Erdbeben, Verkehrslage und Pässe, Webcams, Spitäler mit Notfallstation, Rettungswachen, Heli Landeplätze, Defibrillatoren (nur wenn offene Daten vorhanden), Luftraum Zonen
* ÖV Abfahrten (transport.opendata.ch) von Wohnort und Arbeit
* Rettungs Toolbox: Rechner und Scores (z.B. GCS, NEWS2, Tropfrechner, Umrechnungen). Nur mit geprüften Formeln und Quellenangabe, als Hilfsmittel gekennzeichnet, nicht als Entscheidungsgrundlage. Jerome prüft jede Formel vor dem Einbau.
* Push Regeln: Alertswiss in der Region, Unwetterwarnung ab Stufe 3 für gespeicherte Orte, Heli Aktivität, Erdbeben ab einstellbarer Stärke

Nicht bauen: Position von Rettungswagen (nicht öffentlich), Mitlesen von Pager oder Funk (in der Schweiz nicht erlaubt).

### Drohne

* Planungskarte: Orte speichern, Shortlist, Notizen, Status (Idee, geplant, gedreht), Zuordnung zu Kundendrehs
* Pro Ort Wetter und Vorhersage (Open-Meteo), Wind auf Flughöhe, Böen, Niederschlag, KP Index, Luftraum Einschränkungen (geo.admin.ch)
* Wetterfenster Alarm: Mindestwetter pro Ort hinterlegen, Push bei passendem Fenster
* Sonne und Licht: Sonnenstand, Golden Hour, Mondphase pro Ort und Datum
* Drehbuch pro Kundendreh
* Lieferstatus pro Kundendreh (Anfrage, Dreh, Schnitt, Lieferung) mit Fristen
* Flugstatistiken und Flug Logbuch
* Akku und Wartung: Zyklen pro Akku, Wartungslog, Erinnerungen
* Dokumente und Fristen (Versicherung, Registrierung, Weiterbildungen)

### Unihockey

* Spielplan und Rangliste von UHC Jonschwil Vipers und United Toggenburg

### swiss unihockey

Das Modul liefert nur Infos und eine Checkliste. Es erstellt nichts, schreibt nichts und postet nichts.

* Einsatzplan aus der geheimen iCal Adresse von Jeromes Google Kalender. Einsätze tragen das Präfix «swiss unihockey |» und enthalten Typ (Resultatpost, Matchbericht), Status (fix, evtl., Ersatz für wen) und geschätzte Postzeit (letztes Spiel plus rund 3 Stunden).
* Spiele des Tages mit Anspielzeiten, Live Stand und Spielende
* Push Erinnerungen: Freitagabend Login prüfen, Spielende erreicht, evtl. Einsätze klären
* Checkliste pro Einsatz nach dem Ablauf von Marion Kaufmann (Verantwortliche Kommunikation). Jerome liefert den genauen Ablauf und das Muster in `docs/swissunihockey-ablauf.md`. Bis dahin ist die Checkliste ein Platzhalter. Nichts erfinden.
* Zugangsdaten zum geteilten Hub Login gehören nur in die `.env`, nie ins Git, nie in Logs, nie in Prompts.
* Die Datenquelle von swiss unihockey kann sich ändern (API Umstellung angekündigt). Der Adapter muss austauschbar sein.

## Sicherheit

* Login für alle Seiten ausser der öffentlichen Statusseite
* Keine Secrets im Git. `.env.example` mit leeren Werten pflegen.
* Aktionen, die etwas verändern, brauchen Bestätigung
* Keine personenbezogenen Daten Dritter speichern, die nicht nötig sind

## Arbeitsweise

* Phasenweise bauen, jede Phase muss auf dem Pi lauffähig und getestet sein, bevor die nächste startet.
* Vor grösseren Entscheidungen kurz Optionen nennen und auf Jeromes Antwort warten.
* Nach jeder Phase: RAM Verbrauch auf dem Pi messen und berichten.
* Änderungen klein halten, jede in einem eigenen Commit.

## Phasen

1. Kern: Projektgerüst, Modul System, Supabase Anbindung und Login, Alarmzentrale mit ntfy, Systemstatus, Statusseite für Jerome, `install.sh`, Deploy Befehl, Tailscale Anleitung
2. Webseiten Wächter, Kunden und Domains, Qualitätscheck
3. Karte mit Ebenen, Wetter und Drohnen Planung
4. Rettung: Helikopter, Alertswiss, Warnungen, Einsatzauswertungen, Rega Statistik
5. swiss unihockey und Unihockey Modul, gemeinsame Timeline, Morgenbriefing
6. Rest: Zeiterfassung, Drohnen Extras, Rettungs Toolbox, Berichte, öffentliche Statusseite

## Umsetzung und Entscheide (Stand Bau)

Ergänzt nach dem Bau. Details und Begründungen in `docs/ENTSCHEIDE.md`, Stand in `docs/STATUS.md`.

* Datenschicht mit zwei Treibern hinter einem Interface (`src/server/daten`): `supabase` (Postgres Verbindung aus dem Backend) und `lokal` (SQLite über `node:sqlite`, für Entwicklung, Tests und als Offline Puffer). Wahl über `DATEN_TREIBER` in der `.env`.
* Schema als Code: Tabellen werden pro Modul mit `tabelle({...})` deklariert. `npm run db:generieren` erzeugt neue Migrationen in `supabase/migrations`, `npm run db:migrate` wendet sie an.
* **Regel: Migrationen sind rückwärts kompatibel.** Nur neue Tabellen und neue Spalten, nie löschen oder umbenennen. So kann ein Update jederzeit auf die vorherige Version zurückfallen.
* Jede externe Quelle ist eine `Quelle` mit Cache, Timeout, Status und Demo Daten (`DEMO_MODUS=true`).
* Module: Zentrale, Wetter, scont, Rettung, Drohne, swiss unihockey, Unihockey, Mobilität. Jedes Modul ist einzeln ausschaltbar.
* Login: lokaler Admin (scrypt) oder Supabase Auth für Adressen in `ERLAUBTE_EMAILS`. Schreibende Anfragen brauchen den Header `x-pihub: 1`.
* Betrieb: `install.sh`, Releases unter `/opt/pihub/releases` mit Rückfall, Befehl `pihub` auf dem Pi, Backup täglich per systemd Timer.
* Tests mit `node:test`, Lint mit Biome, Screenshots mit Playwright (`npm run screenshots`).
* Kein TypeScript, das Node nicht direkt ausführen kann (keine Enums, keine Konstruktor Parameter Eigenschaften).
