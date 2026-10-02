// Wendet die Supabase Migrationen über die Datenbank Verbindung an. Aufruf: npm run db:migrate
import { resolve } from 'node:path';
import { migrationenAnwenden } from '../src/server/daten/migration.ts';
import { konfigLaden } from '../src/server/konfig.ts';

const k = konfigLaden();
if (!k.supabase.dbUrl) {
  console.error('SUPABASE_DB_URL fehlt in der .env. Mit dem lokalen Treiber sind keine Migrationen nötig.');
  process.exit(1);
}
try {
  const r = await migrationenAnwenden(k.supabase.dbUrl, resolve('supabase/migrations'), (t) =>
    console.log(t),
  );
  console.log(`Fertig: ${r.angewendet.length} angewendet, ${r.uebersprungen.length} bereits vorhanden.`);
} catch (e) {
  console.error(`Migration fehlgeschlagen: ${(e as Error).message}`);
  process.exit(1);
}
