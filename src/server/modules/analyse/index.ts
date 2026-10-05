// Modul Unihockey Analyse: Abschlüsse vergangener Spiele selbst erfassen (Ort, Spieler, Ausgang)
// und auswerten: Trefferbilder, Zonen, Drittel, Werte pro Spieler und Saison.
import type { FastifyInstance } from 'fastify';
import { tabelle, validieren } from '../../daten/schema.ts';
import type { Kachel } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { lokalDatum, tageZurueck } from '../../kern/zeit.ts';
import {
  auswerten,
  type Ereignis,
  resultat,
  type Spieler,
  SEITEN,
  type Strafe,
  strafeEndetDurchTor,
  TYPEN,
} from './auswertung.ts';
import { spielbericht, spielberichtPdf } from './bericht.ts';
import { saisonverlauf } from './verlauf.ts';
import { einschaetzung, gleicherGegner } from './vorbereitung.ts';
import { DEMO_SPIELE, DEMO_SPIELER, demoEreignisse, demoStrafen } from './demo.ts';

export const ANALYSE_SPIELE = tabelle({
  name: 'analyse_spiele',
  modul: 'analyse',
  label: 'Analyse Spiele',
  bearbeitbar: true,
  anzeige: 'gegner',
  suche: ['gegner', 'notiz'],
  spalten: [
    { name: 'datum', typ: 'datum', label: 'Datum', pflicht: true },
    { name: 'gegner', typ: 'text', label: 'Gegner', pflicht: true },
    { name: 'team', typ: 'text', label: 'Eigenes Team', standard: 'UHC Jonschwil Vipers' },
    {
      name: 'ort',
      typ: 'text',
      label: 'Heim oder auswärts',
      optionen: ['heim', 'auswaerts'],
      standard: 'heim',
    },
    { name: 'saison', typ: 'text', label: 'Saison (z.B. 2026/27)' },
    { name: 'notiz', typ: 'text', label: 'Notiz', lang: true },
    {
      name: 'drittel_min',
      typ: 'int',
      label: 'Drittel Länge',
      einheit: 'Minuten',
      standard: 20,
      min: 5,
      max: 20,
    },
  ],
  indizes: [['datum']],
});

export const ANALYSE_SPIELER = tabelle({
  name: 'analyse_spieler',
  modul: 'analyse',
  label: 'Analyse Spieler',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'nummer', typ: 'int', label: 'Nummer', min: 0, max: 99 },
    { name: 'name', typ: 'text', label: 'Name oder Kürzel', pflicht: true },
    {
      name: 'position',
      typ: 'text',
      label: 'Position',
      optionen: ['Sturm', 'Center', 'Verteidigung', 'Torhüter'],
    },
    { name: 'aktiv', typ: 'bool', label: 'Im Kader', standard: true },
    { name: 'block', typ: 'int', label: 'Block', min: 1, max: 4 },
  ],
});

export const ANALYSE_EREIGNISSE = tabelle({
  name: 'analyse_ereignisse',
  modul: 'analyse',
  label: 'Analyse Abschlüsse',
  bearbeitbar: true,
  spalten: [
    { name: 'spiel_id', typ: 'text', label: 'Spiel', pflicht: true, verweis: 'analyse_spiele' },
    { name: 'typ', typ: 'text', label: 'Ausgang', pflicht: true, optionen: [...TYPEN] },
    { name: 'team', typ: 'text', label: 'Team', pflicht: true, optionen: [...SEITEN], standard: 'eigen' },
    { name: 'x', typ: 'real', label: 'Position quer', pflicht: true, min: 0, max: 1 },
    { name: 'y', typ: 'real', label: 'Position Tiefe', pflicht: true, min: 0, max: 1 },
    { name: 'spieler_id', typ: 'text', label: 'Schütze', verweis: 'analyse_spieler' },
    { name: 'assist_id', typ: 'text', label: 'Assist', verweis: 'analyse_spieler' },
    { name: 'drittel', typ: 'int', label: 'Drittel (4 = Verlängerung)', min: 1, max: 4 },
    { name: 'minute', typ: 'int', label: 'Minute', min: 0, max: 80 },
    {
      name: 'situation',
      typ: 'text',
      label: 'Situation',
      optionen: ['gleich', 'ueberzahl', 'unterzahl', 'penalty'],
      standard: 'gleich',
    },
    { name: 'auf_feld', typ: 'text', label: 'Auf dem Feld' },
    { name: 'zeit_sek', typ: 'int', label: 'Spielzeit in Sekunden', min: 0 },
  ],
  indizes: [['spiel_id']],
});

export const ANALYSE_STRAFEN = tabelle({
  name: 'analyse_strafen',
  modul: 'analyse',
  label: 'Analyse Strafen',
  bearbeitbar: true,
  spalten: [
    { name: 'spiel_id', typ: 'text', label: 'Spiel', pflicht: true, verweis: 'analyse_spiele' },
    { name: 'team', typ: 'text', label: 'Team', pflicht: true, optionen: [...SEITEN], standard: 'eigen' },
    { name: 'spieler_id', typ: 'text', label: 'Spieler', verweis: 'analyse_spieler' },
    { name: 'minuten', typ: 'int', label: 'Minuten', pflicht: true, standard: 2, min: 2, max: 10 },
    { name: 'drittel', typ: 'int', label: 'Drittel', min: 1, max: 4 },
    { name: 'minute', typ: 'int', label: 'Minute', min: 0, max: 80 },
    { name: 'zeit_sek', typ: 'int', label: 'Spielzeit in Sekunden', min: 0 },
    { name: 'ende_sek', typ: 'int', label: 'Vorzeitig beendet bei Sekunde', min: 0 },
  ],
  indizes: [['spiel_id']],
});

interface Spiel {
  id: string;
  datum: string;
  gegner: string;
  team: string | null;
  ort: string | null;
  saison: string | null;
  notiz: string | null;
}

export const analyse: ModulDef = {
  id: 'analyse',
  name: 'Unihockey Analyse',
  beschreibung: 'Abschlüsse vergangener Spiele erfassen und auswerten: Trefferbild, Zonen, Spieler',
  symbol: 'analyse',
  reihenfolge: 52,
  tabellen: [ANALYSE_SPIELE, ANALYSE_SPIELER, ANALYSE_EREIGNISSE, ANALYSE_STRAFEN],
  erstellen: (ctx) => analyseLaufzeit(ctx),
};

function analyseLaufzeit(ctx: Kontext) {
  const { daten } = ctx;
  let bereit: Promise<void> | null = null;

  // Im Demo Modus einmalig Beispielspiele anlegen, damit die Auswertung etwas zeigt
  async function vorbereiten() {
    bereit ??= (async () => {
      if (!ctx.konfig.demo || ctx.einstellungen.hole('analyse.demo_angelegt', false)) return;
      if ((await daten.anzahl('analyse_spiele')) > 0) return;
      const spieler = await daten.einfuegen<{ id: string }>('analyse_spieler', DEMO_SPIELER);
      const ids = spieler.map((s) => s.id);
      let start = 7;
      for (const s of DEMO_SPIELE) {
        const [spiel] = await daten.einfuegen<{ id: string }>('analyse_spiele', [
          {
            datum: lokalDatum(tageZurueck(ctx.jetzt(), s.tage)),
            gegner: s.gegner,
            ort: s.ort,
            team: 'UHC Jonschwil Vipers',
            saison: '2026/27',
          },
        ]);
        await daten.einfuegen('analyse_ereignisse', demoEreignisse(spiel.id, ids, start));
        await daten.einfuegen('analyse_strafen', demoStrafen(spiel.id, ids, start++));
      }
      await ctx.einstellungen.setze('analyse.demo_angelegt', true);
    })();
    await bereit;
  }

  const spieleLaden = () => daten.liste<Spiel>('analyse_spiele', { sortierung: '-datum', limit: 500 });
  const spielerLaden = () =>
    daten.liste<Spieler & { aktiv: boolean }>('analyse_spieler', { sortierung: 'nummer', limit: 200 });
  const ereignisseLaden = (filter: Record<string, unknown> = {}) =>
    daten.liste<Ereignis>('analyse_ereignisse', { filter, sortierung: 'erstellt', limit: 20000 });
  const strafenLaden = (filter: Record<string, unknown> = {}) =>
    daten.liste<Strafe>('analyse_strafen', { filter, sortierung: 'erstellt', limit: 5000 });

  async function uebersicht() {
    await vorbereiten();
    const [spiele, spieler, ereignisse] = await Promise.all([
      spieleLaden(),
      spielerLaden(),
      ereignisseLaden(),
    ]);
    const proSpiel = new Map<string, Ereignis[]>();
    for (const e of ereignisse) proSpiel.set(e.spiel_id, [...(proSpiel.get(e.spiel_id) ?? []), e]);
    return {
      spiele: spiele.map((s) => {
        const liste = proSpiel.get(s.id) ?? [];
        return {
          ...s,
          resultat: resultat(liste),
          schuesse: {
            eigen: liste.filter((e) => e.team === 'eigen').length,
            gegner: liste.filter((e) => e.team === 'gegner').length,
          },
        };
      }),
      spieler,
      saisons: [...new Set(spiele.map((s) => s.saison).filter(Boolean))].sort().reverse(),
    };
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => uebersicht());

    // Auswertung für ein Spiel, eine Saison oder alles. Optional nur ein Spieler.
    app.get<{ Querystring: { spiel?: string; saison?: string; spieler?: string } }>(
      '/auswertung',
      async (req) => {
        await vorbereiten();
        const { spiel, saison, spieler: nurSpieler } = req.query;
        const [spiele, spieler] = await Promise.all([spieleLaden(), spielerLaden()]);
        let ids: string[] | null = null;
        if (spiel) ids = [spiel];
        else if (saison) ids = spiele.filter((s) => s.saison === saison).map((s) => s.id);
        const filter = ids ? { spiel_id: { in: ids.length ? ids : ['-'] } } : {};
        let liste = await ereignisseLaden(filter);
        const auswertung = auswerten(liste, spieler, await strafenLaden(filter));
        if (nurSpieler) liste = liste.filter((e) => e.team === 'eigen' && e.spieler_id === nurSpieler);
        return {
          ...auswertung,
          spiele: ids ? ids.length : spiele.length,
          ereignisse: liste.map((e) => ({
            id: e.id,
            typ: e.typ,
            team: e.team,
            x: e.x,
            y: e.y,
            spieler_id: e.spieler_id,
          })),
        };
      },
    );

    // Alles für die Erfassung eines Spiels
    app.get<{ Params: { id: string } }>('/spiel/:id', async (req, reply) => {
      const spiel = await daten.hole<Spiel>('analyse_spiele', req.params.id);
      if (!spiel) return reply.code(404).send({ fehler: 'Spiel nicht gefunden' });
      const [ereignisse, strafen] = await Promise.all([
        ereignisseLaden({ spiel_id: spiel.id }),
        strafenLaden({ spiel_id: spiel.id }),
      ]);
      return { spiel, ereignisse, strafen, resultat: resultat(ereignisse) };
    });

    // Spielbericht: Torfolge, Schlüsselmomente, beste Spieler und Zahlen, als JSON mit Text oder als PDF
    async function berichtLaden(id: string) {
      await vorbereiten();
      const spiel = await daten.hole<Spiel>('analyse_spiele', id);
      if (!spiel) return null;
      const [ereignisse, strafen, spieler] = await Promise.all([
        ereignisseLaden({ spiel_id: spiel.id }),
        strafenLaden({ spiel_id: spiel.id }),
        spielerLaden(),
      ]);
      return spielbericht(spiel, ereignisse, strafen, spieler);
    }
    app.get<{ Params: { id: string } }>('/spiel/:id/bericht', async (req, reply) => {
      const b = await berichtLaden(req.params.id);
      return b ?? reply.code(404).send({ fehler: 'Spiel nicht gefunden' });
    });
    app.get<{ Params: { id: string } }>('/spiel/:id/bericht.pdf', async (req, reply) => {
      const b = await berichtLaden(req.params.id);
      if (!b) return reply.code(404).send({ fehler: 'Spiel nicht gefunden' });
      const name = `Spielbericht-${b.titel.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`;
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `inline; filename="${name}"`)
        .send(spielberichtPdf(b));
    });

    // Saisonverlauf eines Teams: ohne Angabe die neueste Saison und das häufigste Team
    app.get<{ Querystring: { saison?: string; team?: string } }>('/saison', async (req) => {
      await vorbereiten();
      const alle = await spieleLaden();
      const saisons = [...new Set(alle.map((s) => s.saison).filter(Boolean))].sort().reverse() as string[];
      const saison = req.query.saison || saisons[0] || null;
      const inSaison = alle.filter((s) => !saison || s.saison === saison);
      const proTeam = new Map<string, number>();
      for (const s of inSaison) if (s.team) proTeam.set(s.team, (proTeam.get(s.team) ?? 0) + 1);
      const teams = [...proTeam].sort((a, b) => b[1] - a[1]).map(([t]) => t);
      const team = req.query.team || teams[0] || null;
      const spiele = inSaison.filter((s) => !team || s.team === team);
      const filter = { spiel_id: { in: spiele.length ? spiele.map((s) => s.id) : ['-'] } };
      const [ereignisse, strafen] = await Promise.all([ereignisseLaden(filter), strafenLaden(filter)]);
      return { saison, saisons, team, teams, ...saisonverlauf(spiele, ereignisse, strafen) };
    });

    // Spielvorbereitung: Stärken und Schwächen der laufenden Saison, dazu die erfassten Spiele gegen den Gegner
    app.get<{ Querystring: { team?: string; gegner?: string } }>('/vorbereitung', async (req) => {
      await vorbereiten();
      const [alle, spieler] = await Promise.all([spieleLaden(), spielerLaden()]);
      const saison = [...new Set(alle.map((s) => s.saison).filter(Boolean))].sort().reverse()[0] ?? null;
      const inSaison = alle.filter((s) => !saison || s.saison === saison);
      const proTeam = new Map<string, number>();
      for (const s of inSaison) if (s.team) proTeam.set(s.team, (proTeam.get(s.team) ?? 0) + 1);
      const team = req.query.team || [...proTeam].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const spiele = inSaison.filter((s) => !team || s.team === team);
      const filter = { spiel_id: { in: spiele.length ? spiele.map((s) => s.id) : ['-'] } };
      const [ereignisse, strafen] = await Promise.all([ereignisseLaden(filter), strafenLaden(filter)]);
      const verlauf = saisonverlauf(spiele, ereignisse, strafen);
      const { staerken, schwaechen } = einschaetzung(auswerten(ereignisse, spieler, strafen), verlauf);

      const gegner = req.query.gegner?.trim() || null;
      const direktSpiele = gegner
        ? alle
            .filter((s) => (!team || s.team === team) && gleicherGegner(s.gegner, gegner))
            .sort((a, b) => b.datum.localeCompare(a.datum))
        : [];
      const direkt = await Promise.all(
        direktSpiele.slice(0, 5).map(async (s) => {
          const r = resultat(await ereignisseLaden({ spiel_id: s.id }));
          return { id: s.id, datum: s.datum, gegner: s.gegner, tore: r.eigen, gegentore: r.gegner };
        }),
      );
      const letzter = direktSpiele[0] ? await berichtLaden(direktSpiele[0].id) : null;
      return {
        team,
        saison,
        spiele: verlauf.bilanz.spiele,
        form: verlauf.form,
        staerken,
        schwaechen,
        gegner,
        direkt,
        letzter: letzter
          ? {
              id: direktSpiele[0].id,
              titel: letzter.titel,
              unter: letzter.unter,
              momente: letzter.momente.slice(0, 4),
              beste: letzter.beste,
              zahlen: letzter.zahlen,
            }
          : null,
      };
    });

    // Abschluss aus der Live Erfassung. Ein Tor in Überzahl beendet die älteste 2 Minuten Strafe des Gegners.
    app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
      '/spiel/:id/abschluss',
      async (req, reply) => {
        const spiel = await daten.hole<Spiel>('analyse_spiele', req.params.id);
        if (!spiel) return reply.code(404).send({ fehler: 'Spiel nicht gefunden' });
        let zeile: Record<string, unknown>;
        try {
          zeile = validieren(ANALYSE_EREIGNISSE, { ...req.body, spiel_id: spiel.id }, false);
        } catch (e) {
          return reply.code(400).send({ fehler: (e as Error).message });
        }
        const [neu] = await daten.einfuegen<Ereignis & { zeit_sek: number | null }>('analyse_ereignisse', [
          zeile,
        ]);
        let beendet: string | null = null;
        if (neu.typ === 'tor' && neu.zeit_sek != null) {
          const s = strafeEndetDurchTor(await strafenLaden({ spiel_id: spiel.id }), neu.team, neu.zeit_sek);
          if (s) {
            await daten.aendern('analyse_strafen', s.id, { ende_sek: neu.zeit_sek });
            beendet = s.id;
          }
        }
        return { ereignis: neu, strafeBeendet: beendet };
      },
    );
  }

  async function kachel(): Promise<Kachel> {
    const u = await uebersicht();
    const letztes = u.spiele.find((s) => s.schuesse.eigen + s.schuesse.gegner > 0);
    const saison = u.saisons[0];
    const a = saison ? auswerten(await saisonEreignisse(u.spiele, saison), u.spieler) : null;
    const top = a?.spieler[0];
    return {
      status: 'neutral',
      titel: 'Analyse',
      wert: letztes ? `${letztes.resultat.eigen}:${letztes.resultat.gegner}` : 'kein Spiel',
      unter: letztes ? `gegen ${letztes.gegner}` : 'Noch nichts erfasst',
      zeilen: [
        ...(a?.eigen.effizienz != null
          ? [{ text: `Effizienz ${saison}`, wert: `${a.eigen.effizienz} %` }]
          : []),
        ...(top ? [{ text: 'Topskorer', wert: `${top.spieler.name} ${top.tore}+${top.assists}` }] : []),
        { text: 'Erfasste Spiele', wert: String(u.spiele.length) },
      ],
      demo: ctx.konfig.demo,
    };
  }

  async function saisonEreignisse(spiele: Spiel[], saison: string) {
    const ids = spiele.filter((s) => s.saison === saison).map((s) => s.id);
    return ids.length ? ereignisseLaden({ spiel_id: { in: ids } }) : [];
  }

  return { routen, kachel };
}
