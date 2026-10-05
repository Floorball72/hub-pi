// Zeitpläne für Geräte: feste Uhrzeit oder Sonnenauf und Sonnenuntergang mit Versatz, an gewählten Wochentagen.
import { sonnenZeiten } from '../../quellen/sonne.ts';
import { hhmmZuMinuten, lokal, vonLokal } from '../../kern/zeit.ts';

export interface Zeitplan {
  id: string;
  geraet_id: string;
  aktion: 'an' | 'aus';
  art: 'uhrzeit' | 'sonnenaufgang' | 'sonnenuntergang';
  uhrzeit: string | null;
  versatz_min: number | null;
  tage: string | null;
  aktiv: boolean;
}

const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** «Mo-Fr», «Sa,So», «täglich» oder leer. Gibt die Wochentage zurück (0 = Sonntag). */
export function tageParsen(text: string | null | undefined): Set<number> {
  const t = (text ?? '').trim();
  if (!t || /^t(ä|ae)glich$/i.test(t) || t === '*') return new Set([0, 1, 2, 3, 4, 5, 6]);
  const tage = new Set<number>();
  const index = (s: string) => TAGE.findIndex((x) => x.toLowerCase() === s.trim().slice(0, 2).toLowerCase());
  for (const teil of t.split(/[,;\s]+/).filter(Boolean)) {
    const [a, b] = teil.split('-');
    const i = index(a);
    if (i < 0) continue;
    if (b === undefined) {
      tage.add(i);
      continue;
    }
    const j = index(b);
    if (j < 0) continue;
    // Montag als Wochenbeginn, damit «Mo-So» alle Tage meint
    const mo = (x: number) => (x + 6) % 7;
    for (let k = mo(i), n = 0; n < 7; k = (k + 1) % 7, n++) {
      tage.add((k + 1) % 7);
      if (k === mo(j)) break;
    }
  }
  return tage;
}

/** Zeitpunkt des Plans am lokalen Tag von «tag», oder null (z.B. Sonne geht nicht unter, ungültige Zeit) */
export function zeitpunkt(p: Zeitplan, tag: Date, lat: number, lon: number): Date | null {
  const l = lokal(tag);
  if (!tageParsen(p.tage).has(l.wochentag)) return null;
  const versatz = (p.versatz_min ?? 0) * 60000;
  if (p.art === 'uhrzeit') {
    if (!p.uhrzeit) return null;
    try {
      const m = hhmmZuMinuten(p.uhrzeit);
      return new Date(vonLokal(l.jahr, l.monat, l.tag, Math.floor(m / 60), m % 60).getTime() + versatz);
    } catch {
      return null;
    }
  }
  const s = sonnenZeiten(vonLokal(l.jahr, l.monat, l.tag, 12), lat, lon);
  const basis = p.art === 'sonnenaufgang' ? s.aufgang : s.untergang;
  return basis ? new Date(basis.getTime() + versatz) : null;
}

/** Pläne, deren Zeitpunkt im Intervall (von, bis] liegt. Prüft heute und gestern, falls über Mitternacht. */
export function faellige(plaene: Zeitplan[], von: Date, bis: Date, lat: number, lon: number): Zeitplan[] {
  return plaene.filter((p) => {
    if (!p.aktiv) return false;
    for (const tag of [von, bis]) {
      const z = zeitpunkt(p, tag, lat, lon);
      if (z && z > von && z <= bis) return true;
    }
    return false;
  });
}

/** Nächster Zeitpunkt in den kommenden 8 Tagen, für die Anzeige */
export function naechster(p: Zeitplan, ab: Date, lat: number, lon: number): Date | null {
  if (!p.aktiv) return null;
  for (let i = 0; i < 8; i++) {
    const tag = new Date(ab.getTime() + i * 86400000);
    const z = zeitpunkt(p, tag, lat, lon);
    if (z && z > ab) return z;
  }
  return null;
}
