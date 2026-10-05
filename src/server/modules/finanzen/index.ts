// Modul Finanzen: private Abos und Fixkosten mit Kündigungsfristen, offene Rechnungen und Monatsübersicht.
// Geschäftskosten bleiben im Modul scont und werden hier nur zusammengezählt angezeigt.
// Keine Konto oder Kartennummern speichern, nur Beträge und Termine.
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
import { plusMonate, plusTage, tageZwischen } from '../aufgaben/wiederholung.ts';
import {
  INTERVALLE,
  KATEGORIEN,
  type Kuendigung,
  kuendigung,
  monatsBetrag,
  naechsteZahlung,
  termine,
  warnstufe,
} from './rechnen.ts';

export const ABOS = tabelle({
  name: 'abos',
  modul: 'finanzen',
  label: 'Abos und Fixkosten',
  bearbeitbar: true,
  anzeige: 'name',
  suche: ['name', 'anbieter'],
  spalten: [
    { name: 'name', typ: 'text', label: 'Bezeichnung', pflicht: true },
    { name: 'kategorie', typ: 'text', label: 'Kategorie', optionen: KATEGORIEN, standard: 'Andere' },
    { name: 'anbieter', typ: 'text', label: 'Anbieter' },
    { name: 'betrag', typ: 'real', label: 'Betrag', einheit: 'CHF', pflicht: true, min: 0 },
    { name: 'intervall', typ: 'text', label: 'Intervall', optionen: [...INTERVALLE], standard: 'monatlich' },
    { name: 'naechste_zahlung', typ: 'datum', label: 'Nächste Zahlung' },
    { name: 'vertrag_bis', typ: 'datum', label: 'Vertrag läuft bis' },
    {
      name: 'kuendigungsfrist_monate',
      typ: 'int',
      label: 'Kündigungsfrist',
      einheit: 'Monate',
      standard: 0,
      min: 0,
      max: 24,
    },
    {
      name: 'verlaengerung_monate',
      typ: 'int',
      label: 'Verlängert sich um',
      einheit: 'Monate',
      standard: 12,
      min: 0,
      max: 60,
    },
    { name: 'gekuendigt', typ: 'bool', label: 'Gekündigt', standard: false },
    { name: 'gekuendigt_am', typ: 'datum', label: 'Gekündigt am' },
    { name: 'aktiv', typ: 'bool', label: 'Aktiv', standard: true },
    { name: 'notiz', typ: 'text', label: 'Notiz (keine Konto oder Kartennummern)', lang: true },
  ],
});

export const RECHNUNGEN = tabelle({
  name: 'rechnungen',
  modul: 'finanzen',
  label: 'Rechnungen',
  bearbeitbar: true,
  anzeige: 'titel',
  suche: ['titel'],
  spalten: [
    { name: 'titel', typ: 'text', label: 'Rechnung', pflicht: true },
    { name: 'kategorie', typ: 'text', label: 'Kategorie', optionen: KATEGORIEN, standard: 'Andere' },
    { name: 'betrag', typ: 'real', label: 'Betrag', einheit: 'CHF', pflicht: true, min: 0 },
    { name: 'faellig', typ: 'datum', label: 'Zahlbar bis', pflicht: true },
    { name: 'bezahlt', typ: 'bool', label: 'Bezahlt', standard: false },
    { name: 'bezahlt_am', typ: 'datum', label: 'Bezahlt am' },
    { name: 'notiz', typ: 'text', label: 'Notiz', lang: true },
  ],
  indizes: [['bezahlt', 'faellig']],
});

interface Abo {
  id: string;
  name: string;
  kategorie: string | null;
  anbieter: string | null;
  betrag: number;
  intervall: string;
  naechste_zahlung: string | null;
  vertrag_bis: string | null;
  kuendigungsfrist_monate: number | null;
  verlaengerung_monate: number | null;
  gekuendigt: boolean;
  gekuendigt_am: string | null;
  aktiv: boolean;
  notiz: string | null;
}
interface Rechnung {
  id: string;
  titel: string;
  kategorie: string | null;
  betrag: number;
  faellig: string;
  bezahlt: boolean;
  bezahlt_am: string | null;
  notiz: string | null;
}
type AboMehr = Abo & { monat: number; naechste: string | null; frist: Kuendigung | null };

export const finanzen: ModulDef = {
  id: 'finanzen',
  name: 'Finanzen',
  beschreibung: 'Abos und Fixkosten mit Kündigungsfristen, offene Rechnungen und Monatsübersicht',
  symbol: 'finanzen',
  reihenfolge: 13,
  tabellen: [ABOS, RECHNUNGEN],
  regeln: [
    {
      id: 'kuendigung',
      name: 'Kündigungsfrist naht',
      beschreibung: '30, 14, 7 und 1 Tag vor dem letzten Kündigungstag eines Abos',
      prioritaet: 3,
      cooldownMin: 600,
    },
    {
      id: 'rechnung',
      name: 'Rechnung fällig',
      beschreibung: 'Drei Tage vor dem Zahltermin, am Tag selbst und wenn sie überfällig ist',
      prioritaet: 3,
      cooldownMin: 600,
    },
    {
      id: 'zahlung',
      name: 'Grössere Abbuchung',
      beschreibung: 'Eine Woche bevor ein Abo ab CHF 100 belastet wird',
      prioritaet: 2,
      cooldownMin: 600,
    },
  ],
  erstellen: (ctx) => finanzenLaufzeit(ctx),
};

const DEMO_ABOS = (h: string) => {
  const jahr = h.slice(0, 4);
  return [
    {
      name: 'Krankenkasse Grundversicherung',
      kategorie: 'Versicherung',
      betrag: 389.5,
      intervall: 'monatlich',
      naechste_zahlung: `${h.slice(0, 7)}-28`,
      vertrag_bis: `${jahr}-12-31`,
      kuendigungsfrist_monate: 1,
      verlaengerung_monate: 12,
    },
    {
      name: 'Handy Abo',
      kategorie: 'Telefon und Internet',
      betrag: 45,
      intervall: 'monatlich',
      naechste_zahlung: plusTage(h, 12),
      vertrag_bis: plusMonate(plusTage(h, 20), 2),
      kuendigungsfrist_monate: 2,
      verlaengerung_monate: 12,
    },
    {
      name: 'Internet und TV',
      kategorie: 'Telefon und Internet',
      betrag: 69,
      intervall: 'monatlich',
      naechste_zahlung: plusTage(h, 3),
    },
    {
      name: 'Streaming',
      kategorie: 'Unterhaltung',
      betrag: 18.9,
      intervall: 'monatlich',
      naechste_zahlung: plusTage(h, 8),
    },
    {
      name: 'Fitnesscenter',
      kategorie: 'Sport und Verein',
      betrag: 79,
      intervall: 'monatlich',
      naechste_zahlung: plusTage(h, 1),
      vertrag_bis: plusTage(h, 25),
      kuendigungsfrist_monate: 1,
      verlaengerung_monate: 12,
    },
    {
      name: 'Halbtax',
      kategorie: 'Mobilität',
      betrag: 190,
      intervall: 'jaehrlich',
      naechste_zahlung: plusTage(h, 5),
    },
    {
      name: 'Hausrat und Privathaftpflicht',
      kategorie: 'Versicherung',
      betrag: 268,
      intervall: 'jaehrlich',
      naechste_zahlung: plusTage(h, 70),
      vertrag_bis: `${Number(jahr) + 1}-12-31`,
      kuendigungsfrist_monate: 3,
      verlaengerung_monate: 12,
    },
    {
      name: 'Drohnen Haftpflicht',
      kategorie: 'Versicherung',
      betrag: 120,
      intervall: 'jaehrlich',
      naechste_zahlung: plusTage(h, 140),
    },
    {
      name: 'Vereinsbeitrag Unihockey',
      kategorie: 'Sport und Verein',
      betrag: 250,
      intervall: 'jaehrlich',
      naechste_zahlung: plusTage(h, 200),
    },
    {
      name: 'Cloud Speicher',
      kategorie: 'Software',
      betrag: 29.9,
      intervall: 'vierteljaehrlich',
      naechste_zahlung: plusTage(h, 40),
    },
  ];
};
const DEMO_RECHNUNGEN = (h: string) => [
  { titel: 'Radio und TV Abgabe', kategorie: 'Steuern und Gebühren', betrag: 335, faellig: plusTage(h, -1) },
  { titel: 'Zahnarzt Kontrolle', kategorie: 'Gesundheit', betrag: 184.6, faellig: plusTage(h, 2) },
  { titel: 'Steuern Ratenzahlung', kategorie: 'Steuern und Gebühren', betrag: 650, faellig: plusTage(h, 24) },
];

function finanzenLaufzeit(ctx: Kontext) {
  const { daten } = ctx;
  const heute = () => lokalDatum(ctx.jetzt());
  let bereit: Promise<void> | null = null;

  async function vorbereiten() {
    bereit ??= (async () => {
      if (!ctx.konfig.demo || ctx.einstellungen.hole('finanzen.demo_angelegt', false)) return;
      if ((await daten.anzahl('abos')) > 0) return;
      const h = heute();
      await daten.einfuegen(
        'abos',
        DEMO_ABOS(h).map((a) => ({
          anbieter: null,
          vertrag_bis: null,
          kuendigungsfrist_monate: 0,
          verlaengerung_monate: 12,
          gekuendigt: false,
          aktiv: true,
          ...a,
        })),
      );
      await daten.einfuegen(
        'rechnungen',
        DEMO_RECHNUNGEN(h).map((r) => ({ bezahlt: false, ...r })),
      );
      await daten.einfuegen('rechnungen', [
        {
          titel: 'Werkstatt Service',
          kategorie: 'Mobilität',
          betrag: 420,
          faellig: plusTage(h, -6),
          bezahlt: true,
          bezahlt_am: plusTage(h, -8),
        },
      ]);
      await ctx.einstellungen.setze('finanzen.demo_angelegt', true);
    })();
    await bereit;
  }

  function erweitern(a: Abo, h: string): AboMehr {
    const laeuft = a.aktiv && !a.gekuendigt;
    return {
      ...a,
      monat: a.aktiv ? monatsBetrag(a.betrag, a.intervall) : 0,
      naechste: a.aktiv ? naechsteZahlung(a.naechste_zahlung, a.intervall, h) : null,
      // Für gekündigte Abos zählt nur noch das Vertragsende
      frist: laeuft
        ? kuendigung(a.vertrag_bis, a.kuendigungsfrist_monate, a.verlaengerung_monate, h)
        : a.gekuendigt && a.vertrag_bis
          ? { vertragsende: a.vertrag_bis, kuendigenBis: null, tage: null, verpasst: false }
          : null,
    };
  }

  async function abos(): Promise<AboMehr[]> {
    await vorbereiten();
    const h = heute();
    const alle = await daten.liste<Abo>('abos', { sortierung: 'name', limit: 500 });
    return alle.map((a) => erweitern(a, h));
  }

  async function offeneRechnungen() {
    await vorbereiten();
    return daten.liste<Rechnung>('rechnungen', {
      filter: { bezahlt: false },
      sortierung: 'faellig',
      limit: 300,
    });
  }

  /** Geschäftskosten aus scont pro Monat, falls die Tabelle existiert */
  async function geschaeftMonat(): Promise<number | null> {
    try {
      const k = await daten.liste<{ betrag: number; intervall: string }>('kosten', { limit: 1000 });
      if (!k.length) return null;
      return k.reduce((s, x) => s + monatsBetrag(x.betrag ?? 0, x.intervall), 0);
    } catch {
      return null;
    }
  }

  const runden = (n: number) => Math.round(n * 100) / 100;

  async function uebersicht() {
    const h = heute();
    const liste = await abos();
    const aktiv = liste.filter((a) => a.aktiv);
    const proKategorie = new Map<string, number>();
    for (const a of aktiv)
      proKategorie.set(a.kategorie || 'Andere', (proKategorie.get(a.kategorie || 'Andere') ?? 0) + a.monat);
    const monat = aktiv.reduce((s, a) => s + a.monat, 0);
    const bis30 = plusTage(h, 30);
    const offen = await offeneRechnungen();
    // Kommende Belastungen in 30 Tagen: Abos und offene Rechnungen
    const kommend = [
      ...aktiv.flatMap((a) =>
        termine(a.naechste_zahlung, a.intervall, h, bis30).map((d) => ({
          datum: d,
          titel: a.name,
          betrag: a.betrag,
          art: 'abo' as const,
        })),
      ),
      ...offen
        .filter((r) => r.faellig <= bis30)
        .map((r) => ({ datum: r.faellig, titel: r.titel, betrag: r.betrag, art: 'rechnung' as const })),
    ].sort((a, b) => a.datum.localeCompare(b.datum));
    // Belastungen der nächsten zwölf Monate für das Diagramm
    const start = `${h.slice(0, 7)}-01`;
    const verlauf = Array.from({ length: 12 }, (_, i) => {
      const von = plusMonate(start, i);
      const bis = plusTage(plusMonate(start, i + 1), -1);
      const summe =
        aktiv.reduce((s, a) => s + termine(a.naechste_zahlung, a.intervall, von, bis).length * a.betrag, 0) +
        offen.filter((r) => r.faellig >= von && r.faellig <= bis).reduce((s, r) => s + r.betrag, 0);
      return { monat: von.slice(0, 7), summe: runden(summe) };
    });
    const bezahlt = await daten.liste<Rechnung>('rechnungen', {
      filter: { bezahlt: true, bezahlt_am: { gte: plusTage(h, -60) } },
      sortierung: '-bezahlt_am',
      limit: 50,
    });
    const fristen = liste
      .filter((a) => a.frist?.kuendigenBis && !a.gekuendigt && a.aktiv)
      .sort((a, b) => (a.frist?.kuendigenBis ?? '').localeCompare(b.frist?.kuendigenBis ?? ''));
    return {
      heute: h,
      summen: {
        monat: runden(monat),
        jahr: runden(monat * 12),
        geschaeftMonat: (await geschaeftMonat()) ?? null,
        offen: runden(offen.reduce((s, r) => s + r.betrag, 0)),
        kommend30: runden(kommend.reduce((s, k) => s + k.betrag, 0)),
      },
      kategorien: [...proKategorie]
        .map(([name, betrag]) => ({ name, betrag: runden(betrag) }))
        .sort((a, b) => b.betrag - a.betrag),
      abos: liste,
      fristen: fristen.map((a) => ({ id: a.id, name: a.name, ...a.frist })),
      rechnungen: offen.map((r) => ({ ...r, tage: tageZwischen(h, r.faellig) })),
      bezahlt,
      kommend,
      verlauf,
    };
  }

  async function routen(app: FastifyInstance) {
    app.addHook('onRequest', async () => vorbereiten());
    app.get('/uebersicht', async () => uebersicht());

    app.post<{ Params: { id: string }; Body: { bezahlt?: boolean } }>(
      '/rechnung/:id/bezahlt',
      async (req, reply) => {
        const r = await daten.hole<Rechnung>('rechnungen', req.params.id);
        if (!r) return reply.code(404).send({ fehler: 'Rechnung nicht gefunden' });
        const bezahlt = req.body?.bezahlt !== false;
        await daten.aendern('rechnungen', r.id, { bezahlt, bezahlt_am: bezahlt ? heute() : null });
        if (bezahlt) ctx.aktivitaet('finanzen', `Rechnung bezahlt: ${r.titel}`, 'aktion');
        return { bezahlt };
      },
    );

    // Abo als gekündigt markieren. Der Hub kündigt nichts selbst, er merkt es sich nur.
    app.post<{ Params: { id: string }; Body: { gekuendigt?: boolean; bestaetigt?: boolean } }>(
      '/abo/:id/gekuendigt',
      async (req, reply) => {
        if (!req.body?.bestaetigt) return reply.code(409).send({ fehler: 'Bestätigung nötig' });
        const a = await daten.hole<Abo>('abos', req.params.id);
        if (!a) return reply.code(404).send({ fehler: 'Abo nicht gefunden' });
        const gekuendigt = req.body.gekuendigt !== false;
        const h = heute();
        // Das Vertragsende festhalten, auf das gekündigt wurde
        const f = kuendigung(a.vertrag_bis, a.kuendigungsfrist_monate, a.verlaengerung_monate, h);
        await daten.aendern('abos', a.id, {
          gekuendigt,
          gekuendigt_am: gekuendigt ? h : null,
          ...(gekuendigt && f ? { vertrag_bis: f.vertragsende } : {}),
        });
        ctx.aktivitaet(
          'finanzen',
          `${a.name} ${gekuendigt ? 'als gekündigt markiert' : 'wieder als laufend markiert'}`,
          'aktion',
        );
        return { gekuendigt, vertragsende: f?.vertragsende ?? null };
      },
    );

    // Erinnerung zum Kündigen als Aufgabe anlegen, eine Woche vor der Frist
    app.post<{ Params: { id: string } }>('/abo/:id/aufgabe', async (req, reply) => {
      const a = await daten.hole<Abo>('abos', req.params.id);
      if (!a) return reply.code(404).send({ fehler: 'Abo nicht gefunden' });
      const h = heute();
      const f = kuendigung(a.vertrag_bis, a.kuendigungsfrist_monate, a.verlaengerung_monate, h);
      if (!f?.kuendigenBis) return reply.code(400).send({ fehler: 'Keine Kündigungsfrist hinterlegt' });
      const titel = `${a.name} kündigen oder bestätigen`;
      const schon = await daten.liste('aufgaben', { filter: { titel, erledigt: false }, limit: 1 });
      if (schon.length) return reply.code(409).send({ fehler: 'Diese Aufgabe gibt es schon' });
      const faellig = [plusTage(f.kuendigenBis, -7), h].sort().pop() as string;
      const [neu] = await daten.einfuegen<{ id: string }>('aufgaben', [
        {
          titel,
          notiz: `Letzter Kündigungstag ${f.kuendigenBis}, Vertragsende ${f.vertragsende}.`,
          liste: 'Finanzen',
          faellig,
          prioritaet: 'hoch',
          rhythmus: 'einmalig',
          erledigt: false,
        },
      ]);
      return { id: neu.id, faellig };
    });
  }

  const chf = (n: number) => `CHF ${n.toFixed(2)}`;

  const jobs = [
    {
      id: 'pruefen',
      name: 'Fristen, Rechnungen und Abbuchungen prüfen',
      taeglich: '08:10',
      startVerzoegerungSek: 60,
      lauf: async () => {
        const h = heute();
        let gemeldet = 0;
        let nachgefuehrt = 0;
        for (const a of await abos()) {
          // Zahltermine in der Vergangenheit auf den nächsten Termin nachführen
          if (a.naechste && a.naechste_zahlung && a.naechste !== a.naechste_zahlung) {
            await daten.aendern('abos', a.id, { naechste_zahlung: a.naechste });
            nachgefuehrt++;
          }
          // Gekündigt und Vertrag zu Ende: nicht mehr aktiv
          if (a.gekuendigt && a.aktiv && a.vertrag_bis && a.vertrag_bis < h) {
            await daten.aendern('abos', a.id, { aktiv: false });
            ctx.aktivitaet('finanzen', `${a.name} ist ausgelaufen`, 'info');
            continue;
          }
          const f = a.frist;
          const stufe = a.aktiv && !a.gekuendigt ? warnstufe(f?.tage ?? null) : null;
          if (f?.kuendigenBis && stufe !== null) {
            await ctx.alarm.melden({
              regel: 'finanzen.kuendigung',
              titel:
                f.tage === 0
                  ? `Heute letzter Kündigungstag: ${a.name}`
                  : `Kündigungsfrist ${a.name} in ${f.tage} Tagen`,
              text: `Kündigung muss bis ${f.kuendigenBis} eintreffen, sonst verlängert sich der Vertrag ab ${f.vertragsende}. ${chf(a.betrag)} ${a.intervall}.`,
              schluessel: `kuendigung:${a.id}:${f.kuendigenBis}:${stufe}`,
              prioritaet: stufe <= 7 ? 4 : undefined,
              tags: ['scissors'],
              link: '/modul/finanzen#tab=Abos',
            });
            gemeldet++;
          }
          if (a.aktiv && a.naechste && a.betrag >= 100 && tageZwischen(h, a.naechste) === 7) {
            await ctx.alarm.melden({
              regel: 'finanzen.zahlung',
              titel: `In einer Woche: ${a.name}`,
              text: `${chf(a.betrag)} am ${a.naechste}`,
              schluessel: `zahlung:${a.id}:${a.naechste}`,
              tags: ['money_with_wings'],
              link: '/modul/finanzen',
            });
            gemeldet++;
          }
        }
        for (const r of await offeneRechnungen()) {
          const t = tageZwischen(h, r.faellig);
          const stufe = t < 0 ? 'ueber' : t === 0 ? 'heute' : t <= 3 ? 'bald' : null;
          if (!stufe) continue;
          await ctx.alarm.melden({
            regel: 'finanzen.rechnung',
            titel:
              stufe === 'ueber'
                ? `Überfällig: ${r.titel}`
                : stufe === 'heute'
                  ? `Heute zahlen: ${r.titel}`
                  : `Rechnung in ${t} Tagen: ${r.titel}`,
            text: `${chf(r.betrag)}, zahlbar bis ${r.faellig}`,
            // Überfällige höchstens einmal pro Woche erinnern
            schluessel: `rechnung:${r.id}:${stufe === 'ueber' ? `ueber:${Math.floor(-t / 7)}` : stufe}`,
            prioritaet: stufe === 'bald' ? undefined : 4,
            tags: ['receipt'],
            link: '/modul/finanzen#tab=Rechnungen',
          });
          gemeldet++;
        }
        return gemeldet || nachgefuehrt
          ? `${gemeldet} Meldungen, ${nachgefuehrt} Termine nachgeführt`
          : undefined;
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const u = await uebersicht();
    const h = u.heute;
    const ueber = u.rechnungen.filter((r) => r.faellig < h);
    const zeilen: KachelZeile[] = [];
    const naechsteFrist = u.fristen[0];
    if (naechsteFrist?.tage != null && naechsteFrist.tage <= 60)
      zeilen.push({
        text: `Kündigen: ${naechsteFrist.name}`,
        wert: naechsteFrist.tage === 0 ? 'heute' : `in ${naechsteFrist.tage} Tagen`,
        status: (naechsteFrist.tage <= 14 ? 'warnung' : 'neutral') as Ampel,
      });
    for (const r of u.rechnungen.slice(0, 3))
      zeilen.push({
        text: r.titel,
        wert: chf(r.betrag),
        status: (r.faellig < h ? 'warnung' : 'neutral') as Ampel,
      });
    return {
      status: (ueber.length || (naechsteFrist?.tage ?? 99) <= 7 ? 'warnung' : 'ok') as Ampel,
      titel: 'Finanzen',
      wert: u.summen.monat.toFixed(0),
      einheit: 'CHF pro Monat',
      unter: u.rechnungen.length
        ? `${u.rechnungen.length} Rechnungen offen, ${chf(u.summen.offen)}`
        : 'Keine offenen Rechnungen',
      zeilen,
      demo: ctx.konfig.demo,
    };
  }

  async function briefing(): Promise<BriefingTeil | null> {
    const u = await uebersicht();
    const h = u.heute;
    const zeilen = [
      ...u.rechnungen
        .filter((r) => r.faellig <= plusTage(h, 1))
        .map((r) => ({
          text: r.titel,
          wert: r.faellig < h ? 'überfällig' : r.faellig === h ? 'heute' : 'morgen',
          status: (r.faellig < h ? 'warnung' : 'neutral') as Ampel,
        })),
      ...u.fristen
        .filter((f) => f.tage != null && f.tage <= 7)
        .map((f) => ({
          text: `${f.name} kündigen`,
          wert: f.tage === 0 ? 'heute' : `bis ${f.kuendigenBis}`,
          status: 'warnung' as Ampel,
        })),
    ];
    if (!zeilen.length) return null;
    return {
      modul: 'finanzen',
      titel: 'Finanzen',
      zeilen: zeilen.slice(0, 6),
      status: zeilen.some((z) => z.status === 'warnung') ? 'warnung' : 'neutral',
      reihenfolge: 27,
    };
  }

  async function suche(q: string): Promise<SuchTreffer[]> {
    const muster = { like: `%${q}%` };
    const [a, r] = await Promise.all([
      daten.liste<Abo>('abos', { filter: { name: muster }, limit: 6 }),
      daten.liste<Rechnung>('rechnungen', { filter: { titel: muster }, limit: 6 }),
    ]);
    return [
      ...a.map((x) => ({
        modul: 'finanzen',
        titel: x.name,
        text: `${chf(x.betrag)} ${x.intervall}${x.gekuendigt ? ', gekündigt' : ''}`,
        link: '/modul/finanzen#tab=Abos',
      })),
      ...r.map((x) => ({
        modul: 'finanzen',
        titel: x.titel,
        text: `${chf(x.betrag)}, ${x.bezahlt ? 'bezahlt' : `zahlbar bis ${x.faellig}`}`,
        link: '/modul/finanzen#tab=Rechnungen',
      })),
    ];
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    const v = lokalDatum(von);
    const b = lokalDatum(bis);
    const u = await uebersicht();
    return [
      ...u.fristen
        .filter((f) => f.kuendigenBis && f.kuendigenBis >= v && f.kuendigenBis <= b)
        .map((f) => ({
          id: `frist-${f.id}-${f.kuendigenBis}`,
          modul: 'finanzen',
          art: 'Frist',
          titel: `Letzter Kündigungstag: ${f.name}`,
          start: f.kuendigenBis as string,
          ganztags: true,
          link: '/modul/finanzen#tab=Abos',
          status: 'warnung' as Ampel,
        })),
      ...u.rechnungen
        .filter((r) => r.faellig >= v && r.faellig <= b)
        .map((r) => ({
          id: `rechnung-${r.id}`,
          modul: 'finanzen',
          art: 'Rechnung',
          titel: r.titel,
          start: r.faellig,
          ganztags: true,
          text: chf(r.betrag),
          link: '/modul/finanzen#tab=Rechnungen',
          status: 'neutral' as Ampel,
        })),
    ];
  }

  return { routen, jobs, kachel, briefing, suche, timeline };
}
