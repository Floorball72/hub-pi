// Auswertung der selbst erfassten Abschlüsse. Reine Funktionen ohne Datenzugriff, damit testbar.
//
// Koordinaten: halbes Spielfeld, 20 m breit und 20 m tief. x von 0 (links) bis 1 (rechts),
// y von 0 (Bande hinter dem Tor) bis 1 (Mittellinie). Das Tor steht 3.5 m vor der Bande.

export const FELD_BREITE_M = 20;
export const FELD_TIEFE_M = 20;
export const TOR_ABSTAND_M = 3.5;

export const TYPEN = ['tor', 'gehalten', 'daneben', 'geblockt'] as const;
export type Typ = (typeof TYPEN)[number];
export const SEITEN = ['eigen', 'gegner'] as const;
export type Seite = (typeof SEITEN)[number];
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
}

export interface Spieler {
  id: string;
  nummer: number | null;
  name: string;
  position: string | null;
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

export function nachSpieler(liste: Ereignis[], spieler: Spieler[]): SpielerWerte[] {
  const eigene = liste.filter((e) => e.team === 'eigen');
  return spieler
    .map((s) => {
      const schuesse = eigene.filter((e) => e.spieler_id === s.id);
      const assists = eigene.filter((e) => e.typ === 'tor' && e.assist_id === s.id).length;
      const w = werte(schuesse);
      const spiele = new Set(
        eigene.filter((e) => e.spieler_id === s.id || e.assist_id === s.id).map((e) => e.spiel_id),
      ).size;
      const d = schuesse.length
        ? Math.round((schuesse.reduce((a, e) => a + distanz(e.x, e.y), 0) / schuesse.length) * 10) / 10
        : null;
      return { spieler: s, ...w, assists, punkte: w.tore + assists, spiele, distanz: d };
    })
    .filter((s) => s.schuesse || s.assists)
    .sort((a, b) => b.punkte - a.punkte || b.tore - a.tore || b.schuesse - a.schuesse);
}

/** Resultat aus den erfassten Toren */
export function resultat(liste: Ereignis[]) {
  return {
    eigen: liste.filter((e) => e.team === 'eigen' && e.typ === 'tor').length,
    gegner: liste.filter((e) => e.team === 'gegner' && e.typ === 'tor').length,
  };
}

/** Gesamte Auswertung für eine Auswahl von Ereignissen */
export function auswerten(liste: Ereignis[], spieler: Spieler[]) {
  const eigen = liste.filter((e) => e.team === 'eigen');
  const gegner = liste.filter((e) => e.team === 'gegner');
  return {
    eigen: werte(eigen),
    gegner: werte(gegner),
    zonenEigen: nachZone(eigen),
    zonenGegner: nachZone(gegner),
    drittel: nachDrittel(liste),
    spieler: nachSpieler(liste, spieler),
  };
}
