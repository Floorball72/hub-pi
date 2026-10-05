// Unihockey Regeln, die Server und Oberfläche gemeinsam brauchen (Live Erfassung der Analyse).

export const SEITEN = ['eigen', 'gegner'] as const;
export type Seite = (typeof SEITEN)[number];

export interface Strafe {
  id: string;
  spiel_id: string;
  team: Seite;
  spieler_id: string | null;
  minuten: number;
  /** Spielzeit in Sekunden ab Spielbeginn */
  zeit_sek: number | null;
  /** Vorzeitiges Ende durch ein Tor in Überzahl */
  ende_sek: number | null;
}

/** Strafen, die das Kräfteverhältnis ändern. 10 Minuten sind persönlich, das Team spielt voll weiter. */
export const zaehlt = (s: Strafe) => s.minuten === 2 || s.minuten === 5;

/** Laufende Strafen zu einer Spielzeit in Sekunden */
export function laufendeStrafen(strafen: Strafe[], sek: number): Strafe[] {
  return strafen.filter((s) => {
    if (!zaehlt(s) || s.zeit_sek == null || sek < s.zeit_sek) return false;
    const ende = s.ende_sek ?? s.zeit_sek + s.minuten * 60;
    return sek < ende;
  });
}

/** Spielsituation aus Sicht des eigenen Teams. Höchstens zwei Spieler weniger (Mindestens drei Feldspieler). */
export function situationAus(strafen: Strafe[], sek: number): 'gleich' | 'ueberzahl' | 'unterzahl' {
  const l = laufendeStrafen(strafen, sek);
  const eigen = Math.min(2, l.filter((s) => s.team === 'eigen').length);
  const gegner = Math.min(2, l.filter((s) => s.team === 'gegner').length);
  return eigen === gegner ? 'gleich' : eigen < gegner ? 'ueberzahl' : 'unterzahl';
}

/**
 * Welche Strafe endet durch ein Tor: Trifft das Team in Überzahl, endet die älteste laufende
 * kleine Strafe (2 Minuten) des anderen Teams. 5 Minuten Strafen laufen weiter.
 */
export function strafeEndetDurchTor(strafen: Strafe[], torTeam: Seite, sek: number): Strafe | null {
  const l = laufendeStrafen(strafen, sek);
  const andere = l.filter((s) => s.team !== torTeam);
  if (andere.length <= l.filter((s) => s.team === torTeam).length) return null;
  return (
    andere.filter((s) => s.minuten === 2).sort((a, b) => (a.zeit_sek ?? 0) - (b.zeit_sek ?? 0))[0] ?? null
  );
}
