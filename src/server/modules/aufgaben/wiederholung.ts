// Wiederkehrende Aufgaben und Routinen: Rechnen mit lokalen Kalendertagen im Format JJJJ-MM-TT.

export const RHYTHMEN = [
  'einmalig',
  'taeglich',
  'woechentlich',
  'zweiwoechentlich',
  'monatlich',
  'jaehrlich',
] as const;
export type Rhythmus = (typeof RHYTHMEN)[number];

export const RHYTHMUS_NAMEN: Record<Rhythmus, string> = {
  einmalig: 'einmalig',
  taeglich: 'täglich',
  woechentlich: 'wöchentlich',
  zweiwoechentlich: 'alle zwei Wochen',
  monatlich: 'monatlich',
  jaehrlich: 'jährlich',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (datum: string) => new Date(`${datum}T00:00:00Z`);

export function plusTage(datum: string, n: number): string {
  const d = utc(datum);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Monate addieren, der Tag wird am Monatsende gekappt (31. Januar plus 1 Monat ist der 28. oder 29. Februar) */
export function plusMonate(datum: string, n: number): string {
  const [j, m, t] = datum.split('-').map(Number);
  const ziel = new Date(Date.UTC(j, m - 1 + n, 1));
  const letzter = new Date(Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0)).getUTCDate();
  ziel.setUTCDate(Math.min(t, letzter));
  return iso(ziel);
}

function schritt(datum: string, r: Rhythmus): string {
  switch (r) {
    case 'taeglich':
      return plusTage(datum, 1);
    case 'woechentlich':
      return plusTage(datum, 7);
    case 'zweiwoechentlich':
      return plusTage(datum, 14);
    case 'monatlich':
      return plusMonate(datum, 1);
    case 'jaehrlich':
      return plusMonate(datum, 12);
    default:
      return datum;
  }
}

/**
 * Nächstes Fälligkeitsdatum nach dem Erledigen. Springt vom alten Datum im Rhythmus weiter,
 * bis das Datum nach heute liegt. So bleibt der Wochentag oder Monatstag erhalten,
 * auch wenn die Aufgabe verspätet erledigt wurde. Ohne Datum zählt heute als Start.
 */
export function naechsteFaelligkeit(faellig: string | null, r: Rhythmus, heute: string): string | null {
  if (r === 'einmalig' || !RHYTHMEN.includes(r)) return null;
  // Monatlich und jährlich immer vom ursprünglichen Tag aus rechnen, sonst wandert der 31. auf den 28.
  const start = faellig ?? heute;
  let n = 1;
  let d = schrittN(start, r, n);
  while (d <= heute && n < 5000) d = schrittN(start, r, ++n);
  return d;
}

function schrittN(start: string, r: Rhythmus, n: number): string {
  if (r === 'monatlich') return plusMonate(start, n);
  if (r === 'jaehrlich') return plusMonate(start, 12 * n);
  let d = start;
  for (let i = 0; i < n; i++) d = schritt(d, r);
  return d;
}

/** Wochentag eines Datums, 0 = Sonntag */
export function wochentag(datum: string): number {
  return utc(datum).getUTCDay();
}

/** Schlüssel der Periode einer Routine: der Tag selbst, bei wöchentlich der Montag der Woche */
export function periode(heute: string, rhythmus: 'taeglich' | 'woechentlich'): string {
  if (rhythmus === 'woechentlich') return plusTage(heute, -((wochentag(heute) + 6) % 7));
  return heute;
}

/** Tage zwischen zwei Daten (b minus a) */
export function tageZwischen(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86400000);
}

/**
 * Serie einer Routine: wie viele Perioden in Folge vollständig erledigt wurden.
 * Die laufende Periode zählt mit, wenn sie schon erledigt ist, sonst beginnt die Zählung bei der vorherigen.
 */
export function serie(erledigt: Set<string>, heute: string, rhythmus: 'taeglich' | 'woechentlich'): number {
  const tage = rhythmus === 'woechentlich' ? 7 : 1;
  let p = periode(heute, rhythmus);
  if (!erledigt.has(p)) p = plusTage(p, -tage);
  let n = 0;
  while (erledigt.has(p) && n < 1000) {
    n++;
    p = plusTage(p, -tage);
  }
  return n;
}

/** Schritte einer Routine aus mehrzeiligem Text, leere Zeilen und Aufzählungszeichen weg */
export function schritte(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((z) => z.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 50);
}
