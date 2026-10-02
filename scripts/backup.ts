// Backup aller Tabellen (täglich per systemd Timer). Mit --einspielen <Datei> wird ein Backup eingespielt.
import { datenErstellen } from '../src/server/daten/index.ts';
import { backupEinspielen, backupErstellen } from '../src/server/kern/backup.ts';
import { alleTabellen } from '../src/server/kern/hub.ts';
import { konfigLaden } from '../src/server/konfig.ts';

const k = konfigLaden();
const daten = datenErstellen(k);
await daten.vorbereiten(alleTabellen());
const i = process.argv.indexOf('--einspielen');
try {
  if (i > 0) {
    const n = await backupEinspielen(daten, process.argv[i + 1]);
    console.log(`${n} Zeilen eingespielt`);
  } else {
    const b = await backupErstellen(daten, k.datenVerzeichnis);
    await daten
      .einfuegen('aktivitaet', [
        { modul: 'kern', art: 'info', text: `Tägliches Backup ${b.name} (${b.groesseKb} KB)` },
      ])
      .catch(() => {});
    console.log(`Backup erstellt: ${b.name} (${b.groesseKb} KB)`);
  }
} catch (e) {
  console.error(`Backup fehlgeschlagen: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await daten.schliessen();
}
