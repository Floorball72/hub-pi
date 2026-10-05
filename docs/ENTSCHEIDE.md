# Entscheide

Entscheide, die ohne Rückfrage getroffen wurden. Jeweils: was, warum, Alternative.
Grundsatz bei Unklarheit: die einfachere und ressourcenschonendere Variante.

## Kern

### E1 Zwei Datentreiber hinter einem Interface
- **Was:** `supabase` (Postgres Verbindung aus dem Backend) und `lokal` (SQLite über `node:sqlite`). Wahl über `DATEN_TREIBER` in der `.env`.
- **Warum:** Entwicklung und Tests ohne Schlüssel, Offline Puffer ohne Zusatzpaket.
- **Alternative:** supabase-js mit REST. Verworfen, weil Migrationen ohnehin eine Postgres Verbindung brauchen und `postgres` (porsager) klein und ohne Abhängigkeiten ist.

### E2 SQLite über `node:sqlite` statt `better-sqlite3`
- **Was:** Eingebautes SQLite Modul von Node (ab 22.13, Node 24 auf dem Pi).
- **Warum:** Kein natives Paket, das auf dem Pi kompiliert werden muss. Spart RAM und Installationszeit.
- **Alternative:** better-sqlite3 (schneller, aber native Kompilierung auf ARM).
- **Hinweis:** `node:sqlite` ist in Node noch als experimentell markiert. Die Warnung wird beim Start unterdrückt.

### E3 Schema als Code, Migrationen daraus erzeugt
- **Was:** Tabellen werden in TypeScript deklariert (`tabelle({...})`). Daraus entstehen SQLite Tabellen, die Supabase Migrationen (`npm run db:generieren`) und die Formulare im Frontend.
- **Warum:** Beide Treiber bleiben gleich, keine doppelte Pflege. Ein Test prüft, dass jede Tabelle und Spalte in einer Migration steht und RLS aktiv ist.
- **Alternative:** Handgeschriebene SQL Dateien pro Modul. Mehr Aufwand, Fehler zwischen den Treibern.
- **Regel:** Migrationen sind nur additiv (neue Tabellen, neue Spalten). Nie Spalten löschen oder umbenennen. So bleibt ein Rückfall auf die vorherige Version möglich.

### E4 Row Level Security ohne Policies
- **Was:** RLS ist auf allen Tabellen an, es gibt keine Policies.
- **Warum:** Der öffentliche anon Key kann damit nichts lesen oder schreiben. Das Backend verbindet sich als Tabelleneigentümer und ist nicht betroffen. Der Service Role Key wird nur für allfällige spätere Admin Aufrufe gespeichert, nie ans Frontend gegeben.

### E5 Login: lokaler Admin plus Supabase Auth
- **Was:** Login mit Benutzer `jerome` und Passwort (scrypt Hash in der `.env`) oder mit E-Mail über Supabase Auth (nur Adressen in `ERLAUBTE_EMAILS`). Sitzung als signiertes Cookie (HMAC, 30 Tage, HttpOnly, SameSite Strict).
- **Warum:** Der Hub bleibt bedienbar, wenn Supabase ausfällt. Leere `ERLAUBTE_EMAILS` heisst: kein Supabase Login, damit offene Registrierungen in Supabase kein Risiko sind.
- **Alternative:** Nur Supabase Auth. Abhängig von der Cloud.

### E6 CSRF Schutz über eigenen Header
- **Was:** Schreibende API Aufrufe brauchen den Header `x-pihub: 1`, Cookies sind SameSite Strict.
- **Warum:** Einfach, ohne Token Verwaltung. Fremde Seiten können den Header nicht ohne CORS Freigabe setzen.

### E7 Netzwerk: Port 8080 auf allen Schnittstellen, Filter auf private Netze
- **Was:** `HOST=0.0.0.0`, aber Anfragen nur aus privaten Netzen, Tailscale (100.64.0.0/10) und localhost.
- **Warum:** Der Einrichtungsassistent muss vor der Tailscale Einrichtung aus dem Heimnetz erreichbar sein. Wer nur Tailscale will, setzt `HOST=127.0.0.1` (siehe docs/TAILSCALE.md).

### E8 Bestätigung von Aktionen
- **Was:** Löschen, Modul Schalter, Regeln ein und aus, Backup, Neustart, Aktualisierung und Einrichtung brauchen einen Bestätigungsdialog. Das Backend prüft `bestaetigt: true` bzw. `?bestaetigt=ja`. Erstellen und Bearbeiten in Formularen gilt mit dem Klick auf «Speichern» als bestätigt.
- **Warum:** Schutz vor Fehlklicks ohne jeden Formularschritt doppelt abzufragen.

### E9 Fastify ohne @fastify/static und ohne Cookie Plugin
- **Was:** Statische Dateien und Cookies mit wenigen Zeilen selbst.
- **Warum:** Laufzeit Abhängigkeiten nur `fastify` und `postgres`.

### E10 Backend in TypeScript, auf dem Pi kompiliertes JavaScript
- **Was:** Der Dienst läuft mit `dist/server/main.js` (tsc). Werkzeuge (Selbsttest, Backup, Migration) laufen als `.ts` direkt mit Node 24 (Type Stripping).
- **Warum:** Kompiliertes JS braucht weniger RAM als Type Stripping zur Laufzeit. Werkzeuge laufen selten.
- **Folge:** Keine TypeScript Syntax, die Node nicht entfernen kann (keine Enums, keine Konstruktor Parameter Eigenschaften). `erasableSyntaxOnly` ist an.

### E11 Tests mit `node:test`
- **Was:** Eingebauter Testrunner statt Vitest oder Jest.
- **Warum:** Keine zusätzlichen Pakete. Fixtures echter API Antworten liegen in `test/fixtures`.

### E12 Lint mit Biome
- **Was:** Biome für TypeScript, `svelte-check` für Svelte.
- **Warum:** Ein einziges Paket statt ESLint mit Plugins.

### E13 Scheduler mit einem Takt
- **Was:** Ein Timer alle 15 Sekunden prüft alle Jobs (Intervall oder täglich zur Schweizer Zeit). Jobs überlappen nie, Fehler landen im Aktivitätslog.
- **Warum:** Kein Cron Paket, geringe Last.

### E14 Push über ntfy mit JSON
- **Was:** POST an die Server Wurzel mit JSON (`topic`, `title`, `message`, `priority`, `tags`).
- **Warum:** Umlaute in Titeln funktionieren zuverlässig (HTTP Header können das nicht sicher).

### E15 Ruhezeit Standard 22:00 bis 07:00
- **Was:** Alle Regeln haben diese Ruhezeit und «auch nachts» aus. Ausnahme: Ausfall einer Kundenseite («auch nachts» an).
- **Warum:** Vorgabe «keine Nachtmeldungen ausser Ausfälle von Kundenseiten».

### E16 Backup als komprimiertes JSON
- **Was:** Täglich 03:30 per systemd Timer, alle Tabellen als `.json.gz` in `data/backups`, die letzten 14 bleiben.
- **Warum:** Gleich für beide Treiber, auch Supabase Daten liegen damit lokal vor. Einspielen mit `npm run backup -- --einspielen <Datei>`.
- **Alternative:** pg_dump (müsste auf dem Pi installiert werden).

### E17 Releases mit Rückfall
- **Was:** `/opt/pihub/releases/<Zeit>`, Symlink `current`, Gesundheitscheck nach dem Umschalten, bei Fehler zurück. Die letzten 3 Releases bleiben.
- **Warum:** Deploy und Aktualisierung können den Hub nie dauerhaft kaputt machen.

### E18 Deploy vom Laptop per rsync, Aktualisierung am Pi per git pull
- **Was:** `npm run deploy` prüft, baut lokal und lädt hoch (der Pi muss dann nicht bauen). Der Button «Deploy» im Hub löst über eine systemd Path Unit `git pull` und den Release aus.
- **Warum:** Bauen auf dem Pi 3 ist langsam. Der Button funktioniert nur, wenn `/opt/pihub/quelle` ein Git Clone mit Zugriff ist.

### E19 systemd Härtung und Speichergrenze
- **Was:** `MemoryHigh=320M`, `MemoryMax=400M`, `--max-old-space-size=200`, `ProtectSystem=strict`, nur `data` und `.env` beschreibbar.
- **Warum:** Der Pi bleibt bedienbar, auch wenn der Hub ein Speicherproblem hätte.

### E20 Kartenhintergrund
- **Was:** swisstopo Landeskarte grau, im Browser invertiert für das dunkle Design. Weitere Hintergründe: farbig, Luftbild, OpenStreetMap.
- **Warum:** Kostenlos (swisstopo Geodienste sind frei nutzbar), keine Schlüssel, dunkles Design ohne kommerziellen Kartenanbieter.

## Module (Phasen 2 bis 4)

### E21 Eigene Module «Wetter» und «Mobilität»
- **Was:** Wetter (Orte, KP, Radar) und Mobilität (ÖV, später Parkplätze) sind eigene Module statt Teil von Zentrale oder Rettung.
- **Warum:** Einzeln ausschaltbar (RAM, Abrufe) und von mehreren Bereichen genutzt (Briefing, Drohne, Rettung).

### E22 Verfügbarkeit aus Zählabfragen
- **Was:** Verfügbarkeit (24 h, 7 und 30 Tage) wird mit zwei COUNT Abfragen pro Seite berechnet und 2 Minuten zwischengespeichert. Rohdaten älter als 31 Tage werden zu Stundenwerten verdichtet.
- **Warum:** Keine grossen Datenmengen über die Leitung zu Supabase, wenig RAM.

### E23 Ausfall erst nach zwei Fehlern
- **Was:** Eine Seite gilt erst nach zwei fehlgeschlagenen Prüfungen in Folge als ausgefallen.
- **Warum:** Einzelne Zeitüberschreitungen erzeugen sonst Fehlalarme in der Nacht.

### E24 Sonne nach NOAA statt SunCalc
- **Was:** Sonnenstand und Zeiten nach dem NOAA Algorithmus (Meeus), Mondphase nach SunCalc.
- **Warum:** SunCalc wich beim Untergang bis 2,5 Minuten von PyEphem und Open-Meteo ab, NOAA unter 10 Sekunden.
- **Definitionen:** Goldene Stunde: Sonne zwischen +6° und -4°. Blaue Stunde: -4° bis -6°. Ohne Geländehorizont.

### E25 Wetterfenster stündlich, nur bei Tageslicht
- **Was:** Ein Ort ist fliegbar, wenn eine Stunde alle Grenzen des Ortes erfüllt und Tag ist. Wind auf Flughöhe: nächste Messhöhe von Open-Meteo (10, 80 oder 120 m). Push ab Mindestdauer (Schwelle der Regel, Standard 2 Stunden).

### E26 ADS-B über adsb.lol
- **Was:** Abruf alle 30 Sekunden im Radius der Region. Standard: alle Drehflügler (ADS-B Kategorie A7) zeigen, Organisationen über Kennzeichen Muster hervorheben (Rega HB-ZR*, HB-TI*, zuhause prüfen).
- **Warum:** Offene Daten (ODbL), ohne Schlüssel. OpenSky wäre eine Alternative (Konto nötig für höhere Limits).
- **Start und Landung:** «In der Luft» heisst nicht am Boden und mindestens 25 Knoten. Verschwindet ein Heli tiefer als 4500 Fuss, gilt das als vermutete Landung (Funkschatten in den Bergen).

### E27 Einsatzauswertungen: Stadtpolizei St.Gallen eingebaut
- **Was:** Medienmitteilungen der Stadtpolizei St.Gallen über daten.stadt.sg.ch (Lizenz CC BY), weitere RSS Feeds über `EINSATZ_FEEDS`. Grobe Einordnung über Stichworte. Zeitverzug in der Oberfläche angeschrieben.
- **Warum:** Einzige gefundene offene Quelle mit klarer Lizenz. Die Kantonspolizei St.Gallen hat keinen gefundenen eigenen Feed (der Kantons Feed enthält allgemeine Mitteilungen).

### E28 Nicht gebaute Kartenebenen
- **Blitze live:** Keine offene Quelle mit erlaubter Weiterverwendung gefunden. Ebene sichtbar, aber gesperrt mit Begründung.
- **Verkehrslage und Pässe:** Braucht Schlüssel und DATEX II Verarbeitung (opentransportdata.swiss). Nicht gebaut.
- **Unwetter und Lawinen als Fläche:** MeteoAlarm liefert keine Geometrien, das SLF Format konnte ausserhalb des Winters nicht geprüft werden. Darum als Listen.
- **Webcams:** Eigene Liste (MeteoSchweiz Wetterkameras sind nicht als offener Dienst verfügbar). Windy Webcams API (Schlüssel) wurde nicht gebaut, weil sie nicht ohne Schlüssel geprüft werden konnte.

### E29 Sonnenuntergangs Prognose als nachvollziehbare Heuristik
- **Was:** Score 0 bis 100 aus sechs gewichteten Faktoren (hohe und mittlere Wolken, freier Horizont 80 km Richtung Sonne, tiefe Wolken, Sicht, Feuchte, Regen). Gewichte in der Oberfläche anpassbar, Bewertungen nach dem Abend werden gegen die Prognose verglichen.
- **Warum:** Es gibt kein offenes, belegtes Modell. Eine einfache Formel mit sichtbaren Faktoren lässt sich mit eigenen Bewertungen kalibrieren.
- **Alternative:** Kommerzielle Dienste (z.B. SunsetWx), nicht offen.

### E30 Event Zentrale und Content Kalender ohne Personendaten
- **Was:** Aufgaben und Ablauf tragen eine Rolle statt Namen. Vorlagen speichern Fristen relativ zum Beginn (Tage) und den Ablauf in Minuten. Content Beiträge haben eine Checkliste je Art (in der Oberfläche anpassbar). Erinnerung über die Alarmzentrale (Ruhezeit gilt).
- **Warum:** Datensparsamkeit, Vorlagen lassen sich so für jeden Termin wiederverwenden. Der Hub veröffentlicht und schreibt keine Texte.

### E31 Veranstaltungen nur aus selbst erfassten, geprüften Quellen
- **Was:** Quellen (iCal, RSS) werden in einer Tabelle erfasst und erst abgerufen, wenn das Häkchen «Nutzungsbedingungen geprüft» gesetzt ist. robots.txt wird beachtet, Abruf alle 6 Stunden. Übernahme in die Event Zentrale mit einem Klick.
- **Warum:** Keine offene Schnittstelle für Anlässe in St. Gallen mit klarer Erlaubnis gefunden. Scraping von Veranstaltungsportalen verstösst meist gegen deren Bedingungen.

### E32 Parkplätze: Opendatasoft der Stadt St. Gallen
- **Was:** Abruf alle 10 Minuten, Rohwerte 14 Tage, danach Stundenmittel (ein Jahr). Typische Belegung als Median je Wochentag und Stunde.
- **Warum:** Einzige offene Echtzeitquelle, Lizenz CC BY-NC (private Nutzung passt). Median ist robust gegen Ausreisser (Anlässe).

### E33 Dienste Status über Statuspage JSON
- **Was:** Supabase, GitHub, Vercel, Cloudflare über `/api/v2/status.json` und `/api/v2/incidents/unresolved.json`, ntfy über `https://ntfy.sh/v1/health`. Verlauf nur bei Wechseln. Hinweis auf Zusammenhang, wenn ein Dienst mit «hostet Kundenseiten» gestört ist und der Webseiten Wächter gleichzeitig Ausfälle sieht.
- **Warum:** Offizielle, offene Schnittstellen ohne Schlüssel. Alternative wären RSS Feeds der Statusseiten (weniger strukturiert).

### E34 Sicherheits Checks nur passiv und nur für eigene Seiten
- **Was:** Geprüft werden nur Seiten aus dem Webseiten Wächter (Kunden und eigene). Eine Seitenabfrage, zwei TLS Handshakes (einer nur mit TLS 1.0/1.1), DNS Abfragen (SPF, DMARC, DKIM mit üblichen Selektoren, MX), eine HTTP Abfrage für die Weiterleitung. Keine Port Scans. Punkte: Transport 40, Header 35, E-Mail 20, Software 10 (normalisiert auf 100), Notenskala wie beim Qualitätscheck.
- **Warum:** Aussagekräftig, ohne Angriffscharakter. DKIM ohne bekannten Selektor ist nicht sicher prüfbar, darum nur «nicht gefunden» mit Hinweis.
- **PHP Ende der Unterstützung:** Daten von php.net/supported-versions im Code hinterlegt, jährlich nachführen.

### E35 Abhängigkeiten über osv.dev
- **Was:** package-lock.json (v1 bis v3) lesen, ohne Lockfile Versionen aus package.json (als ungenau markiert). osv.dev `querybatch`, Details je Schwachstelle mit Tagescache. Schwere aus der GitHub Advisory Einstufung. Standardprojekt ist der Hub selbst.
- **Warum:** osv.dev ist offen, ohne Schlüssel und deckt npm vollständig ab. `npm audit` bräuchte npm und node_modules auf dem Pi.

### E36 Änderungs Wächter mit Basis und Gewichten
- **Was:** Momentaufnahme aus sichtbarem Text, Skripten, externen Domains, Formularzielen, versteckten Links, Impressum Zeilen, Preiszeilen und Meta Angaben. Uhrzeiten, Daten und lange Kennungen werden neutralisiert. Vergleich gegen die Basis, «erwartet» übernimmt den neuen Stand.
- **Warum:** Mengenvergleich je Bereich ist robust und günstig im RAM (statt vollem Text Diff). Alternative: visueller Vergleich mit Screenshots, auf dem Pi zu schwer.

### E37 Weitere Teams: TheSportsDB
- **Was:** FC St. Gallen über TheSportsDB (freier Testschlüssel 123, eigener Schlüssel möglich), alternativ OpenLigaDB. «keine» Quelle zeigt ehrlich, dass es keine erlaubte Quelle gibt.
- **Warum:** OpenLigaDB hat für die Super League 2026/27 keine Daten (Community gepflegt, 2025/26 lückenhaft). Die Seiten der Swiss Football League bieten keine offene Schnittstelle.

### E38 Intelligente Abrufe als zentraler Planer in der Quelle
- **Was:** Jede `Quelle` fragt den Abrufplaner: Grundtakt `ttlSek` mal Faktor der Nutzung (aktiv 1, ruhig 1.5, keine Nutzung 2.5, Nacht 3; wichtige Quellen höchstens 1.5), Backoff und Pause ab 3 Fehlern je Adresse (wichtige Quellen nie pausiert), Tagesbudget, Modus auto, fix oder aus. Dazu bedingte Abrufe mit ETag und Last-Modified (304) in `http.ts` und ±5 % Streuung bei Jobs ab 5 Minuten. Nutzung zählt nur bei sichtbarer Seite.
- **Warum:** Eine Stelle statt Logik in jedem Modul. Schont Datenvolumen, Strom und die Anbieter. Pausen je Adresse, damit eine kaputte Kundenseite nicht alle anderen bremst.
- **Alternative:** Feste Intervalle je Modul (bisher), oder ein eigener Prozess als Planer (mehr RAM).

### E39 Auffälligkeiten mit Median und MAD
- **Was:** Module melden Zahlen über `ctx.metrik(...)`. Normalbereich je Eimer (Werktag oder Wochenende, Stunde) aus den Stundenmitteln der letzten 4 Wochen, Rückfall auf die Stunde und auf gesamt. Robuster z Wert mit Untergrenze für die Streuung (2 % des Medians, Mindestabweichung je Metrik). Schwellen 6, 4.5, 3.5 für niedrig, normal, hoch. Rückmeldung «normal» erhöht den Faktor um 15 %, «relevant» senkt ihn um 5 % (0.7 bis 2.5). Lernphase 14 Tage, Mindestdauer und Sperrfrist je Metrik.
- **Warum:** Median und MAD sind robust gegen Ausreisser und brauchen kaum Rechenzeit. Werktag und Wochenende statt sieben Wochentage, weil sonst nach 4 Wochen nur 4 Werte je Eimer da wären.
- **Alternative:** Mittelwert und Standardabweichung (anfällig auf Ausreisser), Holt Winters oder maschinelles Lernen (zu schwer für den Pi 3).

### E40 Selbstheilung in Stufen
- **Was:** Watchdog alle 2 Minuten: nach 3 Fehlern in Folge Modul neu laden, danach Job pausieren (15 min, 1 h, 4 h, 12 h), erst dann Nachricht. Hängt ein Job über 30 Minuten oder liegt der RAM dreimal über 300 MB oder reagiert der Hub träge (p99 Verzögerung über 2 s), beendet er sich und systemd startet neu (höchstens einmal pro Stunde, dreimal pro Tag). Bei wenig Speicher früher verdichten und nur 5 Backups behalten.
- **Warum:** Die meisten Fehler sind vorübergehend (Netz, Anbieter). Neustarts nur als letztes Mittel, weil sie Daten im RAM (Caches, Heli Spuren) verlieren.

### E41 Sichere Updates über die bestehende Release Pipeline
- **Was:** Der Hub schreibt nur eine Anfrage, die Arbeit macht `pihub-aktualisieren` als root (systemd Path Unit). Erlaubt ist nur `UPDATE_REPO` und ein Commit auf `UPDATE_BRANCH`. Vorher Selbsttest `--kern` der laufenden Version, dann Bau in einem eigenen Release Ordner, Backup, Migrationen, Umschalten, Gesundheitscheck, Selbsttest, sonst Rückfall. Ergebnis als JSON Datei, der Hub meldet es in der Alarmzentrale. Automatisch nur im Nachtfenster, einmal pro Tag, Standard aus.
- **Warum:** Der Dienst selbst hat keine Root Rechte (systemd Härtung). Standard aus, weil ein Update zuerst einmal von Hand geprüft werden soll.

### E42 Dreh Wetter Wächter nutzt die zentrale Timeline
- **Was:** Prüfpunkte 72, 48, 24 und 4 Stunden vorher gegen das Mindestwetter des Drehorts. Ausweichtermine: gleiche Dauer, 7 bis 20 Uhr bei Tageslicht, gutes Wetter, keine Überschneidung mit Einträgen der Timeline (Kalender, swiss unihockey Einsätze, Veranstaltungen, andere Drehs). Ganztägige Kalendereinträge blockieren nicht. Höchstens ein Vorschlag pro Tag.
- **Warum:** Die Timeline sammelt schon alle Termine, so braucht es keine eigene Abfrage pro Quelle. Der Hub verschiebt nie selbst.

## Jarvis

- Modell: Claude API per `fetch` mit SSE, ohne SDK (RAM). Ein lokales Modell läuft auf dem Pi 3 nicht. Schlüssel `ANTHROPIC_API_KEY` nur in der `.env`.
- Vollmacht gestuft: `nur_lesen`, `fragen`, `autonom` (Standard), `voll`. Bei `autonom` laufen Lesen und Schreiben direkt, kritische Aktionen (Löschen, Module schalten, Neustart, Update) brauchen Bestätigung. Grund: CLAUDE.md verlangt Bestätigung für Veränderndes, und Inhalte aus Webseiten oder Notizen könnten Anweisungen einschleusen (Prompt Injection). `voll` ist ein bewusster Schalter.
- Gedächtnis ohne Embeddings: Wortsuche mit Ranking, die wichtigsten Erinnerungen stehen im Profil des Prompts, nächtliche Rückschau um 03:20 mit dem schnellen Modell. Spart RAM und externe Dienste.
- Webzugriff nur https, DNS Auflösung, private Netze gesperrt (SSRF Schutz), Tabellen `einstellungen` und `puffer` sind für Jarvis gesperrt.
- Sprache: Web Speech API im Browser (Weckwort «Hey Jarvis», Vorlesen). Läuft nur bei offener Seite und HTTPS. Es gibt keinen Dauerbetrieb im Hintergrund.
- Tageslimit in Tokens (Standard 600000) begrenzt die Kosten.
