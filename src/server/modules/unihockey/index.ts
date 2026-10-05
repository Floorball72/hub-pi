// Modul Unihockey: Spielplan, Resultate und Rangliste der eigenen Teams (UHC Jonschwil Vipers, United Toggenburg).
import type { FastifyInstance } from 'fastify';
import { tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel, TimelineEintrag } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import {
  aktuelleSaison,
  type Rangliste,
  type Spiel,
  type SpielEreignisse,
  SUH_NAMENSNENNUNG,
  suhV2,
} from '../../quellen/swissunihockey.ts';
import { demoRangliste, demoSpielEreignisse, demoTeamSpiele } from './demo.ts';
import { bilanz, gegnerVon, gespielte, namensKern, ranglistenZeile, seiteVon, skorer } from './gegner.ts';

/** So viele gespielte Spiele des Gegners fliessen in die Skorerliste */
const SKORER_SPIELE = 6;

export const TEAMS = tabelle({
  name: 'teams',
  modul: 'unihockey',
  label: 'Unihockey Teams',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'team_id', typ: 'text', label: 'swiss unihockey Team ID', pflicht: true },
    { name: 'saison', typ: 'int', label: 'Saison (leer = aktuelle)' },
    { name: 'favorit', typ: 'bool', label: 'In Timeline und Briefing', standard: true },
    { name: 'push_spielende', typ: 'bool', label: 'Push bei Spielende', standard: false },
  ],
});

interface Team {
  id: string;
  name: string;
  team_id: string;
  saison: number | null;
  favorit: boolean;
  push_spielende: boolean;
}

/** Standardteams, Team IDs über die swiss unihockey API ermittelt (Saison 2026/27). */
export const STANDARD_TEAMS = [
  {
    name: 'UHC Jonschwil Vipers (Herren KF 2. Liga)',
    team_id: '416423',
    favorit: true,
    push_spielende: false,
  },
  {
    name: 'United Toggenburg Bazenheid (Herren GF 2. Liga)',
    team_id: '429092',
    favorit: true,
    push_spielende: false,
  },
];

export const unihockey: ModulDef = {
  id: 'unihockey',
  name: 'Unihockey',
  beschreibung: 'Spielplan und Rangliste von Vipers und United Toggenburg',
  symbol: 'unihockey',
  reihenfolge: 50,
  tabellen: [TEAMS],
  regeln: [
    {
      id: 'spielende',
      name: 'Spielende eines Teams',
      beschreibung: 'Resultat eines Teams mit eingeschaltetem «Push bei Spielende» ist da.',
      prioritaet: 2,
      cooldownMin: 60,
    },
  ],
  erstellen: (ctx) => unihockeyLaufzeit(ctx),
};

function unihockeyLaufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  let angelegt: Promise<void> | null = null;
  const gemeldet = new Set<string>();

  const spiele = ctx.quelle<
    { team: string; saison: number; name: string },
    { titel: string; spiele: Spiel[] }
  >({
    id: 'unihockey.spiele',
    name: 'swiss unihockey Spielplan',
    modul: 'unihockey',
    ttlSek: 15 * 60,
    abruf: (p) => suhV2.teamSpiele(p.team, p.saison),
    demo: (p) => demoTeamSpiele(p.name, ctx.jetzt()),
    namensnennung: SUH_NAMENSNENNUNG,
    testParameter: () => ({ team: '429092', saison: aktuelleSaison(new Date()), name: 'Test' }),
  });
  const rangliste = ctx.quelle<{ team: string; saison: number; name: string }, Rangliste>({
    id: 'unihockey.rangliste',
    name: 'swiss unihockey Rangliste',
    modul: 'unihockey',
    ttlSek: 60 * 60,
    abruf: (p) => suhV2.rangliste(p.team, p.saison),
    demo: (p) => demoRangliste(p.name),
    namensnennung: SUH_NAMENSNENNUNG,
    testParameter: () => ({ team: '429092', saison: aktuelleSaison(new Date()), name: 'Test' }),
  });

  // Gespielte Spiele ändern sich nicht mehr, deshalb ein langer Cache
  const ereignisse = ctx.quelle<
    { spiel: string; heim: string; gast: string; resultat: string | null },
    SpielEreignisse
  >({
    id: 'unihockey.ereignisse',
    name: 'swiss unihockey Spielereignisse',
    modul: 'unihockey',
    ttlSek: 24 * 3600,
    abruf: (p) => suhV2.spielEreignisse(p.spiel),
    demo: (p) => demoSpielEreignisse(p.spiel, p.heim, p.gast, p.resultat),
    namensnennung: SUH_NAMENSNENNUNG,
    testParameter: () => ({ spiel: '1104358', heim: '', gast: '', resultat: null }),
  });

  async function teams(): Promise<Team[]> {
    angelegt ??= (async () => {
      if ((await daten.anzahl('teams')) === 0 && !ctx.einstellungen.hole('unihockey.teams_angelegt', false)) {
        await daten.einfuegen('teams', STANDARD_TEAMS);
        await ctx.einstellungen.setze('unihockey.teams_angelegt', true);
      }
    })();
    await angelegt;
    return daten.liste<Team>('teams', { sortierung: 'name', limit: 20 });
  }

  const param = (t: Team) => ({
    team: t.team_id,
    saison: t.saison ?? aktuelleSaison(ctx.jetzt()),
    name: t.name,
  });

  async function uebersicht() {
    return Promise.all(
      (await teams()).map(async (t) => {
        const [s, r] = await Promise.all([spiele.hole(param(t)), rangliste.hole(param(t))]);
        const jetzt = ctx.jetzt().getTime();
        const liste = s.daten?.spiele ?? [];
        const naechstes =
          liste.find((x) => x.zeit && new Date(x.zeit).getTime() > jetzt - 2 * 3600000 && !x.resultat) ??
          null;
        const letztes = [...liste].reverse().find((x) => x.resultat) ?? null;
        const eigene = r.daten?.zeilen.find((z) => z.hervorgehoben) ?? null;
        return {
          team: t,
          titel: s.daten?.titel ?? '',
          spiele: liste,
          rangliste: r.daten,
          naechstes,
          letztes,
          rang: eigene,
          demo: s.demo,
          fehler: s.fehler ?? r.fehler,
        };
      }),
    );
  }

  /** Gegner Check für das nächste Spiel eines Teams */
  async function gegnerCheck(teamZeile: string) {
    const t = (await teams()).find((x) => x.id === teamZeile);
    if (!t) return null;
    const p = param(t);
    const [s, r] = await Promise.all([spiele.hole(p), rangliste.hole(p)]);
    const jetzt = ctx.jetzt().getTime();
    const eigene = s.daten?.spiele ?? [];
    const spiel =
      eigene.find((x) => x.zeit && new Date(x.zeit).getTime() > jetzt - 2 * 3600000 && !x.resultat) ?? null;
    const gegner = spiel ? gegnerVon(spiel) : null;
    if (!spiel || !gegner) return { spiel, gegner: null, fehler: s.fehler ?? null };

    const zeile = ranglistenZeile(r.daten?.zeilen ?? [], gegner);
    // Direktvergleich aus dieser und der letzten Saison
    const vorjahr = await spiele.hole({ ...p, saison: p.saison - 1 });
    const kern = namensKern(gegner);
    const direkt = gespielte(
      [...eigene, ...(vorjahr.daten?.spiele ?? [])].filter((x) => {
        const g = gegnerVon(x);
        return g != null && namensKern(g) === kern;
      }),
    );

    let form: ReturnType<typeof gespielte> = [];
    let top: ReturnType<typeof skorer> = [];
    let ausgewertet = 0;
    let fehler: string | null = null;
    if (zeile?.teamId) {
      const gs = await spiele.hole({ team: zeile.teamId, saison: p.saison, name: gegner });
      fehler = gs.fehler ?? null;
      const liste = gs.daten?.spiele ?? [];
      form = gespielte(liste, gegner);
      const fuerSkorer = form.slice(0, SKORER_SPIELE).flatMap((f) => {
        const sp = liste.find((x) => x.id === f.id);
        const seite = sp ? seiteVon(sp, gegner) : null;
        return sp && seite ? [{ sp, seite }] : [];
      });
      const geladen = await Promise.all(
        fuerSkorer.map(async ({ sp, seite }) => {
          const e = await ereignisse.hole({
            spiel: sp.id,
            heim: sp.heim,
            gast: sp.gast,
            resultat: sp.resultat,
          });
          return e.daten ? { ereignisse: e.daten, seite } : null;
        }),
      );
      const ok = geladen.filter((x) => x !== null);
      ausgewertet = ok.length;
      top = skorer(ok)
        .filter((x) => x.punkte > 0)
        .slice(0, 8);
    } else {
      fehler = 'Gegner nicht in der Rangliste gefunden';
    }

    return {
      spiel,
      gegner,
      rang: zeile,
      ranglistenGroesse: r.daten?.zeilen.length ?? null,
      form: form.slice(0, 10),
      bilanz: bilanz(form),
      formLetzte5: bilanz(form.slice(0, 5)),
      direkt,
      direktBilanz: bilanz(direkt),
      skorer: top,
      skorerSpiele: ausgewertet,
      demo: s.demo,
      fehler,
    };
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => uebersicht());
    app.get<{ Params: { id: string } }>('/gegner/:id', async (req, rep) => {
      const g = await gegnerCheck(req.params.id);
      if (!g) return rep.code(404).send({ fehler: 'Team nicht gefunden' });
      return g;
    });
  }

  const jobs = [
    {
      id: 'spielende',
      name: 'Resultate prüfen',
      intervallSek: 600,
      startVerzoegerungSek: 70,
      lauf: async () => {
        const jetzt = ctx.jetzt().getTime();
        for (const t of (await teams()).filter((x) => x.push_spielende)) {
          const s = await spiele.hole(param(t));
          for (const sp of s.daten?.spiele ?? []) {
            if (!sp.zeit || !sp.resultat || gemeldet.has(sp.id)) continue;
            const t0 = new Date(sp.zeit).getTime();
            if (jetzt - t0 > 8 * 3600000 || jetzt < t0) continue;
            gemeldet.add(sp.id);
            await ctx.alarm.melden({
              regel: 'unihockey.spielende',
              titel: `${sp.heim} ${sp.resultat} ${sp.gast}`,
              text: `${t.name}${sp.zusatz ? ` (${sp.zusatz})` : ''}`,
              schluessel: `suhspiel:${sp.id}`,
              tags: ['ice_hockey'],
            });
          }
        }
        return undefined;
      },
    },
  ];

  const kurz = (iso: string) =>
    new Date(iso).toLocaleString('de-CH', {
      timeZone: 'Europe/Zurich',
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function kachel(): Promise<Kachel> {
    const u = await uebersicht();
    const naechste = u
      .filter((x) => x.naechstes?.zeit)
      .sort((a, b) => a.naechstes!.zeit!.localeCompare(b.naechstes!.zeit!));
    const erstes = naechste[0];
    return {
      status: u.some((x) => x.fehler && !x.spiele.length) ? 'warnung' : 'ok',
      titel: 'Unihockey',
      wert: erstes ? kurz(erstes.naechstes!.zeit!) : 'kein Spiel',
      unter: erstes ? `${erstes.naechstes!.heim} gegen ${erstes.naechstes!.gast}` : '',
      zeilen: u.map((x) => ({
        text: x.team.name.replace(/\s*\(.*\)$/, ''),
        wert: [x.rang ? `Rang ${x.rang.rang}` : null, x.letztes ? `${x.letztes.resultat}` : null]
          .filter(Boolean)
          .join(' · '),
        status: 'neutral' as Ampel,
      })),
      demo: konfig.demo,
    };
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    const u = await uebersicht();
    return u
      .filter((x) => x.team.favorit)
      .flatMap((x) =>
        x.spiele
          .filter((s) => s.zeit && new Date(s.zeit) >= von && new Date(s.zeit) <= bis)
          .map((s) => ({
            id: `suh-${s.id}`,
            modul: 'unihockey',
            art: 'Spiel',
            titel: `${s.heim} gegen ${s.gast}`,
            text: [s.ort, s.resultat ? `Resultat ${s.resultat}` : null].filter(Boolean).join(' · '),
            start: s.zeit!,
            link: '/modul/unihockey',
          })),
      );
  }

  return { routen, jobs, kachel, timeline };
}
