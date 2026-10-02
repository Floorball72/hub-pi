// Erzeugt CREATE Statements für SQLite und Postgres (Supabase) aus dem Schema.
import { alleSpalten, type SpaltenTyp, type Tabelle } from './schema.ts';

const PG: Record<SpaltenTyp, string> = {
  text: 'text',
  int: 'integer',
  real: 'double precision',
  bool: 'boolean',
  json: 'jsonb',
  zeit: 'timestamptz',
  datum: 'date',
};

const SQLITE: Record<SpaltenTyp, string> = {
  text: 'TEXT',
  int: 'INTEGER',
  real: 'REAL',
  bool: 'INTEGER',
  json: 'TEXT',
  zeit: 'TEXT',
  datum: 'TEXT',
};

function indexName(t: Tabelle, felder: string[]) {
  return `idx_${t.name}_${felder.join('_')}`;
}

export function postgresSql(t: Tabelle): string {
  const spalten = alleSpalten(t).map((s) => {
    if (s.name === 'id') return '  "id" text PRIMARY KEY';
    if (s.name === 'erstellt') return '  "erstellt" timestamptz NOT NULL DEFAULT now()';
    return `  "${s.name}" ${PG[s.typ]}`;
  });
  const teile = [
    `-- ${t.label} (Modul ${t.modul})`,
    `CREATE TABLE IF NOT EXISTS "${t.name}" (\n${spalten.join(',\n')}\n);`,
    `ALTER TABLE "${t.name}" ENABLE ROW LEVEL SECURITY;`,
  ];
  for (const felder of t.indizes ?? []) {
    teile.push(
      `CREATE INDEX IF NOT EXISTS "${indexName(t, felder)}" ON "${t.name}" (${felder.map((f) => `"${f}"`).join(', ')});`,
    );
  }
  return teile.join('\n');
}

export function sqliteSql(t: Tabelle): string[] {
  const spalten = alleSpalten(t).map((s) => {
    if (s.name === 'id') return '"id" TEXT PRIMARY KEY';
    if (s.name === 'erstellt') return '"erstellt" TEXT NOT NULL';
    return `"${s.name}" ${SQLITE[s.typ]}`;
  });
  const sql = [`CREATE TABLE IF NOT EXISTS "${t.name}" (${spalten.join(', ')})`];
  for (const felder of t.indizes ?? []) {
    sql.push(
      `CREATE INDEX IF NOT EXISTS "${indexName(t, felder)}" ON "${t.name}" (${felder.map((f) => `"${f}"`).join(', ')})`,
    );
  }
  return sql;
}

export function sqliteSpaltenTyp(typ: SpaltenTyp) {
  return SQLITE[typ];
}

/** Kopf jeder Migration: Tabelle für angewendete Migrationen. */
export const MIGRATIONS_TABELLE = `CREATE TABLE IF NOT EXISTS "_migrationen" (
  "name" text PRIMARY KEY,
  "angewendet" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "_migrationen" ENABLE ROW LEVEL SECURITY;`;
