// Adapter für Sportdaten: TheSportsDB (freier Schlüssel 123 oder eigener) und OpenLigaDB (Community Daten).
import { httpJson } from '../../quellen/http.ts';

export interface Spiel {
  id: string;
  zeit: string | null;
  heim: string;
  gast: string;
  toreHeim: number | null;
  toreGast: number | null;
  beendet: boolean;
  wettbewerb: string | null;
  ort: string | null;
}
export interface TabellenZeile {
  rang: number;
  team: string;
  spiele: number | null;
  punkte: number | null;
  tore: string | null;
  eigenes: boolean;
}
export interface TeamDaten {
  spiele: Spiel[];
  tabelle: TabellenZeile[];
  hinweis: string | null;
}

/** Fussballsaison im Format 2026-2027 (Wechsel im Juli) */
export function saisonTsdb(jetzt: Date): string {
  const j = jetzt.getUTCFullYear();
  return jetzt.getUTCMonth() >= 6 ? `${j}-${j + 1}` : `${j - 1}-${j}`;
}

const zahl = (x: unknown) =>
  x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null;

interface TsdbEvent {
  idEvent?: string;
  strTimestamp?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strHomeTeam?: string;
  strAwayTeam?: string;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  strStatus?: string | null;
  strLeague?: string | null;
  strVenue?: string | null;
}

export function tsdbSpiel(e: TsdbEvent): Spiel {
  // strTimestamp ist UTC ohne Zeitzone
  const ts = e.strTimestamp ?? (e.dateEvent && e.strTime ? `${e.dateEvent}T${e.strTime}` : null);
  const beendet =
    /^(FT|AET|PEN|Match Finished)$/i.test(e.strStatus ?? '') ||
    (zahl(e.intHomeScore) !== null &&
      zahl(e.intAwayScore) !== null &&
      !/^(NS|TBD|1H|2H|HT|LIVE)$/i.test(e.strStatus ?? ''));
  return {
    id: `tsdb-${e.idEvent}`,
    zeit: ts ? new Date(/Z|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`).toISOString() : null,
    heim: e.strHomeTeam ?? '?',
    gast: e.strAwayTeam ?? '?',
    toreHeim: zahl(e.intHomeScore),
    toreGast: zahl(e.intAwayScore),
    beendet,
    wettbewerb: e.strLeague ?? null,
    ort: e.strVenue ?? null,
  };
}

export function tsdbTabelle(j: { table?: Record<string, string>[] | null }, teamId: string): TabellenZeile[] {
  return (j.table ?? []).map((z) => ({
    rang: Number(z.intRank),
    team: z.strTeam,
    spiele: zahl(z.intPlayed),
    punkte: zahl(z.intPoints),
    tore: z.intGoalsFor !== undefined ? `${z.intGoalsFor}:${z.intGoalsAgainst}` : null,
    eigenes: z.idTeam === teamId,
  }));
}

export async function tsdbHolen(
  schluessel: string,
  teamId: string,
  ligaId: string | null,
  jetzt: Date,
): Promise<TeamDaten> {
  if (!/^\d+$/.test(teamId)) throw new Error('TheSportsDB Team ID ist eine Zahl');
  const basis = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(schluessel)}`;
  const [naechste, letzte] = await Promise.all([
    httpJson<{ events?: TsdbEvent[] | null }>(`${basis}/eventsnext.php?id=${teamId}`, {
      timeoutMs: 15000,
      abstandMs: 2000,
    }),
    httpJson<{ results?: TsdbEvent[] | null }>(`${basis}/eventslast.php?id=${teamId}`, {
      timeoutMs: 15000,
      abstandMs: 2000,
    }),
  ]);
  let tabelle: TabellenZeile[] = [];
  if (ligaId && /^\d+$/.test(ligaId)) {
    const t = await httpJson<{ table?: Record<string, string>[] | null }>(
      `${basis}/lookuptable.php?l=${ligaId}&s=${saisonTsdb(jetzt)}`,
      { timeoutMs: 15000, abstandMs: 2000 },
    ).catch(() => ({ table: [] }));
    tabelle = tsdbTabelle(t, teamId);
  }
  const spiele = [...(letzte.results ?? []), ...(naechste.events ?? [])].map(tsdbSpiel);
  return {
    spiele: spiele.sort((a, b) => (a.zeit ?? '').localeCompare(b.zeit ?? '')),
    tabelle,
    hinweis:
      schluessel === '123'
        ? 'Freier TheSportsDB Schlüssel: nur das letzte und das nächste Spiel, Tabelle nur die ersten 5. Mit eigenem Schlüssel (THESPORTSDB_KEY) mehr.'
        : null,
  };
}

interface OldbSpiel {
  matchID: number;
  matchDateTimeUTC?: string;
  team1?: { teamName?: string; teamId?: number };
  team2?: { teamName?: string; teamId?: number };
  matchIsFinished?: boolean;
  matchResults?: { resultTypeID?: number; pointsTeam1?: number; pointsTeam2?: number }[];
  group?: { groupName?: string };
  location?: { locationCity?: string; locationStadium?: string } | null;
}

export function oldbSpiele(liste: OldbSpiel[], teamName: string): Spiel[] {
  const n = teamName.toLowerCase();
  return liste
    .filter(
      (m) =>
        (m.team1?.teamName ?? '').toLowerCase().includes(n) ||
        (m.team2?.teamName ?? '').toLowerCase().includes(n),
    )
    .map((m) => {
      const end = (m.matchResults ?? []).find((r) => r.resultTypeID === 2) ?? null;
      return {
        id: `oldb-${m.matchID}`,
        zeit: m.matchDateTimeUTC ? new Date(m.matchDateTimeUTC).toISOString() : null,
        heim: m.team1?.teamName ?? '?',
        gast: m.team2?.teamName ?? '?',
        toreHeim: end?.pointsTeam1 ?? null,
        toreGast: end?.pointsTeam2 ?? null,
        beendet: !!m.matchIsFinished && !!end,
        wettbewerb: m.group?.groupName ?? null,
        ort: m.location?.locationStadium ?? null,
      };
    })
    .sort((a, b) => (a.zeit ?? '').localeCompare(b.zeit ?? ''));
}

export async function oldbHolen(liga: string, saison: string, teamName: string): Promise<TeamDaten> {
  if (!/^[a-z0-9]+$/i.test(liga) || !/^\d{4}$/.test(saison))
    throw new Error('OpenLigaDB: Liga Kürzel und Saisonjahr nötig');
  const [spiele, tabelle] = await Promise.all([
    httpJson<OldbSpiel[]>(`https://api.openligadb.de/getmatchdata/${liga}/${saison}`, {
      timeoutMs: 20000,
      abstandMs: 1000,
    }),
    httpJson<{ teamName: string; points: number; matches: number; goals: number; opponentGoals: number }[]>(
      `https://api.openligadb.de/getbltable/${liga}/${saison}`,
      { timeoutMs: 20000, abstandMs: 1000 },
    ).catch(() => []),
  ]);
  const n = teamName.toLowerCase();
  const s = oldbSpiele(spiele, teamName);
  return {
    spiele: s,
    tabelle: tabelle.map((z, i) => ({
      rang: i + 1,
      team: z.teamName,
      spiele: z.matches,
      punkte: z.points,
      tore: `${z.goals}:${z.opponentGoals}`,
      eigenes: z.teamName.toLowerCase().includes(n),
    })),
    hinweis: s.length
      ? 'OpenLigaDB wird von der Community gepflegt. Resultate können fehlen oder verspätet sein.'
      : 'OpenLigaDB hat für diese Liga und Saison keine Spiele dieses Teams.',
  };
}
