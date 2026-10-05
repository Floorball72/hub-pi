// Saisonverlauf eines Teams aus den selbst erfassten Spielen: Formkurve, Tore pro Drittel, Spezialteams.
import type { Strafe } from '../../geteilt/unihockey.ts';
import { type Ereignis, resultat, spezialteams } from './auswertung.ts';

export interface VerlaufSpiel {
  id: string;
  datum: string;
  gegner: string;
  tore: number;
  gegentore: number;
  ausgang: 'S' | 'U' | 'N';
  /** Entschieden in der Verlängerung (Ereignisse im 4. Drittel) */
  verlaengerung: boolean;
  punkte: number;
  punkteSumme: number;
  schuesse: number;
  schuesseGegen: number;
  ueberzahl: { tore: number; chancen: number };
  unterzahl: { gegentore: number; chancen: number };
  /** Quoten über alle Spiele bis und mit diesem */
  ueberzahlQuote: number | null;
  unterzahlQuote: number | null;
}

const prozent = (teil: number, ganz: number) => (ganz ? Math.round((teil / ganz) * 1000) / 10 : null);

/** Punkte wie in der Meisterschaft: Sieg 3, Sieg nach Verlängerung 2, Niederlage nach Verlängerung 1 */
function punkteVon(ausgang: 'S' | 'U' | 'N', verlaengerung: boolean): number {
  if (ausgang === 'U') return 1;
  if (ausgang === 'S') return verlaengerung ? 2 : 3;
  return verlaengerung ? 1 : 0;
}

/** Laufende Serie am Ende der Liste, etwa «3 Siege in Folge» */
function serie(spiele: VerlaufSpiel[]): string | null {
  const letzter = spiele.at(-1)?.ausgang;
  if (!letzter) return null;
  let n = 0;
  for (let i = spiele.length - 1; i >= 0 && spiele[i].ausgang === letzter; i--) n++;
  if (n < 2) return null;
  const name = { S: 'Siege', U: 'Unentschieden', N: 'Niederlagen' }[letzter];
  return `${n} ${name} in Folge`;
}

/**
 * Verlauf über die Spiele einer Saison. Spiele ohne erfasste Abschlüsse fallen weg,
 * weil sie nichts über die Leistung sagen.
 */
export function saisonverlauf(
  spiele: { id: string; datum: string; gegner: string }[],
  ereignisse: Ereignis[],
  strafen: Strafe[],
) {
  const reihe: VerlaufSpiel[] = [];
  let summe = 0;
  const kumuliert = { uzTore: 0, uzChancen: 0, bzGegentore: 0, bzChancen: 0 };
  const drittel = new Map<number, { tore: number; gegentore: number }>();
  for (const s of [...spiele].sort((a, b) => a.datum.localeCompare(b.datum))) {
    const liste = ereignisse.filter((e) => e.spiel_id === s.id);
    if (!liste.length) continue;
    const r = resultat(liste);
    const sp = spezialteams(
      liste,
      strafen.filter((x) => x.spiel_id === s.id),
    );
    const verlaengerung = liste.some((e) => e.typ === 'tor' && (e.drittel ?? 0) >= 4);
    const ausgang = r.eigen > r.gegner ? 'S' : r.eigen < r.gegner ? 'N' : 'U';
    const punkte = punkteVon(ausgang, verlaengerung);
    summe += punkte;
    kumuliert.uzTore += sp.ueberzahl.tore;
    kumuliert.uzChancen += sp.ueberzahl.chancen;
    kumuliert.bzGegentore += sp.unterzahl.gegentore;
    kumuliert.bzChancen += sp.unterzahl.chancen;
    for (const e of liste) {
      if (e.typ !== 'tor' || !e.drittel) continue;
      const d = drittel.get(e.drittel) ?? { tore: 0, gegentore: 0 };
      if (e.team === 'eigen') d.tore++;
      else d.gegentore++;
      drittel.set(e.drittel, d);
    }
    reihe.push({
      id: s.id,
      datum: s.datum,
      gegner: s.gegner,
      tore: r.eigen,
      gegentore: r.gegner,
      ausgang,
      verlaengerung,
      punkte,
      punkteSumme: summe,
      schuesse: liste.filter((e) => e.team === 'eigen').length,
      schuesseGegen: liste.filter((e) => e.team === 'gegner').length,
      ueberzahl: { tore: sp.ueberzahl.tore, chancen: sp.ueberzahl.chancen },
      unterzahl: { gegentore: sp.unterzahl.gegentore, chancen: sp.unterzahl.chancen },
      ueberzahlQuote: prozent(kumuliert.uzTore, kumuliert.uzChancen),
      unterzahlQuote: kumuliert.bzChancen
        ? Math.round((1 - kumuliert.bzGegentore / kumuliert.bzChancen) * 1000) / 10
        : null,
    });
  }
  const zaehle = (a: 'S' | 'U' | 'N') => reihe.filter((s) => s.ausgang === a).length;
  const tore = reihe.reduce((a, s) => a + s.tore, 0);
  const gegentore = reihe.reduce((a, s) => a + s.gegentore, 0);
  const letzte = reihe.at(-1);
  return {
    spiele: reihe,
    bilanz: {
      spiele: reihe.length,
      siege: zaehle('S'),
      unentschieden: zaehle('U'),
      niederlagen: zaehle('N'),
      punkte: summe,
      punkteProSpiel: reihe.length ? Math.round((summe / reihe.length) * 100) / 100 : null,
      tore,
      gegentore,
    },
    form: reihe.slice(-5).map((s) => s.ausgang),
    serie: serie(reihe),
    drittel: [...drittel].sort((a, b) => a[0] - b[0]).map(([d, w]) => ({ drittel: d, ...w })),
    ueberzahl: {
      tore: kumuliert.uzTore,
      chancen: kumuliert.uzChancen,
      quote: letzte?.ueberzahlQuote ?? null,
    },
    unterzahl: {
      gegentore: kumuliert.bzGegentore,
      chancen: kumuliert.bzChancen,
      quote: letzte?.unterzahlQuote ?? null,
    },
  };
}
