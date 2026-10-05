// Demo Daten für die Unihockey Analyse: erfundene Spieler und Spiele mit plausibel verteilten Abschlüssen.
import { type Typ, zone } from './auswertung.ts';

/** Kleiner Zufallsgenerator mit Startwert, damit die Demo immer gleich aussieht */
function zufall(start: number) {
  let s = start;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export const DEMO_SPIELER = [
  { nummer: 7, name: 'Nico', position: 'Sturm', block: 1 },
  { nummer: 10, name: 'Lars', position: 'Center', block: 1 },
  { nummer: 14, name: 'Timo', position: 'Sturm', block: 1 },
  { nummer: 19, name: 'Fabio', position: 'Sturm', block: 2 },
  { nummer: 22, name: 'Remo', position: 'Verteidigung', block: 1 },
  { nummer: 4, name: 'Sven', position: 'Verteidigung', block: 1 },
  { nummer: 33, name: 'Jan', position: 'Torhüter' },
  { nummer: 8, name: 'Mike', position: 'Sturm', block: 2 },
  { nummer: 11, name: 'Luca', position: 'Center', block: 2 },
  { nummer: 25, name: 'Pascal', position: 'Verteidigung', block: 2 },
  { nummer: 3, name: 'Silvan', position: 'Verteidigung', block: 2 },
];

/** Blöcke als Index in DEMO_SPIELER */
const BLOCK = [
  [0, 1, 2, 4, 5],
  [3, 7, 8, 9, 10],
];

export const DEMO_SPIELE = [
  { tage: 28, gegner: 'UHC Demo Wil', ort: 'heim' },
  { tage: 21, gegner: 'Unihockey Beispiel Gossau', ort: 'auswaerts' },
  { tage: 14, gegner: 'Floorball Muster Uzwil', ort: 'heim' },
  { tage: 7, gegner: 'UHC Test Flawil', ort: 'auswaerts' },
];

const TORCHANCE: Record<string, number> = { Torraum: 0.22, Slot: 0.15, Seite: 0.06, Distanz: 0.04 };

/** Abschlüsse für ein Spiel. Spieler ids in der Reihenfolge von DEMO_SPIELER. */
export function demoEreignisse(spielId: string, spielerIds: string[], start: number) {
  const r = zufall(start);
  const feldspieler = [...spielerIds.slice(0, 6), ...spielerIds.slice(7, 11)];
  const bloecke = BLOCK.map((b) => b.map((i) => spielerIds[i]));
  // Stürmer schiessen öfter als Verteidiger
  const gewicht = [5, 4, 4, 3, 2, 2, 3, 3, 1, 1];
  const summe = gewicht.reduce((a, b) => a + b, 0);
  const schuetze = () => {
    let z = r() * summe;
    for (let i = 0; i < gewicht.length; i++) {
      z -= gewicht[i];
      if (z <= 0) return feldspieler[i];
    }
    return feldspieler[0];
  };
  const liste: Record<string, unknown>[] = [];
  for (const team of ['eigen', 'gegner'] as const) {
    const anzahl = team === 'eigen' ? 24 + Math.floor(r() * 12) : 18 + Math.floor(r() * 10);
    for (let i = 0; i < anzahl; i++) {
      // Mehr Abschlüsse nahe am Tor und zentral
      const x = Math.min(0.97, Math.max(0.03, 0.5 + (r() - 0.5) * (0.4 + r() * 0.5)));
      const y = Math.min(0.95, Math.max(0.08, 0.1 + ((r() + r()) / 2) ** 1.8 * 1.0));
      const z = zone(x, y);
      let typ: Typ;
      if (r() < TORCHANCE[z]) typ = 'tor';
      else {
        const t = r();
        typ = t < 0.45 ? 'gehalten' : t < 0.75 ? 'daneben' : 'geblockt';
      }
      const drittel = 1 + Math.floor(r() * 3);
      const spieler = team === 'eigen' ? schuetze() : null;
      const block = spieler
        ? (bloecke.find((b) => b.includes(spieler)) ?? bloecke[0])
        : bloecke[r() < 0.55 ? 0 : 1];
      let assist: string | null = null;
      if (team === 'eigen' && typ === 'tor' && r() < 0.7) {
        const andere = block.filter((id) => id !== spieler);
        assist = andere[Math.floor(r() * andere.length)];
      }
      const minute = (drittel - 1) * 20 + Math.floor(r() * 20);
      liste.push({
        spiel_id: spielId,
        typ,
        team,
        x: Math.round(x * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        spieler_id: spieler,
        assist_id: assist,
        drittel,
        minute,
        zeit_sek: minute * 60 + Math.floor(r() * 60),
        situation: r() < 0.12 ? (team === 'eigen' ? 'ueberzahl' : 'unterzahl') : 'gleich',
        auf_feld: block.join(','),
      });
    }
  }
  return liste;
}

/** Strafen für ein Spiel: je Team zwei bis vier, meist 2 Minuten */
export function demoStrafen(spielId: string, spielerIds: string[], start: number) {
  const r = zufall(start * 31);
  const feldspieler = [...spielerIds.slice(0, 6), ...spielerIds.slice(7, 11)];
  const liste: Record<string, unknown>[] = [];
  for (const team of ['eigen', 'gegner'] as const) {
    const anzahl = 2 + Math.floor(r() * 3);
    for (let i = 0; i < anzahl; i++) {
      const sek = Math.floor(r() * 3600);
      liste.push({
        spiel_id: spielId,
        team,
        spieler_id: team === 'eigen' ? feldspieler[Math.floor(r() * feldspieler.length)] : null,
        minuten: r() < 0.9 ? 2 : r() < 0.5 ? 5 : 10,
        drittel: 1 + Math.floor(sek / 1200),
        minute: Math.floor(sek / 60),
        zeit_sek: sek,
      });
    }
  }
  return liste;
}
