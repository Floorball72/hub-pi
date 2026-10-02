# Heimsetup: Pi Hub in Betrieb nehmen

Schritt für Schritt, in dieser Reihenfolge. Zu jedem Schritt steht, woran du erkennst, dass er geklappt hat.
Rechne mit etwa einer Stunde, davon 15 Minuten Warten beim Installieren.

**Du brauchst:** Raspberry Pi 3 mit Netzteil (mindestens 2.5 A), SD Karte (64 GB), Netzwerkkabel (empfohlen),
Laptop, Handy, die Datei `pi-hub-code.zip` aus dem Chat (oder Zugriff auf das GitHub Repository).

---

## 1. SD Karte beschreiben

1. Auf dem Laptop den **Raspberry Pi Imager** installieren (raspberrypi.com/software).
2. Imager öffnen:
   - Gerät: **Raspberry Pi 3**
   - Betriebssystem: **Raspberry Pi OS (other)**, dann **Raspberry Pi OS Lite (64-bit)**
   - Speicher: die SD Karte
3. Bei «Einstellungen anpassen» (OS Anpassung):
   - Hostname: `pihub`
   - Benutzername: `pi`, ein eigenes Passwort
   - WLAN nur, wenn kein Kabel möglich ist
   - Zeitzone: `Europe/Zurich`, Tastatur: `ch`
   - Reiter «Dienste»: **SSH aktivieren** (mit Passwort)
4. Schreiben.

**Geklappt, wenn:** der Imager «Schreiben erfolgreich» meldet.

## 2. Pi starten

SD Karte in den Pi, Netzwerkkabel zum Router, dann Strom einstecken. Zwei Minuten warten.

**Geklappt, wenn:** die grüne LED flackert und im Router ein Gerät «pihub» erscheint.

## 3. Mit dem Pi verbinden

Auf dem Laptop ein Terminal öffnen (Windows: PowerShell):

```bash
ssh pi@pihub.local
```

Beim ersten Mal die Frage mit `yes` beantworten, dann das Passwort aus Schritt 1 eingeben.
Klappt `pihub.local` nicht, die IP Adresse aus dem Router nehmen: `ssh pi@192.168.x.y`.

**Geklappt, wenn:** die Zeile `pi@pihub:~ $` erscheint.

## 4. System aktualisieren

```bash
sudo apt update && sudo apt full-upgrade -y && sudo reboot
```

Nach dem Neustart (eine Minute) wieder mit `ssh pi@pihub.local` verbinden.

**Geklappt, wenn:** du wieder `pi@pihub:~ $` siehst.

## 5. Pi Hub auf den Pi kopieren

**Variante A, mit der ZIP Datei** (ohne GitHub). Auf dem **Laptop**, im Ordner mit der ZIP Datei:

```bash
scp pi-hub-code.zip pi@pihub.local:~
```

Dann auf dem **Pi**:

```bash
sudo apt install -y unzip && unzip -o pi-hub-code.zip
```

Unter Windows geht `scp` gleich in der PowerShell. Wer lieber klickt: WinSCP (Windows) oder Cyberduck (Mac), Verbindung «SFTP» zu `pihub.local`, Benutzer `pi`, die ZIP Datei in den Ordner `/home/pi` ziehen.

**Variante A2, mit USB Stick** (ohne Netzwerk vom Laptop): ZIP Datei auf den Stick kopieren, Stick in den Pi stecken, dann auf dem **Pi**:

```bash
lsblk                                   # Stick suchen, meist sda1
sudo mount /dev/sda1 /mnt
cp /mnt/pi-hub-code.zip ~ && sudo umount /mnt
sudo apt install -y unzip && unzip -o pi-hub-code.zip
```

**Variante B, mit GitHub** (falls der Zugriff eingerichtet ist):

```bash
sudo apt install -y git && git clone https://github.com/Floorball72/hub-pi.git pi-hub
```

**Geklappt, wenn:** `ls pi-hub` die Dateien `install.sh`, `package.json` und den Ordner `src` zeigt.

## 6. Installieren

```bash
cd pi-hub && sudo bash install.sh
```

Das Skript prüft den Pi, installiert Node.js 24, legt den Dienst an und baut den Hub. Auf dem Pi 3 dauert
der Bau 10 bis 15 Minuten. Das Skript darf jederzeit nochmals laufen, Daten und Einstellungen bleiben erhalten.

**Geklappt, wenn:** am Ende steht: `✓ Pi Hub läuft: http://192.168.x.y:8080`.
Zusätzlich: `pihub status` zeigt bei `pihub.service` den Zustand **active (running)**.

Falls etwas rot ist: `pihub logs` zeigt die letzten Meldungen.

## 7. Tailscale einrichten

Kurzfassung (Details in `docs/TAILSCALE.md`):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=pihub
```

Den angezeigten Link auf dem Laptop öffnen und anmelden. Dann in der Tailscale Verwaltung
(login.tailscale.com, Seite **DNS**) **MagicDNS** und **HTTPS Certificates** einschalten. Danach auf dem Pi:

```bash
sudo tailscale serve --bg 8080
tailscale serve status
```

**Geklappt, wenn:** `tailscale serve status` eine Adresse wie `https://pihub.tail1234.ts.net` zeigt.

## 8. Supabase vorbereiten (für den Datentreiber «supabase»)

1. Auf supabase.com ein Konto und ein **neues Projekt** anlegen. Region: **Zurich (eu-central-2)**, falls angeboten, sonst Frankfurt.
   Ein starkes Datenbank Passwort wählen und notieren.
2. **Authentication, Sign In / Providers:** «Allow new users to sign up» **ausschalten**.
3. **Authentication, Users, Add user:** dich selbst mit E-Mail und Passwort anlegen (für den Login).
4. Werte sammeln:
   - **Project Settings, API:** Project URL, `anon` Key, `service_role` Key
   - **Connect** (oben), **Session pooler:** die Verbindung `postgresql://postgres.xxxx:[PASSWORT]@...pooler.supabase.com:5432/postgres` (Passwort einsetzen)

Ohne Supabase läuft der Hub mit dem lokalen Treiber (SQLite auf der SD Karte). Das geht auch, aber
die Daten liegen dann nur auf dem Pi.

## 9. Einrichtungsassistent

Im Browser auf dem Laptop öffnen (im Heimnetz):

```
http://pihub.local:8080/einrichtung
```

Oder über Tailscale: `https://pihub.<dein-tailnet>.ts.net/einrichtung`.

Die Schritte:

1. **Zugang:** Benutzer `jerome` und ein Passwort mit mindestens 10 Zeichen.
2. **Datenbank:** «Supabase» wählen, Werte aus Schritt 8 eintragen, **Verbindung testen**.
3. **Push:** Server `https://ntfy.sh`, ein langes zufälliges Thema (z.B. `pihub-` und 20 zufällige Zeichen), **Testnachricht senden** (siehe Schritt 12, App vorher installieren).
4. **Orte:** Standard «Kirchberg SG; St. Gallen», **Orte suchen**. ÖV Haltestellen prüfen.
5. **Kalender:** Google Kalender, Einstellungen des Kalenders, «Geheime Adresse im iCal Format» kopieren, einfügen, **Kalender lesen**.
6. **Region:** Mittelpunkt (z.B. «Wil SG») und Radius (z.B. 40 km), **Region prüfen**. Zusätzliche RSS Feeds sind optional.
7. **Optional:** PageSpeed API Schlüssel, swiss unihockey Login (bleibt nur in der .env).
8. **Abschluss:** «Speichern und neu starten».

**Geklappt, wenn:** jede Prüfung grün ist und nach dem Speichern die Meldung «Gespeichert. Der Hub startet neu.»
erscheint. Nach etwa 20 Sekunden kommt die Login Seite. Bei Supabase werden dabei die Tabellen angelegt
(Migrationen), das steht in der Meldung.

## 10. Selbsttest

Auf dem Pi:

```bash
pihub selbsttest
```

**Geklappt, wenn:** am Ende `0 rot` steht und auf dem Handy die Nachricht «Pi Hub Selbsttest» ankommt.
Gelbe Punkte sind Hinweise (z.B. noch kein Backup). Rote Punkte zeigen, was fehlt.

## 11. Handy einrichten

1. App **Tailscale** installieren, mit demselben Konto anmelden, VPN erlauben.
2. Im Browser `https://pihub.<dein-tailnet>.ts.net` öffnen und anmelden.
3. iPhone: Teilen, «Zum Home Bildschirm». Android: Menü, «App installieren».

**Geklappt, wenn:** der Hub als App Symbol auf dem Startbildschirm liegt und ohne Browserleiste startet.

## 12. ntfy App

1. App **ntfy** installieren (App Store oder Play Store).
2. «Thema abonnieren», Server `ntfy.sh`, das Thema aus dem Einrichtungsassistenten eintragen.
3. Im Hub: **Alarmzentrale, Testnachricht**.

**Geklappt, wenn:** die Testnachricht auf dem Handy erscheint.
Tipp Android: in der ntfy App für das Thema «Sofortige Zustellung» einschalten.

## 13. Eigene Daten eintragen

| Wo | Was |
|---|---|
| scont, Tab Kunden und Seiten | Kunden und Webseiten, die überwacht werden. Bei «Auf öffentlicher Statusseite» nur die freigeben, die Kunden sehen dürfen. |
| scont, Tab Domains und Kosten | Ablaufdaten und Abos, damit Erinnerungen kommen |
| Rettung, Tab Kennzeichen | Rega Kennzeichen prüfen, weitere Organisationen ergänzen |
| Drohne, Tab Orte | Drehorte mit Mindestwetter, «Push bei passendem Wetterfenster» |
| Drohne, Tab Akkus und Dokumente | Akkus mit maximalen Zyklen, Versicherung und Registrierung mit Ablaufdatum |
| Unihockey, Tab Einstellungen | Team IDs prüfen, «Push bei Spielende» nach Wunsch |
| swiss unihockey | `docs/swissunihockey-ablauf.md` mit dem Ablauf von Marion füllen, dann im Modul «Aus Ablauf Datei laden» |
| Alarmzentrale | Schwellen und Ruhezeiten anpassen |
| Weitere Teams, Tab Einstellungen | FC St. Gallen ist vorbereitet (TheSportsDB 134406, Liga 4675). Weitere Teams mit Quelle ergänzen, «keine» wenn es keine erlaubte Quelle gibt |
| Abhängigkeiten Wächter, Tab Projekte | Eigene Projekte als GitHub «besitzer/name». Private Repositories brauchen `GITHUB_TOKEN` (nur Leserecht) |
| Änderungs Wächter, Tab Seiten | «Seiten aus dem Webseiten Wächter übernehmen», später dynamische Stellen als Ausnahmen |
| Dienste Status, Tab Dienste verwalten | Bei Vercel und Cloudflare «hostet Kundenseiten» prüfen, weitere Statusseiten ergänzen |
| Veranstaltungen, Tab Quellen | Kalender (iCal) oder RSS von Vereinen und Veranstaltern, nur nach Prüfung der Nutzungsbedingungen mit Häkchen; Stichworte setzen |
| Event Zentrale, Tab Vorlagen | Eigene Vorlagen (am einfachsten: eine Veranstaltung planen und «Als Vorlage speichern») |
| Content Kalender, Tab Checklisten | Checklisten je Art anpassen |
| Drohne, Tab Sonne | Schwelle für den Sonnenuntergangs Push (Alarmzentrale, Regel «Schöner Sonnenauf oder untergang»), Gewichte nach einigen Bewertungen |
| Drohne, Tab Kundendrehs | Ort und Dauer eintragen, damit der Dreh Wetter Wächter prüfen kann |
| Auffälligkeiten | Empfindlichkeit (Standard «normal»), einzelne Messwerte bei Bedarf ausschalten |
| Alarmzentrale, Schwellen | Abhängigkeiten nur hoch und kritisch, Dienste ab Stufe 3 (Störung), Aufgaben der Event Zentrale 24 h vor Frist, Sonnenuntergang ab Score 75 |

## 14. Später: Updates

**Mit ZIP Datei:** neue `pi-hub-code.zip` auf den Pi kopieren (Schritt 5), entpacken, dann:

```bash
pihub update ~/pi-hub
```

**Vom Laptop mit Node.js:** im Projektordner `npm run deploy` (Ziel in der `.env` des Laptops: `DEPLOY_ZIEL=pi@pihub.local`).

**Aus dem Hub (empfohlen):** einmalig auf dem Pi

```bash
pihub updates-einrichten
```

Ist das Repository privat, vorher Zugang hinterlegen: `sudo -u pihub git config --global credential.helper store`, danach fragt `git clone` einmal nach Benutzer und Token (GitHub Token mit Leserecht auf Floorball72/hub-pi).

Dann im Hub unter «Sichere Updates»: einmal «Jetzt aktualisieren» testen, danach «Automatische Updates im Nachtfenster» einschalten (Standard 02:30 bis 04:30). Der Hub aktualisiert nur, wenn der Selbsttest grün ist, baut in einem eigenen Ordner, macht vorher ein Backup, wendet Migrationen an, prüft sich nach dem Umschalten und schaltet bei Fehlern zurück. Das Ergebnis erscheint in der Alarmzentrale.

**Geklappt, wenn:** auf der Seite «Sichere Updates» bei «Letztes Update» «erfolgreich» steht und `pihub selbsttest` bei «Updates aus dem Hub» grün ist.

Bei allen Varianten gilt: Startet die neue Version nicht, schaltet der Pi automatisch auf die vorherige zurück.

## Nützliche Befehle

```bash
pihub                # Übersicht aller Befehle
pihub status         # Laufen die Dienste?
pihub logs           # Letzte Meldungen
pihub speicher       # RAM Verbrauch des Hubs (Ziel unter 300 MB)
pihub backup         # Backup jetzt
```
