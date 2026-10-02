// Verdichtung: Rohdaten älter als N Tage werden zu Stunden oder Tageswerten zusammengefasst
// und danach gelöscht. Verarbeitet wird Tag für Tag, damit keine Gruppe geteilt wird.
import type { Daten } from './index.ts';

export type AggregatArt = 'mittel' | 'min' | 'max' | 'summe' | 'anteil';

export interface VerdichtungsRegel {
  quelle: string;
  ziel: string;
  nachTagen: number;
  intervall: 'stunde' | 'tag';
  /** Felder, nach denen gruppiert wird (z.B. ziel_id) */
  gruppe: string[];
  /** Zielspalte: Art und Quellfeld */
  felder: { ziel: string; art: AggregatArt; feld: string }[];
  /** Zeitfeld der Quelle, Standard «erstellt» */
  zeitFeld?: string;
}

type Roh = Record<string, unknown>;

function eimer(zeit: string, intervall: 'stunde' | 'tag'): string {
  const d = new Date(zeit);
  if (intervall === 'stunde') d.setUTCMinutes(0, 0, 0);
  else d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function aggregieren(zeilen: Roh[], r: VerdichtungsRegel): Roh[] {
  const zeitFeld = r.zeitFeld ?? 'erstellt';
  const gruppen = new Map<string, Roh[]>();
  for (const z of zeilen) {
    const zeit = eimer(String(z[zeitFeld]), r.intervall);
    const schluessel = JSON.stringify([zeit, ...r.gruppe.map((g) => z[g] ?? null)]);
    const liste = gruppen.get(schluessel) ?? [];
    liste.push(z);
    gruppen.set(schluessel, liste);
  }
  const aus: Roh[] = [];
  for (const [schluessel, liste] of gruppen) {
    const [zeit, ...werte] = JSON.parse(schluessel) as unknown[];
    const zeile: Roh = { zeit, anzahl: liste.length };
    r.gruppe.forEach((g, i) => {
      zeile[g] = werte[i];
    });
    for (const f of r.felder) {
      const zahlen = liste
        .map((z) => z[f.feld])
        .filter((w) => w !== null && w !== undefined)
        .map((w) => (typeof w === 'boolean' ? (w ? 1 : 0) : Number(w)))
        .filter((w) => Number.isFinite(w));
      if (!zahlen.length) {
        zeile[f.ziel] = null;
        continue;
      }
      const summe = zahlen.reduce((a, b) => a + b, 0);
      switch (f.art) {
        case 'mittel':
        case 'anteil':
          zeile[f.ziel] = Math.round((summe / zahlen.length) * 10000) / 10000;
          break;
        case 'min':
          zeile[f.ziel] = Math.min(...zahlen);
          break;
        case 'max':
          zeile[f.ziel] = Math.max(...zahlen);
          break;
        case 'summe':
          zeile[f.ziel] = summe;
          break;
      }
    }
    aus.push(zeile);
  }
  return aus;
}

/** Führt eine Regel aus. Gibt die Anzahl verdichteter Rohzeilen zurück. */
export async function verdichten(
  daten: Daten,
  r: VerdichtungsRegel,
  jetzt = new Date(),
  maxTage = 60,
): Promise<number> {
  const zeitFeld = r.zeitFeld ?? 'erstellt';
  const grenze = new Date(jetzt.getTime() - r.nachTagen * 86400000);
  grenze.setUTCHours(0, 0, 0, 0);
  let total = 0;
  for (let i = 0; i < maxTage; i++) {
    const [aelteste] = await daten.liste<Roh>(r.quelle, {
      filter: { [zeitFeld]: { lt: grenze.toISOString() } },
      sortierung: zeitFeld,
      limit: 1,
    });
    if (!aelteste) break;
    const von = new Date(String(aelteste[zeitFeld]));
    von.setUTCHours(0, 0, 0, 0);
    const bis = new Date(von.getTime() + 86400000);
    const zeilen = await daten.liste<Roh>(r.quelle, {
      filter: { [zeitFeld]: { gte: von.toISOString(), lt: bis.toISOString() } },
      limit: 100000,
    });
    const verdichtet = aggregieren(zeilen, r);
    if (verdichtet.length) await daten.einfuegen(r.ziel, verdichtet);
    await daten.loescheWo(r.quelle, { [zeitFeld]: { gte: von.toISOString(), lt: bis.toISOString() } });
    total += zeilen.length;
  }
  return total;
}
