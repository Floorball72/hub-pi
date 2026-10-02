// Modul Drohne: Planungskarte mit Orten, Wetter auf Flughöhe, Luftraum, Sonne und Licht, Wetterfenster, Kundendrehs.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler } from '../../daten/schema.ts';
import type { Ampel, Ebene, GeoPunkt, Kachel, PunkteAntwort, TimelineEintrag } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { lokal, lokalDatum, vonLokal } from '../../kern/zeit.ts';
import { demoKp, demoVorhersage } from '../../quellen/demo-wetter.ts';
import { type DrohnenZone, drohnenZonen, GEOADMIN_NAMENSNENNUNG, WMTS } from '../../quellen/geoadmin.ts';
import { type KpWert, kpHolen, kpZusammenfassen } from '../../quellen/kp.ts';
import { OPENMETEO_NAMENSNENNUNG, type Vorhersage, vorhersageHolen } from '../../quellen/openmeteo.ts';
import { mond, sonnenstand, sonnenZeiten } from '../../quellen/sonne.ts';
import { himmelsrichtung } from '../../geteilt/wetter.ts';
import {
  type Gewichte,
  naechsteStunde,
  punktInRichtung,
  type SonnenPrognose,
  STANDARD_GEWICHTE,
  sonnenScore,
  vergleich,
} from './sonnenuntergang.ts';
import { type Fenster, fensterFinden, type Grenzen, STANDARD_GRENZEN, stundeBewerten } from './fenster.ts';
import {
  AKKUS,
  DOKUMENTE,
  SONNEN_BEWERTUNGEN,
  type Dreh,
  DREHS,
  DROHNEN_ORTE,
  type DrohnenOrt,
  FLUEGE,
  WARTUNG,
} from './tabellen.ts';

export const DROHNE_TABELLEN = [DROHNEN_ORTE, DREHS, FLUEGE, AKKUS, WARTUNG, DOKUMENTE, SONNEN_BEWERTUNGEN];

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
    {
      id: 'sonne',
      name: 'Schöner Sonnenauf oder untergang',
      beschreibung:
        'Für Orte mit eingeschaltetem Sonnen Alarm: Prognose Score ab der Schwelle (0 bis 100), mit Uhrzeit und Himmelsrichtung.',
      schwelle: 75,
      schwelleLabel: 'Score',
      prioritaet: 3,
      cooldownMin: 600,
    },
    {
      id: 'frist',
      name: 'Frist läuft ab',
      beschreibung:
        'Versicherung, Registrierung, Ausweis, Weiterbildung oder Wartung läuft in weniger Tagen ab als die Schwelle.',
      schwelle: 30,
      schwelleLabel: 'Tage',
      prioritaet: 3,
      cooldownMin: 10080,
    },
    {
      id: 'akku',
      name: 'Akku am Ende der Lebensdauer',
      beschreibung: 'Ein Akku erreicht den Anteil seiner empfohlenen Zyklen (Prozent).',
      schwelle: 90,
      schwelleLabel: '% der Zyklen',
      prioritaet: 2,
      cooldownMin: 10080,
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

  const jobs: JobDef[] = [
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

  interface Akku {
    id: string;
    name: string;
    zyklen_start: number | null;
    zyklen_max: number | null;
    status: string;
  }

  async function akkuZustand() {
    const akkus = await daten.liste<Akku>('akkus', { sortierung: 'name', limit: 100 });
    return Promise.all(
      akkus.map(async (a) => {
        const zyklen = (a.zyklen_start ?? 0) + (await daten.anzahl('drohnen_fluege', { akku_id: a.id }));
        return { ...a, zyklen, anteil: a.zyklen_max ? Math.round((zyklen / a.zyklen_max) * 100) : null };
      }),
    );
  }

  async function flugStatistik() {
    const fluege = await daten.liste<{
      datum: string;
      dauer_min: number;
      ort_id: string | null;
      kategorie: string | null;
    }>('drohnen_fluege', {
      sortierung: '-datum',
      limit: 5000,
    });
    const jahr = String(lokal(ctx.jetzt()).jahr);
    const diesesJahr = fluege.filter((f) => lokalDatum(new Date(f.datum)).startsWith(jahr));
    const proMonat = Array(12).fill(0) as number[];
    for (const f of diesesJahr)
      proMonat[Number(lokalDatum(new Date(f.datum)).slice(5, 7)) - 1] += f.dauer_min;
    return {
      anzahl: fluege.length,
      minutenTotal: Math.round(fluege.reduce((s, f) => s + f.dauer_min, 0)),
      anzahlJahr: diesesJahr.length,
      minutenJahr: Math.round(diesesJahr.reduce((s, f) => s + f.dauer_min, 0)),
      proMonat: proMonat.map((m) => Math.round(m)),
      letzterFlug: fluege[0]?.datum ?? null,
    };
  }

  async function extrasDemo() {
    if (!konfig.demo || (await daten.anzahl('akkus')) > 0) return;
    const [a1, a2] = await daten.einfuegen<{ id: string }>('akkus', [
      {
        name: 'Akku 1 (Demo)',
        drohne: 'Demo Drohne',
        zyklen_start: 120,
        zyklen_max: 200,
        status: 'in Betrieb',
      },
      {
        name: 'Akku 2 (Demo)',
        drohne: 'Demo Drohne',
        zyklen_start: 40,
        zyklen_max: 200,
        status: 'in Betrieb',
      },
    ]);
    const orte = await daten.liste<{ id: string }>('drohnen_orte', { limit: 4 });
    const fluege: Record<string, unknown>[] = [];
    for (let i = 0; i < 24; i++) {
      fluege.push({
        datum: new Date(ctx.jetzt().getTime() - (i * 9 + 2) * 86400000).toISOString(),
        dauer_min: 8 + ((i * 7) % 18),
        drohne: 'Demo Drohne',
        ort_id: orte[i % Math.max(1, orte.length)]?.id ?? null,
        akku_id: i % 2 ? a1.id : a2.id,
        kategorie: 'offen A1',
        max_hoehe_m: 60 + ((i * 13) % 60),
        zweck: ['Probeflug', 'Kundendreh', 'Übung', 'Landschaft'][i % 4],
      });
    }
    await daten.einfuegen('drohnen_fluege', fluege);
    const tag = (n: number) => lokalDatum(new Date(ctx.jetzt().getTime() + n * 86400000));
    await daten.einfuegen('drohnen_dokumente', [
      { titel: 'Haftpflichtversicherung Drohne (Demo)', art: 'Versicherung', ablauf: tag(24) },
      { titel: 'Betreiber Registrierung BAZL (Demo)', art: 'Registrierung', ablauf: tag(400) },
      { titel: 'Kompetenznachweis A2 (Demo)', art: 'Ausweis', ablauf: tag(900) },
    ]);
    await daten.einfuegen('wartung', [
      { datum: tag(-60), gegenstand: 'Demo Drohne', arbeit: 'Propeller ersetzt', naechste: tag(30) },
    ]);
  }

  async function fristenPruefen() {
    const bis = lokalDatum(new Date(ctx.jetzt().getTime() + 120 * 86400000));
    const dok = await daten.liste<{ id: string; titel: string; ablauf: string }>('drohnen_dokumente', {
      filter: { ablauf: { lte: bis } },
      limit: 100,
    });
    const wartung = await daten.liste<{ id: string; gegenstand: string; arbeit: string; naechste: string }>(
      'wartung',
      { filter: { naechste: { lte: bis } }, limit: 100 },
    );
    const tage = (d: string) =>
      Math.floor((new Date(`${d}T12:00:00Z`).getTime() - ctx.jetzt().getTime()) / 86400000);
    for (const d of dok) {
      await ctx.alarm.melden({
        regel: 'drohne.frist',
        titel: `Frist: ${d.titel}`,
        text: `Gültig bis ${d.ablauf} (in ${tage(d.ablauf)} Tagen).`,
        wert: tage(d.ablauf),
        richtung: 'unter',
        schluessel: `dok:${d.id}:${d.ablauf}`,
      });
    }
    for (const w of wartung) {
      await ctx.alarm.melden({
        regel: 'drohne.frist',
        titel: `Wartung: ${w.gegenstand}`,
        text: `${w.arbeit}, nächste Wartung ${w.naechste}.`,
        wert: tage(w.naechste),
        richtung: 'unter',
        schluessel: `wartung:${w.id}:${w.naechste}`,
      });
    }
    for (const a of await akkuZustand()) {
      if (a.anteil === null || a.status === 'ausgemustert') continue;
      await ctx.alarm.melden({
        regel: 'drohne.akku',
        titel: `Akku: ${a.name}`,
        text: `${a.zyklen} von ${a.zyklen_max} Zyklen (${a.anteil} %).`,
        wert: a.anteil,
        schluessel: `akku:${a.id}`,
      });
    }
  }

  async function extrasRouten(app: FastifyInstance) {
    app.get('/extras', async () => {
      await demoVorbereiten();
      await extrasDemo();
      const bis = lokalDatum(new Date(ctx.jetzt().getTime() + 120 * 86400000));
      return {
        statistik: await flugStatistik(),
        akkus: await akkuZustand(),
        fristen: [
          ...(
            await daten.liste<{ titel: string; ablauf: string; art: string }>('drohnen_dokumente', {
              filter: { ablauf: { lte: bis } },
              sortierung: 'ablauf',
              limit: 20,
            })
          ).map((d) => ({ titel: d.titel, datum: d.ablauf, art: d.art })),
          ...(
            await daten.liste<{ gegenstand: string; arbeit: string; naechste: string }>('wartung', {
              filter: { naechste: { lte: bis } },
              sortierung: 'naechste',
              limit: 20,
            })
          ).map((w) => ({ titel: `${w.gegenstand}: ${w.arbeit}`, datum: w.naechste, art: 'Wartung' })),
        ].sort((a, b) => a.datum.localeCompare(b.datum)),
      };
    });
  }

  jobs.push({
    id: 'fristen',
    name: 'Drohnen Fristen und Akkus',
    taeglich: '08:10',
    lauf: async () => {
      await fristenPruefen();
      return undefined;
    },
  });

  async function timelineMitFristen(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    const basis = await timeline(von, bis);
    const dok = await daten.liste<{ id: string; titel: string; ablauf: string; art: string }>(
      'drohnen_dokumente',
      {
        filter: { ablauf: { gte: lokalDatum(von), lte: lokalDatum(bis) } },
        limit: 100,
      },
    );
    return [
      ...basis,
      ...dok.map((d) => ({
        id: `dok-${d.id}`,
        modul: 'drohne',
        art: `Frist ${d.art}`,
        titel: d.titel,
        start: d.ablauf,
        ganztags: true,
        status: 'warnung' as Ampel,
        link: '/modul/drohne',
      })),
    ];
  }

  // Sonnenauf und Sonnenuntergang Prognose
  const gewichte = () => ({
    ...STANDARD_GEWICHTE,
    ...ctx.einstellungen.hole<Partial<Gewichte>>('drohne.sonne.gewichte', {}),
  });

  async function sonnenPrognose(
    o: { lat: number; lon: number },
    tag: string,
    ereignis: 'aufgang' | 'untergang',
  ): Promise<SonnenPrognose | null> {
    const [j, m, d] = tag.split('-').map(Number);
    const z = sonnenZeiten(vonLokal(j, m, d, 12), o.lat, o.lon);
    const zeit = ereignis === 'aufgang' ? z.aufgang : z.untergang;
    if (!zeit) return null;
    const azimut = Math.round(sonnenstand(zeit, o.lat, o.lon).azimut);
    const [lokalW, hor] = await Promise.all([
      wetter.hole({ lat: o.lat, lon: o.lon }),
      wetter.hole(punktInRichtung(o.lat, o.lon, azimut, 80)),
    ]);
    const s = lokalW.daten ? naechsteStunde(lokalW.daten.stunden, zeit.getTime()) : null;
    if (!s) return null;
    const h = hor.daten ? naechsteStunde(hor.daten.stunden, zeit.getTime()) : null;
    return { ...sonnenScore(s, h, gewichte()), zeit: zeit.toISOString(), azimut };
  }

  async function prognoseSpeichern(
    ortId: string,
    tag: string,
    ereignis: string,
    p: SonnenPrognose,
    bewertung?: number,
  ) {
    const [alt] = await daten.liste<{ id: string }>('sonnen_bewertungen', {
      filter: { ort_id: ortId, datum: tag, ereignis },
      limit: 1,
    });
    const zeile: Record<string, unknown> = {
      ort_id: ortId,
      datum: tag,
      ereignis,
      score: p.score,
      faktoren: p.faktoren,
    };
    if (bewertung !== undefined) zeile.bewertung = bewertung;
    if (alt) {
      // Die Prognose vom Vortag bleibt bestehen, nur die Bewertung kommt dazu
      await daten.aendern('sonnen_bewertungen', alt.id, bewertung !== undefined ? { bewertung } : zeile);
    } else await daten.einfuegen('sonnen_bewertungen', [zeile]);
  }

  async function sonneRouten(app: FastifyInstance) {
    app.get<{ Querystring: { ort: string; tage?: string } }>('/sonne/prognose', async (req) => {
      await demoVorbereiten();
      const o = await daten.hole<DrohnenOrt>('drohnen_orte', String(req.query.ort ?? ''));
      if (!o) throw new EingabeFehler('Ort nicht gefunden');
      const tage = Math.min(Number(req.query.tage) || 5, 7);
      const liste = [];
      for (let i = 0; i < tage; i++) {
        const tag = lokalDatum(new Date(ctx.jetzt().getTime() + i * 86400000));
        for (const ereignis of ['aufgang', 'untergang'] as const) {
          const p = await sonnenPrognose(o, tag, ereignis);
          if (p) liste.push({ tag, ereignis, ...p, richtung: himmelsrichtung(p.azimut) });
        }
      }
      return {
        ort: o,
        prognosen: liste.filter((x) => new Date(x.zeit).getTime() > ctx.jetzt().getTime() - 6 * 3600000),
        gewichte: gewichte(),
      };
    });
    app.post<{ Body: { ort_id: string; datum: string; ereignis: string; bewertung: number } }>(
      '/sonne/bewertung',
      async (req) => {
        const b = req.body ?? ({} as { ort_id: string; datum: string; ereignis: string; bewertung: number });
        const o = await daten.hole<DrohnenOrt>('drohnen_orte', String(b.ort_id ?? ''));
        if (!o) throw new EingabeFehler('Ort nicht gefunden');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.datum)) || !['aufgang', 'untergang'].includes(b.ereignis))
          throw new EingabeFehler('Ungültiges Datum oder Ereignis');
        const wert = Number(b.bewertung);
        if (!Number.isInteger(wert) || wert < 1 || wert > 5) throw new EingabeFehler('Bewertung 1 bis 5');
        const p = await sonnenPrognose(o, b.datum, b.ereignis as 'aufgang' | 'untergang');
        if (!p) throw new EingabeFehler('Für diesen Tag gibt es keine Wetterdaten mehr');
        await prognoseSpeichern(o.id, b.datum, b.ereignis, p, wert);
        return { ok: true };
      },
    );
    app.get('/sonne/vergleich', async () => {
      const zeilen = await daten.liste<{
        ort_id: string;
        datum: string;
        ereignis: string;
        score: number;
        bewertung: number | null;
      }>('sonnen_bewertungen', {
        sortierung: '-datum',
        limit: 500,
      });
      const bewertet = zeilen.filter((z) => z.bewertung !== null) as {
        ort_id: string;
        datum: string;
        ereignis: string;
        score: number;
        bewertung: number;
      }[];
      return { ...vergleich(bewertet), zeilen: bewertet.slice(0, 60) };
    });
    app.put<{ Body: Partial<Gewichte> }>('/sonne/gewichte', async (req) => {
      const neu: Partial<Gewichte> = {};
      for (const k of Object.keys(STANDARD_GEWICHTE) as (keyof Gewichte)[]) {
        const w = Number((req.body ?? {})[k]);
        if (!Number.isFinite(w) || w < 0 || w > 10)
          throw new EingabeFehler(`Gewicht ${k}: Zahl von 0 bis 10`);
        neu[k] = w;
      }
      await ctx.einstellungen.setze('drohne.sonne.gewichte', neu);
      await ctx.aktivitaet('drohne', 'Gewichte der Sonnenuntergangs Prognose geändert', 'aktion');
      return gewichte();
    });
  }

  async function sonnenAlarm(ereignis: 'aufgang' | 'untergang', tagOffset: number) {
    const tag = lokalDatum(new Date(ctx.jetzt().getTime() + tagOffset * 86400000));
    let n = 0;
    for (const o of (await orte()).filter((x) => x.sonnen_alarm || x.shortlist)) {
      const p = await sonnenPrognose(o, tag, ereignis);
      if (!p) continue;
      await prognoseSpeichern(o.id, tag, ereignis, p);
      if (!o.sonnen_alarm) continue;
      n++;
      const uhr = new Date(p.zeit).toLocaleTimeString('de-CH', {
        timeZone: 'Europe/Zurich',
        hour: '2-digit',
        minute: '2-digit',
      });
      await ctx.alarm.melden({
        regel: 'drohne.sonne',
        titel: `${ereignis === 'aufgang' ? 'Sonnenaufgang' : 'Sonnenuntergang'} ${p.score}/100: ${o.name}`,
        text: `${tagOffset ? 'Morgen' : 'Heute'} ${uhr}, Richtung ${himmelsrichtung(p.azimut)} (${p.azimut}°). ${p.faktoren
          .slice(0, 2)
          .map((f) => `${f.label}: ${f.text}`)
          .join(', ')}.`,
        wert: p.score,
        schluessel: `sonne:${o.id}:${tag}:${ereignis}`,
        tags: ['sunrise'],
      });
    }
    return `${n} Orte geprüft`;
  }

  jobs.push(
    {
      id: 'sonnenuntergang',
      name: 'Sonnenuntergang Prognose',
      taeglich: '13:00',
      lauf: () => sonnenAlarm('untergang', 0),
    },
    {
      id: 'sonnenaufgang',
      name: 'Sonnenaufgang Prognose (morgen)',
      taeglich: '19:30',
      lauf: () => sonnenAlarm('aufgang', 1),
    },
  );

  const alleRouten = async (app: FastifyInstance) => {
    await routen(app);
    await extrasRouten(app);
    await sonneRouten(app);
  };

  return { routen: alleRouten, ebenen, jobs, kachel, timeline: timelineMitFristen };
}
