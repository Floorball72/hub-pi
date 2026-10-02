// Modul Drohne: Planungskarte mit Orten, Wetter auf Flughöhe, Luftraum, Sonne und Licht, Wetterfenster, Kundendrehs.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler } from '../../daten/schema.ts';
import type { Ampel, Ebene, GeoPunkt, Kachel, PunkteAntwort, TimelineEintrag } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { lokalDatum, vonLokal } from '../../kern/zeit.ts';
import { demoKp, demoVorhersage } from '../../quellen/demo-wetter.ts';
import { type DrohnenZone, drohnenZonen, GEOADMIN_NAMENSNENNUNG, WMTS } from '../../quellen/geoadmin.ts';
import { type KpWert, kpHolen, kpZusammenfassen } from '../../quellen/kp.ts';
import { OPENMETEO_NAMENSNENNUNG, type Vorhersage, vorhersageHolen } from '../../quellen/openmeteo.ts';
import { mond, sonnenZeiten } from '../../quellen/sonne.ts';
import { type Fenster, fensterFinden, type Grenzen, STANDARD_GRENZEN, stundeBewerten } from './fenster.ts';
import { type Dreh, DREHS, DROHNEN_ORTE, type DrohnenOrt } from './tabellen.ts';

export const DROHNE_TABELLEN = [DROHNEN_ORTE, DREHS];

function grenzen(o: DrohnenOrt): Grenzen {
  const g = { ...STANDARD_GRENZEN };
  for (const k of Object.keys(g) as (keyof Grenzen)[])
    if (o[k] !== null && o[k] !== undefined) g[k] = o[k] as number;
  return g;
}

export const drohne: ModulDef = {
  id: 'drohne',
  name: 'Drohne',
  beschreibung: 'Planungskarte, Wetter auf Flughöhe, Luftraum, Licht und Kundendrehs',
  symbol: 'drohne',
  reihenfolge: 30,
  tabellen: DROHNE_TABELLEN,
  regeln: [
    {
      id: 'wetterfenster',
      name: 'Passendes Wetterfenster',
      beschreibung:
        'Für einen Ort mit eingeschaltetem Alarm gibt es in den nächsten 48 Stunden ein Fenster, das das Mindestwetter erfüllt. Schwelle: Mindestdauer in Stunden.',
      schwelle: 2,
      schwelleLabel: 'Stunden',
      prioritaet: 3,
      cooldownMin: 720,
    },
  ],
  erstellen: (ctx) => drohneLaufzeit(ctx),
};

function drohneLaufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  let demoAngelegt: Promise<void> | null = null;

  const wetter = ctx.quelle<{ lat: number; lon: number }, Vorhersage>({
    id: 'drohne.wetter',
    name: 'Open-Meteo (Drohnen Orte)',
    modul: 'drohne',
    ttlSek: 30 * 60,
    abruf: (p) => vorhersageHolen(p.lat, p.lon),
    demo: (p) => demoVorhersage(p.lat, p.lon, ctx.jetzt()),
    namensnennung: OPENMETEO_NAMENSNENNUNG,
    testParameter: () => ({ lat: 47.3, lon: 9.1 }),
  });
  const luftraum = ctx.quelle<{ lat: number; lon: number }, DrohnenZone[]>({
    id: 'drohne.luftraum',
    name: 'Luftraum für Drohnen (geo.admin.ch)',
    modul: 'drohne',
    ttlSek: 7 * 86400,
    abruf: (p) => drohnenZonen(p.lat, p.lon),
    demo: (p) =>
      p.lat > 47.42
        ? [
            {
              name: 'Demo Zone Flugplatz',
              einschraenkung:
                'Der Betrieb von unbemannten Luftfahrzeugen mit einem Gewicht von mehr als 250 g ist verboten.',
              grund: 'AIR_TRAFFIC',
              art: 'REQ_AUTHORISATION',
              hinweis: 'Ausnahmebewilligungen können bei der zuständigen Stelle beantragt werden.',
              bewilligung: null,
            },
          ]
        : [],
    namensnennung: GEOADMIN_NAMENSNENNUNG,
    testParameter: () => ({ lat: 47.4502, lon: 8.5617 }),
  });
  const kp = ctx.quelle<void, KpWert[]>({
    id: 'drohne.kp',
    name: 'KP Index (NOAA SWPC)',
    modul: 'drohne',
    ttlSek: 3 * 3600,
    abruf: () => kpHolen(),
    demo: () => demoKp(ctx.jetzt()),
    namensnennung: 'NOAA Space Weather Prediction Center',
  });

  async function demoVorbereiten() {
    if (!konfig.demo) return;
    demoAngelegt ??= (async () => {
      if ((await daten.anzahl('drohnen_orte')) > 0) return;
      const morgen = new Date(ctx.jetzt().getTime() + 86400000);
      const t = (tage: number, stunde: number) => {
        const d = new Date(ctx.jetzt().getTime() + tage * 86400000);
        const l = lokalDatum(d).split('-').map(Number);
        return vonLokal(l[0], l[1], l[2], stunde).toISOString();
      };
      const [dreh1, dreh2] = await daten.einfuegen<{ id: string }>('drehs', [
        {
          titel: 'Imagefilm Bäckerei (Demo)',
          termin: t(2, 9),
          status: 'Dreh',
          frist: lokalDatum(new Date(morgen.getTime() + 12 * 86400000)),
          drehbuch: '1. Anflug über das Dorf\n2. Orbit um die Backstube\n3. Abflug Richtung Säntis',
        },
        {
          titel: 'Vereinsvideo Turnverein (Demo)',
          termin: t(9, 14),
          status: 'Anfrage',
          frist: lokalDatum(new Date(morgen.getTime() + 30 * 86400000)),
        },
      ]);
      await daten.einfuegen('drohnen_orte', [
        {
          name: 'Aussicht oberhalb Kirchberg (Demo)',
          lat: 47.4235,
          lon: 9.0565,
          status: 'geplant',
          shortlist: true,
          dreh_id: dreh1.id,
          wetterfenster_alarm: true,
          flughoehe_m: 100,
          notizen: 'Parkplatz beim Waldrand, Startplatz flach.',
        },
        {
          name: 'Thur bei Bazenheid (Demo)',
          lat: 47.4096,
          lon: 9.0685,
          status: 'Idee',
          shortlist: true,
          flughoehe_m: 60,
          notizen: 'Morgens Nebel über dem Fluss möglich.',
        },
        {
          name: 'Hügel bei Wil (Demo)',
          lat: 47.4552,
          lon: 9.0402,
          status: 'Idee',
          shortlist: false,
          dreh_id: dreh2.id,
        },
        {
          name: 'Alpstein Blick (Demo)',
          lat: 47.2965,
          lon: 9.2805,
          status: 'gedreht',
          shortlist: false,
          notizen: 'Golden Hour im Oktober ideal.',
        },
      ]);
    })();
    await demoAngelegt;
  }

  const orte = async () => {
    await demoVorbereiten();
    return daten.liste<DrohnenOrt>('drohnen_orte', { sortierung: 'name', limit: 300 });
  };

  async function kpJetzt() {
    const r = await kp.hole();
    return r.daten ? kpZusammenfassen(r.daten, ctx.jetzt()) : { aktuell: null, maxPrognose: null };
  }

  async function ortAuswerten(o: DrohnenOrt, stunden = 48) {
    const w = await wetter.hole({ lat: o.lat, lon: o.lon });
    const k = await kpJetzt();
    const jetzt = ctx.jetzt().getTime();
    const g = grenzen(o);
    const fenster: Fenster[] = w.daten
      ? fensterFinden(w.daten.stunden, g, k.maxPrognose, jetzt, jetzt + stunden * 3600000)
      : [];
    const jetztStunde = w.daten?.stunden.find((s) => s.t <= jetzt && s.t + 3600000 > jetzt);
    return {
      wetter: w,
      fenster,
      jetzt: jetztStunde ? stundeBewerten(jetztStunde, g, k.aktuell) : null,
      grenzen: g,
      kp: k,
    };
  }

  async function routen(app: FastifyInstance) {
    app.get('/orte', async () => {
      const liste = await orte();
      return Promise.all(
        liste.map(async (o) => {
          const a = await ortAuswerten(o);
          return {
            ort: o,
            naechstesFenster: a.fenster[0] ?? null,
            jetztOk: a.jetzt?.ok ?? null,
            gruende: a.jetzt?.gruende ?? [],
          };
        }),
      );
    });

    app.get<{ Params: { id: string } }>('/ort/:id', async (req) => {
      await demoVorbereiten();
      const o = await daten.hole<DrohnenOrt>('drohnen_orte', req.params.id);
      if (!o) throw new EingabeFehler('Ort nicht gefunden');
      const a = await ortAuswerten(o, 7 * 24);
      const z = await luftraum.hole({ lat: o.lat, lon: o.lon });
      const tage = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(ctx.jetzt().getTime() + i * 86400000);
        const l = lokalDatum(d).split('-').map(Number);
        const mittag = vonLokal(l[0], l[1], l[2], 12);
        return { datum: lokalDatum(d), sonne: sonnenZeiten(mittag, o.lat, o.lon), mond: mond(mittag) };
      });
      const bewertet = (a.wetter.daten?.stunden ?? []).map((s) => ({
        ...s,
        urteil: stundeBewerten(s, a.grenzen, a.kp.maxPrognose),
      }));
      return {
        ort: o,
        grenzen: a.grenzen,
        stunden: bewertet,
        tage,
        fenster: a.fenster,
        kp: a.kp,
        luftraum: { zonen: z.daten ?? [], fehler: z.fehler ?? null, demo: z.demo },
        wetterDemo: a.wetter.demo,
        wetterFehler: a.wetter.fehler ?? null,
        notizen: await daten.liste('notizen', {
          filter: { bezug_typ: 'ort', bezug_id: o.id },
          sortierung: '-erstellt',
          limit: 20,
        }),
      };
    });

    app.get('/punkte', async (): Promise<PunkteAntwort> => {
      const liste = await orte();
      const farbe: Record<string, string> = { Idee: '#94a3b8', geplant: '#34d399', gedreht: '#7c9cff' };
      const punkte: GeoPunkt[] = liste.map((o) => ({
        id: o.id,
        lat: o.lat,
        lon: o.lon,
        titel: o.name,
        text: `${o.status}${o.shortlist ? ' · Shortlist' : ''}${o.notizen ? `\n${o.notizen}` : ''}`,
        symbol: 'drohne',
        farbe: farbe[o.status] ?? '#34d399',
        link: `/modul/drohne?ort=${o.id}`,
      }));
      return { punkte, stand: ctx.jetzt().toISOString(), demo: konfig.demo };
    });

    app.get('/drehs', async () => {
      await demoVorbereiten();
      return daten.liste<Dreh>('drehs', { sortierung: 'termin', limit: 200 });
    });
  }

  function ebenen(): Ebene[] {
    return [
      {
        id: 'drohne.orte',
        name: 'Drohnen Orte',
        gruppe: 'Drohne',
        modul: 'drohne',
        art: 'punkte',
        datenUrl: '/api/m/drohne/punkte',
        namensnennung: '',
        standardAn: true,
      },
      {
        id: 'drohne.zonen',
        name: 'Einschränkungen für Drohnen',
        gruppe: 'Luftraum',
        modul: 'drohne',
        art: 'wmts',
        url: WMTS('ch.bazl.einschraenkungen-drohnen'),
        deckkraft: 0.6,
        namensnennung: '© BAZL, swisstopo',
        hinweis: 'Verbindlich sind nur die offiziellen Angaben des BAZL (map.geo.admin.ch).',
      },
      {
        id: 'drohne.ctr',
        name: 'Kontrollzonen CTR',
        gruppe: 'Luftraum',
        modul: 'drohne',
        art: 'wmts',
        url: WMTS('ch.bazl.luftraeume-kontrollzonen'),
        deckkraft: 0.7,
        namensnennung: '© BAZL, swisstopo',
      },
    ];
  }

  const jobs = [
    {
      id: 'wetterfenster',
      name: 'Wetterfenster prüfen',
      intervallSek: 3600,
      startVerzoegerungSek: 120,
      lauf: async () => {
        const regel = ctx.alarm.regel('drohne.wetterfenster');
        const minStunden = Math.max(1, Math.round(regel?.schwelle ?? 2));
        let gefunden = 0;
        for (const o of (await orte()).filter((x) => x.wetterfenster_alarm)) {
          const a = await ortAuswerten(o);
          const f = a.fenster.find((x) => x.stunden >= minStunden);
          if (!f) continue;
          gefunden++;
          const zeit = (t: number) =>
            new Date(t).toLocaleString('de-CH', {
              timeZone: 'Europe/Zurich',
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });
          await ctx.alarm.melden({
            regel: 'drohne.wetterfenster',
            titel: `Flugwetter: ${o.name}`,
            text: `${zeit(f.start)} bis ${zeit(f.ende)} (${f.stunden} h) passt das Mindestwetter.`,
            wert: f.stunden,
            schluessel: `fenster:${o.id}:${lokalDatum(new Date(f.start))}`,
            tags: ['helicopter'],
          });
        }
        return `${gefunden} Orte mit Fenster`;
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const liste = (await orte()).filter((o) => o.shortlist || o.status === 'geplant');
    const bewertet = await Promise.all(liste.slice(0, 6).map(async (o) => ({ o, a: await ortAuswerten(o) })));
    const k = await kpJetzt();
    const offen = (
      await daten.liste<Dreh>('drehs', { filter: { status: { ne: 'abgeschlossen' } }, limit: 100 })
    ).length;
    const naechstes = bewertet
      .filter((b) => b.a.fenster.length)
      .sort((a, b) => a.a.fenster[0].start - b.a.fenster[0].start)[0];
    const zeit = (t: number) =>
      new Date(t).toLocaleString('de-CH', {
        timeZone: 'Europe/Zurich',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    return {
      status: 'ok',
      titel: 'Drohne',
      wert: naechstes ? zeit(naechstes.a.fenster[0].start) : 'kein Fenster',
      unter: naechstes ? `nächstes Flugfenster: ${naechstes.o.name}` : 'in den nächsten 48 Stunden',
      zeilen: [
        ...bewertet.slice(0, 3).map((b) => ({
          text: b.o.name,
          wert: b.a.jetzt?.ok ? 'jetzt fliegbar' : (b.a.jetzt?.gruende[0] ?? '–'),
          status: (b.a.jetzt?.ok ? 'ok' : 'neutral') as Ampel,
        })),
        { text: 'KP Index', wert: k.aktuell !== null ? String(k.aktuell) : '–' },
        { text: 'Offene Kundendrehs', wert: String(offen) },
      ],
      demo: konfig.demo,
    };
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    await demoVorbereiten();
    const drehs = await daten.liste<Dreh>('drehs', {
      filter: { termin: { gte: von.toISOString(), lte: bis.toISOString() } },
      limit: 200,
    });
    const fristen = await daten.liste<Dreh>('drehs', {
      filter: { frist: { gte: lokalDatum(von), lte: lokalDatum(bis) }, status: { ne: 'abgeschlossen' } },
      limit: 200,
    });
    return [
      ...drehs.map((d) => ({
        id: `dreh-${d.id}`,
        modul: 'drohne',
        art: 'Kundendreh',
        titel: d.titel,
        text: d.status,
        start: d.termin!,
        link: `/modul/drohne?dreh=${d.id}`,
      })),
      ...fristen.map((d) => ({
        id: `frist-${d.id}`,
        modul: 'drohne',
        art: 'Lieferfrist',
        titel: d.titel,
        text: `Status: ${d.status}`,
        start: d.frist!,
        ganztags: true,
        status: 'warnung' as Ampel,
        link: `/modul/drohne?dreh=${d.id}`,
      })),
    ];
  }

  return { routen, ebenen, jobs, kachel, timeline };
}
