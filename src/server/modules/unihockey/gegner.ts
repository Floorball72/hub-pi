// Gegner Check: Form, Tore und Skorer des nächsten Gegners aus den öffentlichen Daten von swiss unihockey.
// Reine Funktionen, damit sie ohne Netz testbar sind.
import type { Spiel, SpielEreignisse, TabellenZeile } from '../../quellen/swissunihockey.ts';

export type Ausgang = 'S' | 'U' | 'N';

/** Name ohne Zusatz wie «II» oder «(Herren KF 2. Liga)», klein geschrieben, zum Vergleichen */
export function namensKern(n: string): string {
  return n
    .replace(/\s*\(.*\)$/, '')
    .replace(/\s+(I{1,3}|IV|V|VI{0,3})$/i, '')
    .trim()
    .toLowerCase();
}

/** Seite des Teams in einem Spiel: zuerst die Markierung der API, sonst über den Namen */
export function seiteVon(s: Spiel, team?: string): 'heim' | 'gast' | null {
  if (s.eigen) return s.eigen;
  if (!team) return null;
  if (s.heim === team) return 'heim';
  if (s.gast === team) return 'gast';
  const k = namensKern(team);
  if (namensKern(s.heim) === k) return 'heim';
  if (namensKern(s.gast) === k) return 'gast';
  return null;
}

export function gegnerVon(s: Spiel, team?: string): string | null {
  const seite = seiteVon(s, team);
  return seite === 'heim' ? s.gast : seite === 'gast' ? s.heim : null;
}

/** Tore aus Sicht einer Seite, null ohne gültiges Resultat */
export function tore(s: Spiel, seite: 'heim' | 'gast'): { fuer: number; gegen: number } | null {
  const m = s.resultat ? /^(\d+)\s*:\s*(\d+)/.exec(s.resultat) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const g = Number(m[2]);
  return seite === 'heim' ? { fuer: h, gegen: g } : { fuer: g, gegen: h };
}

export interface FormSpiel {
  id: string;
  zeit: string | null;
  gegner: string;
  resultat: string;
  zusatz: string | null;
  ausgang: Ausgang;
  heim: boolean;
}

/** Gespielte Spiele eines Teams, das Neueste zuerst */
export function gespielte(spiele: Spiel[], team?: string): FormSpiel[] {
  const liste: FormSpiel[] = [];
  for (const s of spiele) {
    const seite = seiteVon(s, team);
    const t = seite ? tore(s, seite) : null;
    if (!seite || !t) continue;
    liste.push({
      id: s.id,
      zeit: s.zeit,
      gegner: seite === 'heim' ? s.gast : s.heim,
      resultat: `${t.fuer}:${t.gegen}`,
      zusatz: s.zusatz,
      ausgang: t.fuer > t.gegen ? 'S' : t.fuer < t.gegen ? 'N' : 'U',
      heim: seite === 'heim',
    });
  }
  return liste.sort((a, b) => (b.zeit ?? '').localeCompare(a.zeit ?? ''));
}

export function bilanz(liste: FormSpiel[]) {
  const n = liste.length;
  let fuer = 0;
  let gegen = 0;
  for (const s of liste) {
    const [f, g] = s.resultat.split(':').map(Number);
    fuer += f;
    gegen += g;
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    spiele: n,
    siege: liste.filter((s) => s.ausgang === 'S').length,
    unentschieden: liste.filter((s) => s.ausgang === 'U').length,
    niederlagen: liste.filter((s) => s.ausgang === 'N').length,
    toreSchnitt: n ? r1(fuer / n) : null,
    gegentoreSchnitt: n ? r1(gegen / n) : null,
  };
}

/** Zeile des Gegners in der Rangliste */
export function ranglistenZeile(zeilen: TabellenZeile[], gegner: string): TabellenZeile | null {
  return (
    zeilen.find((z) => z.team === gegner) ??
    zeilen.find((z) => namensKern(z.team) === namensKern(gegner)) ??
    null
  );
}

export interface Skorer {
  name: string;
  tore: number;
  assists: number;
  punkte: number;
  strafminuten: number;
  spiele: number;
}

/** Skorer eines Teams aus den Ereignissen mehrerer Spiele. `seite` sagt pro Spiel, welche Seite das Team war. */
export function skorer(spiele: { ereignisse: SpielEreignisse; seite: 'heim' | 'gast' }[]): Skorer[] {
  const m = new Map<string, Skorer & { inSpiel: Set<number> }>();
  const hole = (name: string) => {
    let s = m.get(name);
    if (!s) {
      s = { name, tore: 0, assists: 0, punkte: 0, strafminuten: 0, spiele: 0, inSpiel: new Set() };
      m.set(name, s);
    }
    return s;
  };
  spiele.forEach(({ ereignisse, seite }, i) => {
    for (const e of ereignisse.ereignisse) {
      if (e.seite !== seite) continue;
      if (e.typ === 'tor' && e.spieler) {
        const s = hole(e.spieler);
        s.tore++;
        s.inSpiel.add(i);
        if (e.assist) {
          const a = hole(e.assist);
          a.assists++;
          a.inSpiel.add(i);
        }
      }
      if (e.typ === 'strafe' && e.spieler && e.minuten) {
        const s = hole(e.spieler);
        s.strafminuten += e.minuten;
        s.inSpiel.add(i);
      }
    }
  });
  return [...m.values()]
    .map(({ inSpiel, ...s }) => ({ ...s, punkte: s.tore + s.assists, spiele: inSpiel.size }))
    .sort((a, b) => b.punkte - a.punkte || b.tore - a.tore || a.name.localeCompare(b.name));
}
