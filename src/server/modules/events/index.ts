// Modul Event Zentrale: Veranstaltungen mit Countdown, Ablaufplan, Checkliste, Aufgaben, Notizen und Wetter.
// Speichert keine Personendaten: Aufgaben haben eine Rolle, keine Namen.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler, tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel, TimelineEintrag } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { lokalDatum, vonLokal } from '../../kern/zeit.ts';
import { demoVorhersage } from '../../quellen/demo-wetter.ts';
import { OPENMETEO_NAMENSNENNUNG, type Vorhersage, vorhersageHolen } from '../../quellen/openmeteo.ts';

export const EVENTS = tabelle({
  name: 'events',
  modul: 'events',
  label: 'Veranstaltungen',
  bearbeitbar: true,
  anzeige: 'titel',
  suche: ['titel', 'ort_name', 'notizen'],
  spalten: [
    { name: 'titel', typ: 'text', label: 'Titel', pflicht: true },
    { name: 'start', typ: 'zeit', label: 'Beginn', pflicht: true },
    { name: 'ende', typ: 'zeit', label: 'Ende' },
    { name: 'ort_name', typ: 'text', label: 'Ort' },
    { name: 'lat', typ: 'real', label: 'Breite', min: -90, max: 90 },
    { name: 'lon', typ: 'real', label: 'Länge', min: -180, max: 180 },
    { name: 'typ', typ: 'text', label: 'Typ' },
    {
      name: 'status',
      typ: 'text',
      label: 'Status',
      optionen: ['Idee', 'geplant', 'bestätigt', 'abgeschlossen', 'abgesagt'],
      standard: 'geplant',
    },
    { name: 'kunde_id', typ: 'text', label: 'Kunde', verweis: 'kunden' },
    { name: 'link', typ: 'text', label: 'Link' },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
  ],
  indizes: [['start']],
});

export const ABLAUF = tabelle({
  name: 'event_ablauf',
  modul: 'events',
  label: 'Ablaufplan',
  bearbeitbar: true,
  anzeige: 'text',
  spalten: [
    { name: 'event_id', typ: 'text', label: 'Veranstaltung', verweis: 'events', pflicht: true },
    { name: 'zeit', typ: 'zeit', label: 'Zeit', pflicht: true },
    { name: 'dauer_min', typ: 'int', label: 'Dauer', einheit: 'min', min: 0 },
    { name: 'text', typ: 'text', label: 'Programmpunkt', pflicht: true },
    { name: 'rolle', typ: 'text', label: 'Zuständig (Rolle, kein Name)' },
  ],
  indizes: [['event_id']],
});

export const AUFGABEN = tabelle({
  name: 'event_aufgaben',
  modul: 'events',
  label: 'Aufgaben',
  bearbeitbar: true,
  anzeige: 'text',
  spalten: [
    { name: 'event_id', typ: 'text', label: 'Veranstaltung', verweis: 'events', pflicht: true },
    { name: 'text', typ: 'text', label: 'Aufgabe', pflicht: true },
    { name: 'frist', typ: 'zeit', label: 'Frist' },
    { name: 'erledigt', typ: 'bool', label: 'Erledigt', standard: false },
    { name: 'art', typ: 'text', label: 'Art', optionen: ['Aufgabe', 'Checkliste'], standard: 'Aufgabe' },
    { name: 'reihenfolge', typ: 'int', label: 'Reihenfolge', standard: 100 },
  ],
  indizes: [['event_id'], ['frist']],
});

export const VORLAGEN = tabelle({
  name: 'event_vorlagen',
  modul: 'events',
  label: 'Vorlagen',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'typ', typ: 'text', label: 'Veranstaltungstyp' },
    { name: 'eintraege', typ: 'json', label: 'Checkliste und Aufgaben (JSON)' },
    { name: 'ablauf', typ: 'json', label: 'Ablauf (JSON)' },
  ],
});

interface Event {
  id: string;
  titel: string;
  start: string;
  ende: string | null;
  ort_name: string | null;
  lat: number | null;
  lon: number | null;
  typ: string | null;
  status: string;
  notizen: string | null;
  link: string | null;
}
interface Aufgabe {
  id: string;
  event_id: string;
  text: string;
  frist: string | null;
  erledigt: boolean;
  art: string;
  reihenfolge: number;
}
interface VorlagenEintrag {
  text: string;
  art: string;
  /** Frist relativ zum Beginn in Tagen (negativ = vorher) */
  tage?: number | null;
}

export const events: ModulDef = {
  id: 'events',
  name: 'Event Zentrale',
  beschreibung: 'Veranstaltungen mit Countdown, Ablauf, Checkliste, Aufgaben und Wetter',
  symbol: 'events',
  reihenfolge: 55,
  tabellen: [EVENTS, ABLAUF, AUFGABEN, VORLAGEN],
  regeln: [
    {
      id: 'aufgabe',
      name: 'Aufgabe bald fällig',
      beschreibung: 'Eine offene Aufgabe einer Veranstaltung ist in weniger Stunden fällig als die Schwelle.',
      schwelle: 24,
      schwelleLabel: 'Stunden',
      prioritaet: 3,
      cooldownMin: 720,
    },
  ],
  erstellen: (ctx) => eventsLaufzeit(ctx),
};

function eventsLaufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  let demo: Promise<void> | null = null;

  const wetter = ctx.quelle<{ lat: number; lon: number }, Vorhersage>({
    id: 'events.wetter',
    name: 'Open-Meteo (Veranstaltungsorte)',
    modul: 'events',
    ttlSek: 60 * 60,
    abruf: (p) => vorhersageHolen(p.lat, p.lon),
    demo: (p) => demoVorhersage(p.lat, p.lon, ctx.jetzt()),
    namensnennung: OPENMETEO_NAMENSNENNUNG,
    testParameter: () => ({ lat: 47.42, lon: 9.37 }),
  });

  async function demoVorbereiten() {
    if (!konfig.demo) return;
    demo ??= (async () => {
      if ((await daten.anzahl('events')) > 0) return;
      const tag = (n: number, h: number) => {
        const [j, m, d] = lokalDatum(new Date(ctx.jetzt().getTime() + n * 86400000))
          .split('-')
          .map(Number);
        return vonLokal(j, m, d, h).toISOString();
      };
      const [vorlage] = await daten.einfuegen<{ id: string }>('event_vorlagen', [
        {
          name: 'Turnier (Demo)',
          typ: 'Turnier',
          eintraege: [
            { text: 'Halle reservieren', art: 'Aufgabe', tage: -30 },
            { text: 'Spielplan veröffentlichen', art: 'Aufgabe', tage: -7 },
            { text: 'Kasse und Wechselgeld', art: 'Checkliste' },
            { text: 'Erste Hilfe Material', art: 'Checkliste' },
            { text: 'Banden und Tore aufstellen', art: 'Checkliste' },
          ],
          ablauf: [
            { minuten: -60, text: 'Aufbau' },
            { minuten: 0, text: 'Erstes Spiel' },
            { minuten: 300, text: 'Siegerehrung' },
          ],
        },
      ]);
      const ev = await vonVorlage(vorlage.id, {
        titel: 'Vereinsturnier (Demo)',
        start: tag(12, 9),
        ort_name: 'Sporthalle Kirchberg (Demo)',
        lat: 47.411,
        lon: 9.04,
        typ: 'Turnier',
      });
      await daten.aendern(
        'event_aufgaben',
        (await daten.liste<{ id: string }>('event_aufgaben', { filter: { event_id: ev.id }, limit: 1 }))[0]
          .id,
        { erledigt: true },
      );
      await daten.einfuegen('events', [
        {
          titel: 'Kundenapéro scont (Demo)',
          start: tag(4, 18),
          ort_name: 'St. Gallen',
          lat: 47.4236,
          lon: 9.3748,
          status: 'bestätigt',
          typ: 'Apéro',
        },
      ]);
    })();
    await demo;
  }

  async function vonVorlage(vorlageId: string | null, basis: Record<string, unknown>): Promise<Event> {
    const ev = await daten.eins<Event>('events', { status: 'geplant', ...basis });
    if (!vorlageId) return ev;
    const v = await daten.hole<{
      eintraege: VorlagenEintrag[] | null;
      ablauf: { minuten: number; text: string }[] | null;
    }>('event_vorlagen', vorlageId);
    if (!v) return ev;
    const start = new Date(ev.start).getTime();
    await daten.einfuegen(
      'event_aufgaben',
      (v.eintraege ?? []).map((e, i) => ({
        event_id: ev.id,
        text: String(e.text).slice(0, 300),
        art: e.art === 'Checkliste' ? 'Checkliste' : 'Aufgabe',
        frist: typeof e.tage === 'number' ? new Date(start + e.tage * 86400000).toISOString() : null,
        erledigt: false,
        reihenfolge: i + 1,
      })),
    );
    await daten.einfuegen(
      'event_ablauf',
      (v.ablauf ?? []).map((a) => ({
        event_id: ev.id,
        zeit: new Date(start + Number(a.minuten) * 60000).toISOString(),
        text: String(a.text).slice(0, 300),
      })),
    );
    return ev;
  }

  const liste = async () => {
    await demoVorbereiten();
    return daten.liste<Event>('events', { sortierung: 'start', limit: 300 });
  };

  async function fortschritt(eventId: string) {
    const a = await daten.liste<Aufgabe>('event_aufgaben', { filter: { event_id: eventId }, limit: 500 });
    return { total: a.length, erledigt: a.filter((x) => x.erledigt).length };
  }

  async function routen(app: FastifyInstance) {
    app.get('/liste', async () => {
      const jetzt = ctx.jetzt().getTime();
      return Promise.all(
        (await liste()).map(async (e) => ({
          ...e,
          fortschritt: await fortschritt(e.id),
          vorbei: new Date(e.ende ?? e.start).getTime() < jetzt,
        })),
      );
    });

    app.get<{ Params: { id: string } }>('/event/:id', async (req) => {
      await demoVorbereiten();
      const e = await daten.hole<Event>('events', req.params.id);
      if (!e) throw new EingabeFehler('Veranstaltung nicht gefunden');
      const aufgaben = await daten.liste<Aufgabe>('event_aufgaben', {
        filter: { event_id: e.id },
        sortierung: 'reihenfolge',
        limit: 500,
      });
      let wetterInfo: unknown = null;
      const tageBis = (new Date(e.start).getTime() - ctx.jetzt().getTime()) / 86400000;
      if (e.lat !== null && e.lon !== null && tageBis > -1 && tageBis < 7) {
        const w = await wetter.hole({ lat: e.lat, lon: e.lon });
        const t = new Date(e.start).getTime();
        const stunden = (w.daten?.stunden ?? []).filter(
          (s) => s.t >= t - 3600000 && s.t <= (e.ende ? new Date(e.ende).getTime() : t + 6 * 3600000),
        );
        wetterInfo = {
          stunden,
          tag: w.daten?.tage.find((d) => d.datum === lokalDatum(new Date(e.start))) ?? null,
          demo: w.demo,
          fehler: w.fehler,
        };
      }
      const beitraege = daten.tabelle('content_beitraege')
        ? await daten.liste('content_beitraege', {
            filter: { event_id: e.id },
            sortierung: 'zeit',
            limit: 100,
          })
        : [];
      return {
        event: e,
        ablauf: await daten.liste('event_ablauf', {
          filter: { event_id: e.id },
          sortierung: 'zeit',
          limit: 200,
        }),
        aufgaben: aufgaben.filter((a) => a.art === 'Aufgabe'),
        checkliste: aufgaben.filter((a) => a.art === 'Checkliste'),
        wetter: wetterInfo,
        beitraege,
        vorlagen: await daten.liste('event_vorlagen', { sortierung: 'name', limit: 100 }),
      };
    });

    app.post<{
      Body: {
        titel?: string;
        start?: string;
        vorlage_id?: string;
        ort_name?: string;
        lat?: number;
        lon?: number;
        link?: string;
        typ?: string;
        notizen?: string;
      };
    }>('/neu', async (req) => {
      const b = req.body ?? {};
      const titel = String(b.titel ?? '').trim();
      const start = new Date(String(b.start ?? ''));
      if (!titel || titel.length > 300) throw new EingabeFehler('Titel fehlt');
      if (Number.isNaN(start.getTime())) throw new EingabeFehler('Beginn fehlt');
      const ev = await vonVorlage(b.vorlage_id || null, {
        titel,
        start: start.toISOString(),
        ort_name: b.ort_name ? String(b.ort_name).slice(0, 200) : null,
        lat: Number.isFinite(Number(b.lat)) && b.lat !== undefined && b.lat !== null ? Number(b.lat) : null,
        lon: Number.isFinite(Number(b.lon)) && b.lon !== undefined && b.lon !== null ? Number(b.lon) : null,
        link: typeof b.link === 'string' && /^https?:\/\//.test(b.link) ? b.link.slice(0, 500) : null,
        typ: b.typ ? String(b.typ).slice(0, 100) : null,
        notizen: b.notizen ? String(b.notizen).slice(0, 5000) : null,
      });
      await ctx.aktivitaet('events', `Veranstaltung «${titel}» erstellt`, 'aktion');
      return ev;
    });

    app.post<{ Params: { id: string }; Body: { erledigt: boolean } }>('/aufgabe/:id', async (req) => {
      const a = await daten.aendern<Aufgabe>('event_aufgaben', req.params.id, {
        erledigt: !!req.body?.erledigt,
      });
      if (!a) throw new EingabeFehler('Aufgabe nicht gefunden');
      return a;
    });

    app.post<{ Params: { id: string }; Body: { name?: string; bestaetigt?: boolean } }>(
      '/event/:id/als-vorlage',
      async (req) => {
        if (req.body?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
        const e = await daten.hole<Event>('events', req.params.id);
        if (!e) throw new EingabeFehler('Veranstaltung nicht gefunden');
        const start = new Date(e.start).getTime();
        const aufgaben = await daten.liste<Aufgabe>('event_aufgaben', {
          filter: { event_id: e.id },
          sortierung: 'reihenfolge',
          limit: 500,
        });
        const ablauf = await daten.liste<{ zeit: string; text: string }>('event_ablauf', {
          filter: { event_id: e.id },
          sortierung: 'zeit',
          limit: 200,
        });
        const v = await daten.eins('event_vorlagen', {
          name: String(req.body?.name || `${e.typ ?? 'Vorlage'}: ${e.titel}`).slice(0, 200),
          typ: e.typ,
          eintraege: aufgaben.map((a) => ({
            text: a.text,
            art: a.art,
            tage: a.frist ? Math.round((new Date(a.frist).getTime() - start) / 86400000) : null,
          })),
          ablauf: ablauf.map((x) => ({
            minuten: Math.round((new Date(x.zeit).getTime() - start) / 60000),
            text: x.text,
          })),
        });
        await ctx.aktivitaet('events', `Vorlage aus «${e.titel}» gespeichert`, 'aktion');
        return v;
      },
    );
  }

  const jobs = [
    {
      id: 'aufgaben',
      name: 'Fällige Aufgaben',
      intervallSek: 1800,
      startVerzoegerungSek: 100,
      lauf: async () => {
        const regel = ctx.alarm.regel('events.aufgabe');
        const stunden = regel?.schwelle ?? 24;
        const bis = new Date(ctx.jetzt().getTime() + stunden * 3600000).toISOString();
        const offen = await daten.liste<Aufgabe>('event_aufgaben', {
          filter: { erledigt: false, frist: { lte: bis, gte: ctx.jetzt().toISOString() } },
          limit: 100,
        });
        for (const a of offen) {
          const e = await daten.hole<Event>('events', a.event_id);
          await ctx.alarm.melden({
            regel: 'events.aufgabe',
            titel: `Aufgabe fällig: ${a.text}`,
            text: `${e?.titel ?? 'Veranstaltung'}, Frist ${new Date(a.frist!).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
            schluessel: `aufgabe:${a.id}`,
          });
        }
        return offen.length ? `${offen.length} fällig` : undefined;
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const jetzt = ctx.jetzt().getTime();
    const kommende = (await liste()).filter(
      (e) => new Date(e.start).getTime() > jetzt && e.status !== 'abgesagt',
    );
    const n = kommende[0];
    if (!n)
      return {
        status: 'neutral',
        titel: 'Event Zentrale',
        wert: '–',
        unter: 'keine Veranstaltung geplant',
        demo: konfig.demo,
      };
    const tage = Math.ceil((new Date(n.start).getTime() - jetzt) / 86400000);
    const f = await fortschritt(n.id);
    return {
      status: 'ok',
      titel: 'Event Zentrale',
      wert: String(tage),
      einheit: tage === 1 ? 'Tag' : 'Tage',
      unter: `bis ${n.titel}`,
      zeilen: [
        ...(f.total
          ? [
              {
                text: 'Erledigt',
                wert: `${f.erledigt} von ${f.total}`,
                status: (f.erledigt < f.total && tage < 3 ? 'warnung' : 'neutral') as Ampel,
              },
            ]
          : []),
        ...kommende.slice(1, 3).map((e) => ({
          text: e.titel,
          wert: new Date(e.start).toLocaleDateString('de-CH', {
            timeZone: 'Europe/Zurich',
            day: 'numeric',
            month: 'numeric',
          }),
        })),
      ],
      demo: konfig.demo,
    };
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    await demoVorbereiten();
    const ev = await daten.liste<Event>('events', {
      filter: { start: { gte: von.toISOString(), lte: bis.toISOString() } },
      limit: 200,
    });
    const aufgaben = await daten.liste<Aufgabe>('event_aufgaben', {
      filter: { frist: { gte: von.toISOString(), lte: bis.toISOString() }, erledigt: false },
      limit: 200,
    });
    return [
      ...ev.map((e) => ({
        id: `event-${e.id}`,
        modul: 'events',
        art: e.typ ?? 'Veranstaltung',
        titel: e.titel,
        text: e.ort_name ?? undefined,
        start: e.start,
        ende: e.ende ?? undefined,
        link: `/modul/events?event=${e.id}`,
        status: (e.status === 'abgesagt' ? 'ausfall' : 'neutral') as Ampel,
      })),
      ...aufgaben.map((a) => ({
        id: `aufgabe-${a.id}`,
        modul: 'events',
        art: 'Aufgabe',
        titel: a.text,
        start: a.frist!,
        link: `/modul/events?event=${a.event_id}`,
        status: 'warnung' as Ampel,
      })),
    ];
  }

  return { routen, jobs, kachel, timeline };
}
