// Deklaratives Tabellenschema. Daraus entstehen die SQLite Tabellen, die Supabase Migrationen
// und die Formulare im Frontend. So bleiben beide Treiber gleich.

export type SpaltenTyp = 'text' | 'int' | 'real' | 'bool' | 'json' | 'zeit' | 'datum';

export interface Spalte {
  name: string;
  typ: SpaltenTyp;
  label?: string;
  pflicht?: boolean;
  /** Feste Auswahl (z.B. Status) */
  optionen?: string[];
  /** Verweis auf eine andere Tabelle (id) */
  verweis?: string;
  /** Im Formular nicht anzeigen (vom System gesetzt) */
  intern?: boolean;
  /** Mehrzeiliges Textfeld */
  lang?: boolean;
  standard?: unknown;
  min?: number;
  max?: number;
  /** Einheit für die Anzeige */
  einheit?: string;
}

export interface Tabelle {
  name: string;
  modul: string;
  label: string;
  spalten: Spalte[];
  /** Messwerte: werden bei Ausfall von Supabase lokal gepuffert */
  puffer?: boolean;
  indizes?: string[][];
  /** Darf über die generische CRUD API bearbeitet werden */
  bearbeitbar?: boolean;
  /** Feld für die Anzeige in Listen und Verweisen */
  anzeige?: string;
  /** Felder für die globale Suche */
  suche?: string[];
}

/** Jede Tabelle hat diese Spalten automatisch. */
export const BASIS_SPALTEN: Spalte[] = [
  { name: 'id', typ: 'text', intern: true },
  { name: 'erstellt', typ: 'zeit', intern: true },
];

export function tabelle(t: Tabelle): Tabelle {
  for (const s of t.spalten) {
    if (!/^[a-z][a-z0-9_]*$/.test(s.name)) throw new Error(`Ungültiger Spaltenname ${t.name}.${s.name}`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(t.name)) throw new Error(`Ungültiger Tabellenname ${t.name}`);
  return t;
}

export function alleSpalten(t: Tabelle): Spalte[] {
  return [...BASIS_SPALTEN, ...t.spalten];
}

export type Zeile = Record<string, unknown> & { id: string; erstellt: string };

/** Prüft und normalisiert Eingaben anhand des Schemas. Wirft bei ungültigen Werten. */
export function validieren(
  t: Tabelle,
  eingabe: Record<string, unknown>,
  teilweise: boolean,
): Record<string, unknown> {
  if (!eingabe || typeof eingabe !== 'object' || Array.isArray(eingabe))
    throw new EingabeFehler('Ungültige Eingabe');
  const aus: Record<string, unknown> = {};
  for (const s of t.spalten) {
    const vorhanden = Object.hasOwn(eingabe, s.name);
    let wert = eingabe[s.name];
    if (!vorhanden) {
      if (!teilweise && s.pflicht && s.standard === undefined)
        throw new EingabeFehler(`${s.label ?? s.name} fehlt`);
      if (!teilweise && s.standard !== undefined) aus[s.name] = s.standard;
      continue;
    }
    if (wert === '' || wert === undefined) wert = null;
    if (wert === null) {
      if (s.pflicht) throw new EingabeFehler(`${s.label ?? s.name} fehlt`);
      aus[s.name] = null;
      continue;
    }
    aus[s.name] = wertPruefen(s, wert);
  }
  return aus;
}

export class EingabeFehler extends Error {
  status = 400;
}

function wertPruefen(s: Spalte, wert: unknown): unknown {
  const name = s.label ?? s.name;
  switch (s.typ) {
    case 'text': {
      if (typeof wert !== 'string' && typeof wert !== 'number')
        throw new EingabeFehler(`${name}: Text erwartet`);
      const t = String(wert);
      if (t.length > (s.max ?? (s.lang ? 20000 : 500))) throw new EingabeFehler(`${name}: zu lang`);
      if (s.optionen && !s.optionen.includes(t)) throw new EingabeFehler(`${name}: ungültige Auswahl`);
      return t;
    }
    case 'int':
    case 'real': {
      const n = typeof wert === 'number' ? wert : Number(String(wert).replace(',', '.'));
      if (!Number.isFinite(n)) throw new EingabeFehler(`${name}: Zahl erwartet`);
      if (s.typ === 'int' && !Number.isInteger(n)) throw new EingabeFehler(`${name}: ganze Zahl erwartet`);
      if (s.min !== undefined && n < s.min) throw new EingabeFehler(`${name}: mindestens ${s.min}`);
      if (s.max !== undefined && n > s.max) throw new EingabeFehler(`${name}: höchstens ${s.max}`);
      return n;
    }
    case 'bool':
      if (typeof wert === 'boolean') return wert;
      if (wert === 'true' || wert === 1) return true;
      if (wert === 'false' || wert === 0) return false;
      throw new EingabeFehler(`${name}: ja oder nein erwartet`);
    case 'json':
      if (JSON.stringify(wert).length > 50000) throw new EingabeFehler(`${name}: zu gross`);
      return wert;
    case 'zeit': {
      const d = new Date(String(wert));
      if (Number.isNaN(d.getTime())) throw new EingabeFehler(`${name}: Zeitpunkt erwartet`);
      return d.toISOString();
    }
    case 'datum': {
      const t = String(wert);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(new Date(t).getTime()))
        throw new EingabeFehler(`${name}: Datum erwartet (JJJJ-MM-TT)`);
      return t;
    }
  }
}
