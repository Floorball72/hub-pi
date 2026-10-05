// Modul Inventar: Geräte und Ausrüstung mit Kaufdatum, Wert, Standort, Garantie und Wartung.
// Liefert eine Liste für die Hausratversicherung und erinnert an Garantieende und Wartungen.
import type { FastifyInstance } from 'fastify';
import { tabelle } from '../../daten/schema.ts';
import type {
  Ampel,
  BriefingTeil,
  Kachel,
  KachelZeile,
  SuchTreffer,
  TimelineEintrag,
} from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { lokalDatum } from '../../kern/zeit.ts';
import { plusMonate, plusTage } from '../aufgaben/wiederholung.ts';
import { csvFeld, garantieEnde, garantieStufe, KATEGORIEN, naechsteWartung, tageBis } from './rechnen.ts';

export const GEGENSTAENDE = tabelle({
  name: 'gegenstaende',
  modul: 'inventar',
  label: 'Inventar',
  bearbeitbar: true,
  anzeige: 'name',
  suche: ['name', 'marke', 'modell', 'ort'],
  spalten: [
    { name: 'name', typ: 'text', label: 'Gegenstand', pflicht: true },
    { name: 'kategorie', typ: 'text', label: 'Kategorie', optionen: KATEGORIEN, standard: 'Andere' },
    { name: 'ort', typ: 'text', label: 'Standort' },
    { name: 'marke', typ: 'text', label: 'Marke' },
    { name: 'modell', typ: 'text', label: 'Modell' },
    { name: 'seriennummer', typ: 'text', label: 'Seriennummer' },
    { name: 'gekauft_am', typ: 'datum', label: 'Gekauft am' },
    { name: 'preis', typ: 'real', label: 'Kaufpreis', einheit: 'CHF', min: 0 },
    { name: 'haendler', typ: 'text', label: 'Händler' },
    {
      name: 'garantie_monate',
      typ: 'int',
      label: 'Garantie',
      einheit: 'Monate',
      standard: 24,
      min: 0,
      max: 120,
    },
    { name: 'garantie_bis', typ: 'datum', label: 'Garantie bis (falls abweichend)' },
    { name: 'beleg', typ: 'text', label: 'Beleg (Link oder Ablageort)' },
    { name: 'wartung_monate', typ: 'int', label: 'Wartung alle', einheit: 'Monate', min: 0, max: 120 },
    { name: 'wartung_text', typ: 'text', label: 'Was warten' },
    { name: 'letzte_wartung', typ: 'datum', label: 'Letzte Wartung' },
    { name: 'ausgemustert', typ: 'bool', label: 'Ausgemustert', standard: false },
    { name: 'notiz', typ: 'text', label: 'Notiz', lang: true },
  ],
  indizes: [['ausgemustert']],
});

interface Gegenstand {
  id: string;
  name: string;
  kategorie: string | null;
  ort: string | null;
  marke: string | null;
  modell: string | null;
  seriennummer: string | null;
  gekauft_am: string | null;
  preis: number | null;
  haendler: string | null;
  garantie_monate: number | null;
  garantie_bis: string | null;
  beleg: string | null;
  wartung_monate: number | null;
  wartung_text: string | null;
  letzte_wartung: string | null;
  ausgemustert: boolean;
  notiz: string | null;
}
type Mehr = Gegenstand & {
  garantieEnde: string | null;
  garantieTage: number | null;
  wartung: string | null;
  wartungTage: number | null;
};

export const inventar: ModulDef = {
  id: 'inventar',
  name: 'Inventar',
  beschreibung: 'Geräte und Ausrüstung mit Wert, Standort, Garantie und Wartung',
  symbol: 'inventar',
  reihenfolge: 14,
  tabellen: [GEGENSTAENDE],
  regeln: [
    {
      id: 'garantie',
      name: 'Garantie läuft ab',
      beschreibung: '30 und 7 Tage bevor die Garantie eines Gegenstands endet',
      prioritaet: 2,
      cooldownMin: 600,
    },
    {
      id: 'wartung',
      name: 'Wartung fällig',
      beschreibung: 'Am Tag, an dem eine Wartung fällig wird, danach einmal pro Woche',
      prioritaet: 2,
      cooldownMin: 600,
    },
  ],
  erstellen: (ctx) => inventarLaufzeit(ctx),
};

const DEMO = (h: string) => [
  {
    name: 'Drohne',
    kategorie: 'Drohne und Kamera',
    ort: 'Büro',
    marke: 'DJI',
    modell: 'Mavic 3 Classic',
    gekauft_am: plusTage(plusMonate(h, -24), 30),
    preis: 1690,
    haendler: 'Fachhandel',
    garantie_monate: 24,
    wartung_monate: 6,
    wartung_text: 'Propeller und Motoren prüfen, Firmware',
    letzte_wartung: plusTage(plusMonate(h, -6), 2),
  },
  {
    name: 'Laptop',
    kategorie: 'Elektronik',
    ort: 'Büro',
    marke: 'Apple',
    modell: 'MacBook Pro 14',
    gekauft_am: plusMonate(h, -14),
    preis: 2399,
    garantie_monate: 36,
  },
  {
    name: 'Kamera',
    kategorie: 'Drohne und Kamera',
    ort: 'Büro',
    marke: 'Sony',
    modell: 'A7 IV',
    gekauft_am: plusMonate(h, -30),
    preis: 2499,
    garantie_monate: 24,
    wartung_monate: 12,
    wartung_text: 'Sensor reinigen',
    letzte_wartung: plusMonate(h, -13),
  },
  {
    name: 'Kaffeemaschine',
    kategorie: 'Küche',
    ort: 'Küche',
    marke: 'Jura',
    gekauft_am: plusTage(plusMonate(h, -24), 7),
    preis: 890,
    garantie_monate: 24,
    wartung_monate: 3,
    wartung_text: 'Entkalken und Filter wechseln',
    letzte_wartung: plusTage(plusMonate(h, -3), 4),
  },
  {
    name: 'Fernseher',
    kategorie: 'Elektronik',
    ort: 'Wohnzimmer',
    gekauft_am: plusMonate(h, -40),
    preis: 1290,
  },
  {
    name: 'Sofa',
    kategorie: 'Möbel',
    ort: 'Wohnzimmer',
    gekauft_am: plusMonate(h, -50),
    preis: 1850,
    garantie_monate: 0,
  },
  {
    name: 'Velo',
    kategorie: 'Sport',
    ort: 'Keller',
    gekauft_am: plusMonate(h, -20),
    preis: 2100,
    wartung_monate: 12,
    wartung_text: 'Service beim Velomech',
    letzte_wartung: plusMonate(h, -8),
  },
  {
    name: 'Rauchmelder',
    kategorie: 'Haushalt',
    ort: 'Gang',
    gekauft_am: plusMonate(h, -18),
    preis: 35,
    garantie_monate: 0,
    wartung_monate: 12,
    wartung_text: 'Testknopf drücken, Batterie prüfen',
  },
  {
    name: 'Unihockeystöcke (2)',
    kategorie: 'Sport',
    ort: 'Keller',
    gekauft_am: plusMonate(h, -6),
    preis: 380,
  },
  { name: 'Akkubohrer', kategorie: 'Werkzeug', ort: 'Keller', gekauft_am: plusMonate(h, -60), preis: 189 },
];

function inventarLaufzeit(ctx: Kontext) {
  const { daten } = ctx;
  const heute = () => lokalDatum(ctx.jetzt());
  let bereit: Promise<void> | null = null;

  async function vorbereiten() {
    bereit ??= (async () => {
      if (!ctx.konfig.demo || ctx.einstellungen.hole('inventar.demo_angelegt', false)) return;
      if ((await daten.anzahl('gegenstaende')) > 0) return;
      await daten.einfuegen(
        'gegenstaende',
        DEMO(heute()).map((g) => ({ garantie_monate: 24, ausgemustert: false, ...g })),
      );
      await ctx.einstellungen.setze('inventar.demo_angelegt', true);
    })();
    await bereit;
  }

  function erweitern(g: Gegenstand, h: string): Mehr {
    const ende = garantieEnde(g.gekauft_am, g.garantie_monate, g.garantie_bis);
    const wartung = g.ausgemustert
      ? null
      : naechsteWartung(g.letzte_wartung, g.gekauft_am, g.wartung_monate, h);
    return {
      ...g,
      garantieEnde: ende,
      garantieTage: tageBis(ende, h),
      wartung,
      wartungTage: tageBis(wartung, h),
    };
  }

  async function alle(): Promise<Mehr[]> {
    await vorbereiten();
    const h = heute();
    const liste = await daten.liste<Gegenstand>('gegenstaende', { sortierung: 'name', limit: 2000 });
    return liste.map((g) => erweitern(g, h));
  }

  const runden = (n: number) => Math.round(n * 100) / 100;

  function gruppieren(liste: Mehr[], feld: (g: Mehr) => string) {
    const m = new Map<string, { anzahl: number; wert: number }>();
    for (const g of liste) {
      const k = feld(g);
      const e = m.get(k) ?? { anzahl: 0, wert: 0 };
      e.anzahl++;
      e.wert += g.preis ?? 0;
      m.set(k, e);
    }
    return [...m]
      .map(([name, e]) => ({ name, anzahl: e.anzahl, wert: runden(e.wert) }))
      .sort((a, b) => b.wert - a.wert);
  }

  async function uebersicht() {
    const h = heute();
    const liste = await alle();
    const aktiv = liste.filter((g) => !g.ausgemustert);
    const garantieAktiv = aktiv.filter((g) => (g.garantieTage ?? -1) >= 0);
    return {
      heute: h,
      summen: {
        anzahl: aktiv.length,
        wert: runden(aktiv.reduce((s, g) => s + (g.preis ?? 0), 0)),
        garantie: garantieAktiv.length,
        ohnePreis: aktiv.filter((g) => g.preis == null).length,
      },
      orte: gruppieren(aktiv, (g) => g.ort || 'Ohne Standort'),
      kategorien: gruppieren(aktiv, (g) => g.kategorie || 'Andere'),
      garantien: garantieAktiv
        .filter((g) => (g.garantieTage ?? 999) <= 90)
        .sort((a, b) => (a.garantieTage ?? 0) - (b.garantieTage ?? 0)),
      wartungen: aktiv
        .filter((g) => g.wartung && (g.wartungTage ?? 999) <= 30)
        .sort((a, b) => (a.wartungTage ?? 0) - (b.wartungTage ?? 0)),
      gegenstaende: liste,
    };
  }

  async function routen(app: FastifyInstance) {
    app.addHook('onRequest', async () => vorbereiten());
    app.get('/uebersicht', async () => uebersicht());

    app.post<{ Params: { id: string } }>('/gegenstand/:id/gewartet', async (req, reply) => {
      const g = await daten.hole<Gegenstand>('gegenstaende', req.params.id);
      if (!g) return reply.code(404).send({ fehler: 'Gegenstand nicht gefunden' });
      const h = heute();
      await daten.aendern('gegenstaende', g.id, { letzte_wartung: h });
      ctx.aktivitaet('inventar', `Wartung erledigt: ${g.name}`, 'aktion');
      return { letzte_wartung: h, naechste: naechsteWartung(h, g.gekauft_am, g.wartung_monate, h) };
    });

    // Liste für die Hausratversicherung, Semikolon getrennt mit BOM, damit Excel die Umlaute erkennt
    app.get('/inventar.csv', async (_req, reply) => {
      const liste = (await alle()).filter((g) => !g.ausgemustert);
      const kopf = [
        'Gegenstand',
        'Kategorie',
        'Standort',
        'Marke',
        'Modell',
        'Seriennummer',
        'Gekauft am',
        'Kaufpreis CHF',
        'Händler',
        'Garantie bis',
        'Beleg',
      ];
      const zeilen = liste.map((g) =>
        [
          g.name,
          g.kategorie,
          g.ort,
          g.marke,
          g.modell,
          g.seriennummer,
          g.gekauft_am,
          g.preis?.toFixed(2),
          g.haendler,
          g.garantieEnde,
          g.beleg,
        ]
          .map(csvFeld)
          .join(';'),
      );
      ctx.aktivitaet('inventar', `Inventarliste exportiert (${liste.length} Gegenstände)`, 'aktion');
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="inventar-${heute()}.csv"`)
        .send(`﻿${[kopf.join(';'), ...zeilen].join('\r\n')}\r\n`);
    });
  }

  const jobs = [
    {
      id: 'pruefen',
      name: 'Garantien und Wartungen prüfen',
      taeglich: '08:20',
      startVerzoegerungSek: 90,
      lauf: async () => {
        let gemeldet = 0;
        for (const g of await alle()) {
          if (g.ausgemustert) continue;
          const stufe = garantieStufe(g.garantieTage);
          if (stufe && g.garantieEnde) {
            await ctx.alarm.melden({
              regel: 'inventar.garantie',
              titel: `Garantie ${g.name} endet in ${stufe} Tagen`,
              text: `Garantie bis ${g.garantieEnde}. Mängel jetzt noch melden.`,
              schluessel: `garantie:${g.id}:${g.garantieEnde}:${stufe}`,
              tags: ['shield'],
              link: '/modul/inventar',
            });
            gemeldet++;
          }
          const t = g.wartungTage;
          // Am Tag selbst und danach einmal pro Woche
          if (g.wartung && t !== null && t <= 0 && -t % 7 === 0) {
            await ctx.alarm.melden({
              regel: 'inventar.wartung',
              titel: t === 0 ? `Wartung fällig: ${g.name}` : `Wartung überfällig: ${g.name}`,
              text: g.wartung_text || `Wartung alle ${g.wartung_monate} Monate`,
              schluessel: `wartung:${g.id}:${g.wartung}:${-t}`,
              tags: ['wrench'],
              link: '/modul/inventar#tab=Wartung',
            });
            gemeldet++;
          }
        }
        return gemeldet ? `${gemeldet} Meldungen` : undefined;
      },
    },
  ];

  const chf = (n: number) => `CHF ${n.toLocaleString('de-CH', { maximumFractionDigits: 0 })}`;

  async function kachel(): Promise<Kachel> {
    const u = await uebersicht();
    const faellig = u.wartungen.filter((g) => (g.wartungTage ?? 1) <= 0);
    const zeilen: KachelZeile[] = [
      ...faellig.slice(0, 2).map((g) => ({
        text: `Wartung: ${g.name}`,
        wert: g.wartungTage === 0 ? 'heute' : 'überfällig',
        status: 'warnung' as Ampel,
      })),
      ...u.garantien.slice(0, 2).map((g) => ({
        text: `Garantie: ${g.name}`,
        wert: `noch ${g.garantieTage} Tage`,
        status: ((g.garantieTage ?? 99) <= 14 ? 'warnung' : 'neutral') as Ampel,
      })),
    ];
    return {
      status: (faellig.length ? 'warnung' : 'ok') as Ampel,
      titel: 'Inventar',
      wert: String(u.summen.anzahl),
      einheit: 'Gegenstände',
      unter: `Neuwert ${chf(u.summen.wert)}, ${u.summen.garantie} mit Garantie`,
      zeilen,
      demo: ctx.konfig.demo,
    };
  }

  async function briefing(): Promise<BriefingTeil | null> {
    const u = await uebersicht();
    const zeilen = [
      ...u.wartungen
        .filter((g) => (g.wartungTage ?? 1) <= 0)
        .map((g) => ({
          text: `${g.name}: ${g.wartung_text || 'Wartung'}`,
          wert: g.wartungTage === 0 ? 'heute' : 'überfällig',
          status: 'warnung' as Ampel,
        })),
      ...u.garantien
        .filter((g) => (g.garantieTage ?? 99) <= 7)
        .map((g) => ({
          text: `Garantie ${g.name}`,
          wert: g.garantieTage === 0 ? 'endet heute' : `noch ${g.garantieTage} Tage`,
          status: 'neutral' as Ampel,
        })),
    ];
    if (!zeilen.length) return null;
    return {
      modul: 'inventar',
      titel: 'Inventar',
      zeilen: zeilen.slice(0, 5),
      status: zeilen.some((z) => z.status === 'warnung') ? 'warnung' : 'neutral',
      reihenfolge: 28,
    };
  }

  async function suche(q: string): Promise<SuchTreffer[]> {
    const muster = { like: `%${q}%` };
    const treffer = new Map<string, Gegenstand>();
    for (const feld of ['name', 'marke', 'modell', 'seriennummer', 'ort'])
      for (const g of await daten.liste<Gegenstand>('gegenstaende', { filter: { [feld]: muster }, limit: 6 }))
        treffer.set(g.id, g);
    return [...treffer.values()].slice(0, 8).map((g) => ({
      modul: 'inventar',
      titel: g.name,
      text: [g.marke, g.modell, g.ort].filter(Boolean).join(', ') || (g.kategorie ?? ''),
      link: '/modul/inventar#tab=Liste',
    }));
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    const v = lokalDatum(von);
    const b = lokalDatum(bis);
    const liste = (await alle()).filter((g) => !g.ausgemustert);
    return [
      ...liste
        .filter((g) => g.garantieEnde && g.garantieEnde >= v && g.garantieEnde <= b)
        .map((g) => ({
          id: `garantie-${g.id}`,
          modul: 'inventar',
          art: 'Garantie',
          titel: `Garantie endet: ${g.name}`,
          start: g.garantieEnde as string,
          ganztags: true,
          link: '/modul/inventar',
          status: 'neutral' as Ampel,
        })),
      ...liste
        .filter((g) => g.wartung && g.wartung >= v && g.wartung <= b)
        .map((g) => ({
          id: `wartung-${g.id}-${g.wartung}`,
          modul: 'inventar',
          art: 'Wartung',
          titel: `Wartung: ${g.name}`,
          start: g.wartung as string,
          ganztags: true,
          text: g.wartung_text ?? undefined,
          link: '/modul/inventar#tab=Wartung',
          status: 'neutral' as Ampel,
        })),
    ];
  }

  return { routen, jobs, kachel, briefing, suche, timeline };
}
