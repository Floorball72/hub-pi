// Finanzen: Zahlungstermine, Monatsbeträge und Kündigungsfristen. Rechnet mit Kalendertagen JJJJ-MM-TT.
import { plusMonate, tageZwischen } from '../aufgaben/wiederholung.ts';

export const INTERVALLE = [
  'monatlich',
  'vierteljaehrlich',
  'halbjaehrlich',
  'jaehrlich',
  'einmalig',
] as const;
export type Intervall = (typeof INTERVALLE)[number];

export const INTERVALL_NAMEN: Record<Intervall, string> = {
  monatlich: 'monatlich',
  vierteljaehrlich: 'vierteljährlich',
  halbjaehrlich: 'halbjährlich',
  jaehrlich: 'jährlich',
  einmalig: 'einmalig',
};

export const KATEGORIEN = [
  'Wohnen',
  'Versicherung',
  'Mobilität',
  'Telefon und Internet',
  'Unterhaltung',
  'Software',
  'Sport und Verein',
  'Gesundheit',
  'Steuern und Gebühren',
  'Andere',
];

/** Monate pro Intervall, 0 für einmalig */
export function monate(i: Intervall | string | null | undefined): number {
  switch (i) {
    case 'monatlich':
      return 1;
    case 'vierteljaehrlich':
      return 3;
    case 'halbjaehrlich':
      return 6;
    case 'jaehrlich':
    case 'jährlich':
      return 12;
    default:
      return 0;
  }
}

/** Betrag auf einen Monat umgerechnet, einmalige Beträge zählen nicht */
export function monatsBetrag(betrag: number, i: Intervall | string | null | undefined): number {
  const m = monate(i);
  return m ? betrag / m : 0;
}

/** Nächster Zahlungstag ab heute (heute zählt), vom ursprünglichen Tag aus gerechnet, damit der 31. erhalten bleibt */
export function naechsteZahlung(start: string | null, i: Intervall | string, heute: string): string | null {
  if (!start) return null;
  const m = monate(i);
  if (!m || start >= heute) return start;
  let n = 1;
  let d = plusMonate(start, m);
  while (d < heute && n < 2000) d = plusMonate(start, m * ++n);
  return d;
}

/** Alle Zahlungstage im Bereich [von, bis] */
export function termine(start: string | null, i: Intervall | string, von: string, bis: string): string[] {
  if (!start) return [];
  const m = monate(i);
  if (!m) return start >= von && start <= bis ? [start] : [];
  const aus: string[] = [];
  for (let n = 0; n < 2000; n++) {
    const d = plusMonate(start, m * n);
    if (d > bis) break;
    if (d >= von) aus.push(d);
  }
  return aus;
}

export interface Kuendigung {
  /** Aktuelles oder nächstes Vertragsende */
  vertragsende: string;
  /** Letzter Tag, an dem die Kündigung eintreffen muss. null, wenn der Vertrag ohnehin endet */
  kuendigenBis: string | null;
  /** Tage bis zur Frist */
  tage: number | null;
  /** Die Frist für das aktuelle Vertragsende ist schon vorbei, angezeigt wird die nächste Möglichkeit */
  verpasst: boolean;
}

/**
 * Kündigungstermin eines Vertrags. Liegt das Vertragsende zurück, verlängert sich der Vertrag
 * um die Verlängerungsdauer (0 = endet ohne Verlängerung). Die Frist zählt in Monaten vor dem Ende.
 */
export function kuendigung(
  vertragBis: string | null,
  fristMonate: number | null,
  verlaengerungMonate: number | null,
  heute: string,
): Kuendigung | null {
  if (!vertragBis) return null;
  const frist = Math.max(0, fristMonate ?? 0);
  const verl = Math.max(0, verlaengerungMonate ?? 0);
  let n = 0;
  const ende = () => plusMonate(vertragBis, verl * n);
  if (vertragBis < heute) {
    if (!verl) return { vertragsende: vertragBis, kuendigenBis: null, tage: null, verpasst: false };
    while (ende() < heute && n < 1000) n++;
  }
  let bis = plusMonate(ende(), -frist);
  let verpasst = false;
  if (bis < heute) {
    if (!verl) return { vertragsende: ende(), kuendigenBis: null, tage: null, verpasst: true };
    verpasst = true;
    n++;
    bis = plusMonate(ende(), -frist);
  }
  return { vertragsende: ende(), kuendigenBis: bis, tage: tageZwischen(heute, bis), verpasst };
}

/** Warnstufe für eine Frist: 30, 14, 7, 1 oder 0 Tage vorher, sonst null */
export function warnstufe(tage: number | null): number | null {
  if (tage === null || tage < 0) return null;
  return [0, 1, 7, 14, 30].find((s) => tage <= s) ?? null;
}
