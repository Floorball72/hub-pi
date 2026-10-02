// Modul Änderungs Wächter: erkennt Änderungen an Kundenseiten (Text, Skripte, Formulare, Impressum, Preise, Meta).
// Vergleich immer gegen die Basis. «Erwartet» bestätigt eine Änderung und macht den neuen Stand zur Basis.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler, tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { httpAnfrage } from '../../quellen/http.ts';
import { robotsErlaubt } from '../../quellen/robots.ts';
import {
  ausnahmenLesen,
  GEWICHT_RANG,
  type Gewicht,
  hoechstesGewicht,
  type Snapshot,
  snapshotErstellen,
  snapshotHash,
  type Unterschied,
  vergleichen,
} from './snapshot.ts';

export const SEITEN = tabelle({
  name: 'aend_seiten',
  modul: 'aenderungen',
  label: 'Beobachtete Seiten',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'url', typ: 'text', label: 'Adresse (https://…)', pflicht: true },
    { name: 'kunde_id', typ: 'text', label: 'Kunde', verweis: 'kunden' },
    {
      name: 'intervall_std',
      typ: 'int',
      label: 'Prüfen alle',
      einheit: 'Stunden',
      min: 1,
      max: 168,
      standard: 12,
    },
    {
      name: 'ausnahmen',
      typ: 'text',
      label: 'Ausnahmen (eine pro Zeile, Text oder regulärer Ausdruck)',
      lang: true,
    },
    { name: 'aktiv', typ: 'bool', label: 'Aktiv', standard: true },
  ],
});

export const SNAPSHOTS = tabelle({
  name: 'aend_snapshots',
  modul: 'aenderungen',
  label: 'Momentaufnahmen',
  spalten: [
    { name: 'seite_id', typ: 'text' },
    { name: 'hash', typ: 'text' },
    { name: 'basis', typ: 'bool' },
    { name: 'daten', typ: 'json' },
  ],
  indizes: [['seite_id', 'basis']],
});

export const AENDERUNGEN = tabelle({
  name: 'aend_meldungen',
  modul: 'aenderungen',
  label: 'Erkannte Änderungen',
  spalten: [
    { name: 'seite_id', typ: 'text' },
    { name: 'hash', typ: 'text' },
    { name: 'gewicht', typ: 'text' },
    { name: 'zusammenfassung', typ: 'text' },
    { name: 'unterschiede', typ: 'json' },
    { name: 'status', typ: 'text' },
  ],
  indizes: [['seite_id', 'erstellt'], ['status']],
});

interface Seite {
  id: string;
  name: string;
  url: string;
  kunde_id: string | null;
  intervall_std: number | null;
  ausnahmen: string | null;
  aktiv: boolean;
}
interface Meldung {
  id: string;
  seite_id: string;
  hash: string;
  gewicht: Gewicht;
  zusammenfassung: string;
  unterschiede: Unterschied[];
  status: 'offen' | 'erwartet';
  erstellt: string;
}

export const aenderungen: ModulDef = {
  id: 'aenderungen',
  name: 'Änderungs Wächter',
  beschreibung:
    'Erkennt Änderungen an Kundenseiten, mit Gewicht für neue Skripte, versteckte Links und Formulare',
  symbol: 'aenderungen',
  reihenfolge: 63,
  tabellen: [SEITEN, SNAPSHOTS, AENDERUNGEN],
  regeln: [
    {
      id: 'hoch',
      name: 'Verdächtige Änderung',
      beschreibung:
        'Neue externe Skripte, versteckte Links, fremde Formularziele, Weiterleitung auf andere Domain oder noindex.',
      prioritaet: 4,
      cooldownMin: 360,
    },
    {
      id: 'mittel',
      name: 'Wichtige Änderung',
      beschreibung: 'Impressum, Preise, Formularziel oder Skripte der eigenen Domain geändert.',
      prioritaet: 2,
      cooldownMin: 720,
    },
  ],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  let demo: Promise<void> | null = null;

  const quelle = ctx.quelle<{ url: string; ausnahmen: string | null }, Snapshot>({
    id: 'aenderungen.abruf',
    name: 'Kundenseiten (Momentaufnahme)',
    modul: 'aenderungen',
    ttlSek: 600,
    abruf: async ({ url, ausnahmen }) => {
      if (!(await robotsErlaubt(url))) throw new Error('robots.txt verbietet den Abruf');
      const a = await httpAnfrage(url, { timeoutMs: 20000, maxBytes: 3_000_000 });
      if (a.status >= 400) throw new Error(`HTTP ${a.status}`);
      return snapshotErstellen(a.text, url, a.url || url, ausnahmenLesen(ausnahmen));
    },
    demo: ({ url }) =>
      snapshotErstellen(
        `<html><head><title>Demo</title></head><body><h1>Willkommen</h1><p>Angebot ab CHF 49.–</p></body></html>`,
        url,
        url,
      ),
  });

  async function basis(seiteId: string) {
    const [b] = await daten.liste<{ id: string; hash: string; daten: Snapshot; erstellt: string }>(
      'aend_snapshots',
      { filter: { seite_id: seiteId, basis: true }, sortierung: '-erstellt', limit: 1 },
    );
    return b ?? null;
  }

  async function seitePruefen(s: Seite): Promise<Meldung | null> {
    const r = await quelle.hole({ url: s.url, ausnahmen: s.ausnahmen }, true);
    if (!r.daten) throw new Error(r.fehler ?? 'Abruf fehlgeschlagen');
    const neu = r.daten;
    const hash = snapshotHash(neu);
    const b = await basis(s.id);
    if (!b) {
      await daten.einfuegen('aend_snapshots', [{ seite_id: s.id, hash, basis: true, daten: neu }]);
      return null;
    }
    if (b.hash === hash) return null;
    const unterschiede = vergleichen(b.daten, neu);
    const gewicht = hoechstesGewicht(unterschiede);
    if (!gewicht) return null;
    // Gleicher Stand wie eine offene Meldung: nichts Neues
    const [offen] = await daten.liste<Meldung>('aend_meldungen', {
      filter: { seite_id: s.id, status: 'offen' },
      sortierung: '-erstellt',
      limit: 1,
    });
    if (offen?.hash === hash) return null;
    // Letzte Momentaufnahme (nicht Basis) ersetzen, damit «erwartet» sie übernehmen kann
    await daten.loescheWo('aend_snapshots', { seite_id: s.id, basis: false });
    await daten.einfuegen('aend_snapshots', [{ seite_id: s.id, hash, basis: false, daten: neu }]);
    if (offen) await daten.loeschen('aend_meldungen', offen.id);
    const wichtig = unterschiede.filter((u) => GEWICHT_RANG[u.gewicht] >= GEWICHT_RANG[gewicht]);
    const m = await daten.eins<Meldung>('aend_meldungen', {
      seite_id: s.id,
      hash,
      gewicht,
      zusammenfassung: wichtig
        .map((u) => u.text)
        .join('; ')
        .slice(0, 500),
      unterschiede,
      status: 'offen',
    });
    if (gewicht !== 'niedrig')
      await ctx.alarm.melden({
        regel: gewicht === 'hoch' ? 'aenderungen.hoch' : 'aenderungen.mittel',
        titel: `${s.name}: ${wichtig[0]?.art ?? 'Änderung'}`,
        text: m.zusammenfassung,
        schluessel: `aend:${s.id}:${hash}`,
        link: '/modul/aenderungen',
      });
    return m;
  }

  async function demoVorbereiten() {
    if (!konfig.demo) return;
    demo ??= (async () => {
      if ((await daten.anzahl('aend_seiten')) > 0) return;
      const html = (extra: string, preis = '6.50') =>
        `<html><head><title>Bäckerei Muster</title><meta name="description" content="Frisches Brot aus dem Toggenburg"><script src="/js/app.js"></script></head><body><h1>Bäckerei Muster</h1><p>Zopf 500 g CHF ${preis}</p><p>Impressum: Bäckerei Muster GmbH, CHE-123.456.789</p>${extra}<form method="post" action="/kontakt"></form></body></html>`;
      const [a, b] = await daten.einfuegen<Seite>('aend_seiten', [
        {
          name: 'Bäckerei Website (Demo)',
          url: 'https://baeckerei.example/',
          intervall_std: 12,
          aktiv: true,
        },
        { name: 'Velo Shop (Demo)', url: 'https://veloshop.example/', intervall_std: 24, aktiv: true },
      ]);
      const alt = snapshotErstellen(html(''), a.url, a.url);
      const neu = snapshotErstellen(
        html(
          '<script src="https://cdn.unbekannt-stats.example/t.js"></script><p><a href="https://spam.example/casino" style="display:none">Casino</a></p>',
          '6.90',
        ),
        a.url,
        a.url,
      );
      await daten.einfuegen('aend_snapshots', [
        { seite_id: a.id, hash: snapshotHash(alt), basis: true, daten: alt },
        { seite_id: a.id, hash: snapshotHash(neu), basis: false, daten: neu },
      ]);
      const u = vergleichen(alt, neu);
      await daten.einfuegen('aend_meldungen', [
        {
          seite_id: a.id,
          hash: snapshotHash(neu),
          gewicht: hoechstesGewicht(u),
          zusammenfassung: u
            .filter((x) => x.gewicht === 'hoch')
            .map((x) => x.text)
            .join('; '),
          unterschiede: u,
          status: 'offen',
        },
      ]);
      const vAlt = snapshotErstellen(
        '<html><head><title>Velo Shop</title></head><body><p>Öffnungszeiten Mo bis Fr</p><p>Service ab CHF 89.–</p></body></html>',
        b.url,
        b.url,
      );
      const vNeu = snapshotErstellen(
        '<html><head><title>Velo Shop</title></head><body><p>Öffnungszeiten Mo bis Sa</p><p>Service ab CHF 89.–</p></body></html>',
        b.url,
        b.url,
      );
      const vu = vergleichen(vAlt, vNeu);
      await daten.einfuegen('aend_snapshots', [
        { seite_id: b.id, hash: snapshotHash(vNeu), basis: true, daten: vNeu },
      ]);
      await daten.einfuegen('aend_meldungen', [
        {
          seite_id: b.id,
          hash: snapshotHash(vNeu),
          gewicht: 'niedrig',
          zusammenfassung: vu.map((x) => x.text).join('; '),
          unterschiede: vu,
          status: 'erwartet',
          erstellt: new Date(ctx.jetzt().getTime() - 3 * 86400000).toISOString(),
        },
      ]);
    })();
    await demo;
  }

  async function uebersicht() {
    await demoVorbereiten();
    const seiten = await daten.liste<Seite>('aend_seiten', { sortierung: 'name', limit: 200 });
    return Promise.all(
      seiten.map(async (s) => {
        const meldungen = await daten.liste<Meldung>('aend_meldungen', {
          filter: { seite_id: s.id },
          sortierung: '-erstellt',
          limit: 20,
        });
        const b = await basis(s.id);
        return { seite: s, meldungen, basisSeit: b?.erstellt ?? null };
      }),
    );
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => ({ seiten: await uebersicht() }));

    app.post<{ Params: { id: string }; Body: { bestaetigt?: boolean } }>(
      '/meldung/:id/erwartet',
      async (req) => {
        if (req.body?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
        const m = await daten.hole<Meldung>('aend_meldungen', req.params.id);
        if (!m) throw new EingabeFehler('Meldung nicht gefunden');
        const [neu] = await daten.liste<{ id: string; hash: string }>('aend_snapshots', {
          filter: { seite_id: m.seite_id, basis: false },
          limit: 1,
        });
        if (neu && neu.hash === m.hash) {
          await daten.loescheWo('aend_snapshots', { seite_id: m.seite_id, basis: true });
          await daten.aendern('aend_snapshots', neu.id, { basis: true });
        }
        await daten.aendern('aend_meldungen', m.id, { status: 'erwartet' });
        await ctx.aktivitaet('aenderungen', 'Änderung als erwartet bestätigt, neue Basis gesetzt', 'aktion');
        return { ok: true };
      },
    );

    app.post<{ Params: { id: string } }>('/seite/:id/pruefen', async (req) => {
      const s = await daten.hole<Seite>('aend_seiten', req.params.id);
      if (!s) throw new EingabeFehler('Seite nicht gefunden');
      if (konfig.demo) throw new EingabeFehler('Im Demo Modus werden keine Seiten abgerufen');
      try {
        const m = await seitePruefen(s);
        return { meldung: m };
      } catch (e) {
        throw new EingabeFehler(String((e as Error).message).slice(0, 200));
      }
    });

    app.post<{ Body: { bestaetigt?: boolean } }>('/aus-waechter', async (req) => {
      if (req.body?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
      if (!daten.tabelle('seiten')) return { neu: 0 };
      const vorhanden = new Set((await daten.liste<Seite>('aend_seiten', { limit: 500 })).map((s) => s.url));
      const quelle = (
        await daten.liste<{ name: string; url: string; kunde_id: string | null; aktiv: boolean }>('seiten', {
          limit: 500,
        })
      ).filter((s) => s.aktiv && !vorhanden.has(s.url));
      if (quelle.length)
        await daten.einfuegen(
          'aend_seiten',
          quelle.map((s) => ({
            name: s.name,
            url: s.url,
            kunde_id: s.kunde_id,
            intervall_std: 12,
            aktiv: true,
          })),
        );
      return { neu: quelle.length };
    });
  }

  const jobs: JobDef[] = [
    {
      id: 'pruefen',
      name: 'Seiten vergleichen',
      intervallSek: 1800,
      startVerzoegerungSek: 300,
      lauf: async () => {
        if (konfig.demo) return undefined;
        const jetzt = ctx.jetzt().getTime();
        let n = 0;
        for (const s of (await daten.liste<Seite>('aend_seiten', { limit: 200 })).filter((x) => x.aktiv)) {
          const [letzte] = await daten.liste<{ erstellt: string }>('aend_snapshots', {
            filter: { seite_id: s.id },
            sortierung: '-erstellt',
            limit: 1,
          });
          const [letzteMeldung] = await daten.liste<{ erstellt: string }>('aend_meldungen', {
            filter: { seite_id: s.id },
            sortierung: '-erstellt',
            limit: 1,
          });
          const zuletzt = Math.max(
            letzte ? Date.parse(letzte.erstellt) : 0,
            letzteMeldung ? Date.parse(letzteMeldung.erstellt) : 0,
            pruefZeit.get(s.id) ?? 0,
          );
          if (jetzt - zuletzt < (s.intervall_std ?? 12) * 3600000) continue;
          pruefZeit.set(s.id, jetzt);
          try {
            await seitePruefen(s);
          } catch (e) {
            await ctx.aktivitaet(
              'aenderungen',
              `${s.name}: ${(e as Error).message}`.slice(0, 300),
              'warnung',
            );
          }
          if (++n >= 5) break; // höchstens 5 Seiten pro Lauf, verteilt die Last
        }
        await daten.loescheWo('aend_meldungen', {
          erstellt: { lt: new Date(jetzt - 365 * 86400000).toISOString() },
          status: 'erwartet',
        });
        return `${n} Seiten verglichen`;
      },
    },
  ];
  const pruefZeit = new Map<string, number>();

  async function kachel(): Promise<Kachel> {
    const u = await uebersicht();
    const offen = u.flatMap((x) =>
      x.meldungen.filter((m) => m.status === 'offen').map((m) => ({ ...m, name: x.seite.name })),
    );
    const hoch = offen.filter((m) => m.gewicht === 'hoch');
    return {
      status: (offen.length ? 'warnung' : 'ok') as Ampel,
      titel: 'Änderungen',
      wert: String(offen.length),
      einheit: 'offen',
      unter: hoch.length ? `${hoch.length} verdächtig` : `${u.length} Seiten beobachtet`,
      zeilen: offen.slice(0, 3).map((m) => ({
        text: m.name,
        wert: m.gewicht,
        status: (m.gewicht === 'hoch' ? 'ausfall' : m.gewicht === 'mittel' ? 'warnung' : 'neutral') as Ampel,
      })),
      demo: konfig.demo,
    };
  }

  return { routen, jobs, kachel };
}
