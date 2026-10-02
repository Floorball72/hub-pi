// Modul Content Kalender: Planung von Posts und Stories. Der Hub veröffentlicht nichts und schreibt keine Texte.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler, tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel, TimelineEintrag } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { lokalDatum, vonLokal } from '../../kern/zeit.ts';

export const STATUS = ['Idee', 'in Arbeit', 'bereit', 'veröffentlicht'] as const;
export const PLATTFORMEN = ['Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'Facebook', 'Webseite', 'Andere'];

export const BEITRAEGE = tabelle({
  name: 'content_beitraege',
  modul: 'content',
  label: 'Beiträge',
  bearbeitbar: true,
  anzeige: 'titel',
  suche: ['titel', 'notizen'],
  spalten: [
    { name: 'titel', typ: 'text', label: 'Titel', pflicht: true },
    { name: 'zeit', typ: 'zeit', label: 'Geplant für', pflicht: true },
    { name: 'plattform', typ: 'text', label: 'Plattform', optionen: PLATTFORMEN, standard: 'Instagram' },
    {
      name: 'art',
      typ: 'text',
      label: 'Art',
      optionen: ['Post', 'Story', 'Reel', 'Video', 'Karussell'],
      standard: 'Post',
    },
    { name: 'status', typ: 'text', label: 'Status', optionen: [...STATUS], standard: 'Idee' },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
    { name: 'checkliste', typ: 'json', label: 'Checkliste' },
    { name: 'event_id', typ: 'text', label: 'Veranstaltung', verweis: 'events' },
    { name: 'kunde_id', typ: 'text', label: 'Kunde', verweis: 'kunden' },
    {
      name: 'erinnerung_min',
      typ: 'int',
      label: 'Erinnerung vorher',
      einheit: 'min',
      min: 0,
      max: 10080,
      standard: 60,
    },
  ],
  indizes: [['zeit']],
});

export interface Punkt {
  text: string;
  erledigt: boolean;
}
interface Beitrag {
  id: string;
  titel: string;
  zeit: string;
  plattform: string | null;
  art: string | null;
  status: string;
  notizen: string | null;
  checkliste: Punkt[] | null;
  event_id: string | null;
  kunde_id: string | null;
  erinnerung_min: number | null;
}

/** Standard Checkliste pro Art. In den Einstellungen anpassbar (Schlüssel content.checklisten). */
export const STANDARD_CHECKLISTEN: Record<string, string[]> = {
  Post: [
    'Bild oder Video ausgewählt',
    'Bearbeitet und exportiert',
    'Text geschrieben',
    'Hashtags und Markierungen',
    'Freigabe (falls Kunde)',
  ],
  Story: ['Material bereit', 'Sticker oder Link gesetzt', 'Freigabe (falls Kunde)'],
  Reel: [
    'Schnitt fertig',
    'Musik mit Rechten',
    'Untertitel',
    'Titelbild',
    'Text geschrieben',
    'Freigabe (falls Kunde)',
  ],
  Video: [
    'Schnitt fertig',
    'Ton gemischt',
    'Untertitel',
    'Thumbnail',
    'Beschreibung',
    'Freigabe (falls Kunde)',
  ],
  Karussell: ['Bilder ausgewählt', 'Reihenfolge festgelegt', 'Text geschrieben', 'Freigabe (falls Kunde)'],
};

export function checklisteFuer(art: string | null, vorlagen: Record<string, string[]>): Punkt[] {
  return (vorlagen[art ?? 'Post'] ?? vorlagen.Post ?? []).map((text) => ({ text, erledigt: false }));
}

/** Beiträge, deren Erinnerung jetzt fällig ist (Fenster seit dem letzten Lauf) */
export function faelligeErinnerungen(liste: Beitrag[], jetzt: number, fensterMs: number): Beitrag[] {
  return liste.filter((b) => {
    if (b.status === 'veröffentlicht' || !b.erinnerung_min) return false;
    const t = new Date(b.zeit).getTime() - b.erinnerung_min * 60000;
    return t <= jetzt && t > jetzt - fensterMs;
  });
}

export const content: ModulDef = {
  id: 'content',
  name: 'Content Kalender',
  beschreibung: 'Posts und Stories planen, mit Status, Checkliste und Erinnerung',
  symbol: 'content',
  reihenfolge: 56,
  tabellen: [BEITRAEGE],
  regeln: [
    {
      id: 'erinnerung',
      name: 'Erinnerung an Beitrag',
      beschreibung: 'Erinnert vor dem geplanten Zeitpunkt eines Beitrags, der noch nicht veröffentlicht ist.',
      prioritaet: 3,
      cooldownMin: 60,
    },
  ],
  erstellen: (ctx) => contentLaufzeit(ctx),
};

function contentLaufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  let demo: Promise<void> | null = null;
  const vorlagen = () =>
    ctx.einstellungen.hole<Record<string, string[]>>('content.checklisten', STANDARD_CHECKLISTEN);

  async function demoVorbereiten() {
    if (!konfig.demo) return;
    demo ??= (async () => {
      if ((await daten.anzahl('content_beitraege')) > 0) return;
      const tag = (n: number, h: number, m = 0) => {
        const [j, mo, d] = lokalDatum(new Date(ctx.jetzt().getTime() + n * 86400000))
          .split('-')
          .map(Number);
        return vonLokal(j, mo, d, h, m).toISOString();
      };
      const ev = daten.tabelle('events')
        ? await daten.liste<{ id: string }>('events', { sortierung: 'start', limit: 1 })
        : [];
      const eintraege = [
        { titel: 'Drohnenaufnahme Herbstwald (Demo)', zeit: tag(1, 18, 30), art: 'Reel', status: 'bereit' },
        { titel: 'Hinter den Kulissen Dreh (Demo)', zeit: tag(2, 12), art: 'Story', status: 'in Arbeit' },
        {
          titel: 'Turnier Ankündigung (Demo)',
          zeit: tag(5, 19),
          art: 'Post',
          status: 'Idee',
          event_id: ev[0]?.id ?? null,
        },
        { titel: 'Kundenprojekt Rückblick (Demo)', zeit: tag(9, 8), art: 'Karussell', status: 'Idee' },
        { titel: 'Sonnenuntergang Säntis (Demo)', zeit: tag(-3, 19), art: 'Post', status: 'veröffentlicht' },
      ];
      await daten.einfuegen(
        'content_beitraege',
        eintraege.map((e) => {
          const liste = checklisteFuer(e.art, vorlagen());
          const fertig =
            e.status === 'veröffentlicht'
              ? liste.length
              : e.status === 'bereit'
                ? liste.length
                : e.status === 'in Arbeit'
                  ? 2
                  : 0;
          return {
            plattform: 'Instagram',
            erinnerung_min: 60,
            ...e,
            checkliste: liste.map((p, i) => ({ ...p, erledigt: i < fertig })),
          };
        }),
      );
    })();
    await demo;
  }

  async function zeitraum(von: Date, bis: Date) {
    await demoVorbereiten();
    return daten.liste<Beitrag>('content_beitraege', {
      filter: { zeit: { gte: von.toISOString(), lt: bis.toISOString() } },
      sortierung: 'zeit',
      limit: 1000,
    });
  }

  async function routen(app: FastifyInstance) {
    app.get<{ Querystring: { von?: string; bis?: string } }>('/beitraege', async (req) => {
      const von = new Date(String(req.query.von ?? ''));
      const bis = new Date(String(req.query.bis ?? ''));
      if (Number.isNaN(von.getTime()) || Number.isNaN(bis.getTime()))
        throw new EingabeFehler('Zeitraum fehlt');
      if (bis.getTime() - von.getTime() > 120 * 86400000) throw new EingabeFehler('Zeitraum zu lang');
      const events = daten.tabelle('events')
        ? await daten.liste<{ id: string; titel: string; start: string }>('events', {
            filter: { start: { gte: von.toISOString(), lt: bis.toISOString() } },
            limit: 200,
          })
        : [];
      return { beitraege: await zeitraum(von, bis), events, plattformen: PLATTFORMEN, status: STATUS };
    });

    app.get('/vorlagen', async () => vorlagen());
    app.put<{ Body: Record<string, unknown> }>('/vorlagen', async (req) => {
      const neu: Record<string, string[]> = {};
      for (const [art, liste] of Object.entries(req.body ?? {})) {
        if (!/^[\p{L} ]{1,30}$/u.test(art) || !Array.isArray(liste))
          throw new EingabeFehler('Ungültige Vorlage');
        neu[art] = liste
          .map((x) => String(x).trim().slice(0, 200))
          .filter(Boolean)
          .slice(0, 30);
      }
      await ctx.einstellungen.setze('content.checklisten', neu);
      return neu;
    });

    app.post<{ Body: Partial<Beitrag> }>('/neu', async (req) => {
      const b = req.body ?? {};
      const titel = String(b.titel ?? '').trim();
      const zeit = new Date(String(b.zeit ?? ''));
      if (!titel) throw new EingabeFehler('Titel fehlt');
      if (Number.isNaN(zeit.getTime())) throw new EingabeFehler('Zeitpunkt fehlt');
      const art = typeof b.art === 'string' ? b.art : 'Post';
      return daten.eins('content_beitraege', {
        titel,
        zeit: zeit.toISOString(),
        art,
        plattform: typeof b.plattform === 'string' ? b.plattform : 'Instagram',
        status: 'Idee',
        notizen: b.notizen ?? null,
        event_id: b.event_id || null,
        kunde_id: b.kunde_id || null,
        erinnerung_min: b.erinnerung_min ?? 60,
        checkliste: checklisteFuer(art, vorlagen()),
      });
    });

    app.post<{ Params: { id: string }; Body: { status?: string; zeit?: string; checkliste?: Punkt[] } }>(
      '/beitrag/:id',
      async (req) => {
        const aenderung: Record<string, unknown> = {};
        const b = req.body ?? {};
        if (b.status !== undefined) {
          if (!(STATUS as readonly string[]).includes(b.status)) throw new EingabeFehler('Ungültiger Status');
          aenderung.status = b.status;
        }
        if (b.zeit !== undefined) {
          const z = new Date(b.zeit);
          if (Number.isNaN(z.getTime())) throw new EingabeFehler('Ungültiger Zeitpunkt');
          aenderung.zeit = z.toISOString();
        }
        if (b.checkliste !== undefined) {
          if (!Array.isArray(b.checkliste) || b.checkliste.length > 50)
            throw new EingabeFehler('Ungültige Checkliste');
          aenderung.checkliste = b.checkliste.map((p) => ({
            text: String(p.text).slice(0, 200),
            erledigt: !!p.erledigt,
          }));
        }
        const r = await daten.aendern('content_beitraege', req.params.id, aenderung);
        if (!r) throw new EingabeFehler('Beitrag nicht gefunden');
        return r;
      },
    );
  }

  let letzterLauf = 0;
  const jobs: JobDef[] = [
    {
      id: 'erinnerungen',
      name: 'Erinnerungen',
      intervallSek: 300,
      startVerzoegerungSek: 70,
      lauf: async () => {
        const jetzt = ctx.jetzt().getTime();
        // Erster Lauf nach dem Start: 10 Minuten zurückschauen, danach seit dem letzten Lauf
        const fenster = letzterLauf ? jetzt - letzterLauf + 1000 : 600000;
        letzterLauf = jetzt;
        const kandidaten = await daten.liste<Beitrag>('content_beitraege', {
          filter: {
            zeit: {
              gte: new Date(jetzt - 3600000).toISOString(),
              lte: new Date(jetzt + 7 * 86400000).toISOString(),
            },
          },
          limit: 500,
        });
        const faellig = faelligeErinnerungen(kandidaten, jetzt, fenster);
        for (const b of faellig) {
          const offen = (b.checkliste ?? []).filter((p) => !p.erledigt).length;
          await ctx.alarm.melden({
            regel: 'content.erinnerung',
            titel: `${b.art ?? 'Beitrag'} um ${new Date(b.zeit).toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })}: ${b.titel}`,
            text: `${b.plattform ?? 'Instagram'}, Status ${b.status}${offen ? `, ${offen} Punkte offen` : ''}`,
            schluessel: `content:${b.id}:${b.zeit}`,
            link: '/modul/content',
          });
        }
        return faellig.length ? `${faellig.length} Erinnerungen` : undefined;
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const jetzt = ctx.jetzt();
    const liste = await zeitraum(jetzt, new Date(jetzt.getTime() + 7 * 86400000));
    const offen = liste.filter((b) => b.status !== 'veröffentlicht');
    const n = offen[0];
    return {
      status: (n && n.status !== 'bereit' && new Date(n.zeit).getTime() - jetzt.getTime() < 86400000
        ? 'warnung'
        : 'ok') as Ampel,
      titel: 'Content Kalender',
      wert: String(offen.length),
      einheit: 'geplant',
      unter: 'in den nächsten 7 Tagen',
      zeilen: offen.slice(0, 3).map((b) => ({
        text: b.titel,
        wert: `${new Date(b.zeit).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short' })} · ${b.status}`,
        status: (b.status === 'bereit' ? 'ok' : 'neutral') as Ampel,
      })),
      demo: konfig.demo,
    };
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    return (await zeitraum(von, bis)).map((b) => ({
      id: `content-${b.id}`,
      modul: 'content',
      art: b.art ?? 'Beitrag',
      titel: b.titel,
      text: `${b.plattform ?? 'Instagram'} · ${b.status}`,
      start: b.zeit,
      link: '/modul/content',
      status: (b.status === 'veröffentlicht' || b.status === 'bereit' ? 'ok' : 'neutral') as Ampel,
    }));
  }

  return { routen, jobs, kachel, timeline };
}
