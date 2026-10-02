// Modul Weitere Teams: Mannschaften anderer Sportarten (Standard FC St. Gallen) mit nächstem Spiel,
// letztem Resultat und Tabelle. Ehrlich, wenn es keine erlaubte Quelle gibt. Push bei Spielende.
import type { FastifyInstance } from 'fastify';
import { tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel, TimelineEintrag } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { oldbHolen, type Spiel, type TeamDaten, tsdbHolen } from './quellen.ts';

export const SPORT_TEAMS = tabelle({
  name: 'sport_teams',
  modul: 'teams',
  label: 'Teams',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'sport', typ: 'text', label: 'Sportart', standard: 'Fussball' },
    {
      name: 'quelle',
      typ: 'text',
      label: 'Quelle',
      optionen: ['TheSportsDB', 'OpenLigaDB', 'keine'],
      standard: 'TheSportsDB',
    },
    { name: 'team_id', typ: 'text', label: 'Team ID (TheSportsDB) oder Teamname (OpenLigaDB)' },
    { name: 'liga', typ: 'text', label: 'Liga ID (TheSportsDB) oder Kürzel (OpenLigaDB)' },
    { name: 'saison', typ: 'text', label: 'Saisonjahr (nur OpenLigaDB, z.B. 2026)' },
    { name: 'push_spielende', typ: 'bool', label: 'Push bei Spielende', standard: true },
    { name: 'aktiv', typ: 'bool', label: 'Aktiv', standard: true },
  ],
});

export const STANDARD_SPORT_TEAMS = [
  {
    name: 'FC St. Gallen',
    sport: 'Fussball',
    quelle: 'TheSportsDB',
    team_id: '134406',
    liga: '4675',
    push_spielende: true,
    aktiv: true,
  },
];

interface Team {
  id: string;
  name: string;
  sport: string | null;
  quelle: string;
  team_id: string | null;
  liga: string | null;
  saison: string | null;
  push_spielende: boolean;
  aktiv: boolean;
}

export function resultatText(s: Spiel): string {
  return s.toreHeim !== null && s.toreGast !== null ? `${s.toreHeim}:${s.toreGast}` : '–';
}

export function demoTeamDaten(jetzt: Date): TeamDaten {
  const t = (tage: number, h: number) =>
    new Date(
      Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate() + tage, h),
    ).toISOString();
  return {
    spiele: [
      {
        id: 'demo-1',
        zeit: t(-6, 14),
        heim: 'St. Gallen',
        gast: 'Demo FC',
        toreHeim: 2,
        toreGast: 1,
        beendet: true,
        wettbewerb: 'Super League (Demo)',
        ort: 'Kybunpark',
      },
      {
        id: 'demo-2',
        zeit: t(3, 16),
        heim: 'Demo United',
        gast: 'St. Gallen',
        toreHeim: null,
        toreGast: null,
        beendet: false,
        wettbewerb: 'Super League (Demo)',
        ort: null,
      },
    ],
    tabelle: [
      { rang: 1, team: 'Demo United', spiele: 9, punkte: 22, tore: '20:8', eigenes: false },
      { rang: 2, team: 'St. Gallen', spiele: 9, punkte: 19, tore: '17:10', eigenes: true },
      { rang: 3, team: 'Demo FC', spiele: 9, punkte: 15, tore: '13:11', eigenes: false },
    ],
    hinweis: null,
  };
}

export const teams: ModulDef = {
  id: 'teams',
  name: 'Weitere Teams',
  beschreibung: 'FC St. Gallen und weitere Teams: nächstes Spiel, Resultat, Tabelle',
  symbol: 'teams',
  reihenfolge: 66,
  tabellen: [SPORT_TEAMS],
  regeln: [
    {
      id: 'spielende',
      name: 'Spielende weiterer Teams',
      beschreibung: 'Schlussresultat eines Teams, bei dem Push eingeschaltet ist.',
      prioritaet: 2,
      cooldownMin: 30,
    },
  ],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  let vorbereitet: Promise<void> | null = null;

  const quelle = ctx.quelle<Team, TeamDaten>({
    id: 'teams.daten',
    name: 'Sportdaten (TheSportsDB, OpenLigaDB)',
    modul: 'teams',
    ttlSek: 1800,
    abruf: (t) => {
      if (t.quelle === 'TheSportsDB')
        return tsdbHolen(konfig.sportsdbKey, t.team_id ?? '', t.liga, ctx.jetzt());
      if (t.quelle === 'OpenLigaDB')
        return oldbHolen(t.liga ?? '', t.saison ?? String(ctx.jetzt().getUTCFullYear()), t.team_id ?? t.name);
      return Promise.resolve({
        spiele: [],
        tabelle: [],
        hinweis: 'Für dieses Team ist keine Quelle erfasst, deren Nutzung erlaubt ist.',
      });
    },
    demo: () => demoTeamDaten(ctx.jetzt()),
    namensnennung: 'TheSportsDB.com, OpenLigaDB',
    testParameter: () => ({
      id: 'test',
      name: 'FC St. Gallen',
      sport: 'Fussball',
      quelle: 'TheSportsDB',
      team_id: '134406',
      liga: null,
      saison: null,
      push_spielende: false,
      aktiv: true,
    }),
  });

  async function vorbereiten() {
    vorbereitet ??= (async () => {
      if ((await daten.anzahl('sport_teams')) === 0)
        await daten.einfuegen('sport_teams', STANDARD_SPORT_TEAMS);
    })();
    await vorbereitet;
  }

  const schluessel = (t: Team) => ({ ...t, push_spielende: false, aktiv: true });

  async function alle(frisch = false) {
    await vorbereiten();
    const liste = (await daten.liste<Team>('sport_teams', { sortierung: 'name', limit: 30 })).filter(
      (t) => t.aktiv,
    );
    return Promise.all(
      liste.map(async (t) => {
        const r = await quelle.hole(schluessel(t), frisch);
        const d = r.daten ?? { spiele: [], tabelle: [], hinweis: null };
        const jetzt = ctx.jetzt().getTime();
        const naechstes =
          d.spiele.find((s) => !s.beendet && s.zeit && new Date(s.zeit).getTime() > jetzt - 3 * 3600000) ??
          null;
        const letztes = [...d.spiele].reverse().find((s) => s.beendet) ?? null;
        return { team: t, ...d, naechstes, letztes, demo: r.demo, fehler: r.fehler, stand: r.stand };
      }),
    );
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => alle());
  }

  const jobs: JobDef[] = [
    {
      id: 'spielende',
      name: 'Resultate prüfen',
      intervallSek: 600,
      startVerzoegerungSek: 130,
      lauf: async () => {
        if (konfig.demo) return undefined;
        const jetzt = ctx.jetzt().getTime();
        let geprueft = 0;
        for (const e of await alle()) {
          // Nur rund um Spiele häufig abfragen: ab Anpfiff bis 4 Stunden danach
          const laeuft = e.spiele.some(
            (s) =>
              s.zeit &&
              !s.beendet &&
              jetzt > new Date(s.zeit).getTime() &&
              jetzt - new Date(s.zeit).getTime() < 4 * 3600000,
          );
          if (!laeuft || !e.team.push_spielende) continue;
          const r = await quelle.hole(schluessel(e.team), true);
          geprueft++;
          const letztes = [...(r.daten?.spiele ?? [])].reverse().find((s) => s.beendet);
          if (!letztes?.zeit || jetzt - new Date(letztes.zeit).getTime() > 6 * 3600000) continue;
          const merk = `teams.gemeldet.${e.team.id}`;
          if (ctx.einstellungen.hole<string>(merk, '') === letztes.id) continue;
          await ctx.einstellungen.setze(merk, letztes.id);
          await ctx.alarm.melden({
            regel: 'teams.spielende',
            titel: `${letztes.heim} ${resultatText(letztes)} ${letztes.gast}`,
            text: `${e.team.name}, ${letztes.wettbewerb ?? e.team.sport ?? ''}`.trim(),
            schluessel: `teams:${letztes.id}`,
            link: '/modul/teams',
          });
        }
        return geprueft ? `${geprueft} laufende Spiele` : undefined;
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const l = await alle();
    const e = l[0];
    if (!e)
      return {
        status: 'neutral',
        titel: 'Weitere Teams',
        wert: '–',
        unter: 'kein Team erfasst',
        demo: konfig.demo,
      };
    const n = e.naechstes;
    return {
      status: (e.fehler ? 'warnung' : 'neutral') as Ampel,
      titel: e.team.name,
      wert: n?.zeit
        ? new Date(n.zeit).toLocaleString('de-CH', {
            timeZone: 'Europe/Zurich',
            weekday: 'short',
            day: 'numeric',
            month: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '–',
      unter: n ? `${n.heim} gegen ${n.gast}` : (e.hinweis ?? 'kein Spiel bekannt'),
      zeilen: l.slice(0, 3).map((x) => ({
        text: x.letztes ? `${x.letztes.heim} : ${x.letztes.gast}` : x.team.name,
        wert: x.letztes ? resultatText(x.letztes) : '–',
      })),
      demo: e.demo,
    };
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    return (await alle()).flatMap((e) =>
      e.spiele
        .filter((s) => s.zeit && new Date(s.zeit) >= von && new Date(s.zeit) <= bis)
        .map((s) => ({
          id: `team-${s.id}`,
          modul: 'teams',
          art: e.team.sport ?? 'Spiel',
          titel: `${s.heim} : ${s.gast}${s.beendet ? ` ${resultatText(s)}` : ''}`,
          start: s.zeit!,
          link: '/modul/teams',
          status: 'neutral' as Ampel,
        })),
    );
  }

  return { routen, jobs, kachel, timeline };
}
