// Modul Abhängigkeiten Wächter: liest package.json und package-lock.json eigener Projekte und prüft sie gegen osv.dev.
// Ändert nie Code, meldet nur. Push nur bei neuen Funden mit Schwere hoch oder kritisch, dazu eine Wochenübersicht.
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { EingabeFehler, tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { httpAnfrage } from '../../quellen/http.ts';
import {
  behobenIn,
  osvAbfragen,
  type Paket,
  paketeLesen,
  SCHWERE_RANG,
  type Schwere,
  schwereLesen,
  type Vuln,
  vulnHolen,
} from './osv.ts';

export const PROJEKTE = tabelle({
  name: 'abh_projekte',
  modul: 'abhaengigkeiten',
  label: 'Projekte',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'quelle', typ: 'text', label: 'Quelle', optionen: ['GitHub', 'Ordner'], standard: 'GitHub' },
    { name: 'ort', typ: 'text', label: 'Repository (besitzer/name) oder Ordner', pflicht: true },
    { name: 'zweig', typ: 'text', label: 'Branch (leer = Standard)' },
    { name: 'unterordner', typ: 'text', label: 'Unterordner mit package.json' },
    { name: 'aktiv', typ: 'bool', label: 'Aktiv', standard: true },
  ],
});

export const FUNDE = tabelle({
  name: 'abh_funde',
  modul: 'abhaengigkeiten',
  label: 'Funde',
  spalten: [
    { name: 'projekt_id', typ: 'text' },
    { name: 'paket', typ: 'text' },
    { name: 'version', typ: 'text' },
    { name: 'direkt', typ: 'bool' },
    { name: 'vuln_id', typ: 'text' },
    { name: 'aliase', typ: 'text' },
    { name: 'titel', typ: 'text' },
    { name: 'schwere', typ: 'text' },
    { name: 'behoben_in', typ: 'text' },
  ],
  indizes: [['projekt_id']],
});

export const LAEUFE = tabelle({
  name: 'abh_laeufe',
  modul: 'abhaengigkeiten',
  label: 'Prüfläufe',
  spalten: [
    { name: 'projekt_id', typ: 'text' },
    { name: 'pakete', typ: 'int' },
    { name: 'funde', typ: 'int' },
    { name: 'neu', typ: 'int' },
    { name: 'behoben', typ: 'int' },
    { name: 'genau', typ: 'bool' },
    { name: 'fehler', typ: 'text' },
  ],
  indizes: [['projekt_id', 'erstellt']],
});

interface Projekt {
  id: string;
  name: string;
  quelle: string;
  ort: string;
  zweig: string | null;
  unterordner: string | null;
  aktiv: boolean;
}
interface Fund {
  id: string;
  projekt_id: string;
  paket: string;
  version: string;
  direkt: boolean;
  vuln_id: string;
  aliase: string | null;
  titel: string | null;
  schwere: Schwere;
  behoben_in: string | null;
  erstellt: string;
}

export const abhaengigkeiten: ModulDef = {
  id: 'abhaengigkeiten',
  name: 'Abhängigkeiten Wächter',
  beschreibung: 'Bekannte Schwachstellen in npm Paketen eigener Projekte (osv.dev)',
  symbol: 'abhaengigkeiten',
  reihenfolge: 62,
  tabellen: [PROJEKTE, FUNDE, LAEUFE],
  regeln: [
    {
      id: 'kritisch',
      name: 'Neue Schwachstelle hoch oder kritisch',
      beschreibung: 'Ein Paket in einem Projekt hat eine neue Schwachstelle mit Schwere hoch oder kritisch.',
      prioritaet: 4,
      cooldownMin: 720,
    },
    {
      id: 'woche',
      name: 'Wochenübersicht Abhängigkeiten',
      beschreibung: 'Montags um 08:15 eine Übersicht aller offenen Funde.',
      prioritaet: 2,
      cooldownMin: 1440,
    },
  ],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  const vulnCache = new Map<string, { v: Vuln; zeit: number }>();
  let vorbereitet: Promise<void> | null = null;

  const quelle = ctx.quelle<Paket[], Map<string, string[]>>({
    id: 'abhaengigkeiten.osv',
    name: 'osv.dev Schwachstellen Datenbank',
    modul: 'abhaengigkeiten',
    ttlSek: 6 * 3600,
    abruf: (p) => osvAbfragen(p),
    demo: () => new Map(),
    namensnennung: 'OSV (osv.dev), Daten u.a. aus GitHub Advisory Database (CC BY 4.0)',
    testParameter: () => [{ name: 'lodash', version: '4.17.15', direkt: true }],
  });

  async function vuln(id: string): Promise<Vuln> {
    const c = vulnCache.get(id);
    if (c && Date.now() - c.zeit < 86400000) return c.v;
    const v = await vulnHolen(id);
    vulnCache.set(id, { v, zeit: Date.now() });
    if (vulnCache.size > 500) vulnCache.delete(vulnCache.keys().next().value!);
    return v;
  }

  async function dateiLesen(p: Projekt, name: string): Promise<string | null> {
    const unter = (p.unterordner ?? '').replace(/^\/+|\/+$/g, '');
    if (unter.includes('..')) throw new EingabeFehler('Unterordner ungültig');
    if (p.quelle === 'Ordner') {
      const basis = p.ort === '.' ? process.cwd() : p.ort;
      if (!isAbsolute(basis)) throw new EingabeFehler('Ordner muss absolut sein');
      return readFile(resolve(join(basis, unter, name)), 'utf8').catch(() => null);
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(p.ort)) throw new EingabeFehler('Repository im Format besitzer/name');
    const pfad = [unter, name].filter(Boolean).join('/');
    const url = `https://api.github.com/repos/${p.ort}/contents/${pfad}${p.zweig ? `?ref=${encodeURIComponent(p.zweig)}` : ''}`;
    const a = await httpAnfrage(url, {
      timeoutMs: 20000,
      maxBytes: 20_000_000,
      headers: {
        accept: 'application/vnd.github.raw+json',
        'x-github-api-version': '2022-11-28',
        ...(konfig.githubToken ? { authorization: `Bearer ${konfig.githubToken}` } : {}),
      },
    });
    if (a.status === 404) return null;
    if (a.status !== 200)
      throw new Error(
        `GitHub antwortet ${a.status}${a.status === 403 ? ' (Limit oder fehlendes Token)' : ''}`,
      );
    return a.text;
  }

  async function projektPruefen(p: Projekt) {
    const pj = await dateiLesen(p, 'package.json');
    if (!pj) throw new Error('package.json nicht gefunden');
    const lock = await dateiLesen(p, 'package-lock.json');
    const { pakete, genau } = paketeLesen(pj, lock);
    const r = await quelle.hole(pakete, true);
    if (!r.daten) throw new Error(r.fehler ?? 'osv.dev nicht erreichbar');
    const neueFunde: Omit<Fund, 'id' | 'erstellt'>[] = [];
    for (const pk of pakete) {
      for (const id of r.daten.get(`${pk.name}@${pk.version}`) ?? []) {
        const v = await vuln(id).catch(() => null);
        neueFunde.push({
          projekt_id: p.id,
          paket: pk.name,
          version: pk.version,
          direkt: pk.direkt,
          vuln_id: id,
          aliase: v?.aliases?.join(', ').slice(0, 200) ?? null,
          titel: v?.summary?.slice(0, 300) ?? null,
          schwere: v ? schwereLesen(v) : 'unbekannt',
          behoben_in: v ? behobenIn(v, pk.name, pk.version) : null,
        });
      }
    }
    const alt = await daten.liste<Fund>('abh_funde', { filter: { projekt_id: p.id }, limit: 5000 });
    const schl = (f: { paket: string; version: string; vuln_id: string }) =>
      `${f.paket}@${f.version}:${f.vuln_id}`;
    const altSet = new Set(alt.map(schl));
    const neuSet = new Set(neueFunde.map(schl));
    const weg = alt.filter((f) => !neuSet.has(schl(f)));
    const dazu = neueFunde.filter((f) => !altSet.has(schl(f)));
    for (const f of weg) await daten.loeschen('abh_funde', f.id);
    if (dazu.length) await daten.einfuegen('abh_funde', dazu);
    await daten.einfuegen('abh_laeufe', [
      {
        projekt_id: p.id,
        pakete: pakete.length,
        funde: neueFunde.length,
        neu: dazu.length,
        behoben: weg.length,
        genau,
        fehler: null,
      },
    ]);
    const wichtig = dazu.filter((f) => SCHWERE_RANG[f.schwere] >= SCHWERE_RANG.hoch);
    if (wichtig.length)
      await ctx.alarm.melden({
        regel: 'abhaengigkeiten.kritisch',
        titel: `${p.name}: ${wichtig.length} neue Schwachstelle${wichtig.length > 1 ? 'n' : ''} (${wichtig.some((f) => f.schwere === 'kritisch') ? 'kritisch' : 'hoch'})`,
        text: wichtig
          .slice(0, 5)
          .map((f) => `${f.paket} ${f.version}${f.behoben_in ? ` → ${f.behoben_in}` : ''}`)
          .join(', '),
        schluessel: `abh:${p.id}:${wichtig
          .map((f) => f.vuln_id)
          .sort()
          .join(',')}`.slice(0, 200),
        link: '/modul/abhaengigkeiten',
      });
    return { pakete: pakete.length, funde: neueFunde.length, neu: dazu.length, behoben: weg.length, genau };
  }

  async function demoVorbereiten() {
    vorbereitet ??= (async () => {
      if ((await daten.anzahl('abh_projekte')) > 0) return;
      // Standard: der Hub prüft sich selbst
      const [hub] = await daten.einfuegen<{ id: string }>('abh_projekte', [
        { name: 'Pi Hub', quelle: 'Ordner', ort: '.', aktiv: true },
      ]);
      if (!konfig.demo) return;
      const [web] = await daten.einfuegen<{ id: string }>('abh_projekte', [
        { name: 'scont Webseite (Demo)', quelle: 'GitHub', ort: 'beispiel/scont-web', aktiv: true },
      ]);
      await daten.einfuegen('abh_funde', [
        {
          projekt_id: web.id,
          paket: 'lodash',
          version: '4.17.15',
          direkt: true,
          vuln_id: 'GHSA-p6mc-m468-83gw',
          aliase: 'CVE-2020-8203',
          titel: 'Prototype Pollution in lodash',
          schwere: 'hoch',
          behoben_in: '4.17.19',
        },
        {
          projekt_id: web.id,
          paket: 'lodash',
          version: '4.17.15',
          direkt: true,
          vuln_id: 'GHSA-35jh-r3h4-6jhm',
          aliase: 'CVE-2021-23337',
          titel: 'Command Injection in lodash',
          schwere: 'hoch',
          behoben_in: '4.17.21',
        },
        {
          projekt_id: web.id,
          paket: 'nanoid',
          version: '3.1.20',
          direkt: false,
          vuln_id: 'GHSA-qrpm-p2h7-hrv2',
          aliase: 'CVE-2021-23566',
          titel: 'Exposure of Sensitive Information in nanoid',
          schwere: 'mittel',
          behoben_in: '3.1.31',
        },
      ]);
      await daten.einfuegen('abh_laeufe', [
        { projekt_id: hub.id, pakete: 212, funde: 0, neu: 0, behoben: 0, genau: true, fehler: null },
        { projekt_id: web.id, pakete: 486, funde: 3, neu: 1, behoben: 0, genau: true, fehler: null },
      ]);
    })();
    await vorbereitet;
  }

  async function uebersicht() {
    await demoVorbereiten();
    const projekte = await daten.liste<Projekt>('abh_projekte', { sortierung: 'name', limit: 100 });
    return Promise.all(
      projekte.map(async (p) => {
        const funde = await daten.liste<Fund>('abh_funde', { filter: { projekt_id: p.id }, limit: 2000 });
        funde.sort(
          (a, b) => SCHWERE_RANG[b.schwere] - SCHWERE_RANG[a.schwere] || a.paket.localeCompare(b.paket),
        );
        const [lauf] = await daten.liste<Record<string, unknown>>('abh_laeufe', {
          filter: { projekt_id: p.id },
          sortierung: '-erstellt',
          limit: 1,
        });
        return { projekt: p, funde, lauf: lauf ?? null };
      }),
    );
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => ({
      projekte: await uebersicht(),
      tokenGesetzt: !!konfig.githubToken,
    }));
    app.post<{ Params: { id: string } }>('/projekt/:id/pruefen', async (req) => {
      const p = await daten.hole<Projekt>('abh_projekte', req.params.id);
      if (!p) throw new EingabeFehler('Projekt nicht gefunden');
      if (konfig.demo && p.quelle === 'GitHub')
        throw new EingabeFehler('Im Demo Modus werden keine Repositories abgerufen');
      try {
        return await projektPruefen(p);
      } catch (e) {
        await daten.einfuegen('abh_laeufe', [
          {
            projekt_id: p.id,
            pakete: 0,
            funde: 0,
            neu: 0,
            behoben: 0,
            genau: false,
            fehler: String((e as Error).message).slice(0, 300),
          },
        ]);
        throw new EingabeFehler(String((e as Error).message).slice(0, 300));
      }
    });
  }

  const jobs: JobDef[] = [
    {
      id: 'pruefen',
      name: 'Projekte prüfen',
      taeglich: '05:10',
      lauf: async () => {
        await demoVorbereiten();
        if (konfig.demo) return undefined;
        const projekte = (await daten.liste<Projekt>('abh_projekte', { limit: 100 })).filter((p) => p.aktiv);
        const fehler: string[] = [];
        for (const p of projekte) {
          try {
            await projektPruefen(p);
          } catch (e) {
            fehler.push(`${p.name}: ${(e as Error).message}`);
            await daten.einfuegen('abh_laeufe', [
              {
                projekt_id: p.id,
                pakete: 0,
                funde: 0,
                neu: 0,
                behoben: 0,
                genau: false,
                fehler: String((e as Error).message).slice(0, 300),
              },
            ]);
          }
        }
        await daten.loescheWo('abh_laeufe', {
          erstellt: { lt: new Date(ctx.jetzt().getTime() - 180 * 86400000).toISOString() },
        });
        if (fehler.length)
          await ctx.aktivitaet('abhaengigkeiten', fehler.join('; ').slice(0, 500), 'warnung');
        return `${projekte.length} Projekte`;
      },
    },
    {
      id: 'woche',
      name: 'Wochenübersicht',
      taeglich: '08:15',
      lauf: async () => {
        if (
          ctx.jetzt().toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'long' }) !== 'Montag'
        )
          return undefined;
        const u = await uebersicht();
        const offen = u.flatMap((x) => x.funde);
        const proSchwere = (s: Schwere) => offen.filter((f) => f.schwere === s).length;
        await ctx.alarm.melden({
          regel: 'abhaengigkeiten.woche',
          titel: offen.length
            ? `Abhängigkeiten: ${offen.length} offene Funde`
            : 'Abhängigkeiten: keine offenen Funde',
          text: offen.length
            ? `kritisch ${proSchwere('kritisch')}, hoch ${proSchwere('hoch')}, mittel ${proSchwere('mittel')}, niedrig ${proSchwere('niedrig')}. ${u
                .filter((x) => x.funde.length)
                .map((x) => `${x.projekt.name} ${x.funde.length}`)
                .join(', ')}`
            : `${u.length} Projekte geprüft`,
          schluessel: `abh-woche:${ctx.jetzt().toISOString().slice(0, 10)}`,
          link: '/modul/abhaengigkeiten',
        });
        return 'Übersicht gemeldet';
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const u = await uebersicht();
    const offen = u.flatMap((x) => x.funde);
    const ernst = offen.filter((f) => SCHWERE_RANG[f.schwere] >= SCHWERE_RANG.hoch);
    return {
      status: (ernst.length ? 'warnung' : 'ok') as Ampel,
      titel: 'Abhängigkeiten',
      wert: String(offen.length),
      einheit: 'Funde',
      unter: ernst.length ? `${ernst.length} hoch oder kritisch` : `${u.length} Projekte ohne ernste Funde`,
      zeilen: u.slice(0, 3).map((x) => ({
        text: x.projekt.name,
        wert: x.funde.length ? `${x.funde.length} Funde` : 'sauber',
        status: (x.funde.some((f) => SCHWERE_RANG[f.schwere] >= 3) ? 'warnung' : 'ok') as Ampel,
      })),
      demo: konfig.demo,
    };
  }

  return { routen, jobs, kachel };
}
