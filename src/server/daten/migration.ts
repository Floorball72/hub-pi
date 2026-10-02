// Wendet die SQL Dateien aus supabase/migrations über die Postgres Verbindung an.
// Jede Datei läuft genau einmal, in einer Transaktion. Angewendete Dateien stehen in «_migrationen».
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_TABELLE } from './ddl.ts';
import { postgresVerbinden } from './supabase.ts';

export interface MigrationsErgebnis {
  angewendet: string[];
  uebersprungen: string[];
}

export function migrationsDateien(verzeichnis: string): string[] {
  if (!existsSync(verzeichnis)) return [];
  return readdirSync(verzeichnis)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

export async function migrationenAnwenden(
  dbUrl: string,
  verzeichnis: string,
  log: (t: string) => void = () => {},
): Promise<MigrationsErgebnis> {
  const sql = postgresVerbinden(dbUrl, 1);
  const ergebnis: MigrationsErgebnis = { angewendet: [], uebersprungen: [] };
  try {
    await sql.unsafe(MIGRATIONS_TABELLE);
    const erledigt = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM "_migrationen"`).map((r) => r.name),
    );
    for (const datei of migrationsDateien(verzeichnis)) {
      if (erledigt.has(datei)) {
        ergebnis.uebersprungen.push(datei);
        continue;
      }
      const inhalt = readFileSync(join(verzeichnis, datei), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(inhalt);
        await tx.unsafe('INSERT INTO "_migrationen" ("name") VALUES ($1)', [datei]);
      });
      log(`Migration angewendet: ${datei}`);
      ergebnis.angewendet.push(datei);
    }
  } finally {
    await sql.end({ timeout: 2 });
  }
  return ergebnis;
}

/** Verbindungstest für den Einrichtungsassistenten */
export async function datenbankTesten(dbUrl: string): Promise<string> {
  const sql = postgresVerbinden(dbUrl, 1);
  try {
    const [r] = await sql<{ v: string }[]>`SELECT version() AS v`;
    return r.v.split(' ').slice(0, 2).join(' ');
  } finally {
    await sql.end({ timeout: 2 });
  }
}
