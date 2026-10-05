// Zeitfunktionen für die Schweiz (Europe/Zurich), ohne Zusatzpakete.
export const ZONE = 'Europe/Zurich';

const teileFormat = new Intl.DateTimeFormat('de-CH', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

export interface LokalTeile {
  jahr: number;
  monat: number;
  tag: number;
  stunde: number;
  minute: number;
  sekunde: number;
  /** 0 = Sonntag */
  wochentag: number;
}

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function lokal(d: Date): LokalTeile {
  const t: Record<string, string> = {};
  for (const p of teileFormat.formatToParts(d)) t[p.type] = p.value;
  return {
    jahr: Number(t.year),
    monat: Number(t.month),
    tag: Number(t.day),
    stunde: Number(t.hour),
    minute: Number(t.minute),
    sekunde: Number(t.second),
    wochentag: WOCHENTAGE.indexOf(t.weekday.replace('.', '')),
  };
}

export function lokalDatum(d: Date): string {
  const l = lokal(d);
  return `${l.jahr}-${String(l.monat).padStart(2, '0')}-${String(l.tag).padStart(2, '0')}`;
}

export function lokalZeit(d: Date): string {
  const l = lokal(d);
  return `${String(l.stunde).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`;
}

/** Minuten seit Mitternacht (lokal) */
export function minutenLokal(d: Date): number {
  const l = lokal(d);
  return l.stunde * 60 + l.minute;
}

export function hhmmZuMinuten(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Ungültige Zeit ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Liegt d im Zeitfenster von bis (lokal)? Fenster über Mitternacht sind erlaubt (22:00 bis 07:00). */
export function imFenster(d: Date, von: string, bis: string): boolean {
  const m = minutenLokal(d);
  const a = hhmmZuMinuten(von);
  const b = hhmmZuMinuten(bis);
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** Wandelt eine lokale Zeit (Europe/Zurich) in ein Date um. */
export function vonLokal(
  jahr: number,
  monat: number,
  tag: number,
  stunde = 0,
  minute = 0,
  sekunde = 0,
): Date {
  // Erst als UTC annehmen, dann um den Versatz korrigieren (zweimal für Sommerzeitwechsel)
  let utc = Date.UTC(jahr, monat - 1, tag, stunde, minute, sekunde);
  for (let i = 0; i < 2; i++) {
    const l = lokal(new Date(utc));
    const alsUtc = Date.UTC(l.jahr, l.monat - 1, l.tag, l.stunde, l.minute, l.sekunde);
    utc += Date.UTC(jahr, monat - 1, tag, stunde, minute, sekunde) - alsUtc;
  }
  return new Date(utc);
}

/** Beginn des lokalen Tages */
export function tagesBeginn(d: Date): Date {
  const l = lokal(d);
  return vonLokal(l.jahr, l.monat, l.tag);
}

/** Beginn des lokalen Tages, der n Tage vor d liegt (n = 0 ist heute) */
export function tageZurueck(d: Date, n: number): Date {
  const l = lokal(d);
  return tagesBeginn(vonLokal(l.jahr, l.monat, l.tag - n, 12));
}

export type Rueckblick = 'tag' | 'woche';

/** Beginn des Rückblicks: heute ab Mitternacht oder die letzten sieben Tage inklusive heute */
export function rueckblickBeginn(d: Date, zeitraum: Rueckblick): Date {
  return zeitraum === 'woche' ? tageZurueck(d, 6) : tagesBeginn(d);
}
