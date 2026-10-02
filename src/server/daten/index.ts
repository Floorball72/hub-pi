// Zentraler Datenzugriff. Alle Module lesen und schreiben nur über diese Klasse.
import { join } from 'node:path';
import type { Konfig } from '../konfig.ts';
import { LokalTreiber } from './lokal.ts';
import { type Tabelle, tabelle, type Zeile } from './schema.ts';
import { SupabaseTreiber } from './supabase.ts';
import type { Abfrage, DatenTreiber, Filter } from './treiber.ts';

export type { Abfrage, Filter } from './treiber.ts';
export type { Zeile } from './schema.ts';

const PUFFER_TABELLE = tabelle({
  name: 'puffer',
  modul: 'kern',
  label: 'Offline Puffer',
  spalten: [
    { name: 'tabelle', typ: 'text' },
    { name: 'zeile', typ: 'json' },
  ],
});

export class Daten {
  private tabellen = new Map<string, Tabelle>();
  verbunden = true;
  letzterFehler: string | null = null;
  letzterErfolg: string | null = null;

  readonly treiber: DatenTreiber;
  /** Lokaler Puffer für Messwerte, nur beim Supabase Treiber */
  readonly puffer: LokalTreiber | null;

  constructor(treiber: DatenTreiber, puffer: LokalTreiber | null) {
    this.treiber = treiber;
    this.puffer = puffer;
  }

  async vorbereiten(tabellen: Tabelle[]) {
    for (const t of tabellen) this.tabellen.set(t.name, t);
    await this.treiber.vorbereiten(tabellen);
    if (this.puffer) await this.puffer.vorbereiten([PUFFER_TABELLE]);
  }

  alleTabellen(): Tabelle[] {
    return [...this.tabellen.values()];
  }

  tabelle(name: string): Tabelle | undefined {
    return this.tabellen.get(name);
  }

  private async mitStatus<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn();
      this.verbunden = true;
      this.letzterErfolg = new Date().toISOString();
      return r;
    } catch (e) {
      if (istVerbindungsfehler(e)) {
        this.verbunden = false;
        this.letzterFehler = new Date().toISOString();
      }
      throw e;
    }
  }

  liste<T = Zeile>(t: string, a?: Abfrage) {
    return this.mitStatus(() => this.treiber.liste<T>(t, a));
  }
  hole<T = Zeile>(t: string, id: string) {
    return this.mitStatus(() => this.treiber.hole<T>(t, id));
  }
  aendern<T = Zeile>(t: string, id: string, a: Record<string, unknown>) {
    return this.mitStatus(() => this.treiber.aendern<T>(t, id, a));
  }
  loeschen(t: string, id: string) {
    return this.mitStatus(() => this.treiber.loeschen(t, id));
  }
  loescheWo(t: string, f: Filter) {
    return this.mitStatus(() => this.treiber.loescheWo(t, f));
  }
  anzahl(t: string, f?: Filter) {
    return this.mitStatus(() => this.treiber.anzahl(t, f));
  }

  async einfuegen<T = Zeile>(t: string, zeilen: Record<string, unknown>[]): Promise<T[]> {
    try {
      return await this.mitStatus(() => this.treiber.einfuegen<T>(t, zeilen));
    } catch (e) {
      // Messwerte gehen nicht verloren: lokal puffern und später nachsenden
      if (this.puffer && this.tabellen.get(t)?.puffer && istVerbindungsfehler(e)) {
        const jetzt = new Date().toISOString();
        const voll = zeilen.map((z) => ({ id: crypto.randomUUID(), erstellt: jetzt, ...z }));
        await this.puffer.einfuegen(
          'puffer',
          voll.map((z) => ({ tabelle: t, zeile: z })),
        );
        return voll as T[];
      }
      throw e;
    }
  }

  async eins<T = Zeile>(t: string, zeile: Record<string, unknown>): Promise<T> {
    const [z] = await this.einfuegen<T>(t, [zeile]);
    return z;
  }

  async pufferAnzahl(): Promise<number> {
    return this.puffer ? this.puffer.anzahl('puffer') : 0;
  }

  /** Schickt gepufferte Messwerte nach. Gibt die Anzahl nachgesendeter Zeilen zurück. */
  async pufferNachsenden(max = 500): Promise<number> {
    if (!this.puffer) return 0;
    const offen = await this.puffer.liste<{ id: string; tabelle: string; zeile: Record<string, unknown> }>(
      'puffer',
      {
        sortierung: 'erstellt',
        limit: max,
      },
    );
    let gesendet = 0;
    for (const p of offen) {
      try {
        await this.mitStatus(() => this.treiber.einfuegen(p.tabelle, [p.zeile]));
      } catch (e) {
        // Doppelte id: schon angekommen, Eintrag entfernen. Sonst abbrechen und später erneut versuchen.
        if (!/duplicate key|UNIQUE constraint/i.test(String(e))) break;
      }
      await this.puffer.loeschen('puffer', p.id);
      gesendet++;
    }
    return gesendet;
  }

  async schliessen() {
    await this.treiber.schliessen();
    await this.puffer?.schliessen();
  }
}

export function istVerbindungsfehler(e: unknown): boolean {
  const t = String((e as { code?: string })?.code ?? '') + String((e as Error)?.message ?? e);
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|CONNECT_TIMEOUT|CONNECTION_|timeout|EHOSTUNREACH|ENETUNREACH|socket/i.test(
    t,
  );
}

export function datenErstellen(k: Konfig): Daten {
  if (k.treiber === 'supabase') {
    return new Daten(
      new SupabaseTreiber(k.supabase.dbUrl),
      new LokalTreiber(join(k.datenVerzeichnis, 'puffer.db')),
    );
  }
  return new Daten(new LokalTreiber(join(k.datenVerzeichnis, 'hub.db')), null);
}
