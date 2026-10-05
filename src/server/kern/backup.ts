// Backup aller Tabellen als komprimiertes JSON nach data/backups. Die letzten 14 bleiben erhalten.
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Daten } from '../daten/index.ts';

export const BEHALTEN = 14;

export interface BackupDatei {
  name: string;
  groesseKb: number;
  zeit: string;
  /** Tabellen, die es in der Datenbank noch nicht gibt (vor der Migration) */
  fehlend?: string[];
}

export function backupVerzeichnis(datenVerzeichnis: string) {
  return join(datenVerzeichnis, 'backups');
}

export async function backupErstellen(
  daten: Daten,
  datenVerzeichnis: string,
  jetzt = new Date(),
): Promise<BackupDatei> {
  const dir = backupVerzeichnis(datenVerzeichnis);
  mkdirSync(dir, { recursive: true });
  const inhalt: Record<string, unknown[]> = {};
  const fehlend: string[] = [];
  for (const t of daten.alleTabellen()) {
    const zeilen: unknown[] = [];
    try {
      for (let offset = 0; ; offset += 2000) {
        const teil = await daten.liste(t.name, { sortierung: 'id', limit: 2000, offset });
        zeilen.push(...teil);
        if (teil.length < 2000) break;
      }
    } catch (e) {
      // Beim Update läuft das Backup vor der Migration: neue Tabellen gibt es dann noch nicht
      if (!tabelleFehlt(e)) throw e;
      fehlend.push(t.name);
      continue;
    }
    inhalt[t.name] = zeilen;
  }
  const stempel = jetzt.toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const name = `backup-${stempel}.json.gz`;
  const daten_ = gzipSync(
    JSON.stringify({
      version: 1,
      erstellt: jetzt.toISOString(),
      treiber: daten.treiber.name,
      tabellen: inhalt,
    }),
  );
  writeFileSync(join(dir, name), daten_, { mode: 0o600 });
  aufraeumen(dir);
  return { name, groesseKb: Math.round(daten_.length / 1024), zeit: jetzt.toISOString(), fehlend };
}

/** Postgres «relation ... does not exist» oder SQLite «no such table» */
export function tabelleFehlt(e: unknown): boolean {
  const t = e instanceof Error ? e.message : String(e);
  return /relation "[^"]+" does not exist|no such table/i.test(t);
}

function aufraeumen(dir: string) {
  const alle = backupListe(dir);
  for (const alt of alle.slice(BEHALTEN)) unlinkSync(join(dir, alt.name));
}

export function backupListe(dir: string): BackupDatei[] {
  try {
    return readdirSync(dir)
      .filter((f) => /^backup-.*\.json\.gz$/.test(f))
      .map((name) => {
        const s = statSync(join(dir, name));
        return { name, groesseKb: Math.round(s.size / 1024), zeit: s.mtime.toISOString() };
      })
      .sort((a, b) => b.zeit.localeCompare(a.zeit));
  } catch {
    return [];
  }
}

/** Spielt ein Backup ein. Vorhandene Zeilen (gleiche id) bleiben unverändert. */
export async function backupEinspielen(daten: Daten, datei: string): Promise<number> {
  const inhalt = JSON.parse(gunzipSync(readFileSync(datei)).toString()) as {
    tabellen: Record<string, Record<string, unknown>[]>;
  };
  let n = 0;
  for (const [name, zeilen] of Object.entries(inhalt.tabellen)) {
    if (!daten.tabelle(name)) continue;
    for (const z of zeilen) {
      if (await daten.hole(name, String(z.id))) continue;
      await daten.einfuegen(name, [z]);
      n++;
    }
  }
  return n;
}
