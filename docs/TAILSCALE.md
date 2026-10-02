# Tailscale für den Pi Hub

Tailscale verbindet Handy, Laptop und Pi in einem privaten Netz. Kein Portforwarding am Router.
`tailscale serve` liefert den Hub mit gültigem HTTPS Zertifikat aus.

## 1. Tailscale auf dem Pi installieren

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

Erfolgreich, wenn `tailscale version` eine Versionsnummer zeigt.

## 2. Pi anmelden

```bash
sudo tailscale up --hostname=hub-pi
```

Es erscheint ein Link (`https://login.tailscale.com/a/...`). Auf dem Laptop öffnen und mit deinem Konto anmelden.
Erfolgreich, wenn `tailscale status` den Pi mit einer Adresse `100.x.y.z` zeigt.

Tipp: In der Tailscale Verwaltung (login.tailscale.com, Machines) beim Pi «Disable key expiry» wählen,
sonst musst du den Pi alle 180 Tage neu anmelden.

## 3. HTTPS einschalten (einmalig im Browser)

In der Tailscale Verwaltung unter **DNS**:

1. **MagicDNS** einschalten (falls nicht schon an)
2. Weiter unten **HTTPS Certificates** einschalten

Dein Tailnet Name steht dort, zum Beispiel `tail1234.ts.net`.

## 4. Hub über HTTPS ausliefern

```bash
sudo tailscale serve --bg 8080
```

Erfolgreich, wenn `tailscale serve status` etwas zeigt wie:

```
https://hub-pi.tail1234.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:8080
```

Der Hub ist jetzt unter `https://hub-pi.<dein-tailnet>.ts.net` erreichbar, nur für Geräte in deinem Tailnet.
Die Einstellung bleibt nach einem Neustart erhalten (`--bg`).

Ältere Tailscale Versionen (vor 1.52) kennen `--bg` nicht. Dann zuerst `sudo apt update && sudo apt upgrade tailscale`.

## 5. Zugriff vom Handy

1. App **Tailscale** installieren (App Store oder Play Store)
2. Mit demselben Konto anmelden, VPN erlauben
3. Im Browser `https://hub-pi.<dein-tailnet>.ts.net` öffnen
4. iPhone: Teilen, «Zum Home Bildschirm». Android: Menü, «App installieren». Der Hub läuft dann wie eine App (PWA).

## 6. Wer darf zugreifen?

Der Hub lauscht auf Port 8080 und nimmt nur Anfragen aus dem lokalen Netz (192.168.x.x, 10.x.x.x usw.)
und aus Tailscale (100.64.0.0/10) an. Alles ausser der öffentlichen Statusseite braucht zusätzlich den Login.
Soll der Hub nur noch über Tailscale erreichbar sein, in `/opt/pihub/.env` setzen:

```
HOST=127.0.0.1
```

und `sudo systemctl restart pihub`. Dann geht der Zugriff nur noch über `tailscale serve`.

## 7. Optional: öffentliche Statusseite für Kunden (Tailscale Funnel)

Nur nötig, wenn Kunden die Verfügbarkeit ihrer Seite ohne Tailscale sehen sollen. Funnel veröffentlicht
**nur den Pfad /status** auf einem eigenen Port, nicht den ganzen Hub:

```bash
sudo tailscale funnel --bg --https=8443 --set-path=/status http://127.0.0.1:8080/status
```

Die Seite ist dann unter `https://hub-pi.<dein-tailnet>.ts.net:8443/status` öffentlich.
Funnel muss in der Tailscale Verwaltung (Access controls, Attribut `funnel`) erlaubt sein.
Ausschalten: `sudo tailscale funnel --https=8443 off`.

**Zuhause prüfen:** Die genaue Funnel Syntax hängt von der Tailscale Version ab (`tailscale funnel --help`).
Danach mit dem Handy ohne Tailscale (WLAN aus, Tailscale aus) testen, dass nur `/status` erreichbar ist und
`/` nicht.
