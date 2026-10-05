// Modul Aufgaben: To dos mit Fälligkeit, Wiederholung und Erinnerung, Routinen als Checklisten,
// die sich täglich oder wöchentlich zurücksetzen, und eine Einkaufsliste.
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
import { lokal, lokalDatum, minutenLokal, hhmmZuMinuten } from '../../kern/zeit.ts';
import { tageParsen } from '../smarthome/zeitplan.ts';
import { schnellErfassen } from './schnell.ts';
import {
  naechsteFaelligkeit,
  periode,
  plusTage,
  RHYTHMEN,
  type Rhythmus,
  schritte,
  serie,
  tageZwischen,
} from './wiederholung.ts';

export const AUFGABEN = tabelle({
  name: 'aufgaben',
  modul: 'aufgaben',
  label: 'Aufgaben',
  bearbeitbar: true,
  anzeige: 'titel',
  suche: ['titel', 'notiz', 'liste'],
  spalten: [
    { name: 'titel', typ: 'text', label: 'Aufgabe', pflicht: true },
    { name: 'notiz', typ: 'text', label: 'Notiz', lang: true },
    { name: 'liste', typ: 'text', label: 'Liste', standard: 'Privat' },
    { name: 'faellig', typ: 'datum', label: 'Fällig' },
    { name: 'uhrzeit', typ: 'text', label: 'Erinnerung um (HH:MM)' },
    { name: 'prioritaet', typ: 'text', label: 'Priorität', optionen: ['normal', 'hoch'], standard: 'normal' },
    { name: 'rhythmus', typ: 'text', label: 'Wiederholung', optionen: [...RHYTHMEN], standard: 'einmalig' },
    { name: 'erledigt', typ: 'bool', label: 'Erledigt', standard: false },
    { name: 'erledigt_am', typ: 'zeit', label: 'Erledigt am', intern: true },
  ],
  indizes: [['erledigt', 'faellig']],
});

export const ROUTINEN = tabelle({
  name: 'routinen',
  modul: 'aufgaben',
  label: 'Routinen',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'schritte', typ: 'text', label: 'Schritte (eine Zeile pro Schritt)', lang: true, pflicht: true },
    {
      name: 'rhythmus',
      typ: 'text',
      label: 'Setzt sich zurück',
      optionen: ['taeglich', 'woechentlich'],
      standard: 'taeglich',
    },
    { name: 'tage', typ: 'text', label: 'Tage (z.B. Mo-Fr)', standard: 'Mo-So' },
    { name: 'uhrzeit', typ: 'text', label: 'Erinnerung um (HH:MM)' },
    { name: 'aktiv', typ: 'bool', label: 'Aktiv', standard: true },
  ],
});

export const ROUTINEN_LAEUFE = tabelle({
  name: 'routinen_laeufe',
  modul: 'aufgaben',
  label: 'Routinen Verlauf',
  spalten: [
    { name: 'routine_id', typ: 'text', label: 'Routine', pflicht: true, verweis: 'routinen' },
    { name: 'periode', typ: 'datum', label: 'Periode', pflicht: true },
    /** Indizes der erledigten Schritte */
    { name: 'erledigt', typ: 'json', label: 'Erledigte Schritte' },
    { name: 'fertig', typ: 'bool', label: 'Vollständig', standard: false },
  ],
  indizes: [['routine_id', 'periode']],
});

export const EINKAUF = tabelle({
  name: 'einkauf',
  modul: 'aufgaben',
  label: 'Einkaufsliste',
  bearbeitbar: true,
  anzeige: 'text',
  spalten: [
    { name: 'text', typ: 'text', label: 'Artikel', pflicht: true },
    { name: 'menge', typ: 'text', label: 'Menge' },
    { name: 'erledigt', typ: 'bool', label: 'Im Korb', standard: false },
  ],
});

interface Aufgabe {
  id: string;
  titel: string;
  notiz: string | null;
  liste: string | null;
  faellig: string | null;
  uhrzeit: string | null;
  prioritaet: string | null;
  rhythmus: Rhythmus | null;
  erledigt: boolean;
  erledigt_am: string | null;
}
interface Routine {
  id: string;
  name: string;
  schritte: string;
  rhythmus: 'taeglich' | 'woechentlich';
  tage: string | null;
  uhrzeit: string | null;
  aktiv: boolean;
}
interface Lauf {
  id: string;
  routine_id: string;
  periode: string;
  erledigt: number[] | null;
  fertig: boolean;
}

export const aufgaben: ModulDef = {
  id: 'aufgaben',
  name: 'Aufgaben',
  beschreibung: 'To dos mit Erinnerung, wiederkehrende Aufgaben, Routinen und Einkaufsliste',
  symbol: 'aufgaben',
  reihenfolge: 12,
  tabellen: [AUFGABEN, ROUTINEN, ROUTINEN_LAEUFE, EINKAUF],
  regeln: [
    {
      id: 'erinnerung',
      name: 'Erinnerung an Aufgabe',
      beschreibung: 'Zur eingetragenen Uhrzeit einer fälligen Aufgabe',
      prioritaet: 3,
      cooldownMin: 1,
    },
    {
      id: 'routine',
      name: 'Routine offen',
      beschreibung: 'Zur Uhrzeit einer Routine, wenn sie noch nicht erledigt ist',
      prioritaet: 3,
      cooldownMin: 60,
    },
    {
      id: 'morgen',
      name: 'Aufgaben am Morgen',
      beschreibung: 'Um 7 Uhr, wenn heute Aufgaben fällig oder welche überfällig sind',
      prioritaet: 2,
      cooldownMin: 600,
    },
  ],
  erstellen: (ctx) => aufgabenLaufzeit(ctx),
};

const DEMO_AUFGABEN = (heute: string) => [
  { titel: 'Domain Verlängerung prüfen', liste: 'scont', faellig: plusTage(heute, -1), prioritaet: 'hoch' },
  { titel: 'Akkus der Drohne laden', liste: 'Drohne', faellig: heute, uhrzeit: '18:00' },
  { titel: 'Pflanzen giessen', liste: 'Privat', faellig: heute, rhythmus: 'woechentlich' },
  { titel: 'Offerte Kundendreh schreiben', liste: 'scont', faellig: plusTage(heute, 2) },
  { titel: 'Steuererklärung', liste: 'Privat', faellig: plusTage(heute, 20) },
  { titel: 'Altpapier bereitstellen', liste: 'Privat', faellig: plusTage(heute, 5), rhythmus: 'monatlich' },
  { titel: 'Ideen für Vipers Matchvideo sammeln', liste: 'Unihockey' },
];
const DEMO_ROUTINEN = [
  {
    name: 'Morgen',
    schritte: 'Wasser trinken\nTermine anschauen\nPush Meldungen durchgehen',
    rhythmus: 'taeglich',
    tage: 'Mo-Fr',
    uhrzeit: '08:30',
  },
  {
    name: 'Vor dem Drohnenflug',
    schritte: 'Luftraum prüfen\nWind und Böen prüfen\nAkkus voll\nSD Karte leer\nPropeller kontrollieren',
    rhythmus: 'taeglich',
    tage: 'Mo-So',
  },
  {
    name: 'Wochenabschluss',
    schritte: 'Zeiterfassung abschliessen\nBackups kontrollieren\nNächste Woche planen',
    rhythmus: 'woechentlich',
    tage: 'Fr',
  },
];
const DEMO_EINKAUF = [
  { text: 'Milch' },
  { text: 'Brot' },
  { text: 'Kaffeebohnen', menge: '1 kg' },
  { text: 'Tape für Stöcke' },
];

function aufgabenLaufzeit(ctx: Kontext) {
  const { daten } = ctx;
  let bereit: Promise<void> | null = null;
  let letzteMinute = minutenLokal(ctx.jetzt());
  let letzterTag = lokalDatum(ctx.jetzt());
  const heute = () => lokalDatum(ctx.jetzt());

  async function vorbereiten() {
    bereit ??= (async () => {
      if (!ctx.konfig.demo || ctx.einstellungen.hole('aufgaben.demo_angelegt', false)) return;
      if ((await daten.anzahl('aufgaben')) > 0) return;
      const h = heute();
      await daten.einfuegen(
        'aufgaben',
        DEMO_AUFGABEN(h).map((a) => ({
          rhythmus: 'einmalig',
          prioritaet: 'normal',
          uhrzeit: null,
          faellig: null,
          erledigt: false,
          ...a,
        })),
      );
      await daten.einfuegen('aufgaben', [
        {
          titel: 'Vereinsbeitrag bezahlt',
          liste: 'Unihockey',
          erledigt: true,
          erledigt_am: ctx.jetzt().toISOString(),
          rhythmus: 'einmalig',
        },
      ]);
      const r = await daten.einfuegen<{ id: string }>(
        'routinen',
        DEMO_ROUTINEN.map((x) => ({ ...x, aktiv: true })),
      );
      // Etwas Verlauf, damit die Serie sichtbar ist
      await daten.einfuegen(
        'routinen_laeufe',
        [1, 2, 3, 4].map((n) => ({
          routine_id: r[0].id,
          periode: plusTage(h, -n),
          erledigt: [0, 1, 2],
          fertig: true,
        })),
      );
      await daten.einfuegen(
        'einkauf',
        DEMO_EINKAUF.map((e) => ({ menge: null, ...e, erledigt: false })),
      );
      await ctx.einstellungen.setze('aufgaben.demo_angelegt', true);
    })();
    await bereit;
  }

  async function offene() {
    await vorbereiten();
    return daten.liste<Aufgabe>('aufgaben', {
      filter: { erledigt: false },
      sortierung: 'faellig',
      limit: 1000,
    });
  }

  /** Einteilung für die Anzeige */
  function gruppe(a: Aufgabe, h: string): string {
    if (!a.faellig) return 'ohne';
    const d = tageZwischen(h, a.faellig);
    if (d < 0) return 'ueberfaellig';
    if (d === 0) return 'heute';
    if (d === 1) return 'morgen';
    if (d <= 7) return 'woche';
    return 'spaeter';
  }

  async function routinenHeute() {
    await vorbereiten();
    const h = heute();
    const wt = lokal(ctx.jetzt()).wochentag;
    const alle = await daten.liste<Routine>('routinen', {
      filter: { aktiv: true },
      sortierung: 'name',
      limit: 100,
    });
    if (!alle.length) return [];
    const laeufe = await daten.liste<Lauf>('routinen_laeufe', {
      filter: { routine_id: { in: alle.map((r) => r.id) }, periode: { gte: plusTage(h, -400) } },
      limit: 5000,
    });
    return alle.map((r) => {
      const p = periode(h, r.rhythmus);
      const eigene = laeufe.filter((l) => l.routine_id === r.id);
      const lauf = eigene.find((l) => l.periode === p);
      const s = schritte(r.schritte);
      return {
        id: r.id,
        name: r.name,
        rhythmus: r.rhythmus,
        uhrzeit: r.uhrzeit,
        // Wöchentliche Routinen gelten die ganze Woche, tägliche nur an den gewählten Tagen
        heute: r.rhythmus === 'woechentlich' || tageParsen(r.tage).has(wt),
        schritte: s,
        erledigt: (lauf?.erledigt ?? []).filter((i) => i < s.length),
        fertig: !!lauf?.fertig,
        serie: serie(new Set(eigene.filter((l) => l.fertig).map((l) => l.periode)), h, r.rhythmus),
      };
    });
  }

  async function uebersicht() {
    const h = heute();
    const offen = await offene();
    const erledigt = await daten.liste<Aufgabe>('aufgaben', {
      filter: {
        erledigt: true,
        erledigt_am: { gte: new Date(ctx.jetzt().getTime() - 7 * 86400000).toISOString() },
      },
      sortierung: '-erledigt_am',
      limit: 30,
    });
    const listen = [...new Set(offen.map((a) => a.liste || 'Privat'))].sort((a, b) =>
      a.localeCompare(b, 'de'),
    );
    return {
      heute: h,
      offen: offen.map((a) => ({ ...a, gruppe: gruppe(a, h) })),
      erledigt,
      listen,
      routinen: await routinenHeute(),
      einkauf: await daten.liste('einkauf', { sortierung: 'erledigt,erstellt', limit: 300 }),
    };
  }

  async function routen(app: FastifyInstance) {
    // Demo Daten vor jeder Anfrage, sonst kommt eine neue Aufgabe der Vorbereitung zuvor
    app.addHook('onRequest', async () => vorbereiten());
    app.get('/uebersicht', async () => uebersicht());

    app.post<{ Body: { text?: string; liste?: string } }>('/schnell', async (req, reply) => {
      const text = String(req.body?.text ?? '').trim();
      if (!text) return reply.code(400).send({ fehler: 'Text fehlt' });
      const e = schnellErfassen(text.slice(0, 300), heute());
      const neu = await daten.eins<Aufgabe>('aufgaben', {
        ...e,
        liste: e.liste ?? (req.body?.liste || 'Privat'),
        erledigt: false,
      });
      await ctx.aktivitaet('aufgaben', `Aufgabe erfasst: ${neu.titel}`, 'info');
      return neu;
    });

    app.post<{ Params: { id: string }; Body: { erledigt?: boolean } }>(
      '/aufgabe/:id/erledigt',
      async (req, reply) => {
        const a = await daten.hole<Aufgabe>('aufgaben', req.params.id);
        if (!a) return reply.code(404).send({ fehler: 'Aufgabe nicht gefunden' });
        const erledigt = req.body?.erledigt !== false;
        const r = (a.rhythmus ?? 'einmalig') as Rhythmus;
        if (erledigt && r !== 'einmalig') {
          // Wiederkehrend: erledigte Kopie für den Verlauf, die Aufgabe selbst rückt zum nächsten Termin
          await daten.eins('aufgaben', {
            titel: a.titel,
            liste: a.liste,
            faellig: a.faellig,
            prioritaet: a.prioritaet,
            rhythmus: 'einmalig',
            erledigt: true,
            erledigt_am: ctx.jetzt().toISOString(),
          });
          const naechste = naechsteFaelligkeit(a.faellig, r, heute());
          const neu = await daten.aendern<Aufgabe>('aufgaben', a.id, { faellig: naechste });
          return { ...neu, naechste };
        }
        return daten.aendern<Aufgabe>('aufgaben', a.id, {
          erledigt,
          erledigt_am: erledigt ? ctx.jetzt().toISOString() : null,
        });
      },
    );

    // Aufgabe auf später schieben
    app.post<{ Params: { id: string }; Body: { tage?: number } }>(
      '/aufgabe/:id/verschieben',
      async (req, reply) => {
        const a = await daten.hole<Aufgabe>('aufgaben', req.params.id);
        if (!a) return reply.code(404).send({ fehler: 'Aufgabe nicht gefunden' });
        const tage = Math.max(1, Math.min(365, Math.round(Number(req.body?.tage) || 1)));
        const h = heute();
        const basis = a.faellig && a.faellig > h ? a.faellig : h;
        return daten.aendern<Aufgabe>('aufgaben', a.id, { faellig: plusTage(basis, tage) });
      },
    );

    app.post<{ Params: { id: string }; Body: { index?: number; erledigt?: boolean } }>(
      '/routine/:id/schritt',
      async (req, reply) => {
        const r = await daten.hole<Routine>('routinen', req.params.id);
        if (!r) return reply.code(404).send({ fehler: 'Routine nicht gefunden' });
        const s = schritte(r.schritte);
        const index = Number(req.body?.index);
        if (!Number.isInteger(index) || index < 0 || index >= s.length)
          return reply.code(400).send({ fehler: 'Ungültiger Schritt' });
        const p = periode(heute(), r.rhythmus);
        const [lauf] = await daten.liste<Lauf>('routinen_laeufe', {
          filter: { routine_id: r.id, periode: p },
          limit: 1,
        });
        const menge = new Set((lauf?.erledigt ?? []).filter((i) => i < s.length));
        if (req.body?.erledigt === false) menge.delete(index);
        else menge.add(index);
        const erledigt = [...menge].sort((a, b) => a - b);
        const fertig = erledigt.length === s.length;
        if (lauf) await daten.aendern('routinen_laeufe', lauf.id, { erledigt, fertig });
        else await daten.eins('routinen_laeufe', { routine_id: r.id, periode: p, erledigt, fertig });
        if (fertig && !lauf?.fertig) await ctx.aktivitaet('aufgaben', `Routine «${r.name}» erledigt`, 'info');
        return { erledigt, fertig };
      },
    );

    // Erledigte Artikel aus der Einkaufsliste entfernen
    app.post<{ Body: { bestaetigt?: boolean } }>('/einkauf/aufraeumen', async (req, reply) => {
      if (!req.body?.bestaetigt) return reply.code(409).send({ fehler: 'Bestätigung nötig' });
      const weg = await daten.liste<{ id: string }>('einkauf', { filter: { erledigt: true }, limit: 500 });
      for (const e of weg) await daten.loeschen('einkauf', e.id);
      return { entfernt: weg.length };
    });
  }

  const jobs = [
    {
      id: 'erinnerungen',
      name: 'Erinnerungen für Aufgaben und Routinen',
      intervallSek: 60,
      startVerzoegerungSek: 30,
      lauf: async () => {
        const jetzt = ctx.jetzt();
        const h = lokalDatum(jetzt);
        const min = minutenLokal(jetzt);
        // Fenster seit dem letzten Lauf, höchstens zehn Minuten zurück und nie über Mitternacht
        const von = letzterTag === h ? Math.max(letzteMinute, min - 10) : min - 1;
        letzteMinute = min;
        letzterTag = h;
        const imFenster = (hhmm: string | null) => {
          if (!hhmm) return false;
          try {
            const m = hhmmZuMinuten(hhmm);
            return m > von && m <= min;
          } catch {
            return false;
          }
        };
        const gemeldet: string[] = [];
        for (const a of await offene()) {
          if (a.faellig !== h || !imFenster(a.uhrzeit)) continue;
          await ctx.alarm.melden({
            regel: 'aufgaben.erinnerung',
            titel: `Erinnerung: ${a.titel}`,
            text: a.notiz?.slice(0, 200) || `Fällig heute um ${a.uhrzeit}`,
            schluessel: `aufgabe:${a.id}:${h}`,
            prioritaet: a.prioritaet === 'hoch' ? 4 : undefined,
            tags: ['memo'],
            link: '/modul/aufgaben',
          });
          gemeldet.push(a.titel);
        }
        for (const r of await routinenHeute()) {
          if (!r.heute || r.fertig || !imFenster(r.uhrzeit)) continue;
          await ctx.alarm.melden({
            regel: 'aufgaben.routine',
            titel: `Routine: ${r.name}`,
            text: `${r.erledigt.length} von ${r.schritte.length} Schritten erledigt`,
            schluessel: `routine:${r.id}:${h}`,
            tags: ['ballot_box_with_check'],
            link: '/modul/aufgaben',
          });
          gemeldet.push(r.name);
        }
        return gemeldet.length ? `Erinnert: ${gemeldet.join(', ')}` : undefined;
      },
    },
    {
      id: 'morgen',
      name: 'Aufgaben des Tages melden',
      taeglich: '07:00',
      lauf: async () => {
        const h = heute();
        const offen = await offene();
        const heuteFaellig = offen.filter((a) => a.faellig === h);
        const ueber = offen.filter((a) => a.faellig && a.faellig < h);
        if (!heuteFaellig.length && !ueber.length) return 'Nichts fällig';
        const teile = [
          heuteFaellig.length
            ? `Heute: ${heuteFaellig
                .slice(0, 5)
                .map((a) => a.titel)
                .join(', ')}`
            : '',
          ueber.length ? `Überfällig: ${ueber.length}` : '',
        ].filter(Boolean);
        await ctx.alarm.melden({
          regel: 'aufgaben.morgen',
          titel: `${heuteFaellig.length} Aufgaben heute${ueber.length ? `, ${ueber.length} überfällig` : ''}`,
          text: teile.join('\n'),
          schluessel: `aufgaben:morgen:${h}`,
          tags: ['clipboard'],
          link: '/modul/aufgaben',
        });
        return teile.join(', ');
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const h = heute();
    const offen = await offene();
    const heuteListe = offen.filter((a) => a.faellig && a.faellig <= h);
    const ueber = offen.filter((a) => a.faellig && a.faellig < h).length;
    const r = (await routinenHeute()).filter((x) => x.heute && !x.fertig);
    const zeilen: KachelZeile[] = heuteListe.slice(0, 4).map((a) => ({
      text: a.titel,
      wert: a.faellig && a.faellig < h ? 'überfällig' : (a.uhrzeit ?? 'heute'),
      status: (a.faellig && a.faellig < h ? 'warnung' : 'neutral') as Ampel,
    }));
    if (r.length) zeilen.push({ text: 'Offene Routinen', wert: r.map((x) => x.name).join(', ') });
    return {
      status: (ueber ? 'warnung' : 'ok') as Ampel,
      titel: 'Aufgaben',
      wert: String(heuteListe.length),
      einheit: 'heute fällig',
      unter: ueber ? `${ueber} überfällig` : `${offen.length} offen insgesamt`,
      zeilen,
      demo: ctx.konfig.demo,
    };
  }

  async function briefing(): Promise<BriefingTeil | null> {
    const h = heute();
    const liste = (await offene()).filter((a) => a.faellig && a.faellig <= h);
    if (!liste.length) return null;
    return {
      modul: 'aufgaben',
      titel: 'Aufgaben heute',
      zeilen: liste.slice(0, 6).map((a) => ({
        text: a.titel,
        wert: a.faellig && a.faellig < h ? 'überfällig' : (a.uhrzeit ?? ''),
        status: (a.faellig && a.faellig < h ? 'warnung' : 'neutral') as Ampel,
      })),
      status: liste.some((a) => a.faellig && a.faellig < h) ? 'warnung' : 'neutral',
      reihenfolge: 25,
    };
  }

  async function abendbericht(): Promise<BriefingTeil | null> {
    const h = heute();
    const erledigt = await daten.liste<Aufgabe>('aufgaben', {
      filter: {
        erledigt: true,
        erledigt_am: { gte: new Date(ctx.jetzt().getTime() - 86400000).toISOString() },
      },
      limit: 50,
    });
    const morgen = (await offene()).filter((a) => a.faellig === plusTage(h, 1));
    if (!erledigt.length && !morgen.length) return null;
    return {
      modul: 'aufgaben',
      titel: 'Aufgaben',
      zeilen: [
        ...(erledigt.length
          ? [{ text: 'Erledigt', wert: String(erledigt.length), status: 'ok' as Ampel }]
          : []),
        ...morgen.slice(0, 4).map((a) => ({ text: a.titel, wert: 'morgen' })),
      ],
      status: 'neutral',
      reihenfolge: 30,
    };
  }

  async function suche(q: string): Promise<SuchTreffer[]> {
    const treffer = await daten.liste<Aufgabe>('aufgaben', {
      filter: { titel: { like: `%${q}%` } },
      limit: 8,
    });
    return treffer.map((a) => ({
      modul: 'aufgaben',
      titel: a.titel,
      text: a.erledigt ? 'erledigt' : a.faellig ? `fällig ${a.faellig}` : (a.liste ?? ''),
      link: '/modul/aufgaben',
    }));
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    const liste = await daten.liste<Aufgabe>('aufgaben', {
      filter: { erledigt: false, faellig: { gte: lokalDatum(von), lte: lokalDatum(bis) } },
      limit: 200,
    });
    return liste.map((a) => ({
      id: `aufgabe-${a.id}`,
      modul: 'aufgaben',
      art: 'Aufgabe',
      titel: a.titel,
      start: a.faellig as string,
      ganztags: true,
      text: a.liste ?? undefined,
      link: '/modul/aufgaben',
      status: (a.prioritaet === 'hoch' ? 'warnung' : 'neutral') as Ampel,
    }));
  }

  return { routen, jobs, kachel, briefing, abendbericht, suche, timeline };
}
