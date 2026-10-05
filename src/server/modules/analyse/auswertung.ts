// Auswertung der selbst erfassten Abschlüsse. Reine Funktionen ohne Datenzugriff, damit testbar.
import {
  laufendeStrafen,
  SEITEN,
  type Seite,
  type Strafe,
  situationAus,
  strafeEndetDurchTor,
  zaehlt,
} from '../../geteilt/unihockey.ts';
//
// Koordinaten: halbes Spielfeld, 20 m breit und 20 m tief. x von 0 (links) bis 1 (rechts),
// y von 0 (Bande hinter dem Tor) bis 1 (Mittellinie). Das Tor steht 3.5 m vor der Bande.

export const FELD_BREITE_M = 20;
export const FELD_TIEFE_M = 20;
export const TOR_ABSTAND_M = 3.5;

export const TYPEN = ['tor', 'gehalten', 'daneben', 'geblockt'] as const;
export type Typ = (typeof TYPEN)[number];
export { SEITEN, type Seite, type Strafe, laufendeStrafen, situationAus, strafeEndetDurchTor, zaehlt };
export const ZONEN = ['Torraum', 'Slot', 'Seite', 'Distanz'] as const;
export type Zone = (typeof ZONEN)[number];

export interface Ereignis {
  id: string;
  spiel_id: string;
  typ: Typ;
  team: Seite;
  x: number;
  y: number;
  spieler_id: string | null;
  assist_id: string | null;
  drittel: number | null;
  minute: number | null;
  situation: string | null;
  /** Spieler ids auf dem Feld, mit Komma getrennt (für Plus Minus) */
  auf_feld?: string | null;
  /** Spielzeit in Sekunden ab Spielbeginn */
  zeit_sek?: number | null;
}

/** Überzahl und Unterzahl: Chancen sind die Strafen des anderen Teams, die das Kräfteverhältnis ändern */
export function spezialteams(liste: Ereignis[], strafen: Strafe[]) {
  const chancen = strafen.filter((s) => s.team === 'gegner' && zaehlt(s)).length;
  const unterzahl = strafen.filter((s) => s.team === 'eigen' && zaehlt(s)).length;
  const tore = liste.filter(
    (e) => e.team === 'eigen' && e.typ === 'tor' && e.situation === 'ueberzahl',
  ).length;
  const gegentore = liste.filter(
    (e) => e.team === 'gegner' && e.typ === 'tor' && e.situation === 'unterzahl',
  ).length;
  return {
    ueberzahl: { chancen, tore, quote: prozent(tore, chancen) },
    unterzahl: {
      chancen: unterzahl,
      gegentore,
      quote: unterzahl ? Math.round((1 - gegentore / unterzahl) * 1000) / 10 : null,
    },
    strafminuten: {
      eigen: strafen.filter((s) => s.team === 'eigen').reduce((a, s) => a + s.minuten, 0),
      gegner: strafen.filter((s) => s.team === 'gegner').reduce((a, s) => a + s.minuten, 0),
    },
  };
}

/**
 * Plus Minus pro Spieler: Tor bei gleich vielen Spielern oder in Unterzahl gibt allen auf dem Feld +1,
 * Gegentor bei gleich vielen oder in Überzahl -1. Tore in eigener Überzahl und Penaltys zählen nicht.
 */
export function plusMinus(liste: Ereignis[]): Map<string, number> {
  const pm = new Map<string, number>();
  for (const e of liste) {
    if (e.typ !== 'tor' || !e.auf_feld || e.situation === 'penalty') continue;
    let d = 0;
    if (e.team === 'eigen' && e.situation !== 'ueberzahl') d = 1;
    if (e.team === 'gegner' && e.situation !== 'unterzahl') d = -1;
    if (!d) continue;
    for (const id of e.auf_feld.split(',').filter(Boolean)) pm.set(id, (pm.get(id) ?? 0) + d);
  }
  return pm;
}

export interface Spieler {
  id: string;
  nummer: number | null;
  name: string;
  position: string | null;
  block?: number | null;
}

export interface Werte {
  schuesse: number;
  tore: number;
  aufsTor: number;
  geblockt: number;
  daneben: number;
  /** Tore pro Schuss in Prozent */
  effizienz: number | null;
  /** Anteil Schüsse aufs Tor in Prozent */
  praezision: number | null;
}

export interface SpielerWerte extends Werte {
  spieler: Spieler;
  assists: number;
  punkte: number;
  spiele: number;
  /** Mittlere Distanz der Abschlüsse in Metern */
  distanz: number | null;
  /** null, wenn für den Spieler nie erfasst wurde, wer auf dem Feld war */
  plusMinus: number | null;
  strafminuten: number;
}

/** Abstand zur Tormitte in Metern */
export function distanz(x: number, y: number): number {
  const dx = (x - 0.5) * FELD_BREITE_M;
  const dy = y * FELD_TIEFE_M - TOR_ABSTAND_M;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Zone eines Abschlusses: Torraum bis 5 m, Slot zentral bis 10 m, sonst seitlich oder aus Distanz */
export function zone(x: number, y: number): Zone {
  const d = distanz(x, y);
  if (d < 5) return 'Torraum';
  const seitlich = Math.abs(x - 0.5) * FELD_BREITE_M;
  if (d < 10) return seitlich <= 4 ? 'Slot' : 'Seite';
  return 'Distanz';
}

const prozent = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

export function werte(liste: Ereignis[]): Werte {
  const tore = liste.filter((e) => e.typ === 'tor').length;
  const gehalten = liste.filter((e) => e.typ === 'gehalten').length;
  const geblockt = liste.filter((e) => e.typ === 'geblockt').length;
  const daneben = liste.filter((e) => e.typ === 'daneben').length;
  return {
    schuesse: liste.length,
    tore,
    aufsTor: tore + gehalten,
    geblockt,
    daneben,
    effizienz: prozent(tore, liste.length),
    praezision: prozent(tore + gehalten, liste.length),
  };
}

export function nachZone(liste: Ereignis[]): ({ zone: Zone } & Werte)[] {
  return ZONEN.map((z) => ({ zone: z, ...werte(liste.filter((e) => zone(e.x, e.y) === z)) }));
}

/** Drittel 1 bis 3, 4 steht für die Verlängerung */
export function nachDrittel(liste: Ereignis[]) {
  const drittel = [...new Set(liste.map((e) => e.drittel ?? 0))].filter((d) => d > 0).sort();
  return (drittel.length ? drittel : [1, 2, 3]).map((d) => {
    const im = liste.filter((e) => e.drittel === d);
    return {
      drittel: d,
      eigen: werte(im.filter((e) => e.team === 'eigen')),
      gegner: werte(im.filter((e) => e.team === 'gegner')),
    };
  });
}

export function nachSpieler(liste: Ereignis[], spieler: Spieler[], strafen: Strafe[] = []): SpielerWerte[] {
  const eigene = liste.filter((e) => e.team === 'eigen');
  const pm = plusMinus(liste);
  return spieler
    .map((s) => {
      const schuesse = eigene.filter((e) => e.spieler_id === s.id);
      const assists = eigene.filter((e) => e.typ === 'tor' && e.assist_id === s.id).length;
      const w = werte(schuesse);
      const feld = liste.filter((e) => e.auf_feld?.split(',').includes(s.id));
      const spiele = new Set(
        [...eigene.filter((e) => e.spieler_id === s.id || e.assist_id === s.id), ...feld].map(
          (e) => e.spiel_id,
        ),
      ).size;
      const strafminuten = strafen
        .filter((x) => x.team === 'eigen' && x.spieler_id === s.id)
        .reduce((a, x) => a + x.minuten, 0);
      const d = schuesse.length
        ? Math.round((schuesse.reduce((a, e) => a + distanz(e.x, e.y), 0) / schuesse.length) * 10) / 10
        : null;
      return {
        spieler: s,
        ...w,
        assists,
        punkte: w.tore + assists,
        spiele,
        distanz: d,
        plusMinus: pm.get(s.id) ?? (feld.length ? 0 : null),
        strafminuten,
      };
    })
    .filter((s) => s.schuesse || s.assists || s.plusMinus !== null || s.strafminuten)
    .sort((a, b) => b.punkte - a.punkte || b.tore - a.tore || b.schuesse - a.schuesse);
}

export interface BlockWerte {
  /** Blocknummer, null für gemischte Aufstellungen */
  block: number | null;
  name: string;
  spieler: string[];
  ereignisse: number;
  schuesseFuer: number;
  schuesseGegen: number;
  /** Anteil der eigenen Abschlüsse an allen Abschlüssen, solange der Block auf dem Feld war */
  anteil: number | null;
  toreFuer: number;
  toreGegen: number;
  /** Tore gleicher Anzahl Spieler wie beim Plus Minus der Spieler */
  plusMinus: number;
  effizienz: number | null;
}

function blockWerte(block: number | null, name: string, liste: Ereignis[], spieler: string[]): BlockWerte {
  const fuer = liste.filter((e) => e.team === 'eigen');
  const gegen = liste.filter((e) => e.team === 'gegner');
  const toreFuer = fuer.filter((e) => e.typ === 'tor').length;
  let pm = 0;
  for (const e of liste) {
    if (e.typ !== 'tor' || e.situation === 'penalty') continue;
    if (e.team === 'eigen' && e.situation !== 'ueberzahl') pm++;
    if (e.team === 'gegner' && e.situation !== 'unterzahl') pm--;
  }
  return {
    block,
    name,
    spieler,
    ereignisse: liste.length,
    schuesseFuer: fuer.length,
    schuesseGegen: gegen.length,
    anteil: prozent(fuer.length, liste.length),
    toreFuer,
    toreGegen: gegen.filter((e) => e.typ === 'tor').length,
    plusMinus: pm,
    effizienz: prozent(toreFuer, fuer.length),
  };
}

/**
 * Werte pro Block: Ein Abschluss zählt für den Block, zu dem die Mehrheit der Spieler auf dem Feld gehört.
 * Dazu die häufigsten genauen Aufstellungen (mindestens drei Abschlüsse).
 */
export function nachBlock(liste: Ereignis[], spieler: Spieler[]) {
  const mitFeld = liste.filter((e) => e.auf_feld);
  const blockVon = new Map(spieler.map((s) => [s.id, s.block ?? null]));
  const name = new Map(spieler.map((s) => [s.id, s.nummer != null ? `${s.name} ${s.nummer}` : s.name]));
  const proBlock = new Map<number | null, Ereignis[]>();
  const proAufstellung = new Map<string, Ereignis[]>();
  for (const e of mitFeld) {
    const ids = (e.auf_feld ?? '').split(',').filter(Boolean);
    const zaehler = new Map<number, number>();
    for (const id of ids) {
      const b = blockVon.get(id);
      if (b != null) zaehler.set(b, (zaehler.get(b) ?? 0) + 1);
    }
    const [besterBlock, anzahl] = [...zaehler].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const block = anzahl * 2 > ids.length ? besterBlock : null;
    proBlock.set(block, [...(proBlock.get(block) ?? []), e]);
    const schluessel = [...ids].sort().join(',');
    proAufstellung.set(schluessel, [...(proAufstellung.get(schluessel) ?? []), e]);
  }
  const bloecke = [...proBlock]
    .sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99))
    .map(([b, l]) =>
      blockWerte(
        b,
        b == null ? 'Gemischt' : `Block ${b}`,
        l,
        b == null ? [] : spieler.filter((s) => s.block === b).map((s) => name.get(s.id) ?? s.name),
      ),
    );
  const aufstellungen = [...proAufstellung]
    .filter(([, l]) => l.length >= 3)
    .map(([k, l]) => {
      const ids = k.split(',');
      return blockWerte(
        null,
        ids.map((id) => name.get(id) ?? '?').join(', '),
        l,
        ids.map((id) => name.get(id) ?? '?'),
      );
    })
    .sort((a, b) => b.ereignisse - a.ereignisse)
    .slice(0, 6);
  return { bloecke, aufstellungen, ohneFeld: liste.length - mitFeld.length };
}

/** Resultat aus den erfassten Toren */
export function resultat(liste: Ereignis[]) {
  return {
    eigen: liste.filter((e) => e.team === 'eigen' && e.typ === 'tor').length,
    gegner: liste.filter((e) => e.team === 'gegner' && e.typ === 'tor').length,
  };
}

/** Gesamte Auswertung für eine Auswahl von Ereignissen */
export function auswerten(liste: Ereignis[], spieler: Spieler[], strafen: Strafe[] = []) {
  const eigen = liste.filter((e) => e.team === 'eigen');
  const gegner = liste.filter((e) => e.team === 'gegner');
  return {
    eigen: werte(eigen),
    gegner: werte(gegner),
    zonenEigen: nachZone(eigen),
    zonenGegner: nachZone(gegner),
    drittel: nachDrittel(liste),
    spieler: nachSpieler(liste, spieler, strafen),
    spezial: spezialteams(liste, strafen),
    bloecke: nachBlock(liste, spieler),
  };
}
