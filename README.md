# Pi Hub

Persönliche Zentrale auf dem Raspberry Pi 3: Überwachung, Karten, Tools und Push Meldungen in Modulen.

- Projektbeschreibung und Regeln: [CLAUDE.md](CLAUDE.md)
- Einrichtung zuhause Schritt für Schritt: [docs/HEIMSETUP.md](docs/HEIMSETUP.md)
- Stand, Ungetestetes, Zuhause prüfen: [docs/STATUS.md](docs/STATUS.md)
- Entscheide: [docs/ENTSCHEIDE.md](docs/ENTSCHEIDE.md)
- Tailscale: [docs/TAILSCALE.md](docs/TAILSCALE.md)

## Entwicklung

```bash
npm install
npm run build
DEMO_MODUS=true npm start          # http://localhost:8080, Login jerome / demo
npm run pruefen                    # Typecheck, Lint, Tests
```

Frontend mit Live Reload: `npm run dev` (Backend) und `npm run dev:web` (Vite auf Port 5173).
