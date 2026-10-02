// Aktionen per Button: Backup, Neustart, Aktualisierung, Job sofort ausführen. Immer mit Bestätigung.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { EingabeFehler } from '../daten/schema.ts';
import type { backupErstellen, backupListe, backupVerzeichnis } from './backup.ts';
import type { Hub } from './hub.ts';

interface BackupFunktionen {
  backupErstellen: typeof backupErstellen;
  backupListe: typeof backupListe;
  backupVerzeichnis: typeof backupVerzeichnis;
}

function bestaetigt(body: unknown) {
  if ((body as { bestaetigt?: boolean })?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
}

export function aktionenRouten(app: FastifyInstance, hub: Hub, b: BackupFunktionen) {
  app.get('/api/backups', async () => ({
    dateien: b.backupListe(b.backupVerzeichnis(hub.konfig.datenVerzeichnis)),
    verzeichnis: b.backupVerzeichnis(hub.konfig.datenVerzeichnis),
  }));

  app.post('/api/aktionen/backup', async (req) => {
    bestaetigt(req.body);
    const datei = await b.backupErstellen(hub.daten, hub.konfig.datenVerzeichnis);
    await hub.aktivitaet('kern', `Backup erstellt: ${datei.name} (${datei.groesseKb} KB)`, 'aktion');
    return datei;
  });

  app.post('/api/aktionen/neustart', async (req, reply) => {
    bestaetigt(req.body);
    await hub.aktivitaet('kern', 'Neustart des Dienstes ausgelöst', 'aktion');
    // systemd startet den Dienst neu (Restart=always)
    setTimeout(() => process.exit(0), 800).unref();
    return reply.send({
      ok: true,
      hinweis: 'Der Dienst startet neu. Die Seite lädt in etwa 20 Sekunden neu.',
    });
  });

  app.post('/api/aktionen/aktualisieren', async (req) => {
    bestaetigt(req.body);
    // Eine systemd Path Unit beobachtet diese Datei und startet die Aktualisierung (git pull, Build, Neustart)
    writeFileSync(join(hub.konfig.datenVerzeichnis, 'aktualisieren.anfrage'), new Date().toISOString());
    await hub.aktivitaet('kern', 'Aktualisierung angefordert', 'aktion');
    return {
      ok: true,
      hinweis:
        'Aktualisierung angefordert. Fortschritt im Aktivitätslog und mit journalctl -u pihub-aktualisieren.',
    };
  });

  app.get('/api/jobs', async () => hub.scheduler.status());
  app.post<{ Params: { id: string } }>('/api/aktionen/job/:id', async (req) => {
    bestaetigt(req.body);
    const s = await hub.scheduler.jetztAusfuehren(req.params.id);
    if (!s) throw new EingabeFehler('Unbekannter Job');
    await hub.aktivitaet(s.modul, `Job «${s.name}» manuell ausgeführt`, 'aktion');
    return s;
  });
}
