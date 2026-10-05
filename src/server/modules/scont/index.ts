// Modul scont: Webseiten Wächter, Kunden, Domains, Kosten, PageSpeed und Qualitätscheck.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler } from '../../daten/schema.ts';
import { verdichten } from '../../daten/verdichtung.ts';
import type { Ampel, Kachel, TimelineEintrag } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { lokalDatum, tagesBeginn } from '../../kern/zeit.ts';
import { httpAnfrage, httpJson } from '../../quellen/http.ts';
import {
  monatsDaten,
  monatsreportPdf,
  type OeffentlicherStatus,
  seitenStatistik,
  statusHtml,
} from './bericht.ts';
import {
  demoZeitenAnlegen,
  demoDatenAnlegen,
  demoPagespeed,
  demoPruefung,
  demoQualitaet,
  demoSsl,
} from './demo.ts';
import {
  linksExtrahieren,
  linksPruefen,
  type PageSpeedWerte,
  type PruefErgebnis,
  pagespeedAuswerten,
  pagespeedUrl,
  type QualitaetsErgebnis,
  qualitaetBewerten,
  type SslErgebnis,
  seitePruefen,
  sslPruefen,
  tageBis,
} from './pruefen.ts';
import { type Pruefung, SCONT_TABELLEN, type Seite } from './tabellen.ts';

interface Domain {
  id: string;
  name: string;
  ablauf: string | null;
  kunde_id: string | null;
  kosten_jahr: number | null;
}
interface Kosten {
  id: string;
  bezeichnung: string;
  art: string;
  betrag: number;
  intervall: string;
  naechste_zahlung: string | null;
  kunde_id: string | null;
  weiterverrechnet: boolean;
}

export interface SeitenZustand {
  seite: Seite;
  letzte: Pruefung | null;
  online: boolean | null;
  verfuegbarkeit: { tag: number | null; woche: number | null; monat: number | null };
  sslTage: number | null;
  sslFehler: string | null;
  performance: number | null;
  note: string | null;
  vorfallOffen: boolean;
}

export const scont: ModulDef = {
  id: 'scont',
  name: 'scont',
  beschreibung: 'Webseiten Wächter, Kunden, Domains und Kosten',
  symbol: 'scont',
  reihenfolge: 10,
  tabellen: SCONT_TABELLEN,
  regeln: [
    {
      id: 'ausfall',
      name: 'Kundenseite ausgefallen',
      beschreibung: 'Eine überwachte Seite ist zweimal in Folge nicht erreichbar. Sendet auch nachts.',
      prioritaet: 5,
      nachts: true,
      cooldownMin: 30,
    },
    {
      id: 'wieder_da',
      name: 'Kundenseite wieder erreichbar',
      beschreibung: 'Eine ausgefallene Seite antwortet wieder.',
      prioritaet: 3,
      cooldownMin: 5,
    },
    {
      id: 'ssl',
      name: 'SSL Zertifikat läuft ab',
      beschreibung: 'Das Zertifikat einer Seite läuft in weniger Tagen ab als die Schwelle.',
      schwelle: 14,
      schwelleLabel: 'Tage',
      prioritaet: 4,
      cooldownMin: 1440,
    },
    {
      id: 'domain',
      name: 'Domain läuft ab',
      beschreibung: 'Eine Domain läuft in weniger Tagen ab als die Schwelle.',
      schwelle: 30,
      schwelleLabel: 'Tage',
      prioritaet: 3,
      cooldownMin: 10080,
    },
    {
      id: 'zahlung',
      name: 'Abo oder Zahlung fällig',
      beschreibung: 'Eine Zahlung oder Verlängerung ist in weniger Tagen fällig als die Schwelle.',
      schwelle: 14,
      schwelleLabel: 'Tage',
      prioritaet: 2,
      cooldownMin: 10080,
    },
  ],
  erstellen: (ctx) => scontLaufzeit(ctx),
};

function scontLaufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  const letztePruefung = new Map<string, number>();
  const fehlerInFolge = new Map<string, number>();
  const offeneVorfaelle = new Map<string, string>();
  const verfuegbarkeitCache = new Map<string, { zeit: number; wert: number | null }>();
  let vorbereitet: Promise<void> | null = null;

  const erreichbarkeit = ctx.quelle<{ url: string; text: string | null; name: string }, PruefErgebnis>({
    id: 'scont.erreichbarkeit',
    wichtig: true,
    // Der Wächter bestimmt den Takt selbst (Prüfintervall je Seite), darum kein Mindestabstand
    minSek: 0,
    name: 'Webseiten Prüfung',
    modul: 'scont',
    ttlSek: 20,
    abruf: (p) => seitePruefen(p.url, p.text),
    demo: (p) => demoPruefung(p.name),
    testParameter: () => ({ url: 'https://www.admin.ch', text: null, name: 'Test' }),
    beschreibung: 'Abruf der überwachten Seiten',
  });
  const ssl = ctx.quelle<string, SslErgebnis>({
    id: 'scont.ssl',
    wichtig: true,
    name: 'SSL Zertifikate',
    modul: 'scont',
    ttlSek: 6 * 3600,
    abruf: (host) => sslPruefen(host),
    demo: (host) => demoSsl(host),
    testParameter: () => 'www.admin.ch',
  });
  const pagespeed = ctx.quelle<string, PageSpeedWerte>({
    id: 'scont.pagespeed',
    name: 'Google PageSpeed Insights',
    modul: 'scont',
    ttlSek: 20 * 3600,
    ungetestet: true,
    abruf: async (url) =>
      pagespeedAuswerten(
        await httpJson(pagespeedUrl(url, konfig.pagespeedKey), { timeoutMs: 90000, abstandMs: 5000 }),
      ),
    demo: (url) => demoPagespeed(url),
    testParameter: () => 'https://www.admin.ch',
    // eine Analyse dauert bei Google oft 30 bis 60 s
    testDauerMs: 95000,
    namensnennung: 'Google PageSpeed Insights',
    beschreibung: 'Ohne API Schlüssel stark begrenzt',
  });
  const qualitaet = ctx.quelle<string, QualitaetsErgebnis>({
    id: 'scont.qualitaet',
    name: 'Qualitätscheck',
    modul: 'scont',
    ttlSek: 6 * 86400,
    abruf: async (url) => {
      const r = await httpAnfrage(url, { timeoutMs: 20000, maxBytes: 3_000_000 });
      const e = qualitaetBewerten(r.url || url, r.headers, r.text);
      const links = linksExtrahieren(r.text, r.url || url, 40);
      e.links = { geprueft: links.length, defekt: await linksPruefen(links) };
      if (e.links.defekt.length) {
        e.vorschlaege.push(`${e.links.defekt.length} defekte Links beheben`);
        e.punkte = Math.max(0, e.punkte - Math.min(20, e.links.defekt.length * 5));
      }
      return e;
    },
    demo: (url) => demoQualitaet(url),
    testParameter: () => 'https://www.admin.ch',
    // bis zu 40 Links, höchstens einer pro Sekunde und Host
    testDauerMs: 90000,
  });

  async function vorbereiten() {
    vorbereitet ??= (async () => {
      if (konfig.demo && (await daten.anzahl('kunden')) === 0) {
        await demoDatenAnlegen(daten, ctx.jetzt());
        await demoZeitenAnlegen(daten, ctx.jetzt());
      }
      for (const v of await daten.liste<{ id: string; seite_id: string }>('vorfaelle', {
        filter: { ende: null },
        limit: 100,
      })) {
        offeneVorfaelle.set(v.seite_id, v.id);
      }
    })();
    return vorbereitet;
  }

  const seiten = () => daten.liste<Seite>('seiten', { sortierung: 'name', limit: 200 });

  async function pruefungSpeichern(s: Seite, e: PruefErgebnis) {
    await daten.einfuegen('pruefungen', [
      { seite_id: s.id, ok: e.ok, status: e.status, ms: e.ms, fehler: e.fehler },
    ]);
    letztePruefung.set(s.id, ctx.jetzt().getTime());
    if (e.ok)
      await ctx.metrik({
        id: `scont.ms.${s.id}`,
        name: `Antwortzeit ${s.name}`,
        einheit: 'ms',
        richtung: 'hoch',
        minAbweichung: 400,
        minDauerMin: 20,
        prioritaet: 4,
      })(e.ms);
    const n = e.ok ? 0 : (fehlerInFolge.get(s.id) ?? 0) + 1;
    fehlerInFolge.set(s.id, n);
    if (n >= 2 && !offeneVorfaelle.has(s.id)) {
      const v = await daten.eins<{ id: string }>('vorfaelle', {
        seite_id: s.id,
        start: ctx.jetzt().toISOString(),
        grund: e.fehler,
      });
      offeneVorfaelle.set(s.id, v.id);
      await ctx.aktivitaet('scont', `Ausfall: ${s.name} (${e.fehler})`, 'warnung');
      await ctx.alarm.melden({
        regel: 'scont.ausfall',
        titel: `Ausfall: ${s.name}`,
        text: `${s.url} antwortet nicht: ${e.fehler ?? 'unbekannt'}`,
        schluessel: `ausfall:${s.id}`,
        tags: ['rotating_light'],
      });
    }
    if (e.ok && offeneVorfaelle.has(s.id)) {
      const id = offeneVorfaelle.get(s.id)!;
      offeneVorfaelle.delete(s.id);
      const v = await daten.aendern<{ start: string }>('vorfaelle', id, { ende: ctx.jetzt().toISOString() });
      const dauer = v ? Math.round((ctx.jetzt().getTime() - new Date(v.start).getTime()) / 60000) : null;
      await ctx.aktivitaet(
        'scont',
        `Wieder erreichbar: ${s.name}${dauer !== null ? ` nach ${dauer} min` : ''}`,
      );
      await ctx.alarm.melden({
        regel: 'scont.wieder_da',
        titel: `Wieder online: ${s.name}`,
        text: `${s.url} antwortet wieder${dauer !== null ? ` (Ausfall ${dauer} min)` : ''}.`,
        schluessel: `wieder:${s.id}:${id}`,
        tags: ['white_check_mark'],
      });
    }
  }

  async function seiteJetztPruefen(s: Seite) {
    const r = await erreichbarkeit.hole({ url: s.url, text: s.erwarteter_text, name: s.name }, true);
    if (r.daten) await pruefungSpeichern(s, r.daten);
    return r.daten;
  }

  async function verfuegbarkeit(seiteId: string, tage: number): Promise<number | null> {
    const schluessel = `${seiteId}:${tage}`;
    const c = verfuegbarkeitCache.get(schluessel);
    if (c && Date.now() - c.zeit < 120000) return c.wert;
    const seit = new Date(ctx.jetzt().getTime() - tage * 86400000).toISOString();
    const total = await daten.anzahl('pruefungen', { seite_id: seiteId, erstellt: { gte: seit } });
    const ok = total
      ? await daten.anzahl('pruefungen', { seite_id: seiteId, erstellt: { gte: seit }, ok: true })
      : 0;
    const wert = total ? Math.round((ok / total) * 10000) / 100 : null;
    verfuegbarkeitCache.set(schluessel, { zeit: Date.now(), wert });
    return wert;
  }

  async function zustaende(): Promise<SeitenZustand[]> {
    await vorbereiten();
    const liste = await seiten();
    const sslListe = await daten.liste<{
      seite_id: string;
      gueltig_bis: string | null;
      fehler: string | null;
    }>('ssl_status', { limit: 500 });
    return Promise.all(
      liste.map(async (s) => {
        const [letzte] = await daten.liste<Pruefung>('pruefungen', {
          filter: { seite_id: s.id },
          sortierung: '-erstellt',
          limit: 1,
        });
        const [ps] = await daten.liste<{ performance: number | null }>('pagespeed', {
          filter: { seite_id: s.id },
          sortierung: '-erstellt',
          limit: 1,
        });
        const [q] = await daten.liste<{ note: string }>('qualitaet', {
          filter: { seite_id: s.id },
          sortierung: '-erstellt',
          limit: 1,
        });
        const sslZeile = sslListe.find((x) => x.seite_id === s.id);
        return {
          seite: s,
          letzte: letzte ?? null,
          online: letzte ? letzte.ok : null,
          verfuegbarkeit: {
            tag: await verfuegbarkeit(s.id, 1),
            woche: await verfuegbarkeit(s.id, 7),
            monat: await verfuegbarkeit(s.id, 30),
          },
          sslTage: sslZeile?.gueltig_bis ? tageBis(sslZeile.gueltig_bis, ctx.jetzt()) : null,
          sslFehler: sslZeile?.fehler ?? null,
          performance: ps?.performance ?? null,
          note: q?.note ?? null,
          vorfallOffen: offeneVorfaelle.has(s.id),
        };
      }),
    );
  }

  async function domainsBald(tage: number) {
    const bis = lokalDatum(new Date(ctx.jetzt().getTime() + tage * 86400000));
    return daten.liste<Domain>('domains', {
      filter: { ablauf: { lte: bis } },
      sortierung: 'ablauf',
      limit: 50,
    });
  }

  function jahresBetrag(k: Kosten) {
    return k.intervall === 'monatlich' ? k.betrag * 12 : k.intervall === 'jährlich' ? k.betrag : 0;
  }

  const jobs = [
    {
      id: 'waechter',
      name: 'Webseiten prüfen',
      intervallSek: 60,
      startVerzoegerungSek: 20,
      lauf: async () => {
        await vorbereiten();
        const jetzt = ctx.jetzt().getTime();
        const faellig = (await seiten()).filter(
          (s) => s.aktiv && jetzt - (letztePruefung.get(s.id) ?? 0) >= (s.intervall_min ?? 5) * 60000 - 5000,
        );
        // Höchstens drei Seiten gleichzeitig, das schont den Pi
        for (let i = 0; i < faellig.length; i += 3) {
          await Promise.all(faellig.slice(i, i + 3).map((s) => seiteJetztPruefen(s)));
        }
        return faellig.length ? `${faellig.length} Seiten geprüft` : undefined;
      },
    },
    {
      id: 'ssl',
      name: 'SSL Zertifikate prüfen',
      intervallSek: 6 * 3600,
      startVerzoegerungSek: 90,
      lauf: async () => {
        await vorbereiten();
        let n = 0;
        for (const s of (await seiten()).filter((x) => x.aktiv && x.url.startsWith('https://'))) {
          const host = new URL(s.url).hostname;
          const r = await ssl.hole(host, true);
          if (!r.daten) continue;
          n++;
          const zeile = {
            seite_id: s.id,
            gueltig_bis: r.daten.gueltigBis,
            aussteller: r.daten.aussteller,
            fehler: r.daten.fehler,
          };
          const [alt] = await daten.liste<{ id: string }>('ssl_status', {
            filter: { seite_id: s.id },
            limit: 1,
          });
          if (alt) await daten.aendern('ssl_status', alt.id, zeile);
          else await daten.einfuegen('ssl_status', [zeile]);
          if (r.daten.gueltigBis) {
            const tage = tageBis(r.daten.gueltigBis, ctx.jetzt());
            await ctx.alarm.melden({
              regel: 'scont.ssl',
              titel: `SSL läuft ab: ${s.name}`,
              text: `Das Zertifikat von ${host} läuft in ${tage} Tagen ab.`,
              wert: tage,
              richtung: 'unter',
              schluessel: `ssl:${s.id}`,
            });
          }
        }
        return `${n} Zertifikate geprüft`;
      },
    },
    {
      id: 'fristen',
      name: 'Domains und Zahlungen prüfen',
      taeglich: '08:05',
      lauf: async () => {
        for (const d of await domainsBald(90)) {
          if (!d.ablauf) continue;
          const tage = tageBis(`${d.ablauf}T12:00:00Z`, ctx.jetzt());
          await ctx.alarm.melden({
            regel: 'scont.domain',
            titel: `Domain läuft ab: ${d.name}`,
            text: `${d.name} läuft am ${d.ablauf} ab (in ${tage} Tagen).`,
            wert: tage,
            richtung: 'unter',
            schluessel: `domain:${d.id}:${d.ablauf}`,
          });
        }
        const bis = lokalDatum(new Date(ctx.jetzt().getTime() + 60 * 86400000));
        for (const k of await daten.liste<Kosten>('kosten', {
          filter: { naechste_zahlung: { lte: bis } },
          limit: 100,
        })) {
          const tage = tageBis(`${k.naechste_zahlung}T12:00:00Z`, ctx.jetzt());
          await ctx.alarm.melden({
            regel: 'scont.zahlung',
            titel: `Fällig: ${k.bezeichnung}`,
            text: `CHF ${k.betrag.toFixed(2)} am ${k.naechste_zahlung} (in ${tage} Tagen).`,
            wert: tage,
            richtung: 'unter',
            schluessel: `zahlung:${k.id}:${k.naechste_zahlung}`,
          });
        }
        return undefined;
      },
    },
    {
      id: 'pagespeed',
      name: 'PageSpeed messen',
      taeglich: '04:10',
      lauf: async () => {
        let n = 0;
        for (const s of (await seiten()).filter((x) => x.aktiv)) {
          const r = await pagespeed.hole(s.url, true);
          if (r.daten) {
            await daten.einfuegen('pagespeed', [{ seite_id: s.id, strategie: 'mobile', ...r.daten }]);
            n++;
          }
        }
        return `${n} Messungen`;
      },
    },
    {
      id: 'qualitaet',
      name: 'Qualitätscheck',
      taeglich: '04:40',
      lauf: async () => {
        let n = 0;
        const grenze = new Date(ctx.jetzt().getTime() - 6.5 * 86400000).toISOString();
        for (const s of (await seiten()).filter((x) => x.aktiv)) {
          const neu = await daten.anzahl('qualitaet', { seite_id: s.id, erstellt: { gte: grenze } });
          if (neu) continue;
          const r = await qualitaet.hole(s.url, true);
          if (r.daten) {
            await daten.einfuegen('qualitaet', [
              { seite_id: s.id, punkte: r.daten.punkte, note: r.daten.note, ergebnis: r.daten },
            ]);
            n++;
          }
        }
        return `${n} Seiten geprüft`;
      },
    },
    {
      id: 'verdichtung',
      name: 'Prüfungen verdichten',
      taeglich: '03:50',
      lauf: async () => {
        const n = await verdichten(
          daten,
          {
            quelle: 'pruefungen',
            ziel: 'pruefungen_stunden',
            nachTagen: 31,
            intervall: 'stunde',
            gruppe: ['seite_id'],
            felder: [
              { ziel: 'ok', art: 'anteil', feld: 'ok' },
              { ziel: 'ms', art: 'mittel', feld: 'ms' },
              { ziel: 'ms_max', art: 'max', feld: 'ms' },
            ],
          },
          ctx.jetzt(),
        );
        return `${n} Rohwerte verdichtet`;
      },
    },
  ];

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => {
      const z = await zustaende();
      const kosten = await daten.liste<Kosten>('kosten', { limit: 500 });
      const proJahr = kosten.reduce((s, k) => s + jahresBetrag(k), 0);
      const weiter = kosten.filter((k) => k.weiterverrechnet).reduce((s, k) => s + jahresBetrag(k), 0);
      return {
        seiten: z,
        domainsBald: await domainsBald(60),
        kosten: { proJahr, proMonat: proJahr / 12, weiterverrechnet: weiter, anzahl: kosten.length },
        kunden: await daten.anzahl('kunden', { status: 'aktiv' }),
      };
    });

    app.get<{ Params: { id: string } }>('/seite/:id', async (req) => {
      await vorbereiten();
      const s = await daten.hole<Seite>('seiten', req.params.id);
      if (!s) throw new EingabeFehler('Seite nicht gefunden');
      const seit = new Date(ctx.jetzt().getTime() - 2 * 86400000).toISOString();
      return {
        seite: s,
        pruefungen: await daten.liste<Pruefung>('pruefungen', {
          filter: { seite_id: s.id, erstellt: { gte: seit } },
          sortierung: 'erstellt',
          limit: 1500,
        }),
        stunden: await daten.liste('pruefungen_stunden', {
          filter: { seite_id: s.id },
          sortierung: '-zeit',
          limit: 24 * 60,
        }),
        vorfaelle: await daten.liste('vorfaelle', {
          filter: { seite_id: s.id },
          sortierung: '-start',
          limit: 30,
        }),
        ssl: (await daten.liste('ssl_status', { filter: { seite_id: s.id }, limit: 1 }))[0] ?? null,
        pagespeed: await daten.liste('pagespeed', {
          filter: { seite_id: s.id },
          sortierung: '-erstellt',
          limit: 60,
        }),
        qualitaet:
          (
            await daten.liste('qualitaet', { filter: { seite_id: s.id }, sortierung: '-erstellt', limit: 1 })
          )[0] ?? null,
        verfuegbarkeit: {
          tag: await verfuegbarkeit(s.id, 1),
          woche: await verfuegbarkeit(s.id, 7),
          monat: await verfuegbarkeit(s.id, 30),
        },
      };
    });

    const bestaetigt = (b: unknown) => {
      if ((b as { bestaetigt?: boolean })?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
    };

    app.post<{ Params: { id: string } }>('/seite/:id/pruefen', async (req) => {
      bestaetigt(req.body);
      const s = await daten.hole<Seite>('seiten', req.params.id);
      if (!s) throw new EingabeFehler('Seite nicht gefunden');
      return seiteJetztPruefen(s);
    });

    app.post<{ Params: { id: string } }>('/seite/:id/qualitaet', async (req) => {
      bestaetigt(req.body);
      const s = await daten.hole<Seite>('seiten', req.params.id);
      if (!s) throw new EingabeFehler('Seite nicht gefunden');
      const r = await qualitaet.hole(s.url, true);
      if (!r.daten) throw new EingabeFehler(r.fehler ?? 'Prüfung fehlgeschlagen');
      await daten.einfuegen('qualitaet', [
        { seite_id: s.id, punkte: r.daten.punkte, note: r.daten.note, ergebnis: r.daten },
      ]);
      await ctx.aktivitaet('scont', `Qualitätscheck ${s.name}: Note ${r.daten.note}`, 'aktion');
      return r.daten;
    });

    app.post<{ Params: { id: string } }>('/seite/:id/pagespeed', async (req) => {
      bestaetigt(req.body);
      const s = await daten.hole<Seite>('seiten', req.params.id);
      if (!s) throw new EingabeFehler('Seite nicht gefunden');
      const r = await pagespeed.hole(s.url, true);
      if (!r.daten) throw new EingabeFehler(r.fehler ?? 'PageSpeed fehlgeschlagen');
      await daten.einfuegen('pagespeed', [{ seite_id: s.id, strategie: 'mobile', ...r.daten }]);
      return r.daten;
    });
  }

  async function kachel(): Promise<Kachel> {
    const z = await zustaende();
    const aktiv = z.filter((x) => x.seite.aktiv);
    const unten = aktiv.filter((x) => x.online === false);
    const sslBald = aktiv.filter((x) => x.sslTage !== null && x.sslTage < 14);
    const domains = await domainsBald(30);
    let status: Ampel = aktiv.length ? 'ok' : 'neutral';
    if (sslBald.length || domains.length) status = 'warnung';
    if (unten.length) status = 'ausfall';
    const zeilen = aktiv
      .sort((a, b) => Number(a.online) - Number(b.online))
      .slice(0, 4)
      .map((x) => ({
        text: x.seite.name,
        wert: x.online === false ? 'Ausfall' : x.letzte?.ms ? `${x.letzte.ms} ms` : '–',
        status: (x.online === false ? 'ausfall' : x.online ? 'ok' : 'neutral') as Ampel,
      }));
    if (sslBald.length)
      zeilen.push({
        text: `SSL läuft ab: ${sslBald[0].seite.name}`,
        wert: `${sslBald[0].sslTage} Tage`,
        status: 'warnung',
      });
    if (domains.length)
      zeilen.push({ text: `Domain: ${domains[0].name}`, wert: domains[0].ablauf ?? '', status: 'warnung' });
    return {
      status,
      titel: 'Webseiten',
      wert: `${aktiv.length - unten.length}/${aktiv.length}`,
      unter: unten.length ? `${unten.length} ausgefallen` : 'Seiten online',
      zeilen,
      demo: konfig.demo,
    };
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    const a = lokalDatum(von);
    const b = lokalDatum(bis);
    const domains = await daten.liste<Domain>('domains', {
      filter: { ablauf: { gte: a, lte: b } },
      limit: 100,
    });
    const kosten = await daten.liste<Kosten>('kosten', {
      filter: { naechste_zahlung: { gte: a, lte: b } },
      limit: 100,
    });
    return [
      ...domains.map((d) => ({
        id: `domain-${d.id}`,
        modul: 'scont',
        art: 'Ablauf Domain',
        titel: d.name,
        start: d.ablauf!,
        ganztags: true,
        status: 'warnung' as Ampel,
      })),
      ...kosten.map((k) => ({
        id: `kosten-${k.id}`,
        modul: 'scont',
        art: 'Frist',
        titel: k.bezeichnung,
        text: `CHF ${k.betrag.toFixed(2)} (${k.intervall})`,
        start: k.naechste_zahlung!,
        ganztags: true,
      })),
    ];
  }

  async function briefing() {
    const z = await zustaende();
    const unten = z.filter((x) => x.seite.aktiv && x.online === false);
    const seit = new Date(ctx.jetzt().getTime() - 12 * 3600000).toISOString();
    const nacht = await daten.liste<{ seite_id: string; start: string; ende: string | null }>('vorfaelle', {
      filter: { start: { gte: seit } },
      limit: 20,
    });
    const name = (id: string) => z.find((x) => x.seite.id === id)?.seite.name ?? 'Seite';
    const zeilen = [
      ...unten.map((x) => ({ text: `${x.seite.name} ist offline`, status: 'ausfall' as Ampel })),
      ...nacht
        .filter((v) => v.ende)
        .map((v) => ({ text: `${name(v.seite_id)} war kurz weg`, status: 'warnung' as Ampel })),
    ];
    if (!zeilen.length)
      zeilen.push({ text: `Alle ${z.filter((x) => x.seite.aktiv).length} Seiten online`, status: 'ok' });
    return {
      modul: 'scont',
      titel: 'Ausfälle',
      zeilen,
      status: (unten.length ? 'ausfall' : nacht.length ? 'warnung' : 'ok') as Ampel,
      reihenfolge: 30,
    };
  }

  // Zeiterfassung per Knopfdruck
  async function laufendeZeit() {
    const [z] = await daten.liste<{
      id: string;
      kunde_id: string;
      start: string;
      beschreibung: string | null;
    }>('zeiten', {
      filter: { ende: null },
      sortierung: '-start',
      limit: 1,
    });
    return z ?? null;
  }

  async function zeitStoppen() {
    const z = await laufendeZeit();
    if (!z) return null;
    const ende = ctx.jetzt();
    const minuten = Math.round(((ende.getTime() - new Date(z.start).getTime()) / 60000) * 10) / 10;
    await daten.aendern('zeiten', z.id, { ende: ende.toISOString(), minuten });
    return { ...z, minuten };
  }

  let statusCache: { zeit: number; html: string } | null = null;

  async function oeffentlicherStatus(): Promise<OeffentlicherStatus[]> {
    await vorbereiten();
    const liste = (await seiten()).filter((s) => s.oeffentlich && s.aktiv);
    const heute = new Date(ctx.jetzt());
    return Promise.all(
      liste.map(async (s) => {
        const tage: (number | null)[] = [];
        for (let i = 29; i >= 0; i--) {
          const von = new Date(heute.getTime() - (i + 1) * 86400000);
          const bis = new Date(heute.getTime() - i * 86400000);
          tage.push((await seitenStatistik(daten, s.id, von, bis)).verfuegbarkeit);
        }
        const [letzte] = await daten.liste<{ ok: boolean }>('pruefungen', {
          filter: { seite_id: s.id },
          sortierung: '-erstellt',
          limit: 1,
        });
        return {
          name: s.oeffentlicher_name || s.name,
          online: letzte ? letzte.ok || !offeneVorfaelle.has(s.id) : null,
          tage,
          verfuegbarkeit30: (
            await seitenStatistik(daten, s.id, new Date(heute.getTime() - 30 * 86400000), heute)
          ).verfuegbarkeit,
        };
      }),
    );
  }

  async function zusatzRouten(app: FastifyInstance) {
    app.get('/zeit', async () => {
      const laufend = await laufendeZeit();
      const monatStart = new Date(ctx.jetzt());
      monatStart.setUTCDate(1);
      monatStart.setUTCHours(0, 0, 0, 0);
      const monat = await daten.liste<{ kunde_id: string; minuten: number | null }>('zeiten', {
        filter: { start: { gte: monatStart.toISOString() } },
        limit: 5000,
      });
      const proKunde: Record<string, number> = {};
      for (const z of monat) proKunde[z.kunde_id] = (proKunde[z.kunde_id] ?? 0) + (z.minuten ?? 0);
      return {
        laufend,
        proKunde,
        kunden: await daten.liste('kunden', { filter: { status: 'aktiv' }, sortierung: 'name', limit: 200 }),
      };
    });
    app.post<{ Body: { kunde_id?: string; beschreibung?: string } }>('/zeit/start', async (req) => {
      const kundeId = String(req.body?.kunde_id ?? '');
      if (!(await daten.hole('kunden', kundeId))) throw new EingabeFehler('Kunde nicht gefunden');
      const gestoppt = await zeitStoppen();
      const z = await daten.eins('zeiten', {
        kunde_id: kundeId,
        start: ctx.jetzt().toISOString(),
        beschreibung: typeof req.body?.beschreibung === 'string' ? req.body.beschreibung.slice(0, 300) : null,
      });
      return { laufend: z, gestoppt };
    });
    app.post('/zeit/stopp', async () => ({ gestoppt: await zeitStoppen() }));

    app.get<{ Querystring: { kunde?: string; monat?: string } }>('/report', async (req, reply) => {
      const monat =
        req.query.monat && /^\d{4}-\d{2}$/.test(req.query.monat)
          ? req.query.monat
          : lokalDatum(ctx.jetzt()).slice(0, 7);
      let d: Awaited<ReturnType<typeof monatsDaten>>;
      try {
        d = await monatsDaten(daten, String(req.query.kunde ?? ''), monat);
      } catch (e) {
        throw new EingabeFehler((e as Error).message);
      }
      const pdf = monatsreportPdf(d, ctx.jetzt());
      await ctx.aktivitaet('scont', `Monatsreport ${d.kunde.name} ${monat} erstellt`, 'aktion');
      const dateiname = `Monatsreport-${d.kunde.name.replace(/[^A-Za-z0-9]+/g, '-')}-${monat}.pdf`;
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `inline; filename="${dateiname}"`)
        .send(pdf);
    });
    app.get<{ Querystring: { kunde?: string; monat?: string } }>('/report/daten', async (req) => {
      const monat =
        req.query.monat && /^\d{4}-\d{2}$/.test(req.query.monat)
          ? req.query.monat
          : lokalDatum(ctx.jetzt()).slice(0, 7);
      return monatsDaten(daten, String(req.query.kunde ?? ''), monat);
    });
  }

  async function oeffentlicheRouten(app: FastifyInstance) {
    // Öffentliche Statusseite: nur freigegebene Seiten, nur Name und Verfügbarkeit
    app.get('/status', async (_req, reply) => {
      if (!statusCache || Date.now() - statusCache.zeit > 60000) {
        statusCache = { zeit: Date.now(), html: statusHtml(await oeffentlicherStatus(), ctx.jetzt()) };
      }
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'public, max-age=60')
        .header('X-Robots-Tag', 'noindex')
        .send(statusCache.html);
    });
  }

  const alleRouten = async (app: FastifyInstance) => {
    await routen(app);
    await zusatzRouten(app);
  };

  // Tagesrückblick: Ausfälle seit Mitternacht
  async function abendbericht() {
    const z = await zustaende();
    const aktiv = z.filter((x) => x.seite.aktiv);
    const unten = aktiv.filter((x) => x.online === false);
    const vorfaelle = await daten.liste<{ seite_id: string; start: string; ende: string | null }>(
      'vorfaelle',
      {
        filter: { start: { gte: tagesBeginn(ctx.jetzt()).toISOString() } },
        limit: 50,
      },
    );
    const name = (id: string) => z.find((x) => x.seite.id === id)?.seite.name ?? 'Seite';
    const proSeite = new Map<string, number>();
    for (const v of vorfaelle) if (v.ende) proSeite.set(v.seite_id, (proSeite.get(v.seite_id) ?? 0) + 1);
    const zeilen = [
      ...unten.map((x) => ({ text: `${x.seite.name} ist offline`, status: 'ausfall' as Ampel })),
      ...[...proSeite].map(([id, n]) => ({
        text: `${name(id)} war ${n === 1 ? 'einmal' : `${n} mal`} weg`,
        status: 'warnung' as Ampel,
      })),
    ];
    if (!zeilen.length)
      zeilen.push({ text: `Alle ${aktiv.length} Seiten den ganzen Tag online`, status: 'ok' });
    return {
      modul: 'scont',
      titel: 'Kundenseiten',
      zeilen,
      status: (unten.length ? 'ausfall' : proSeite.size ? 'warnung' : 'ok') as Ampel,
      reihenfolge: 30,
    };
  }

  return { jobs, routen: alleRouten, oeffentlicheRouten, kachel, timeline, briefing, abendbericht };
}
