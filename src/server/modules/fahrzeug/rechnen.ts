// Fahrzeug: Verbrauch, Kilometerprognose, Service, Reifenwechsel und Vignette rechnen.
import { plusMonate, plusTage, tageZwischen } from '../aufgaben/wiederholung.ts';

export interface Tankung {
  datum: string;
  km: number;
  liter: number;
  betrag: number | null;
  voll: boolean;
}

export interface Verbrauch {
  /** Liter pro 100 km je Abschnitt von Volltankung zu Volltankung, mit Datum der zweiten */
  abschnitte: { datum: string; km: number; l100: number }[];
  /** Mittel über alle vollständigen Abschnitte, gewichtet nach Kilometern */
  mittel: number | null;
  /** Franken pro 100 km über dieselben Abschnitte */
  chf100: number | null;
}

/**
 * Verbrauch nach der Volltank Methode: Zwischen zwei Volltankungen zählen alle Liter
 * nach der ersten bis und mit der zweiten. Teiltankungen werden mitgezählt, sind aber nie Grenze.
 */
export function verbrauch(tankungen: Tankung[]): Verbrauch {
  const t = [...tankungen].sort((a, b) => a.km - b.km);
  const abschnitte: Verbrauch['abschnitte'] = [];
  let summeKm = 0;
  let summeL = 0;
  let summeChf = 0;
  let chfVollstaendig = true;
  let start = -1;
  let liter = 0;
  let chf = 0;
  let chfDa = true;
  for (let i = 0; i < t.length; i++) {
    if (start >= 0) {
      liter += t[i].liter;
      if (t[i].betrag == null) chfDa = false;
      else chf += t[i].betrag as number;
    }
    if (!t[i].voll) continue;
    if (start >= 0) {
      const km = t[i].km - t[start].km;
      if (km > 0 && liter > 0) {
        abschnitte.push({ datum: t[i].datum, km, l100: runden((liter / km) * 100, 1) });
        summeKm += km;
        summeL += liter;
        summeChf += chf;
        if (!chfDa) chfVollstaendig = false;
      }
    }
    start = i;
    liter = 0;
    chf = 0;
    chfDa = true;
  }
  return {
    abschnitte,
    mittel: summeKm ? runden((summeL / summeKm) * 100, 1) : null,
    chf100: summeKm && chfVollstaendig ? runden((summeChf / summeKm) * 100, 2) : null,
  };
}

/** Kilometer pro Tag aus dem ersten und letzten Eintrag der letzten zwölf Monate, mindestens 30 Tage Abstand */
export function kmProTag(staende: { datum: string; km: number }[], heute: string): number | null {
  const ab = plusMonate(heute, -12);
  const s = staende
    .filter((x) => x.datum >= ab && x.datum <= heute)
    .sort((a, b) => a.datum.localeCompare(b.datum));
  if (s.length < 2) return null;
  const tage = tageZwischen(s[0].datum, s[s.length - 1].datum);
  if (tage < 30) return null;
  const km = s[s.length - 1].km - s[0].km;
  return km > 0 ? km / tage : null;
}

/** Geschätzter Kilometerstand heute aus dem letzten Stand und der Fahrleistung */
export function kmHeute(
  letzter: { datum: string; km: number } | null,
  proTag: number | null,
  heute: string,
): number | null {
  if (!letzter) return null;
  if (!proTag) return letzter.km;
  return Math.round(letzter.km + proTag * Math.max(0, tageZwischen(letzter.datum, heute)));
}

export interface ServiceStand {
  /** Fällig nach Datum */
  datum: string | null;
  /** Fällig ab Kilometerstand */
  km: number | null;
  /** Geschätztes Datum, an dem der Kilometerstand erreicht wird */
  kmDatum: string | null;
  /** Was zuerst kommt */
  faellig: string | null;
  tage: number | null;
}

export function service(
  letzterDatum: string | null,
  letzterKm: number | null,
  monate: number | null,
  kmIntervall: number | null,
  kmJetzt: number | null,
  proTag: number | null,
  heute: string,
): ServiceStand {
  const datum = letzterDatum && monate ? plusMonate(letzterDatum, monate) : null;
  const km = letzterKm != null && kmIntervall ? letzterKm + kmIntervall : null;
  let kmDatum: string | null = null;
  if (km != null && kmJetzt != null) {
    if (kmJetzt >= km) kmDatum = heute;
    else if (proTag) kmDatum = plusTage(heute, Math.ceil((km - kmJetzt) / proTag));
  }
  const kandidaten = [datum, kmDatum].filter((d): d is string => !!d).sort();
  const faellig = kandidaten[0] ?? null;
  return { datum, km, kmDatum, faellig, tage: faellig ? tageZwischen(heute, faellig) : null };
}

/**
 * Reifenwechsel nach der Faustregel «von O bis O» (Oktober bis Ostern).
 * Ab 15. Oktober Winterreifen, ab 15. April Sommerreifen. Liefert den empfohlenen Satz und ob gewechselt werden sollte.
 */
export function reifen(
  montiert: string | null,
  heute: string,
): { soll: 'Sommer' | 'Winter'; wechseln: boolean; ab: string } {
  const md = heute.slice(5);
  const winter = md >= '10-15' || md < '04-15';
  const soll = winter ? 'Winter' : 'Sommer';
  const jahr = Number(heute.slice(0, 4));
  // Nächster Stichtag für den anderen Satz
  const ab = winter ? `${md >= '10-15' ? jahr + 1 : jahr}-04-15` : `${jahr}-10-15`;
  const wechseln = montiert !== null && montiert !== 'Ganzjahr' && montiert !== soll;
  return { soll, wechseln, ab };
}

/** Vignette: die neue gilt ab 1. Dezember des Vorjahres, die alte bis 31. Januar. Ab Dezember erinnern. */
export function vignette(
  jahr: number | null,
  heute: string,
): { gueltig: boolean; kaufen: boolean; fuer: number } {
  const j = Number(heute.slice(0, 4));
  const md = heute.slice(5);
  const fuer = md >= '12-01' ? j + 1 : j;
  const gueltig =
    jahr != null && (jahr === j || (jahr === j - 1 && md <= '01-31') || (jahr === j + 1 && md >= '12-01'));
  return { gueltig, kaufen: jahr == null || jahr < fuer, fuer };
}

function runden(n: number, stellen: number) {
  const f = 10 ** stellen;
  return Math.round(n * f) / f;
}
