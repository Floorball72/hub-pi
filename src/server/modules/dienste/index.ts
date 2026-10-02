// Modul Dienste Status: Status der Dienste, auf die Jerome baut (Supabase, GitHub, Vercel, Cloudflare, ntfy).
// Statuspage Seiten (Atlassian) liefern /api/v2/status.json und /api/v2/incidents/unresolved.json.
import type { FastifyInstance } from 'fastify';
import { tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { httpJson } from '../../quellen/http.ts';

export const DIENSTE = tabelle({
  name: 'dienste',
  modul: 'dienste',
  label: 'Dienste',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    {
      name: 'art',
      typ: 'text',
      label: 'Art',
      optionen: ['Statuspage', 'Health JSON'],
      standard: 'Statuspage',
    },
    { name: 'url', typ: 'text', label: 'Adresse der Statusseite', pflicht: true },
    { name: 'aktiv', typ: 'bool', label: 'Aktiv', standard: true },
    { name: 'push', typ: 'bool', label: 'Push bei Störung', standard: true },
    { name: 'hostet_seiten', typ: 'bool', label: 'Kundenseiten laufen darüber', standard: false },
  ],
});

export const VERLAUF = tabelle({
  name: 'dienste_verlauf',
  modul: 'dienste',
  label: 'Dienste Verlauf',
  spalten: [
    { name: 'dienst_id', typ: 'text' },
    { name: 'stufe', typ: 'text' },
    { name: 'text', typ: 'text' },
  ],
  indizes: [['dienst_id', 'erstellt']],
});

export const STANDARD_DIENSTE = [
  { name: 'Supabase', art: 'Statuspage', url: 'https://status.supabase.com', hostet_seiten: false },
  { name: 'GitHub', art: 'Statuspage', url: 'https://www.githubstatus.com', hostet_seiten: false },
  { name: 'Vercel', art: 'Statuspage', url: 'https://www.vercel-status.com', hostet_seiten: true },
  { name: 'Cloudflare', art: 'Statuspage', url: 'https://www.cloudflarestatus.com', hostet_seiten: true },
  { name: 'ntfy', art: 'Health JSON', url: 'https://ntfy.sh/v1/health', hostet_seiten: false },
];

/** Stufen der Statuspage: none, minor, major, critical, maintenance */
export type Stufe = 'ok' | 'wartung' | 'gering' | 'stoerung' | 'ausfall' | 'unbekannt';
const RANG: Record<Stufe, number> = { ok: 0, wartung: 1, gering: 2, stoerung: 3, ausfall: 4, unbekannt: -1 };

export interface DienstStatus {
  stufe: Stufe;
  text: string;
  vorfaelle: { name: string; status: string; wirkung: string; link: string | null; seit: string | null }[];
}

export function stufeAusIndikator(i: string | undefined): Stufe {
  switch (i) {
    case 'none':
      return 'ok';
    case 'minor':
      return 'gering';
    case 'major':
      return 'stoerung';
    case 'critical':
      return 'ausfall';
    case 'maintenance':
      return 'wartung';
    default:
      return 'unbekannt';
  }
}

export const ampelFuer = (s: Stufe): Ampel =>
  s === 'ok'
    ? 'ok'
    : s === 'ausfall' || s === 'stoerung'
      ? 'ausfall'
      : s === 'unbekannt'
        ? 'neutral'
        : 'warnung';

interface StatusJson {
  status?: { indicator?: string; description?: string };
}
interface OffenJson {
  incidents?: {
    name?: string;
    status?: string;
    impact?: string;
    shortlink?: string;
    started_at?: string;
    created_at?: string;
  }[];
}

export function statuspageLesen(status: StatusJson, offen: OffenJson | null): DienstStatus {
  return {
    stufe: stufeAusIndikator(status.status?.indicator),
    text: status.status?.description ?? 'unbekannt',
    vorfaelle: (offen?.incidents ?? []).slice(0, 10).map((i) => ({
      name: String(i.name ?? 'Vorfall').slice(0, 300),
      status: String(i.status ?? ''),
      wirkung: String(i.impact ?? ''),
      link: typeof i.shortlink === 'string' && i.shortlink.startsWith('https://') ? i.shortlink : null,
      seit: i.started_at ?? i.created_at ?? null,
    })),
  };
}

/** Meldet eine Verschlechterung oder Erholung, sonst null */
export function wechsel(alt: Stufe | undefined, neu: Stufe): 'schlechter' | 'besser' | null {
  if (alt === undefined || neu === 'unbekannt' || alt === 'unbekannt' || alt === neu) return null;
  return RANG[neu] > RANG[alt] ? 'schlechter' : 'besser';
}

interface Dienst {
  id: string;
  name: string;
  art: string;
  url: string;
  aktiv: boolean;
  push: boolean;
  hostet_seiten: boolean;
}

export const dienste: ModulDef = {
  id: 'dienste',
  name: 'Dienste Status',
  beschreibung: 'Status von Supabase, GitHub, Vercel, Cloudflare, ntfy und weiteren Diensten',
  symbol: 'dienste',
  reihenfolge: 60,
  tabellen: [DIENSTE, VERLAUF],
  regeln: [
    {
      id: 'stoerung',
      name: 'Dienst gestört',
      beschreibung:
        'Ein Dienst meldet eine Störung (Stufe gering, Störung oder Ausfall). Schwelle: 2 = ab gering, 3 = ab Störung, 4 = nur Ausfall.',
      schwelle: 3,
      schwelleLabel: 'Stufe',
      prioritaet: 3,
      cooldownMin: 120,
    },
    {
      id: 'behoben',
      name: 'Dienst wieder normal',
      beschreibung: 'Ein gestörter Dienst meldet wieder Normalbetrieb.',
      prioritaet: 2,
      cooldownMin: 30,
    },
  ],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  const letzte = new Map<string, Stufe>();
  let vorbereitet: Promise<void> | null = null;

  const quelle = ctx.quelle<{ art: string; url: string }, DienstStatus>({
    id: 'dienste.status',
    name: 'Statusseiten der Dienste',
    modul: 'dienste',
    ttlSek: 240,
    abruf: async ({ art, url }) => {
      if (art === 'Health JSON') {
        const j = await httpJson<{ healthy?: boolean }>(url, { timeoutMs: 10000 });
        return {
          stufe: j.healthy === true ? 'ok' : 'ausfall',
          text: j.healthy === true ? 'Betriebsbereit' : 'Meldet nicht gesund',
          vorfaelle: [],
        };
      }
      const basis = url.replace(/\/+$/, '');
      const status = await httpJson<StatusJson>(`${basis}/api/v2/status.json`, { timeoutMs: 10000 });
      const offen = await httpJson<OffenJson>(`${basis}/api/v2/incidents/unresolved.json`, {
        timeoutMs: 10000,
      }).catch(() => null);
      return statuspageLesen(status, offen);
    },
    demo: ({ url }) =>
      url.includes('cloudflare')
        ? {
            stufe: 'gering',
            text: 'Minor Service Outage',
            vorfaelle: [
              {
                name: 'Erhöhte Latenz in einzelnen Rechenzentren (Demo)',
                status: 'investigating',
                wirkung: 'minor',
                link: null,
                seit: new Date(ctx.jetzt().getTime() - 5400000).toISOString(),
              },
            ],
          }
        : { stufe: 'ok', text: 'All Systems Operational', vorfaelle: [] },
    testParameter: () => ({ art: 'Statuspage', url: 'https://www.githubstatus.com' }),
  });

  async function vorbereiten() {
    vorbereitet ??= (async () => {
      if ((await daten.anzahl('dienste')) === 0)
        await daten.einfuegen(
          'dienste',
          STANDARD_DIENSTE.map((d) => ({ ...d, aktiv: true, push: true })),
        );
    })();
    await vorbereitet;
  }

  async function alle() {
    await vorbereiten();
    const liste = (await daten.liste<Dienst>('dienste', { sortierung: 'name', limit: 50 })).filter(
      (d) => d.aktiv,
    );
    return Promise.all(
      liste.map(async (d) => {
        const r = await quelle.hole({ art: d.art, url: d.url });
        const s: DienstStatus = r.daten ?? {
          stufe: 'unbekannt',
          text: r.fehler ?? 'keine Antwort',
          vorfaelle: [],
        };
        return { dienst: d, ...s, fehler: r.fehler, demo: r.demo, stand: r.stand };
      }),
    );
  }

  async function offeneAusfaelle() {
    if (!daten.tabelle('vorfaelle')) return [];
    const offen = await daten.liste<{ seite_id: string; start: string }>('vorfaelle', {
      filter: { ende: { istNull: true } },
      limit: 50,
    });
    return Promise.all(
      offen.map(async (v) => ({
        ...v,
        name: (await daten.hole<{ name: string }>('seiten', v.seite_id))?.name ?? 'Seite',
      })),
    );
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => {
      const liste = await alle();
      const ausfaelle = await offeneAusfaelle();
      const gestoerteHoster = liste.filter(
        (d) => d.dienst.hostet_seiten && d.stufe !== 'ok' && d.stufe !== 'unbekannt',
      );
      return {
        dienste: liste,
        zusammenhang:
          ausfaelle.length && gestoerteHoster.length
            ? { ausfaelle, dienste: gestoerteHoster.map((d) => d.dienst.name) }
            : null,
        verlauf: await daten.liste('dienste_verlauf', { sortierung: '-erstellt', limit: 40 }),
      };
    });
  }

  const jobs: JobDef[] = [
    {
      id: 'pruefen',
      name: 'Statusseiten abfragen',
      intervallSek: 300,
      startVerzoegerungSek: 35,
      lauf: async () => {
        const liste = await alle();
        for (const d of liste) {
          if (d.stufe === 'unbekannt') continue;
          if (!letzte.has(d.dienst.id)) {
            // Nach dem Start den letzten bekannten Stand aus dem Verlauf nehmen
            const [v] = await daten.liste<{ stufe: Stufe }>('dienste_verlauf', {
              filter: { dienst_id: d.dienst.id },
              sortierung: '-erstellt',
              limit: 1,
            });
            if (v) letzte.set(d.dienst.id, v.stufe);
          }
          const w = wechsel(letzte.get(d.dienst.id), d.stufe);
          if (w || !letzte.has(d.dienst.id))
            await daten.einfuegen('dienste_verlauf', [
              { dienst_id: d.dienst.id, stufe: d.stufe, text: d.text.slice(0, 300) },
            ]);
          letzte.set(d.dienst.id, d.stufe);
          if (!w || !d.dienst.push) continue;
          if (w === 'schlechter' && d.stufe !== 'wartung')
            await ctx.alarm.melden({
              regel: 'dienste.stoerung',
              titel: `${d.dienst.name}: ${d.text}`,
              text: d.vorfaelle.map((v) => v.name).join('; ') || 'Details auf der Statusseite',
              wert: RANG[d.stufe],
              schluessel: `dienst:${d.dienst.id}:${d.stufe}`,
              link: d.dienst.url.replace(/\/v1\/health$/, ''),
            });
          else if (w === 'besser' && d.stufe === 'ok')
            await ctx.alarm.melden({
              regel: 'dienste.behoben',
              titel: `${d.dienst.name} wieder normal`,
              text: d.text,
              schluessel: `dienst:${d.dienst.id}:ok`,
            });
        }
        return `${liste.length} Dienste`;
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const liste = await alle();
    const schlecht = liste.filter((d) => d.stufe !== 'ok');
    const schlimmste = schlecht.reduce<Stufe>((s, d) => (RANG[d.stufe] > RANG[s] ? d.stufe : s), 'ok');
    return {
      status: ampelFuer(schlimmste),
      titel: 'Dienste',
      wert: `${liste.length - schlecht.length}/${liste.length}`,
      unter: schlecht.length ? 'Dienste mit Meldung' : 'alle Dienste normal',
      zeilen: (schlecht.length ? schlecht : liste.slice(0, 3))
        .slice(0, 4)
        .map((d) => ({ text: d.dienst.name, wert: d.text, status: ampelFuer(d.stufe) })),
      demo: konfig.demo,
    };
  }

  return { routen, jobs, kachel };
}
