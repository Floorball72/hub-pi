// Lokaler Treiber auf SQLite (node:sqlite, keine nativen Zusatzpakete).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqliteSpaltenTyp, sqliteSql } from './ddl.ts';
import { alleSpalten, type Spalte, type Tabelle, type Zeile } from './schema.ts';
import { type Abfrage, type DatenTreiber, type Dialekt, type Filter, SqlBauer } from './treiber.ts';

type SqlWert = null | number | bigint | string;

export const sqliteDialekt: Dialekt = {
  platzhalter: () => '?',
  likeOperator: 'LIKE',
  zuDb(s: Spalte, w: unknown): unknown {
    if (w === null || w === undefined) return null;
    switch (s.typ) {
      case 'bool':
        return w ? 1 : 0;
      case 'json':
        return JSON.stringify(w);
      case 'zeit':
        return new Date(w as string).toISOString();
      default:
        return w;
    }
  },
  ausDb(s: Spalte, w: unknown): unknown {
    if (w === null || w === undefined) return null;
    switch (s.typ) {
      case 'bool':
        return w === 1 || w === 1n || w === true;
      case 'json':
        try {
          return JSON.parse(String(w));
        } catch {
          return null;
        }
      case 'int':
      case 'real':
        return Number(w);
      default:
        return w;
    }
  },
};

export function sqliteOeffnen(pfad: string): DatabaseSync {
  if (pfad !== ':memory:') mkdirSync(dirname(pfad), { recursive: true });
  const db = new DatabaseSync(pfad);
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000; PRAGMA cache_size = -4000;',
  );
  return db;
}

export class LokalTreiber implements DatenTreiber {
  readonly name = 'lokal' as const;
  readonly db: DatabaseSync;
  private bauer = new SqlBauer(sqliteDialekt);

  constructor(pfad: string) {
    this.db = sqliteOeffnen(pfad);
  }

  async vorbereiten(tabellen: Tabelle[]): Promise<void> {
    this.bauer.registrieren(tabellen);
    for (const t of tabellen) {
      for (const sql of sqliteSql(t)) {
        // Indizes erst nach dem Ergänzen fehlender Spalten anlegen
        if (sql.startsWith('CREATE INDEX')) continue;
        this.db.exec(sql);
      }
      const vorhanden = new Set(
        (this.db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[]).map((r) => r.name),
      );
      for (const s of alleSpalten(t)) {
        if (!vorhanden.has(s.name))
          this.db.exec(`ALTER TABLE "${t.name}" ADD COLUMN "${s.name}" ${sqliteSpaltenTyp(s.typ)}`);
      }
      for (const sql of sqliteSql(t)) if (sql.startsWith('CREATE INDEX')) this.db.exec(sql);
    }
  }

  async liste<T = Zeile>(tabelle: string, abfrage?: Abfrage): Promise<T[]> {
    const { sql, params } = this.bauer.select(tabelle, abfrage);
    const zeilen = this.db.prepare(sql).all(...(params as SqlWert[])) as Record<string, unknown>[];
    return zeilen.map((z) => this.bauer.zeileAusDb(tabelle, z) as T);
  }

  async hole<T = Zeile>(tabelle: string, id: string): Promise<T | null> {
    const [z] = await this.liste<T>(tabelle, { filter: { id }, limit: 1 });
    return z ?? null;
  }

  async einfuegen<T = Zeile>(tabelle: string, zeilen: Record<string, unknown>[]): Promise<T[]> {
    const aus: T[] = [];
    this.db.exec('BEGIN');
    try {
      for (const z of zeilen) {
        const { sql, params, zeile } = this.bauer.insert(tabelle, z);
        this.db.prepare(sql).run(...(params as SqlWert[]));
        aus.push(zeile as T);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return aus;
  }

  async aendern<T = Zeile>(
    tabelle: string,
    id: string,
    aenderung: Record<string, unknown>,
  ): Promise<T | null> {
    const q = this.bauer.update(tabelle, id, aenderung);
    if (q) this.db.prepare(q.sql).run(...(q.params as SqlWert[]));
    return this.hole<T>(tabelle, id);
  }

  async loeschen(tabelle: string, id: string): Promise<boolean> {
    return (await this.loescheWo(tabelle, { id })) > 0;
  }

  async loescheWo(tabelle: string, filter: Filter): Promise<number> {
    const { sql, params } = this.bauer.delete(tabelle, filter);
    return Number(this.db.prepare(sql).run(...(params as SqlWert[])).changes);
  }

  async anzahl(tabelle: string, filter?: Filter): Promise<number> {
    const { sql, params } = this.bauer.count(tabelle, filter);
    const r = this.db.prepare(sql).get(...(params as SqlWert[])) as { n: number };
    return Number(r.n);
  }

  async ping(): Promise<boolean> {
    this.db.prepare('SELECT 1').get();
    return true;
  }

  async schliessen(): Promise<void> {
    this.db.close();
  }
}
