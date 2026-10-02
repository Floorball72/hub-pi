// Zentrale Metrik Registry für das Modul Auffälligkeiten.
// Module melden Zahlen mit wenigen Zeilen:
//   const ram = ctx.metrik({ id: 'zentrale.ram', name: 'RAM des Hubs', einheit: 'MB' });
//   await ram(87);
// Die Auswertung (Baseline, Abweichungen, Alarme) macht das Modul Auffälligkeiten.
import { tabelle } from '../daten/schema.ts';
import { lokal } from './zeit.ts';

export interface MetrikDef {
  /** Eindeutig, z.B. «parken.frei» oder «scont.ms.<seite>» */
  id: string;
  name: string;
  einheit?: string;
  modul?: string;
  /** Welche Abweichung zählt: nur nach oben, nur nach unten oder beide */
  richtung?: 'hoch' | 'tief' | 'beide';
  /** So lange muss die Abweichung anhalten, bevor gemeldet wird */
  minDauerMin?: number;
  cooldownMin?: number;
  /** Kleinste Abweichung, die überhaupt zählt (in der Einheit der Metrik) */
  minAbweichung?: number;
  /** Ab 4: darf auch nachts melden (z.B. Kundenseiten) */
  prioritaet?: number;
}

export const METRIK_WERTE = tabelle({
  name: 'metrik_werte',
  modul: 'kern',
  label: 'Metriken (Rohwerte)',
  puffer: true,
  spalten: [
    { name: 'metrik', typ: 'text' },
    { name: 'wert', typ: 'real' },
  ],
  indizes: [['metrik', 'erstellt'], ['erstellt']],
});

export const METRIK_STUNDEN = tabelle({
  name: 'metrik_stunden',
  modul: 'kern',
  label: 'Metriken pro Stunde',
  spalten: [
    { name: 'zeit', typ: 'zeit' },
    { name: 'metrik', typ: 'text' },
    { name: 'anzahl', typ: 'int' },
    { name: 'wert', typ: 'real' },
  ],
  indizes: [['metrik', 'zeit'], ['zeit']],
});

export class MetrikRegistry {
  readonly defs = new Map<string, MetrikDef>();
  /** Letzter Wert im RAM (für die Auswertung ohne Datenbankabfrage) */
  readonly letzte = new Map<string, { wert: number; zeit: number }>();
  private speichern: (zeilen: { metrik: string; wert: number }[]) => Promise<unknown>;
  private aktiv: () => boolean;
  private jetzt: () => Date;
  private warteschlange: { metrik: string; wert: number }[] = [];

  constructor(
    speichern: (zeilen: { metrik: string; wert: number }[]) => Promise<unknown>,
    aktiv: () => boolean,
    jetzt: () => Date = () => new Date(),
  ) {
    this.speichern = speichern;
    this.aktiv = aktiv;
    this.jetzt = jetzt;
  }

  registrieren(def: MetrikDef): (wert: number | null | undefined) => Promise<void> {
    if (!/^[a-z0-9_.:-]{3,120}$/i.test(def.id)) throw new Error(`Ungültige Metrik ${def.id}`);
    this.defs.set(def.id, { richtung: 'beide', minDauerMin: 15, cooldownMin: 360, prioritaet: 3, ...def });
    return (wert) => this.erfassen(def.id, wert);
  }

  async erfassen(id: string, wert: number | null | undefined) {
    if (wert === null || wert === undefined || !Number.isFinite(wert) || !this.aktiv()) return;
    this.letzte.set(id, { wert, zeit: this.jetzt().getTime() });
    this.warteschlange.push({ metrik: id, wert: Math.round(wert * 1000) / 1000 });
    // In kleinen Paketen schreiben, schont die SD Karte
    if (this.warteschlange.length >= 20) await this.leeren();
  }

  async leeren() {
    if (!this.warteschlange.length) return;
    const zeilen = this.warteschlange.splice(0);
    await this.speichern(zeilen).catch(() => {});
  }
}

// Statistik

export function median(werte: number[]): number {
  const s = [...werte].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median und MAD (mittlere absolute Abweichung vom Median), robust gegen Ausreisser */
export function medianMad(werte: number[]): { median: number; mad: number } {
  const m = median(werte);
  return { median: m, mad: median(werte.map((w) => Math.abs(w - m))) };
}

/** Eimer für die Baseline: Werktag oder Wochenende, dazu die Stunde (Lokalzeit) */
export function eimer(d: Date): string {
  const l = lokal(d);
  const we = l.wochentag === 0 || l.wochentag === 6;
  return `${we ? 'we' : 'wt'}-${l.stunde}`;
}

export type Empfindlichkeit = 'aus' | 'niedrig' | 'normal' | 'hoch';
export const SCHWELLE: Record<Exclude<Empfindlichkeit, 'aus'>, number> = {
  niedrig: 6,
  normal: 4.5,
  hoch: 3.5,
};

export interface Basis {
  median: number;
  mad: number;
  n: number;
}

/** Robuster z Wert. Die Streuung hat eine Untergrenze, damit sehr ruhige Werte nicht bei jeder Kleinigkeit auslösen. */
export function abweichung(wert: number, b: Basis, minAbweichung = 0): number {
  const streuung = Math.max(1.4826 * b.mad, Math.abs(b.median) * 0.02, minAbweichung / 3, 1e-9);
  return (wert - b.median) / streuung;
}

export interface Bewertung {
  z: number;
  ausserhalb: boolean;
  richtung: 'hoch' | 'tief';
}

export function bewerten(wert: number, b: Basis, def: MetrikDef, schwelle: number): Bewertung {
  const z = abweichung(wert, b, def.minAbweichung ?? 0);
  const richtung = z >= 0 ? 'hoch' : 'tief';
  const passt = def.richtung === 'beide' || def.richtung === undefined || def.richtung === richtung;
  const absolutGenug = Math.abs(wert - b.median) >= (def.minAbweichung ?? 0);
  return { z, richtung, ausserhalb: passt && absolutGenug && Math.abs(z) >= schwelle };
}

/** Rückmeldung passt den Faktor der Schwelle je Metrik an: «normal» macht unempfindlicher, «relevant» empfindlicher */
export function faktorNachRueckmeldung(faktor: number, rueckmeldung: 'normal' | 'relevant'): number {
  const neu = rueckmeldung === 'normal' ? faktor * 1.15 : faktor * 0.95;
  return Math.round(Math.min(2.5, Math.max(0.7, neu)) * 100) / 100;
}
