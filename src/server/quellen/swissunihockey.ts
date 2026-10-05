// swiss unihockey Daten. Hinter einem Interface, damit die angekündigte API Umstellung (v2 auf v3)
// nur einen neuen Adapter braucht. Umgesetzt ist die öffentliche Tabellen API v2 (api-v2.swissunihockey.ch).
import { vonLokal } from '../kern/zeit.ts';
import { httpJson } from './http.ts';

export const SUH_NAMENSNENNUNG = 'Daten: swiss unihockey';

export interface Spiel {
  id: string;
  /** Anspielzeit als ISO, null wenn unbekannt */
  zeit: string | null;
  datumText: string;
  zeitText: string;
  heim: string;
  gast: string;
  resultat: string | null;
  zusatz: string | null;
  ort: string | null;
  lat: number | null;
  lon: number | null;
  /** Status Text der API, z.B. «Spiel beendet» oder die Anspielzeit */
  status: string | null;
  beendet: boolean;
  liga: string | null;
  /** Welche Seite das abgefragte Team ist (nur im Spielplan eines Teams) */
  eigen?: 'heim' | 'gast' | null;
}

export interface TabellenZeile {
  rang: number;
  team: string;
  spiele: number | null;
  punkte: number | null;
  tore: string | null;
  hervorgehoben: boolean;
  teamId?: string | null;
}

export interface SpielEreignis {
  /** Spielzeit «39:42» */
  zeit: string;
  typ: 'tor' | 'strafe' | 'penalty' | 'anderes';
  text: string;
  seite: 'heim' | 'gast' | null;
  spieler: string | null;
  assist: string | null;
  /** Strafminuten bei Strafen */
  minuten: number | null;
}

export interface SpielEreignisse {
  heim: string;
  gast: string;
  ereignisse: SpielEreignis[];
}

export interface Rangliste {
  titel: string;
  zeilen: TabellenZeile[];
}

export interface SuhAdapter {
  name: string;
  teamSpiele(teamId: string, saison: number): Promise<{ titel: string; spiele: Spiel[] }>;
  rangliste(teamId: string, saison: number): Promise<Rangliste>;
  spieleAmTag(datum: string): Promise<Spiel[]>;
  spielEreignisse(spielId: string): Promise<SpielEreignisse>;
}

// Tabellen API v2

interface Zelle {
  text?: string[];
  highlight?: boolean;
  link?: { type?: string; ids?: number[]; x?: number; y?: number };
}
interface Zeile {
  id?: number;
  highlight?: boolean;
  link?: { ids?: number[] };
  cells: Zelle[];
  data?: { rank?: number; team?: { name?: string; id?: number } };
}
interface Tabelle {
  data: {
    title?: string;
    headers: { text: string; key?: string }[];
    tabs?: { text?: string | string[] }[];
    regions: { text?: string | null; rows: Zeile[] }[];
  };
}

function spalte(t: Tabelle, ...namen: string[]): number {
  return t.data.headers.findIndex((h) => namen.includes(h.text));
}

const text = (z: Zelle | undefined, i = 0) => z?.text?.[i]?.trim() || null;

/** «10.10.2026» und «16:00» in Schweizer Zeit zu ISO */
export function suhZeit(datum: string | null, zeit: string | null): string | null {
  const d = datum ? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(datum) : null;
  const z = zeit ? /^(\d{1,2}):(\d{2})$/.exec(zeit) : null;
  if (!d) return null;
  return vonLokal(
    Number(d[3]),
    Number(d[2]),
    Number(d[1]),
    z ? Number(z[1]) : 0,
    z ? Number(z[2]) : 0,
  ).toISOString();
}

export function teamSpieleParsen(t: Tabelle): { titel: string; spiele: Spiel[] } {
  const iZeit = spalte(t, 'Datum / Zeit');
  const iOrt = spalte(t, 'Ort');
  const iHeim = spalte(t, 'Heimteam', 'Heim');
  const iGast = spalte(t, 'Gastteam', 'Gast');
  const iRes = spalte(t, 'Resultat');
  const spiele = t.data.regions.flatMap((r) =>
    r.rows.map((z) => {
      const datumText = text(z.cells[iZeit], 0) ?? '';
      const zeitText = text(z.cells[iZeit], 1) ?? '';
      const resultat = text(z.cells[iRes], 0);
      const ortLink = z.cells[iOrt]?.link;
      return {
        id: String(z.link?.ids?.[0] ?? z.id ?? ''),
        zeit: suhZeit(datumText, zeitText),
        datumText,
        zeitText,
        heim: text(z.cells[iHeim]) ?? '',
        gast: text(z.cells[iGast]) ?? '',
        resultat,
        zusatz: text(z.cells[iRes], 1),
        ort: [text(z.cells[iOrt], 0), text(z.cells[iOrt], 1)].filter(Boolean).join(', ') || null,
        // Kartenlink: x ist die Länge, y die Breite
        lat: ortLink?.type === 'map' && typeof ortLink.y === 'number' ? ortLink.y : null,
        lon: ortLink?.type === 'map' && typeof ortLink.x === 'number' ? ortLink.x : null,
        status: null,
        beendet: !!resultat,
        liga: r.text ?? null,
        eigen: z.cells[iHeim]?.highlight ? 'heim' : z.cells[iGast]?.highlight ? 'gast' : null,
      } as Spiel;
    }),
  );
  return { titel: t.data.title ?? '', spiele };
}

/** Das eigene Team wird über die Team ID erkannt (die API hebt es in der Rangliste nicht hervor). */
export function ranglisteParsen(t: Tabelle, teamId?: string): Rangliste {
  const iTeam = spalte(t, 'Team');
  const iSp = spalte(t, 'Sp');
  const iP = spalte(t, 'P');
  const iT = spalte(t, 'T');
  return {
    titel: t.data.title ?? '',
    zeilen: t.data.regions.flatMap((r) =>
      r.rows.map((z) => ({
        rang: z.data?.rank ?? Number(text(z.cells[0])),
        team: z.data?.team?.name ?? text(z.cells[iTeam]) ?? '',
        spiele: iSp >= 0 ? Number(text(z.cells[iSp])) : null,
        punkte: iP >= 0 ? Number(text(z.cells[iP])) : null,
        tore: iT >= 0 ? text(z.cells[iT]) : null,
        hervorgehoben: !!z.highlight || (!!teamId && String(z.data?.team?.id) === teamId),
        teamId: z.data?.team?.id != null ? String(z.data.team.id) : null,
      })),
    ),
  };
}

export function aktuelleSpieleParsen(t: Tabelle, datum: string): Spiel[] {
  const iZeit = spalte(t, 'Zeit');
  const iHeim = spalte(t, 'Heim');
  const iGast = spalte(t, 'Gast');
  const iRes = spalte(t, 'Resultat');
  const [j, m, d] = datum.split('-');
  return t.data.regions.flatMap((r) =>
    r.rows.map((z) => {
      const status = text(z.cells[iZeit]);
      const istZeit = !!status && /^\d{1,2}:\d{2}$/.test(status);
      const resultat = text(z.cells[iRes]);
      return {
        id: String(z.id ?? z.link?.ids?.[0] ?? ''),
        zeit: istZeit ? suhZeit(`${d}.${m}.${j}`, status) : null,
        datumText: `${d}.${m}.${j}`,
        zeitText: istZeit ? (status as string) : '',
        heim: text(z.cells[iHeim]) ?? '',
        gast: text(z.cells[iGast]) ?? '',
        resultat,
        zusatz: text(z.cells[iRes], 1),
        ort: null,
        lat: null,
        lon: null,
        status,
        beendet: !!status && /beendet/i.test(status),
        liga: r.text ?? null,
      };
    }),
  );
}

/**
 * Spielereignisse. Die Mannschaft steht ohne Zusatz wie «II» in den Ereignissen,
 * die Namen der Seiten kommen aus den Reitern (Alle, Heim, Gast).
 */
export function spielEreignisseParsen(t: Tabelle): SpielEreignisse {
  const tab = (i: number) => {
    const x = t.data.tabs?.[i]?.text;
    return (Array.isArray(x) ? x[0] : x)?.trim() ?? '';
  };
  const heim = tab(1);
  const gast = tab(2);
  const ereignisse = t.data.regions.flatMap((r) =>
    r.rows.map((z): SpielEreignis => {
      const art = text(z.cells[1]) ?? '';
      const team = text(z.cells[2]);
      const wer = text(z.cells[3]);
      const m = wer ? /^(.*?)\s*(?:\((.*)\))?$/.exec(wer) : null;
      const strafe = /^(\d+)'-Strafe/.exec(art);
      return {
        zeit: text(z.cells[0]) ?? '',
        typ: /^Torschütze/.test(art)
          ? 'tor'
          : strafe
            ? 'strafe'
            : /^Penalty/.test(art)
              ? 'penalty'
              : 'anderes',
        text: art,
        seite: team && team === heim ? 'heim' : team && team === gast ? 'gast' : null,
        spieler: m?.[1] || null,
        assist: m?.[2] || null,
        minuten: strafe ? Number(strafe[1]) : null,
      };
    }),
  );
  // Die API liefert das Neueste zuerst
  return { heim, gast, ereignisse: ereignisse.reverse() };
}

const BASIS = 'https://api-v2.swissunihockey.ch/api';

export const suhV2: SuhAdapter = {
  name: 'Tabellen API v2',
  async teamSpiele(teamId, saison) {
    const t = await httpJson<Tabelle>(
      `${BASIS}/games?mode=team&team_id=${encodeURIComponent(teamId)}&season=${saison}&games_per_page=60&page=1`,
      {
        timeoutMs: 15000,
        abstandMs: 1000,
      },
    );
    return teamSpieleParsen(t);
  },
  async rangliste(teamId, saison) {
    return ranglisteParsen(
      await httpJson<Tabelle>(`${BASIS}/rankings?team_id=${encodeURIComponent(teamId)}&season=${saison}`, {
        timeoutMs: 15000,
        abstandMs: 1000,
      }),
      teamId,
    );
  },
  async spieleAmTag(datum) {
    return aktuelleSpieleParsen(
      await httpJson<Tabelle>(`${BASIS}/games?mode=current&on_date=${datum}`, {
        timeoutMs: 15000,
        abstandMs: 1000,
      }),
      datum,
    );
  },
  async spielEreignisse(spielId) {
    return spielEreignisseParsen(
      await httpJson<Tabelle>(`${BASIS}/game_events/${encodeURIComponent(spielId)}`, {
        timeoutMs: 15000,
        abstandMs: 1000,
      }),
    );
  },
};

/** Saison von swiss unihockey: beginnt im Sommer, «2026» ist 2026/27 */
export function aktuelleSaison(jetzt: Date): number {
  return jetzt.getUTCMonth() >= 4 ? jetzt.getUTCFullYear() : jetzt.getUTCFullYear() - 1;
}
