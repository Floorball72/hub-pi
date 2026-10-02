// Supabase Treiber: direkte Postgres Verbindung aus dem Backend (nie aus dem Frontend).
// Die Verbindung umgeht Row Level Security als Tabelleneigentümer. RLS ist trotzdem auf allen
// Tabellen aktiv, damit der öffentliche anon Key keine Daten lesen kann.
import postgres from 'postgres';
import type { Spalte, Tabelle, Zeile } from './schema.ts';
import { type Abfrage, type DatenTreiber, type Dialekt, type Filter, SqlBauer } from './treiber.ts';

const PG_CAST: Partial<Record<Spalte['typ'], string>> = {
  json: '::jsonb',
  zeit: '::timestamptz',
  datum: '::date',
};

export const postgresDialekt: Dialekt = {
  platzhalter: (n, s) => `$${n}${PG_CAST[s.typ] ?? ''}`,
  likeOperator: 'ILIKE',
  zuDb(s: Spalte, w: unknown): unknown {
    if (w === null || w === undefined) return null;
    if (s.typ === 'json') return JSON.stringify(w);
    if (s.typ === 'zeit') return new Date(w as string).toISOString();
    return w;
  },
  ausDb(s: Spalte, w: unknown): unknown {
    if (w === null || w === undefined) return null;
    switch (s.typ) {
      case 'zeit':
        return new Date(w as string).toISOString();
      case 'int':
      case 'real':
        return Number(w);
      case 'json':
        return typeof w === 'string' ? JSON.parse(w) : w;
      default:
        return w;
    }
  },
};

export function postgresVerbinden(url: string, max = 2) {
  return postgres(url, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    // Supabase Pooler im Transaktionsmodus kennt keine Prepared Statements
    prepare: false,
    onnotice: () => {},
    // Datum und Zeit als Text lesen, damit keine Zeitzonenfehler entstehen
    types: {
      datum: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      zeit: { to: 1184, from: [1184, 1114], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
}

export class SupabaseTreiber implements DatenTreiber {
  readonly name = 'supabase' as const;
  private sql: ReturnType<typeof postgresVerbinden>;
  private bauer = new SqlBauer(postgresDialekt);

  constructor(dbUrl: string) {
    if (!dbUrl) throw new Error('SUPABASE_DB_URL fehlt');
    this.sql = postgresVerbinden(dbUrl);
  }

  private async abfragen(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    return (await this.sql.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as Record<
      string,
      unknown
    >[];
  }

  async vorbereiten(tabellen: Tabelle[]): Promise<void> {
    // Tabellen entstehen über die Migrationen (npm run db:migrate)
    this.bauer.registrieren(tabellen);
  }

  async liste<T = Zeile>(tabelle: string, abfrage?: Abfrage): Promise<T[]> {
    const { sql, params } = this.bauer.select(tabelle, abfrage);
    return (await this.abfragen(sql, params)).map((z) => this.bauer.zeileAusDb(tabelle, z) as T);
  }

  async hole<T = Zeile>(tabelle: string, id: string): Promise<T | null> {
    const [z] = await this.liste<T>(tabelle, { filter: { id }, limit: 1 });
    return z ?? null;
  }

  async einfuegen<T = Zeile>(tabelle: string, zeilen: Record<string, unknown>[]): Promise<T[]> {
    if (!zeilen.length) return [];
    const aus: T[] = [];
    await this.sql.begin(async (tx) => {
      for (const z of zeilen) {
        const { sql, params, zeile } = this.bauer.insert(tabelle, z);
        await tx.unsafe(sql, params as postgres.ParameterOrJSON<never>[]);
        aus.push(zeile as T);
      }
    });
    return aus;
  }

  async aendern<T = Zeile>(
    tabelle: string,
    id: string,
    aenderung: Record<string, unknown>,
  ): Promise<T | null> {
    const q = this.bauer.update(tabelle, id, aenderung);
    if (q) await this.abfragen(q.sql, q.params);
    return this.hole<T>(tabelle, id);
  }

  async loeschen(tabelle: string, id: string): Promise<boolean> {
    return (await this.loescheWo(tabelle, { id })) > 0;
  }

  async loescheWo(tabelle: string, filter: Filter): Promise<number> {
    const { sql, params } = this.bauer.delete(tabelle, filter);
    const r = await this.sql.unsafe(sql, params as postgres.ParameterOrJSON<never>[]);
    return r.count;
  }

  async anzahl(tabelle: string, filter?: Filter): Promise<number> {
    const { sql, params } = this.bauer.count(tabelle, filter);
    const [r] = await this.abfragen(sql, params);
    return Number(r.n);
  }

  async ping(): Promise<boolean> {
    await this.sql`SELECT 1`;
    return true;
  }

  async schliessen(): Promise<void> {
    await this.sql.end({ timeout: 2 });
  }
}
