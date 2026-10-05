// Spielvorbereitung: Stärken und Schwächen des eigenen Teams aus den erfassten Spielen der Saison.
import type { auswerten } from './auswertung.ts';
import type { saisonverlauf } from './verlauf.ts';

export interface Punkt {
  text: string;
  detail: string;
}

const mitVorzeichen = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const ZONE_TEXT: Record<string, string> = {
  Torraum: 'aus dem Torraum',
  Slot: 'aus dem Slot',
  Seite: 'von der Seite',
  Distanz: 'aus der Distanz',
};

/**
 * Stärken und Schwächen nach einfachen, nachvollziehbaren Regeln. Erst ab zwei erfassten Spielen,
 * und nur Werte mit genug Abschlüssen, damit ein einzelnes Spiel nichts verzerrt.
 */
export function einschaetzung(
  a: ReturnType<typeof auswerten>,
  v: ReturnType<typeof saisonverlauf>,
): { staerken: Punkt[]; schwaechen: Punkt[] } {
  const staerken: Punkt[] = [];
  const schwaechen: Punkt[] = [];
  if (v.bilanz.spiele < 2) return { staerken, schwaechen };

  // Drittel nach Tordifferenz
  const drittel = v.drittel.filter((d) => d.drittel <= 3).map((d) => ({ ...d, diff: d.tore - d.gegentore }));
  const bestes = [...drittel].sort((x, y) => y.diff - x.diff)[0];
  const schlechtestes = [...drittel].sort((x, y) => x.diff - y.diff)[0];
  if (bestes && bestes.diff > 0)
    staerken.push({
      text: `Stark im ${bestes.drittel}. Drittel`,
      detail: `${bestes.tore}:${bestes.gegentore} Tore (${mitVorzeichen(bestes.diff)})`,
    });
  if (schlechtestes && schlechtestes.diff < 0)
    schwaechen.push({
      text: `Schwach im ${schlechtestes.drittel}. Drittel`,
      detail: `${schlechtestes.tore}:${schlechtestes.gegentore} Tore (${mitVorzeichen(schlechtestes.diff)})`,
    });

  // Spezialteams, erst ab vier Situationen
  const uz = v.ueberzahl;
  if (uz.chancen >= 4 && uz.quote !== null) {
    const p = { text: 'Überzahl', detail: `${uz.tore} von ${uz.chancen} genutzt (${uz.quote} %)` };
    if (uz.quote >= 25) staerken.push({ ...p, text: 'Starkes Powerplay' });
    else if (uz.quote < 15) schwaechen.push({ ...p, text: 'Powerplay bringt wenig' });
  }
  const bz = v.unterzahl;
  if (bz.chancen >= 4 && bz.quote !== null) {
    const p = {
      text: 'Unterzahl',
      detail: `${bz.gegentore} Gegentore in ${bz.chancen} Unterzahlen (${bz.quote} % überstanden)`,
    };
    if (bz.quote >= 85) staerken.push({ ...p, text: 'Sicheres Boxplay' });
    else if (bz.quote < 75) schwaechen.push({ ...p, text: 'Boxplay anfällig' });
  }

  // Spielanteile und Chancenverwertung
  const alle = a.eigen.schuesse + a.gegner.schuesse;
  if (alle >= 40) {
    const anteil = Math.round((a.eigen.schuesse / alle) * 100);
    const detail = `${a.eigen.schuesse}:${a.gegner.schuesse} Abschlüsse (${anteil} %)`;
    if (anteil >= 55) staerken.push({ text: 'Mehr vom Spiel', detail });
    else if (anteil <= 45) schwaechen.push({ text: 'Gegner kommt öfter zum Abschluss', detail });
  }
  if (a.eigen.effizienz !== null && a.gegner.effizienz !== null && a.eigen.schuesse >= 20) {
    const diff = a.eigen.effizienz - a.gegner.effizienz;
    const detail = `${a.eigen.effizienz} % eigene Effizienz, Gegner ${a.gegner.effizienz} %`;
    if (diff >= 3) staerken.push({ text: 'Gute Chancenverwertung', detail });
    else if (diff <= -3) schwaechen.push({ text: 'Chancenverwertung', detail });
  }

  // Zonen: wo wir treffen, woher die Gegentore kommen
  const besteZone = a.zonenEigen
    .filter((z) => z.schuesse >= 10 && z.effizienz !== null)
    .sort((x, y) => (y.effizienz ?? 0) - (x.effizienz ?? 0))[0];
  if (besteZone?.tore)
    staerken.push({
      text: `Gefährlich ${ZONE_TEXT[besteZone.zone]}`,
      detail: `${besteZone.tore} Tore aus ${besteZone.schuesse} Abschlüssen (${besteZone.effizienz} %)`,
    });
  const gegentore = a.zonenGegner.reduce((s, z) => s + z.tore, 0);
  const gefaehrlich = [...a.zonenGegner].sort((x, y) => y.tore - x.tore)[0];
  if (gefaehrlich && gegentore >= 4 && gefaehrlich.tore / gegentore >= 0.4)
    schwaechen.push({
      text: `Gegentore vor allem ${ZONE_TEXT[gefaehrlich.zone]}`,
      detail: `${gefaehrlich.tore} von ${gegentore} Gegentoren`,
    });

  // Blöcke nach Plus Minus
  const bloecke = a.bloecke.bloecke.filter((b) => b.block !== null && b.ereignisse >= 15);
  if (bloecke.length >= 2) {
    const sortiert = [...bloecke].sort((x, y) => y.plusMinus - x.plusMinus);
    const oben = sortiert[0];
    const unten = sortiert[sortiert.length - 1];
    if (oben.plusMinus > unten.plusMinus) {
      if (oben.plusMinus >= 0)
        staerken.push({
          text: `${oben.name} am stärksten`,
          detail: `Plus Minus ${mitVorzeichen(oben.plusMinus)}, Tore ${oben.toreFuer}:${oben.toreGegen}`,
        });
      if (unten.plusMinus < 0)
        schwaechen.push({
          text: `${unten.name} kassiert am meisten`,
          detail: `Plus Minus ${mitVorzeichen(unten.plusMinus)}, Tore ${unten.toreFuer}:${unten.toreGegen}`,
        });
    }
  }

  // Skorer und Form
  const top = [...a.spieler].filter((s) => s.punkte > 0).sort((x, y) => y.punkte - x.punkte)[0];
  if (top)
    staerken.push({
      text: `Topskorer ${top.spieler.name}${top.spieler.nummer != null ? ` ${top.spieler.nummer}` : ''}`,
      detail: `${top.tore} Tore, ${top.assists} Assists in ${top.spiele} Spielen`,
    });
  const letzte = v.spiele.at(-1)?.ausgang;
  if (v.serie && letzte === 'S') staerken.push({ text: 'In Form', detail: v.serie });
  if (v.serie && letzte === 'N') schwaechen.push({ text: 'Negativlauf', detail: v.serie });

  return { staerken, schwaechen };
}

/** Gleiche Gegner trotz Zusätzen wie «UHC», «II» oder «(Damen)» erkennen */
export function gleicherGegner(a: string, b: string): boolean {
  const kern = (n: string) =>
    n
      .replace(/\s*\(.*\)$/, '')
      .replace(/\s+(I{1,3}|IV|V|VI{0,3})$/i, '')
      .replace(/^(uhc|uh|fbc|ufc|sv|unihockey|floorball)\s+/i, '')
      .trim()
      .toLowerCase();
  const x = kern(a);
  const y = kern(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}
