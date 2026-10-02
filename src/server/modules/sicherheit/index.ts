// Modul Sicherheits Checks: passive Prüfung der Kundenseiten und eigenen Seiten aus dem Webseiten Wächter.
// Note A bis E, Verlauf, Vorschläge. Erscheint im Monatsreport. Optional Datenlecks über Have I Been Pwned.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler, tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { httpJson } from '../../quellen/http.ts';
import { zufall } from '../scont/demo.ts';
import { note } from '../scont/pruefen.ts';
import { type Bewertung, basisDomain, bewerten, seiteSicherheitPruefen } from './pruefen.ts';

export const CHECKS = tabelle({
  name: 'sicherheit_checks',
  modul: 'sicherheit',
  label: 'Sicherheits Checks',
  spalten: [
    { name: 'seite_id', typ: 'text' },
    { name: 'domain', typ: 'text' },
    { name: 'note', typ: 'text' },
    { name: 'punkte', typ: 'int' },
    { name: 'ergebnis', typ: 'json' },
  ],
  indizes: [['seite_id', 'erstellt']],
});

export const LECKS = tabelle({
  name: 'sicherheit_lecks',
  modul: 'sicherheit',
  label: 'Datenlecks (Have I Been Pwned)',
  spalten: [
    { name: 'domain', typ: 'text' },
    { name: 'adressen', typ: 'int' },
    { name: 'lecks', typ: 'json' },
  ],
  indizes: [['domain', 'erstellt']],
});

interface Seite {
  id: string;
  name: string;
  url: string;
  kunde_id: string | null;
  aktiv: boolean;
}
interface Check {
  id: string;
  seite_id: string;
  domain: string;
  note: string;
  punkte: number;
  ergebnis: Bewertung;
  erstellt: string;
}

const RANG: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };

/** Demo: plausible, je Seite stabile Bewertung */
export function demoBewertung(url: string, jetzt: Date): Bewertung {
  const z = zufall(url);
  const host = new URL(url).hostname;
  return bewerten(
    {
      url,
      headers: {
        ...(z > 0.3 ? { 'strict-transport-security': 'max-age=31536000' } : {}),
        ...(z > 0.6 ? { 'content-security-policy': "default-src 'self'" } : {}),
        'x-content-type-options': 'nosniff',
        ...(z > 0.4 ? { 'x-frame-options': 'SAMEORIGIN' } : {}),
        ...(z > 0.5 ? { 'referrer-policy': 'strict-origin-when-cross-origin' } : {}),
        ...(z < 0.35 ? { 'x-powered-by': 'PHP/8.0.30' } : {}),
      },
      html: z < 0.5 ? '<meta name="generator" content="WordPress 6.6.2">' : '',
      tls: {
        protokoll: z > 0.2 ? 'TLSv1.3' : 'TLSv1.2',
        gueltig: true,
        gueltigBis: new Date(jetzt.getTime() + (20 + z * 60) * 86400000).toISOString(),
        fehler: null,
        altAkzeptiert: z < 0.25,
      },
      dns: {
        mx: true,
        spf: z > 0.25 ? 'v=spf1 include:_spf.example.ch ~all' : null,
        dmarc: z > 0.45 ? 'v=DMARC1; p=quarantine' : z > 0.2 ? 'v=DMARC1; p=none' : null,
        dkimSelektor: z > 0.3 ? 'default' : null,
      },
      weiterleitung: { status: 301, ziel: `https://${host}/`, aufHttps: true },
    },
    jetzt,
  );
}

export const sicherheit: ModulDef = {
  id: 'sicherheit',
  name: 'Sicherheits Checks',
  beschreibung: 'Passive Prüfung von Headern, TLS, HTTPS, SPF, DKIM, DMARC und Software Hinweisen',
  symbol: 'sicherheit',
  reihenfolge: 61,
  tabellen: [CHECKS, LECKS],
  regeln: [
    {
      id: 'verschlechtert',
      name: 'Sicherheitsnote gesunken',
      beschreibung:
        'Die Note einer Seite ist gegenüber der letzten Prüfung gesunken (z.B. Header entfernt, Zertifikat ungültig).',
      prioritaet: 3,
      cooldownMin: 1440,
    },
    {
      id: 'leck',
      name: 'Neues Datenleck',
      beschreibung:
        'Have I Been Pwned meldet neue betroffene Adressen einer eigenen Domain (nur mit Schlüssel).',
      prioritaet: 4,
      cooldownMin: 1440,
    },
  ],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  let demo: Promise<void> | null = null;

  const quelle = ctx.quelle<string, Bewertung>({
    id: 'sicherheit.pruefung',
    name: 'Passive Sicherheitsprüfung (HTTP, TLS, DNS)',
    modul: 'sicherheit',
    ttlSek: 3600,
    abruf: (url) => seiteSicherheitPruefen(url, ctx.jetzt()),
    demo: (url) => demoBewertung(url, ctx.jetzt()),
    testParameter: () => 'https://www.scont.ch/',
  });

  const hibp = ctx.quelle<string, { adressen: number; lecks: string[] }>({
    id: 'sicherheit.hibp',
    name: 'Have I Been Pwned (Domain Suche)',
    modul: 'sicherheit',
    ttlSek: 24 * 3600,
    konfiguriert: () => !!konfig.hibpKey,
    ungetestet: true,
    beschreibung:
      'Nur mit HIBP_API_KEY und verifizierter Domain. Gespeichert wird nur die Anzahl Adressen und die Namen der Lecks, keine Adressen.',
    abruf: async (domain) => {
      const j = await httpJson<Record<string, string[]>>(
        `https://haveibeenpwned.com/api/v3/breacheddomain/${encodeURIComponent(domain)}`,
        {
          timeoutMs: 15000,
          headers: { 'hibp-api-key': konfig.hibpKey },
        },
      ).catch((e) => {
        if (/404/.test(String(e))) return {} as Record<string, string[]>;
        throw e;
      });
      const lecks = new Set<string>();
      for (const l of Object.values(j ?? {})) for (const n of l) lecks.add(String(n));
      return { adressen: Object.keys(j ?? {}).length, lecks: [...lecks].sort() };
    },
    demo: () => ({ adressen: 2, lecks: ['Beispielleck (Demo)'] }),
  });

  const seiten = async () =>
    daten.tabelle('seiten')
      ? (await daten.liste<Seite>('seiten', { sortierung: 'name', limit: 200 })).filter((s) => s.aktiv)
      : [];

  async function speichern(s: Seite, b: Bewertung) {
    const [vorher] = await daten.liste<Check>('sicherheit_checks', {
      filter: { seite_id: s.id },
      sortierung: '-erstellt',
      limit: 1,
    });
    const c = await daten.eins<Check>('sicherheit_checks', {
      seite_id: s.id,
      domain: b.domain,
      note: b.note,
      punkte: b.punkte,
      ergebnis: b,
    });
    if (vorher && RANG[b.note] < RANG[vorher.note])
      await ctx.alarm.melden({
        regel: 'sicherheit.verschlechtert',
        titel: `${s.name}: Sicherheitsnote ${vorher.note} → ${b.note}`,
        text: b.einzel
          .filter((p) => !p.ok)
          .map((p) => p.name)
          .join(', ')
          .slice(0, 300),
        schluessel: `sicherheit:${s.id}:${b.note}`,
        link: '/modul/sicherheit',
      });
    return c;
  }

  async function demoVorbereiten() {
    if (!konfig.demo) return;
    demo ??= (async () => {
      if ((await daten.anzahl('sicherheit_checks')) > 0) return;
      const jetzt = ctx.jetzt().getTime();
      const liste = await seiten();
      // Seiten des Webseiten Wächters fehlen noch: später erneut versuchen
      if (!liste.length) demo = null;
      for (const s of liste) {
        const b = demoBewertung(s.url, ctx.jetzt());
        // kleiner Verlauf: vor 4 und vor 2 Wochen etwas schlechter
        for (const [woche, minus] of [
          [4, 12],
          [2, 5],
        ] as const) {
          const p = Math.max(0, b.punkte - minus);
          await daten.einfuegen('sicherheit_checks', [
            {
              seite_id: s.id,
              domain: b.domain,
              note: note(p),
              punkte: p,
              ergebnis: { ...b, punkte: p, note: note(p) },
              erstellt: new Date(jetzt - woche * 7 * 86400000).toISOString(),
            },
          ]);
        }
        await daten.einfuegen('sicherheit_checks', [
          { seite_id: s.id, domain: b.domain, note: b.note, punkte: b.punkte, ergebnis: b },
        ]);
      }
    })();
    await demo;
  }

  async function uebersicht() {
    await demoVorbereiten();
    const liste = await seiten();
    return Promise.all(
      liste.map(async (s) => {
        const verlauf = await daten.liste<Check>('sicherheit_checks', {
          filter: { seite_id: s.id },
          sortierung: '-erstellt',
          limit: 12,
        });
        return {
          seite: { id: s.id, name: s.name, url: s.url, kunde_id: s.kunde_id },
          aktuell: verlauf[0] ?? null,
          verlauf: verlauf.map((v) => ({ erstellt: v.erstellt, note: v.note, punkte: v.punkte })).reverse(),
        };
      }),
    );
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => {
      const eigene = daten.tabelle('domains')
        ? await daten.liste<{ name: string }>('domains', { filter: { eigene: true }, limit: 50 })
        : [];
      const lecks =
        konfig.hibpKey || konfig.demo
          ? await Promise.all(
              eigene.map(async (d) => {
                const [l] = await daten.liste<{ adressen: number; lecks: string[]; erstellt: string }>(
                  'sicherheit_lecks',
                  { filter: { domain: d.name }, sortierung: '-erstellt', limit: 1 },
                );
                return {
                  domain: d.name,
                  ...(l ??
                    (konfig.demo
                      ? { adressen: 2, lecks: ['Beispielleck (Demo)'], erstellt: ctx.jetzt().toISOString() }
                      : { adressen: null, lecks: [], erstellt: null })),
                };
              }),
            )
          : null;
      return { seiten: await uebersicht(), lecks, hibpAktiv: !!konfig.hibpKey };
    });
    app.post<{ Params: { id: string } }>('/seite/:id/pruefen', async (req) => {
      const s = (await seiten()).find((x) => x.id === req.params.id);
      if (!s) throw new EingabeFehler('Seite nicht gefunden');
      const r = await quelle.hole(s.url, true);
      if (!r.daten) throw new EingabeFehler(r.fehler ?? 'Prüfung fehlgeschlagen');
      return speichern(s, r.daten);
    });
  }

  const jobs: JobDef[] = [
    {
      id: 'woche',
      name: 'Wöchentliche Prüfung',
      taeglich: '04:20',
      lauf: async () => {
        if (konfig.demo) return undefined;
        const grenze = new Date(ctx.jetzt().getTime() - 6.5 * 86400000).toISOString();
        let n = 0;
        for (const s of await seiten()) {
          if ((await daten.anzahl('sicherheit_checks', { seite_id: s.id, erstellt: { gte: grenze } })) > 0)
            continue;
          const r = await quelle.hole(s.url, true);
          if (r.daten) {
            await speichern(s, r.daten);
            n++;
          }
          if (n >= 10) break; // Rest am nächsten Tag, damit die Last verteilt bleibt
        }
        if (konfig.hibpKey && daten.tabelle('domains')) {
          for (const d of await daten.liste<{ name: string }>('domains', {
            filter: { eigene: true },
            limit: 20,
          })) {
            const dom = basisDomain(d.name);
            const r = await hibp.hole(dom, true);
            if (!r.daten) continue;
            const [vorher] = await daten.liste<{ adressen: number }>('sicherheit_lecks', {
              filter: { domain: d.name },
              sortierung: '-erstellt',
              limit: 1,
            });
            await daten.einfuegen('sicherheit_lecks', [
              { domain: d.name, adressen: r.daten.adressen, lecks: r.daten.lecks },
            ]);
            if (vorher && r.daten.adressen > vorher.adressen)
              await ctx.alarm.melden({
                regel: 'sicherheit.leck',
                titel: `Datenleck: ${d.name}`,
                text: `${r.daten.adressen} betroffene Adressen (vorher ${vorher.adressen})`,
                schluessel: `leck:${d.name}:${r.daten.adressen}`,
              });
          }
        }
        // Verlauf: ein Jahr behalten
        await daten.loescheWo('sicherheit_checks', {
          erstellt: { lt: new Date(ctx.jetzt().getTime() - 400 * 86400000).toISOString() },
        });
        return `${n} Seiten geprüft`;
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const l = (await uebersicht()).filter((x) => x.aktuell);
    if (!l.length)
      return {
        status: 'neutral',
        titel: 'Sicherheit',
        wert: '–',
        unter: 'noch keine Prüfung',
        demo: konfig.demo,
      };
    const schlecht = l.filter((x) => RANG[x.aktuell!.note] <= 2);
    const mittel = Math.round(l.reduce((s, x) => s + x.aktuell!.punkte, 0) / l.length);
    return {
      status: (schlecht.length ? 'warnung' : 'ok') as Ampel,
      titel: 'Sicherheit',
      wert: note(mittel),
      einheit: `Ø ${mittel} Punkte`,
      unter: `${l.length} Seiten geprüft`,
      zeilen: [...l]
        .sort((a, b) => a.aktuell!.punkte - b.aktuell!.punkte)
        .slice(0, 3)
        .map((x) => ({
          text: x.seite.name,
          wert: `Note ${x.aktuell!.note}`,
          status: (RANG[x.aktuell!.note] <= 2 ? 'warnung' : 'neutral') as Ampel,
        })),
      demo: konfig.demo,
    };
  }

  return { routen, jobs, kachel };
}
