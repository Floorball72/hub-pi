// Erzeugt neue Supabase Migrationen aus dem Schema: neue Tabellen als CREATE, neue Spalten als ALTER.
// Bestehende Migrationen werden nie verändert. Aufruf: npm run db:generieren
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { postgresSql } from '../src/server/daten/ddl.ts';
import { migrationsDateien } from '../src/server/daten/migration.ts';
import type { SpaltenTyp } from '../src/server/daten/schema.ts';
import { alleTabellen } from '../src/server/kern/hub.ts';

const VERZ = 'supabase/migrations';
const PG: Record<SpaltenTyp, string> = {
  text: 'text',
  int: 'integer',
  real: 'double precision',
  bool: 'boolean',
  json: 'jsonb',
  zeit: 'timestamptz',
  datum: 'date',
};

const dateien = migrationsDateien(VERZ);
const vorhanden = dateien.map((f) => readFileSync(join(VERZ, f), 'utf8')).join('\n');

const neueTabellen = new Map<string, string[]>();
const neueSpalten: string[] = [];
for (const t of alleTabellen()) {
  const block = new RegExp(`CREATE TABLE IF NOT EXISTS "${t.name}" \\(([\\s\\S]*?)\\);`).exec(vorhanden)?.[1];
  if (!block) {
    neueTabellen.set(t.modul, [...(neueTabellen.get(t.modul) ?? []), postgresSql(t)]);
    continue;
  }
  for (const s of t.spalten) {
    const ergaenzt = vorhanden.includes(`ALTER TABLE "${t.name}" ADD COLUMN IF NOT EXISTS "${s.name}"`);
    if (!block.includes(`"${s.name}" `) && !ergaenzt) {
      neueSpalten.push(`ALTER TABLE "${t.name}" ADD COLUMN IF NOT EXISTS "${s.name}" ${PG[s.typ]};`);
    }
  }
}

let nr = dateien.length ? Number(dateien[dateien.length - 1].slice(0, 4)) : 0;
const kopf =
  '-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.\n';
for (const [modul, sql] of neueTabellen) {
  nr++;
  const name = `${String(nr).padStart(4, '0')}_${modul}.sql`;
  writeFileSync(join(VERZ, name), `${kopf}\n${sql.join('\n\n')}\n`);
  console.log(`Neu: ${name}`);
}
if (neueSpalten.length) {
  nr++;
  const name = `${String(nr).padStart(4, '0')}_spalten.sql`;
  writeFileSync(join(VERZ, name), `${kopf}\n${neueSpalten.join('\n')}\n`);
  console.log(`Neu: ${name}`);
}
if (!neueTabellen.size && !neueSpalten.length) console.log('Schema und Migrationen sind aktuell.');
