// Startpunkt des Pi Hub.
import { appErstellen } from './app.ts';
import { konfigLaden } from './konfig.ts';

const konfig = konfigLaden();
const { app, hub } = await appErstellen({ konfig });

hub.scheduler.starten();
await app.listen({ port: konfig.port, host: konfig.host });
app.log.info(
  `Pi Hub läuft auf ${konfig.host}:${konfig.port} (Treiber ${konfig.treiber}${konfig.demo ? ', Demo Modus' : ''}${konfig.einrichtungAbgeschlossen ? '' : ', Einrichtung offen: /einrichtung'})`,
);

// Fehler dürfen den Hub nie beenden: protokollieren und weiterlaufen
process.on('unhandledRejection', (e) => app.log.error({ err: e }, 'Unbehandelter Fehler'));
process.on('uncaughtException', (e) => app.log.error({ err: e }, 'Unbehandelte Ausnahme'));

async function beenden(signal: string) {
  app.log.info(`${signal} erhalten, Hub wird beendet`);
  hub.scheduler.stoppen();
  await app.close();
  await hub.stoppen();
  process.exit(0);
}
process.on('SIGTERM', () => void beenden('SIGTERM'));
process.on('SIGINT', () => void beenden('SIGINT'));
