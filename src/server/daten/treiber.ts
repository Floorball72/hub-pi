// Gemeinsames Interface der Datentreiber und ein SQL Baukasten für beide Dialekte.
import { randomUUID } from 'node:crypto';
import { alleSpalten, type Spalte, type Tabelle, type Zeile } from './schema.ts';

export type Operator = {
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  ne?: unknown;
  in?: unknown[];
  like?: string;
  istNull?: boolean;
};
export type Filter = Record<string, unknown>;

export interface Abfrage {
  filter?: Filter;
  /** Feldname, mit «-» davor absteigend. Mehrere mit Komma. */
  sortierung?: string;
  limit?: number;
  offset?: number;
}

export interface DatenTreiber {
  readonly name: 'lokal' | 'supabase';
  /** Tabellen bekannt machen (lokal: anlegen) */
  vorbereiten(tabellen: Tabelle[]): Promise<void>;
  liste<T = Zeile>(tabelle: string, abfrage?: Abfrage): Promise<T[]>;
  hole<T = Zeile>(tabelle: string, id: string): Promise<T | null>;
  einfuegen<T = Zeile>(tabelle: string, zeilen: Record<string, unknown>[]): Promise<T[]>;
  aendern<T = Zeile>(tabelle: string, id: string, aenderung: Record<string, unknown>): Promise<T | null>;
  loeschen(tabelle: string, id: string): Promise<boolean>;
  loescheWo(tabelle: string, filter: Filter): Promise<number>;
  anzahl(tabelle: string, filter?: Filter): Promise<number>;
  ping(): Promise<boolean>;
  schliessen(): Promise<void>;
}

const OPERATOREN = new Set(['gt', 'gte', 'lt', 'lte', 'ne', 'in', 'like', 'istNull']);

export function istOperator(w: unknown): w is Operator {
  return (
    !!w &&
    typeof w === 'object' &&
    !Array.isArray(w) &&
    Object.keys(w).length > 0 &&
    Object.keys(w).every((k) => OPERATOREN.has(k))
  );
}

export interface Dialekt {
  /** Platzhalter für Parameter n (1-basiert) */
  platzhalter(n: number, s: Spalte): string;
  zuDb(s: Spalte, w: unknown): unknown;
  ausDb(s: Spalte, w: unknown): unknown;
  likeOperator: string;
}

/** Baut SQL nur aus bekannten Tabellen und Spalten. Werte gehen immer als Parameter. */
export class SqlBauer {
  private tabellen = new Map<string, { t: Tabelle; spalten: Map<string, Spalte> }>();
  private d: Dialekt;
  constructor(d: Dialekt) {
    this.d = d;
  }

  registrieren(tabellen: Tabelle[]) {
    for (const t of tabellen)
      this.tabellen.set(t.name, { t, spalten: new Map(alleSpalten(t).map((s) => [s.name, s])) });
  }

  info(name: string) {
    const i = this.tabellen.get(name);
    if (!i) throw new Error(`Unbekannte Tabelle ${name}`);
    return i;
  }

  private spalte(tabelle: string, feld: string): Spalte {
    const s = this.info(tabelle).spalten.get(feld);
    if (!s) throw new Error(`Unbekannte Spalte ${tabelle}.${feld}`);
    return s;
  }

  wo(tabelle: string, filter: Filter | undefined, params: unknown[]): string {
    if (!filter) return '';
    const teile: string[] = [];
    const p = (s: Spalte, w: unknown) => {
      params.push(this.d.zuDb(s, w));
      return this.d.platzhalter(params.length, s);
    };
    for (const [feld, bedingung] of Object.entries(filter)) {
      if (bedingung === undefined) continue;
      const s = this.spalte(tabelle, feld);
      const q = `"${feld}"`;
      if (bedingung === null) {
        teile.push(`${q} IS NULL`);
      } else if (istOperator(bedingung)) {
        const o = bedingung;
        if (o.gt !== undefined) teile.push(`${q} > ${p(s, o.gt)}`);
        if (o.gte !== undefined) teile.push(`${q} >= ${p(s, o.gte)}`);
        if (o.lt !== undefined) teile.push(`${q} < ${p(s, o.lt)}`);
        if (o.lte !== undefined) teile.push(`${q} <= ${p(s, o.lte)}`);
        if (o.ne !== undefined) teile.push(`(${q} IS NULL OR ${q} <> ${p(s, o.ne)})`);
        if (o.like !== undefined)
          teile.push(`${q} ${this.d.likeOperator} ${p({ ...s, typ: 'text' }, o.like)}`);
        if (o.istNull !== undefined) teile.push(o.istNull ? `${q} IS NULL` : `${q} IS NOT NULL`);
        if (o.in !== undefined) {
          if (o.in.length === 0) teile.push('1=0');
          else teile.push(`${q} IN (${o.in.map((w) => p(s, w)).join(', ')})`);
        }
      } else {
        teile.push(`${q} = ${p(s, bedingung)}`);
      }
    }
    return teile.length ? ` WHERE ${teile.join(' AND ')}` : '';
  }

  select(tabelle: string, a: Abfrage = {}): { sql: string; params: unknown[] } {
    this.info(tabelle);
    const params: unknown[] = [];
    let sql = `SELECT * FROM "${tabelle}"${this.wo(tabelle, a.filter, params)}`;
    if (a.sortierung) {
      const teile = a.sortierung.split(',').map((f) => {
        const ab = f.trim().startsWith('-');
        const feld = f.trim().replace(/^-/, '');
        this.spalte(tabelle, feld);
        return `"${feld}" ${ab ? 'DESC' : 'ASC'}`;
      });
      sql += ` ORDER BY ${teile.join(', ')}`;
    }
    if (a.limit !== undefined) sql += ` LIMIT ${Math.max(0, Math.floor(a.limit))}`;
    if (a.offset !== undefined) sql += ` OFFSET ${Math.max(0, Math.floor(a.offset))}`;
    return { sql, params };
  }

  insert(
    tabelle: string,
    zeile: Record<string, unknown>,
  ): { sql: string; params: unknown[]; zeile: Record<string, unknown> } {
    const { spalten } = this.info(tabelle);
    const voll: Record<string, unknown> = { id: randomUUID(), erstellt: new Date().toISOString(), ...zeile };
    const felder = Object.keys(voll).filter((f) => spalten.has(f) && voll[f] !== undefined);
    const params: unknown[] = [];
    const werte = felder.map((f) => {
      const s = spalten.get(f)!;
      params.push(this.d.zuDb(s, voll[f]));
      return this.d.platzhalter(params.length, s);
    });
    return {
      sql: `INSERT INTO "${tabelle}" (${felder.map((f) => `"${f}"`).join(', ')}) VALUES (${werte.join(', ')})`,
      params,
      zeile: voll,
    };
  }

  update(
    tabelle: string,
    id: string,
    aenderung: Record<string, unknown>,
  ): { sql: string; params: unknown[] } | null {
    const { spalten } = this.info(tabelle);
    const params: unknown[] = [];
    const sets = Object.keys(aenderung)
      .filter((f) => spalten.has(f) && f !== 'id' && f !== 'erstellt' && aenderung[f] !== undefined)
      .map((f) => {
        const s = spalten.get(f)!;
        params.push(this.d.zuDb(s, aenderung[f]));
        return `"${f}" = ${this.d.platzhalter(params.length, s)}`;
      });
    if (!sets.length) return null;
    params.push(id);
    return {
      sql: `UPDATE "${tabelle}" SET ${sets.join(', ')} WHERE "id" = ${this.d.platzhalter(params.length, spalten.get('id')!)}`,
      params,
    };
  }

  delete(tabelle: string, filter: Filter): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const wo = this.wo(tabelle, filter, params);
    if (!wo) throw new Error('Löschen ohne Bedingung ist nicht erlaubt');
    return { sql: `DELETE FROM "${tabelle}"${wo}`, params };
  }

  count(tabelle: string, filter?: Filter): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    return { sql: `SELECT COUNT(*) AS n FROM "${tabelle}"${this.wo(tabelle, filter, params)}`, params };
  }

  zeileAusDb(tabelle: string, roh: Record<string, unknown>): Zeile {
    const { spalten } = this.info(tabelle);
    const aus: Record<string, unknown> = {};
    for (const [k, w] of Object.entries(roh)) {
      const s = spalten.get(k);
      aus[k] = s ? this.d.ausDb(s, w) : w;
    }
    return aus as Zeile;
  }
}
