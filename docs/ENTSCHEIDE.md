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
