// Einsätze aus Kalenderterminen und die Checkliste aus docs/swissunihockey-ablauf.md.
import type { Termin } from '../../quellen/ical.ts';

export const PRAEFIX = /^\s*swiss\s*unihockey\s*\|/i;

export interface Einsatz {
  schluessel: string;
  titel: string;
  start: string;
  ende: string | null;
  ganztags: boolean;
  typ: 'Resultatpost' | 'Matchbericht' | null;
  status: 'fix' | 'evtl.' | 'Ersatz';
  ersatzFuer: string | null;
  /** Geschätzte Postzeit: Termin (letztes Spiel) plus 3 Stunden */
  postzeit: string | null;
  text: string;
  ort: string;
}

export function einsatzAusTermin(t: Termin): Einsatz | null {
  if (!PRAEFIX.test(t.titel)) return null;
  const rest = t.titel.replace(PRAEFIX, '').trim();
  const alles = `${rest}\n${t.beschreibung}`;
  const typ = /matchbericht/i.test(alles)
    ? 'Matchbericht'
    : /resultat\s*post|resultatpost/i.test(alles)
      ? 'Resultatpost'
      : null;
  const ersatz = /ersatz(?:\s+f(?:ü|ue)r\s+([^|\n,]+))?/i.exec(alles);
  const status: Einsatz['status'] = /\bevtl\.?|\beventuell/i.test(alles)
    ? 'evtl.'
    : ersatz
      ? 'Ersatz'
      : 'fix';
  return {
    schluessel: `${t.uid}|${t.start}`,
    titel: rest || t.titel,
    start: t.start,
    ende: t.ende,
    ganztags: t.ganztags,
    typ,
    status,
    ersatzFuer: ersatz?.[1]?.trim() ?? null,
    postzeit: t.ganztags ? null : new Date(new Date(t.start).getTime() + 3 * 3600000).toISOString(),
    text: t.beschreibung,
    ort: t.ort,
  };
}

export interface VorlageSchritt {
  abschnitt: string;
  text: string;
  fuer: 'alle' | 'Resultatpost' | 'Matchbericht';
  reihenfolge: number;
}

/** Liest «- [ ] Schritt» Zeilen unter «## Abschnitt» Überschriften. */
export function ablaufParsen(md: string): VorlageSchritt[] {
  const schritte: VorlageSchritt[] = [];
  let abschnitt = '';
  for (const zeile of md.split(/\r?\n/)) {
    const ueber = /^##\s+(.+?)\s*$/.exec(zeile);
    if (ueber) {
      abschnitt = ueber[1];
      continue;
    }
    const s = /^\s*[-*]\s+\[[ xX]?\]\s+(.+?)\s*$/.exec(zeile);
    if (!s || !abschnitt) continue;
    const fuer = /matchbericht/i.test(abschnitt)
      ? 'Matchbericht'
      : /resultat/i.test(abschnitt)
        ? 'Resultatpost'
        : 'alle';
    schritte.push({ abschnitt, text: s[1], fuer, reihenfolge: schritte.length + 1 });
  }
  return schritte;
}

export function schritteFuer<T extends { fuer: string }>(vorlage: T[], typ: Einsatz['typ']): T[] {
  return vorlage.filter((s) => s.fuer === 'alle' || !typ || s.fuer === typ);
}
