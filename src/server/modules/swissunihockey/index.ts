// Modul swiss unihockey: Einsatzplan aus dem Kalender, Spiele des Tages, Checkliste und Erinnerungen.
// Das Modul erstellt, schreibt und postet nichts. Der geteilte Login steht nur in der .env und wird nie ausgegeben.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { EingabeFehler, tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel, TimelineEintrag } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { lokal, lokalDatum } from '../../kern/zeit.ts';
import { httpText } from '../../quellen/http.ts';
import { icalParsen, type Termin } from '../../quellen/ical.ts';
import { type Spiel, type SpielEreignisse, SUH_NAMENSNENNUNG, suhV2 } from '../../quellen/swissunihockey.ts';
import { demoSpielEreignisse } from '../unihockey/demo.ts';
import { entwurf, pushText, type SpielBericht, spielBericht } from './bericht.ts';
import { demoSpieleAmTag, demoTermine } from './demo.ts';
import { ablaufParsen, type Einsatz, einsatzAusTermin, schritteFuer } from './einsatz.ts';

export const VORLAGE = tabelle({
  name: 'suh_vorlage',
  modul: 'swissunihockey',
  label: 'Checkliste Vorlage',
  bearbeitbar: true,
  anzeige: 'text',
  spalten: [
    { name: 'abschnitt', typ: 'text', label: 'Abschnitt', pflicht: true },
    { name: 'text', typ: 'text', label: 'Schritt', pflicht: true },
    {
      name: 'fuer',
      typ: 'text',
      label: 'Gilt für',
      optionen: ['alle', 'Resultatpost', 'Matchbericht'],
      standard: 'alle',
    },
    { name: 'reihenfolge', typ: 'int', label: 'Reihenfolge', standard: 100 },
  ],
});

export const EINSATZ_STATUS = tabelle({
  name: 'suh_einsatz',
  modul: 'swissunihockey',
  label: 'Checkliste pro Einsatz',
  spalten: [
    { name: 'schluessel', typ: 'text' },
    { name: 'erledigt', typ: 'json' },
    { name: 'notizen', typ: 'text' },
  ],
  indizes: [['schluessel']],
});

interface Schritt {
  id: string;
  abschnitt: string;
  text: string;
  fuer: string;
  reihenfolge: number;
}

export const ABLAUF_DATEI = 'docs/swissunihockey-ablauf.md';

export const swissunihockey: ModulDef = {
  id: 'swissunihockey',
  name: 'swiss unihockey',
  beschreibung: 'Einsatzplan, Spiele des Tages und Checkliste (nur Infos, postet nichts)',
  symbol: 'swissunihockey',
  reihenfolge: 45,
  tabellen: [VORLAGE, EINSATZ_STATUS],
  regeln: [
    {
      id: 'login',
      name: 'Freitagabend: Login prüfen',
      beschreibung: 'Am Freitag um 18:00 eine Erinnerung, wenn am Wochenende Einsätze anstehen.',
      prioritaet: 3,
      cooldownMin: 1440,
    },
    {
      id: 'spielende',
      name: 'Spielende erreicht',
      beschreibung:
        'Die Spiele eines Einsatztages sind beendet (oder geschätzt zwei Stunden nach Termin). Mit Resultaten und Torschützen.',
      prioritaet: 4,
      cooldownMin: 180,
    },
    {
      id: 'evtl',
      name: 'Unsichere Einsätze klären',
      beschreibung:
        'Täglich um 09:00 eine Erinnerung für Einsätze mit Status «evtl.» in den nächsten 7 Tagen.',
      prioritaet: 2,
      cooldownMin: 1440,
    },
  ],
  erstellen: (ctx) => suhLaufzeit(ctx),
};

function suhLaufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  let vorlageGeprueft: Promise<void> | null = null;
  const gemeldet = new Set<string>();

  const kalender = ctx.quelle<void, Termin[]>({
    id: 'swissunihockey.kalender',
    name: 'Google Kalender (iCal)',
    modul: 'swissunihockey',
    ttlSek: 15 * 60,
    abruf: async () => icalParsen(await httpText(konfig.icalUrl, { timeoutMs: 20000, maxBytes: 10_000_000 })),
    demo: () => demoTermine(ctx.jetzt()),
    konfiguriert: () => !!konfig.icalUrl,
    beschreibung: 'Geheime iCal Adresse, nur in der .env',
  });
  const spieleTag = ctx.quelle<string, Spiel[]>({
    id: 'swissunihockey.spiele',
    name: 'swiss unihockey Spiele des Tages',
    modul: 'swissunihockey',
    ttlSek: 120,
    abruf: (datum) => suhV2.spieleAmTag(datum),
    demo: (datum) => demoSpieleAmTag(datum, ctx.jetzt()),
    namensnennung: SUH_NAMENSNENNUNG,
    testParameter: () => lokalDatum(new Date()),
  });
  const ereignisse = ctx.quelle<
    { id: string; heim: string; gast: string; resultat: string | null },
    SpielEreignisse
  >({
    id: 'swissunihockey.ereignisse',
    name: 'swiss unihockey Spielereignisse',
    modul: 'swissunihockey',
    ttlSek: 6 * 3600,
    abruf: (p) => suhV2.spielEreignisse(p.id),
    demo: (p) => demoSpielEreignisse(p.id, p.heim, p.gast, p.resultat),
    namensnennung: SUH_NAMENSNENNUNG,
    testParameter: () => ({ id: '1104358', heim: '', gast: '', resultat: null }),
  });

  async function vorlageLaden(ersetzen: boolean): Promise<number> {
    const pfad = resolve(ABLAUF_DATEI);
    const schritte = existsSync(pfad) ? ablaufParsen(readFileSync(pfad, 'utf8')) : [];
    if (!schritte.length) return 0;
    if (ersetzen) await daten.loescheWo('suh_vorlage', { reihenfolge: { gte: -1000000 } });
    await daten.einfuegen('suh_vorlage', schritte as unknown as Record<string, unknown>[]);
    return schritte.length;
  }

  async function vorlage(): Promise<Schritt[]> {
    vorlageGeprueft ??= (async () => {
      if ((await daten.anzahl('suh_vorlage')) === 0) await vorlageLaden(false);
    })();
    await vorlageGeprueft;
    return daten.liste<Schritt>('suh_vorlage', { sortierung: 'reihenfolge', limit: 300 });
  }

  async function einsaetze(
    vonTage = -1,
    bisTage = 60,
  ): Promise<{ liste: Einsatz[]; fehler?: string; demo: boolean }> {
    const r = await kalender.hole();
    const von = ctx.jetzt().getTime() + vonTage * 86400000;
    const bis = ctx.jetzt().getTime() + bisTage * 86400000;
    const liste = (r.daten ?? [])
      .map(einsatzAusTermin)
      .filter((e): e is Einsatz => !!e)
      .filter((e) => {
        const t = new Date(e.start).getTime();
        return t >= von && t <= bis;
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    return { liste, fehler: r.fehler, demo: r.demo };
  }

  async function status(schluessel: string) {
    const [z] = await daten.liste<{ id: string; erledigt: string[] | null; notizen: string | null }>(
      'suh_einsatz',
      { filter: { schluessel }, limit: 1 },
    );
    return z ?? null;
  }

  /** Ligen, die im Text eines Einsatzes vorkommen (z.B. «Herren L-UPL») */
  function ligenImText(e: Einsatz, spiele: Spiel[]): string[] {
    const text = `${e.titel} ${e.text}`.toLowerCase();
    return [...new Set(spiele.map((s) => s.liga).filter((l): l is string => !!l))].filter((l) =>
      text.includes(l.toLowerCase()),
    );
  }

  /** Beendete Spiele eines Einsatzes mit Torfolge und Skorern. Ohne passende Liga alle beendeten Spiele des Tages. */
  async function berichte(
    e: Einsatz,
    spiele?: Spiel[],
  ): Promise<{ berichte: SpielBericht[]; ligen: string[] }> {
    const sp = spiele ?? (await spieleTag.hole(lokalDatum(new Date(e.start)))).daten ?? [];
    const ligen = ligenImText(e, sp);
    const relevant = ligen.length ? sp.filter((s) => s.liga && ligen.includes(s.liga)) : sp;
    const fertig = relevant.filter((s) => s.beendet && s.id).slice(0, 8);
    const liste = await Promise.all(
      fertig.map(async (s) => {
        const r = await ereignisse.hole({ id: s.id, heim: s.heim, gast: s.gast, resultat: s.resultat });
        return spielBericht(s, r.daten ?? null);
      }),
    );
    return { berichte: liste, ligen };
  }

  async function routen(app: FastifyInstance) {
    app.get('/einsaetze', async () => {
      const e = await einsaetze(-2, 90);
      const v = await vorlage();
      const mitStatus = await Promise.all(
        e.liste.map(async (x) => {
          const s = await status(x.schluessel);
          const schritte = schritteFuer(v, x.typ);
          const erledigt = (s?.erledigt ?? []).filter((id) => schritte.some((y) => y.id === id)).length;
          return { ...x, erledigt, schritte: schritte.length };
        }),
      );
      return {
        einsaetze: mitStatus,
        fehler: e.fehler,
        demo: e.demo,
        konfiguriert: !!konfig.icalUrl || konfig.demo,
        loginHinterlegt: !!konfig.suhLogin.benutzer && !!konfig.suhLogin.passwort,
        vorlageAnzahl: v.length,
      };
    });

    app.get<{ Querystring: { schluessel: string } }>('/einsatz', async (req) => {
      const e = (await einsaetze(-30, 120)).liste.find((x) => x.schluessel === req.query.schluessel);
      if (!e) throw new EingabeFehler('Einsatz nicht gefunden');
      const datum = lokalDatum(new Date(e.start));
      const sp = await spieleTag.hole(datum);
      const ligen = ligenImText(e, sp.daten ?? []);
      const s = await status(e.schluessel);
      return {
        einsatz: e,
        schritte: schritteFuer(await vorlage(), e.typ),
        erledigt: s?.erledigt ?? [],
        notizen: s?.notizen ?? '',
        spiele: sp.daten ?? [],
        spieleFehler: sp.fehler,
        ligen,
      };
    });

    app.get<{ Querystring: { schluessel: string } }>('/einsatz/bericht', async (req) => {
      const e = (await einsaetze(-30, 120)).liste.find((x) => x.schluessel === req.query.schluessel);
      if (!e) throw new EingabeFehler('Einsatz nicht gefunden');
      const b = await berichte(e);
      return { ...b, entwurf: b.berichte.length ? entwurf(b.berichte) : null };
    });

    app.get<{ Querystring: { datum?: string } }>('/tag', async (req) => {
      const datum =
        req.query.datum && /^\d{4}-\d{2}-\d{2}$/.test(req.query.datum)
          ? req.query.datum
          : lokalDatum(ctx.jetzt());
      const r = await spieleTag.hole(datum);
      return { datum, spiele: r.daten ?? [], fehler: r.fehler, demo: r.demo };
    });

    app.post<{ Body: { schluessel: string; schritt?: string; erledigt?: boolean; notizen?: string } }>(
      '/einsatz/status',
      async (req) => {
        const b = req.body ?? ({} as { schluessel: string });
        if (typeof b.schluessel !== 'string' || b.schluessel.length > 500)
          throw new EingabeFehler('Ungültiger Einsatz');
        const s = await status(b.schluessel);
        let erledigt = new Set(s?.erledigt ?? []);
        if (typeof b.schritt === 'string') {
          if (b.erledigt) erledigt.add(b.schritt);
          else erledigt.delete(b.schritt);
        }
        erledigt = new Set([...erledigt].slice(0, 300));
        const zeile = {
          schluessel: b.schluessel,
          erledigt: [...erledigt],
          notizen: typeof b.notizen === 'string' ? b.notizen.slice(0, 5000) : (s?.notizen ?? null),
        };
        if (s) await daten.aendern('suh_einsatz', s.id, zeile);
        else await daten.einfuegen('suh_einsatz', [zeile]);
        return { ok: true, erledigt: zeile.erledigt };
      },
    );

    app.post<{ Body: { bestaetigt?: boolean } }>('/vorlage/neu-laden', async (req) => {
      if (req.body?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
      const n = await vorlageLaden(true);
      if (!n) throw new EingabeFehler(`In ${ABLAUF_DATEI} stehen noch keine Schritte`);
      await ctx.aktivitaet(
        'swissunihockey',
        `Checkliste aus ${ABLAUF_DATEI} geladen (${n} Schritte)`,
        'aktion',
      );
      return { ok: true, schritte: n };
    });
  }

  const jobs = [
    {
      id: 'login',
      name: 'Freitag: Login Erinnerung',
      taeglich: '18:00',
      lauf: async () => {
        if (lokal(ctx.jetzt()).wochentag !== 5) return undefined;
        const wochenende = (await einsaetze(0, 3)).liste.filter((e) =>
          [6, 0].includes(lokal(new Date(e.start)).wochentag),
        );
        if (!wochenende.length) return undefined;
        await ctx.alarm.melden({
          regel: 'swissunihockey.login',
          titel: 'swiss unihockey: Login prüfen',
          text: `${wochenende.length} Einsatz${wochenende.length > 1 ? 'e' : ''} am Wochenende. Funktioniert der geteilte Login?`,
          schluessel: `login:${lokalDatum(ctx.jetzt())}`,
        });
        return 'Erinnerung gesendet';
      },
    },
    {
      id: 'evtl',
      name: 'Unsichere Einsätze',
      taeglich: '09:00',
      lauf: async () => {
        const offen = (await einsaetze(0, 7)).liste.filter((e) => e.status === 'evtl.');
        if (!offen.length) return undefined;
        await ctx.alarm.melden({
          regel: 'swissunihockey.evtl',
          titel: 'swiss unihockey: Einsätze klären',
          text: offen
            .map(
              (e) =>
                `${new Date(e.start).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', day: 'numeric', month: 'numeric' })} ${e.titel}`,
            )
            .join('\n'),
          schluessel: `evtl:${lokalDatum(ctx.jetzt())}`,
        });
        return `${offen.length} unsicher`;
      },
    },
    {
      id: 'spielende',
      name: 'Spielende überwachen',
      intervallSek: 300,
      startVerzoegerungSek: 80,
      lauf: async () => {
        const jetzt = ctx.jetzt().getTime();
        const heute = (await einsaetze(-1, 1)).liste.filter(
          (e) => lokalDatum(new Date(e.start)) === lokalDatum(ctx.jetzt()) && !e.ganztags,
        );
        for (const e of heute) {
          if (gemeldet.has(e.schluessel) || jetzt < new Date(e.start).getTime()) continue;
          const sp = (await spieleTag.hole(lokalDatum(ctx.jetzt()))).daten ?? [];
          const ligen = ligenImText(e, sp);
          const relevant = sp.filter((s) => s.liga && ligen.includes(s.liga));
          const fertig = relevant.length
            ? relevant.every((s) => s.beendet)
            : jetzt >= new Date(e.start).getTime() + 2 * 3600000;
          if (!fertig) continue;
          gemeldet.add(e.schluessel);
          const b = relevant.length ? (await berichte(e, relevant)).berichte : [];
          const postzeit = e.postzeit
            ? new Date(e.postzeit).toLocaleTimeString('de-CH', {
                timeZone: 'Europe/Zurich',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'offen';
          await ctx.alarm.melden({
            regel: 'swissunihockey.spielende',
            titel: `Spielende: ${e.typ ?? 'Einsatz'}`,
            text: relevant.length
              ? `${
                  b.length
                    ? `${pushText(b)}

`
                    : ''
                }Alle Spiele (${ligen.join(', ')}) sind beendet. Geschätzte Postzeit ${postzeit}. Entwurf im Hub.`
              : 'Geschätztes Spielende erreicht (Termin plus zwei Stunden).',
            schluessel: `suhende:${e.schluessel}`,
            tags: ['memo'],
            link: `/modul/swissunihockey?einsatz=${encodeURIComponent(e.schluessel)}`,
          });
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
    const e = await einsaetze(-0.5, 60);
    if (!konfig.icalUrl && !konfig.demo)
      return {
        status: 'neutral',
        titel: 'swiss unihockey',
        wert: '–',
        hinweis: 'iCal Adresse in der Einrichtung eintragen',
      };
    if (e.fehler && !e.liste.length)
      return { status: 'ausfall', titel: 'swiss unihockey', hinweis: e.fehler };
    const n = e.liste[0];
    const evtl = e.liste.filter((x) => x.status === 'evtl.').length;
    return {
      status: evtl ? 'warnung' : 'ok',
      titel: 'swiss unihockey',
      wert: n ? kurz(n.start) : 'kein Einsatz',
      unter: n ? `${n.typ ?? 'Einsatz'} · ${n.status}${n.ersatzFuer ? ` für ${n.ersatzFuer}` : ''}` : '',
      zeilen: [
        ...e.liste.slice(1, 4).map((x) => ({
          text: `${x.typ ?? 'Einsatz'} ${x.status === 'fix' ? '' : x.status}`.trim(),
          wert: kurz(x.start),
          status: (x.status === 'evtl.' ? 'warnung' : 'neutral') as Ampel,
        })),
        ...(evtl ? [{ text: 'Unsichere Einsätze', wert: String(evtl), status: 'warnung' as Ampel }] : []),
      ],
      demo: e.demo,
    };
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    const tage = (d: Date) => (d.getTime() - ctx.jetzt().getTime()) / 86400000;
    const e = await einsaetze(tage(von), tage(bis));
    const termine = ((await kalender.hole()).daten ?? []).filter(
      (t) => !einsatzAusTermin(t) && new Date(t.start) >= von && new Date(t.start) <= bis,
    );
    return [
      ...e.liste.map((x) => ({
        id: `suh-${x.schluessel}`,
        modul: 'swissunihockey',
        art: `swiss unihockey ${x.typ ?? ''}`.trim(),
        titel: x.titel,
        text: [
          x.status === 'fix' ? null : x.status,
          x.ersatzFuer ? `Ersatz für ${x.ersatzFuer}` : null,
          x.postzeit
            ? `Postzeit ca. ${new Date(x.postzeit).toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        start: x.start,
        ende: x.ende ?? undefined,
        ganztags: x.ganztags,
        status: (x.status === 'evtl.' ? 'warnung' : 'neutral') as Ampel,
        link: `/modul/swissunihockey?einsatz=${encodeURIComponent(x.schluessel)}`,
      })),
      ...termine.map((t) => ({
        id: `termin-${t.uid}-${t.start}`,
        modul: 'zentrale',
        art: 'Termin',
        titel: t.titel,
        text: t.ort || undefined,
        start: t.start,
        ende: t.ende ?? undefined,
        ganztags: t.ganztags,
      })),
    ];
  }

  async function briefing() {
    const e = await einsaetze(-0.2, 30);
    const termine = ((await kalender.hole()).daten ?? []).filter(
      (t) => !einsatzAusTermin(t) && lokalDatum(new Date(t.start)) === lokalDatum(ctx.jetzt()),
    );
    const zeilen = [
      ...termine.slice(0, 4).map((t) => ({
        text: t.titel,
        wert: t.ganztags
          ? 'ganztags'
          : new Date(t.start).toLocaleTimeString('de-CH', {
              timeZone: 'Europe/Zurich',
              hour: '2-digit',
              minute: '2-digit',
            }),
      })),
      ...(e.liste[0]
        ? [
            {
              text: `Nächster swiss unihockey Einsatz: ${e.liste[0].typ ?? ''} ${e.liste[0].status === 'fix' ? '' : e.liste[0].status}`.trim(),
              wert: kurz(e.liste[0].start),
              status: (e.liste[0].status === 'evtl.' ? 'warnung' : 'ok') as Ampel,
            },
          ]
        : []),
    ];
    if (!zeilen.length) return null;
    return { modul: 'swissunihockey', titel: 'Termine', zeilen, status: 'neutral' as Ampel, reihenfolge: 20 };
  }

  return { routen, jobs, kachel, timeline, briefing };
}
