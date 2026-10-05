// Inventar: Garantie und Wartung rechnen, Daten im Format JJJJ-MM-TT.
import { plusMonate, tageZwischen } from '../aufgaben/wiederholung.ts';

export const KATEGORIEN = [
  'Elektronik',
  'Drohne und Kamera',
  'Haushalt',
  'Küche',
  'Möbel',
  'Sport',
  'Werkzeug',
  'Fahrzeug',
  'Andere',
];

/** Ende der Garantie: ein erfasstes Datum gewinnt, sonst Kaufdatum plus Garantiemonate */
export function garantieEnde(
  gekauft: string | null,
  monate: number | null,
  bis: string | null,
): string | null {
  if (bis) return bis;
  if (!gekauft || !monate || monate <= 0) return null;
  return plusMonate(gekauft, monate);
}

/** Nächste Wartung: letzte Wartung (oder Kaufdatum) plus Intervall. Ohne Intervall keine Wartung. */
export function naechsteWartung(
  letzte: string | null,
  gekauft: string | null,
  monate: number | null,
  heute: string,
): string | null {
  if (!monate || monate <= 0) return null;
  const start = letzte ?? gekauft;
  // Nie gewartet und kein Kaufdatum: ab heute fällig
  if (!start) return heute;
  return plusMonate(start, monate);
}

/** Tage bis zu einem Datum, null ohne Datum */
export function tageBis(datum: string | null, heute: string): number | null {
  return datum ? tageZwischen(heute, datum) : null;
}

/** Warnstufe für das Garantieende: 30 und 7 Tage vorher, sonst null */
export function garantieStufe(tage: number | null): 30 | 7 | null {
  if (tage === 30) return 30;
  if (tage === 7) return 7;
  return null;
}

/** Ein Feld für CSV mit Semikolon, wie es Excel in der Schweiz erwartet */
export function csvFeld(wert: unknown): string {
  if (wert === null || wert === undefined) return '';
  const s = String(wert);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
