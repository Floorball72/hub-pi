// Modul Veranstaltungen in der Region: sammelt Anlässe aus iCal und RSS Quellen, die Jerome selbst erfasst.
// Es gibt (Stand Bau) keine offene Schnittstelle für Anlässe in St. Gallen, deren Nutzung klar erlaubt ist.
// Darum werden nur Quellen abgerufen, bei denen Jerome die Nutzungsbedingungen geprüft und abgehakt hat.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler, tabelle } from '../../daten/schema.ts';
import type { Kachel } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { lokalDatum, vonLokal } from '../../kern/zeit.ts';
import { distanzKm } from '../../quellen/geo.ts';
import { httpText } from '../../quellen/http.ts';
import { icalParsen } from '../../quellen/ical.ts';
import { robotsErlaubt } from '../../quellen/robots.ts';
import { feedParsen } from '../../quellen/rss.ts';

export const QUELLEN = tabelle({
  name: 'veranstaltung_quellen',
  modul: 'veranstaltungen',
  label: 'Quellen',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'url', typ: 'text', label: 'Adresse (iCal oder RSS)', pflicht: true },
    { name: 'art', typ: 'text', label: 'Format', optionen: ['iCal', 'RSS'], standard: 'iCal' },
    { name: 'kategorie', typ: 'text', label: 'Kategorie', standard: 'Allgemein' },
    { name: 'ort_name', typ: 'text', label: 'Ort, falls die Quelle keinen liefert' },
    { name: 'lat', typ: 'real', label: 'Breite', min: -90, max: 90 },
    { name: 'lon', typ: 'real', label: 'Länge', min: -180, max: 180 },
    {
      name: 'nutzung_geprueft',
      typ: 'bool',
      label: 'Nutzungsbedingungen geprüft, Abruf erlaubt',
      standard: false,
    },
    { name: 'aktiv', typ: 'bool', label: 'Aktiv', standard: true },
  ],
});

export const ANLAESSE = tabelle({
  name: 'veranstaltungen',
  modul: 'veranstaltungen',
  label: 'Anlässe',
  anzeige: 'titel',
  suche: ['titel', 'ort'],
  spalten: [
    { name: 'quelle_id', typ: 'text', label: 'Quelle' },
    { name: 'uid', typ: 'text', label: 'Kennung' },
    { name: 'titel', typ: 'text', label: 'Titel' },
    { name: 'start', typ: 'zeit', label: 'Beginn' },
    { name: 'ende', typ: 'zeit', label: 'Ende' },
    { name: 'ort', typ: 'text', label: 'Ort' },
    { name: 'link', typ: 'text', label: 'Link' },
    { name: 'kategorie', typ: 'text', label: 'Kategorie' },
    { name: 'lat', typ: 'real', label: 'Breite' },
    { name: 'lon', typ: 'real', label: 'Länge' },
  ],
  indizes: [['start'], ['uid']],
});

interface QuelleZeile {
  id: string;
  name: string;
  url: string;
  art: string;
  kategorie: string | null;
  ort_name: string | null;
  lat: number | null;
  lon: number | null;
  nutzung_geprueft: boolean;
  aktiv: boolean;
}
export type Anlass = {
  id?: string;
  quelle_id: string;
  uid: string;
  titel: string;
  start: string;
  ende: string | null;
  ort: string | null;
  link: string | null;
  kategorie: string | null;
  lat: number | null;
  lon: number | null;
};

/** Anlässe aus dem Inhalt einer Quelle lesen */
export function anlaesseLesen(q: QuelleZeile, text: string, jetzt: Date): Anlass[] {
  const basis = { quelle_id: q.id, kategorie: q.kategorie ?? 'Allgemein', lat: q.lat, lon: q.lon };
  const ab = jetzt.getTime() - 86400000;
  if (q.art === 'RSS') {
    // RSS kennt kein Veranstaltungsdatum: das Publikationsdatum dient nur als Annäherung
    return feedParsen(text)
      .filter((e) => e.zeit && new Date(e.zeit).getTime() > ab)
      .map((e) => ({
        ...basis,
        uid: `${q.id}:${e.link || e.titel}`.slice(0, 300),
        titel: e.titel.slice(0, 300),
        start: new Date(e.zeit!).toISOString(),
        ende: null,
        ort: q.ort_name,
        link: e.link || null,
      }));
  }
  return icalParsen(text, new Date(jetzt.getTime() + 180 * 86400000))
    .filter((t) => new Date(t.ende ?? t.start).getTime() > ab && t.status !== 'CANCELLED')
    .map((t) => ({
      ...basis,
      uid: `${q.id}:${t.uid}:${t.start}`.slice(0, 300),
      titel: t.titel.slice(0, 300),
      start: t.start,
      ende: t.ende,
      ort: t.ort || q.ort_name,
      link: /https?:\/\/\S+/.exec(t.beschreibung)?.[0]?.slice(0, 500) ?? null,
    }));
}

/** Welche Stichworte im Text vorkommen (ohne Gross und Kleinschreibung, ganze Wortteile) */
export function stichwortTreffer(text: string, stichworte: string[]): string[] {
  const t = text.toLocaleLowerCase('de-CH');
  return stichworte.filter((s) => s.trim() && t.includes(s.trim().toLocaleLowerCase('de-CH')));
}

export const veranstaltungen: ModulDef = {
  id: 'veranstaltungen',
  name: 'Veranstaltungen',
  beschreibung: 'Anlässe in der Region aus erlaubten Quellen, mit Filter und Stichworten',
  symbol: 'veranstaltungen',
  reihenfolge: 57,
  tabellen: [QUELLEN, ANLAESSE],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  const heim = konfig.wetterOrte[0] ?? { name: 'Kirchberg SG', lat: 47.41079, lon: 9.0411 };
  const stichworte = () =>
    ctx.einstellungen.hole<string[]>('veranstaltungen.stichworte', [
      'Unihockey',
      'Drohne',
      'Openair',
      'Film',
    ]);
  let demo: Promise<void> | null = null;

  const abruf = ctx.quelle<QuelleZeile, Anlass[]>({
    id: 'veranstaltungen.quellen',
    name: 'Erfasste Veranstaltungsquellen (iCal, RSS)',
    modul: 'veranstaltungen',
    ttlSek: 6 * 3600,
    nurMitEintrag: true,
    abruf: async (q) => {
      if (!(await robotsErlaubt(q.url))) throw new Error('robots.txt verbietet den Abruf');
      const text = await httpText(q.url, { timeoutMs: 15000, maxBytes: 3_000_000 });
      return anlaesseLesen(q, text, ctx.jetzt());
    },
    demo: () => [],
    ungetestet: true,
    beschreibung: 'Nur Quellen mit Häkchen «Nutzungsbedingungen geprüft» werden abgerufen.',
  });

  async function demoVorbereiten() {
    if (!konfig.demo) return;
    demo ??= (async () => {
      if ((await daten.anzahl('veranstaltung_quellen')) > 0) return;
      const [q] = await daten.einfuegen<{ id: string }>('veranstaltung_quellen', [
        {
          name: 'Beispielkalender (Demo)',
          url: 'https://example.org/kalender.ics',
          art: 'iCal',
          kategorie: 'Kultur',
          nutzung_geprueft: false,
          aktiv: false,
        },
      ]);
      const tag = (n: number, h: number) => {
        const [j, m, d] = lokalDatum(new Date(ctx.jetzt().getTime() + n * 86400000))
          .split('-')
          .map(Number);
        return vonLokal(j, m, d, h).toISOString();
      };
      const liste: Omit<Anlass, 'quelle_id' | 'uid'>[] = [
        {
          titel: 'Herbstmarkt in der Altstadt (Demo)',
          start: tag(2, 9),
          ende: tag(2, 17),
          ort: 'St. Gallen, Marktplatz',
          link: null,
          kategorie: 'Markt',
          lat: 47.4245,
          lon: 9.3767,
        },
        {
          titel: 'Unihockey Cup Ostschweiz (Demo)',
          start: tag(6, 10),
          ende: tag(6, 18),
          ort: 'Wil SG, Lindenhof',
          link: null,
          kategorie: 'Sport',
          lat: 47.4615,
          lon: 9.0453,
        },
        {
          titel: 'Kurzfilmabend mit Drohnenaufnahmen (Demo)',
          start: tag(8, 20),
          ende: null,
          ort: 'St. Gallen, Kinok',
          link: null,
          kategorie: 'Kultur',
          lat: 47.4229,
          lon: 9.3696,
        },
        {
          titel: 'Konzert in der Tonhalle (Demo)',
          start: tag(11, 19),
          ende: null,
          ort: 'St. Gallen, Tonhalle',
          link: null,
          kategorie: 'Musik',
          lat: 47.4271,
          lon: 9.3817,
        },
        {
          titel: 'Dorffest Kirchberg (Demo)',
          start: tag(15, 11),
          ende: tag(15, 23),
          ort: 'Kirchberg SG',
          link: null,
          kategorie: 'Fest',
          lat: 47.4115,
          lon: 9.0397,
        },
        {
          titel: 'Openair Kino am See (Demo)',
          start: tag(20, 20),
          ende: null,
          ort: 'Rorschach',
          link: null,
          kategorie: 'Kultur',
          lat: 47.478,
          lon: 9.4903,
        },
      ];
      await daten.einfuegen(
        'veranstaltungen',
        liste.map((a, i) => ({ ...a, quelle_id: q.id, uid: `demo-${i}` })),
      );
    })();
    await demo;
  }

  async function aktualisieren(): Promise<string | undefined> {
    if (konfig.demo) return undefined;
    const quellen = (await daten.liste<QuelleZeile>('veranstaltung_quellen', { limit: 50 })).filter(
      (q) => q.aktiv && q.nutzung_geprueft,
    );
    let neu = 0;
    const fehler: string[] = [];
    for (const q of quellen) {
      const r = await abruf.hole(q);
      if (r.fehler || !r.daten) {
        fehler.push(`${q.name}: ${r.fehler ?? 'leer'}`);
        continue;
      }
      // Bestehende Anlässe dieser Quelle ersetzen (Quelle ist massgebend)
      const alt = await daten.liste<{ id: string; uid: string }>('veranstaltungen', {
        filter: { quelle_id: q.id },
        limit: 5000,
      });
      const neueUids = new Set(r.daten.map((a) => a.uid));
      for (const a of alt) if (!neueUids.has(a.uid)) await daten.loeschen('veranstaltungen', a.id);
      const bekannt = new Set(alt.map((a) => a.uid));
      const zuNeu = r.daten.filter((a) => !bekannt.has(a.uid)).slice(0, 2000);
      if (zuNeu.length) await daten.einfuegen('veranstaltungen', zuNeu);
      neu += zuNeu.length;
    }
    // Vergangene Anlässe aufräumen
    await daten.loescheWo('veranstaltungen', {
      start: { lt: new Date(ctx.jetzt().getTime() - 2 * 86400000).toISOString() },
    });
    if (fehler.length)
      await ctx.aktivitaet(
        'veranstaltungen',
        `Abruf fehlgeschlagen: ${fehler.join('; ')}`.slice(0, 500),
        'warnung',
      );
    return `${quellen.length} Quellen, ${neu} neue Anlässe`;
  }

  async function liste() {
    await demoVorbereiten();
    const worte = stichworte();
    const anlaesse = await daten.liste<Anlass & { id: string }>('veranstaltungen', {
      filter: { start: { gte: new Date(ctx.jetzt().getTime() - 6 * 3600000).toISOString() } },
      sortierung: 'start',
      limit: 2000,
    });
    return anlaesse.map((a) => ({
      ...a,
      distanzKm:
        a.lat !== null && a.lon !== null
          ? Math.round(distanzKm(heim.lat, heim.lon, a.lat, a.lon) * 10) / 10
          : null,
      treffer: stichwortTreffer(`${a.titel} ${a.ort ?? ''} ${a.kategorie ?? ''}`, worte),
    }));
  }

  async function routen(app: FastifyInstance) {
    app.get('/liste', async () => {
      const l = await liste();
      return {
        anlaesse: l,
        kategorien: [...new Set(l.map((a) => a.kategorie ?? 'Allgemein'))].sort(),
        stichworte: stichworte(),
        heim: heim.name,
      };
    });
    app.put<{ Body: { stichworte?: unknown } }>('/stichworte', async (req) => {
      const s = req.body?.stichworte;
      if (!Array.isArray(s) || s.length > 50) throw new EingabeFehler('Ungültige Stichworte');
      const sauber = s.map((x) => String(x).trim().slice(0, 50)).filter(Boolean);
      await ctx.einstellungen.setze('veranstaltungen.stichworte', sauber);
      return sauber;
    });
    app.post('/aktualisieren', async () => ({ ergebnis: await aktualisieren() }));
  }

  const jobs: JobDef[] = [
    {
      id: 'abruf',
      name: 'Quellen abrufen',
      intervallSek: 6 * 3600,
      startVerzoegerungSek: 240,
      lauf: aktualisieren,
    },
  ];

  async function kachel(): Promise<Kachel> {
    const l = await liste();
    const woche = l.filter((a) => new Date(a.start).getTime() < ctx.jetzt().getTime() + 7 * 86400000);
    const markiert = l.filter((a) => a.treffer.length);
    return {
      status: 'neutral',
      titel: 'Veranstaltungen',
      wert: String(woche.length),
      einheit: 'diese Woche',
      unter: markiert.length ? `${markiert.length} mit Stichwort` : 'in der Region',
      zeilen: (markiert.length ? markiert : l).slice(0, 3).map((a) => ({
        text: a.titel,
        wert: new Date(a.start).toLocaleDateString('de-CH', {
          timeZone: 'Europe/Zurich',
          weekday: 'short',
          day: 'numeric',
          month: 'numeric',
        }),
      })),
      demo: konfig.demo,
      hinweis: !konfig.demo && !l.length ? 'Noch keine Quelle erfasst' : undefined,
    };
  }

  return { routen, jobs, kachel };
}
