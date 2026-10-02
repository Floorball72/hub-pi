// Modul Wetter Wächter für Drehs: prüft 72, 48 und 24 Stunden sowie wenige Stunden vor jedem Kundendreh,
// ob das Mindestwetter des Ortes erfüllt ist. Bei Problemen: Push mit Gründen und Ausweichterminen, die
// Kalender, swiss unihockey Einsätze, Veranstaltungen und andere Drehs berücksichtigen. Verschiebt nie selbst.
import type { FastifyInstance } from 'fastify';
import { tabelle } from '../../daten/schema.ts';
import type { Ampel, Kachel, TimelineEintrag } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { lokal } from '../../kern/zeit.ts';
import { demoVorhersage } from '../../quellen/demo-wetter.ts';
import {
  OPENMETEO_NAMENSNENNUNG,
  type Stunde,
  type Vorhersage,
  vorhersageHolen,
} from '../../quellen/openmeteo.ts';
import { type Grenzen, STANDARD_GRENZEN, stundeBewerten } from '../drohne/fenster.ts';

export const PRUEFUNGEN = tabelle({
  name: 'dreh_wetter',
  modul: 'drehwetter',
  label: 'Wetterprüfungen der Drehs',
  spalten: [
    { name: 'dreh_id', typ: 'text' },
    { name: 'stufe', typ: 'text' },
    { name: 'ok', typ: 'bool' },
    { name: 'gruende', typ: 'json' },
    { name: 'alternativen', typ: 'json' },
  ],
  indizes: [['dreh_id', 'erstellt']],
});

/** Prüfpunkte in Stunden vor dem Dreh */
export const STUFEN = [72, 48, 24, 4] as const;

export interface Dreh {
  id: string;
  titel: string;
  termin: string | null;
  dauer_min: number | null;
  status: string;
  ort_id: string | null;
}
interface Ort extends Partial<Grenzen> {
  id: string;
  name: string;
  lat: number;
  lon: number;
  dreh_id: string | null;
}

export interface Urteil {
  ok: boolean;
  gruende: string[];
  /** Stunden ohne Vorhersage (zu weit weg) */
  unbekannt: boolean;
}

/** Bewertet das Zeitfenster eines Drehs Stunde für Stunde */
export function drehBewerten(stunden: Stunde[], start: number, ende: number, g: Grenzen): Urteil {
  const relevant = stunden.filter((s) => s.t + 3600000 > start && s.t < ende);
  if (!relevant.length) return { ok: true, gruende: [], unbekannt: true };
  const gruende = new Set<string>();
  for (const s of relevant) for (const x of stundeBewerten(s, g, null).gruende) gruende.add(x);
  // gleichartige Gründe zusammenfassen, z.B. «Wind 32 bis 41 km/h»
  const zusammen = new Map<string, string[]>();
  for (const x of gruende) {
    const art = x.replace(/[-\d.,]+/g, '#');
    zusammen.set(art, [...(zusammen.get(art) ?? []), x]);
  }
  const text = [...zusammen.entries()].map(([art, l]) => {
    if (l.length === 1) return l[0];
    const zahlen = l.map((x) => Number.parseFloat(/-?[\d.]+/.exec(x)?.[0] ?? 'NaN')).filter(Number.isFinite);
    if (!zahlen.length) return l[0];
    return art.replace('#', `${Math.min(...zahlen)} bis ${Math.max(...zahlen)}`);
  });
  return { ok: gruende.size === 0, gruende: text, unbekannt: false };
}

/** Welche Prüfstufe ist jetzt fällig? Die kleinste Stufe, deren Zeitpunkt erreicht ist. */
export function faelligeStufe(stundenBis: number): number | null {
  if (stundenBis <= 0) return null;
  const s = [...STUFEN].reverse().find((x) => stundenBis <= x);
  return s ?? null;
}

export interface Belegung {
  start: number;
  ende: number;
  titel: string;
}

/** Ausweichtermine: gleiche Dauer, Tageslicht 7 bis 20 Uhr, Mindestwetter erfüllt, keine Überschneidung */
export function alternativenFinden(
  stunden: Stunde[],
  dauerMin: number,
  g: Grenzen,
  belegt: Belegung[],
  ab: number,
  max = 3,
): { start: string; ende: string }[] {
  const aus: { start: string; ende: string }[] = [];
  const dauer = dauerMin * 60000;
  const proTag = new Set<string>();
  for (const s of stunden) {
    if (s.t < ab) continue;
    const l = lokal(new Date(s.t));
    const ende = s.t + dauer;
    const lEnde = lokal(new Date(ende - 1));
    if (l.stunde < 7 || lEnde.stunde >= 20 || lEnde.tag !== l.tag) continue;
    const tag = `${l.jahr}-${l.monat}-${l.tag}`;
    if (proTag.has(tag)) continue;
    const u = drehBewerten(stunden, s.t, ende, g);
    if (!u.ok || u.unbekannt) continue;
    if (stunden.filter((x) => x.t + 3600000 > s.t && x.t < ende).some((x) => !x.tag)) continue;
    if (belegt.some((b) => b.start < ende && b.ende > s.t)) continue;
    aus.push({ start: new Date(s.t).toISOString(), ende: new Date(ende).toISOString() });
    proTag.add(tag);
    if (aus.length >= max) break;
  }
  return aus;
}

export const drehwetter: ModulDef = {
  id: 'drehwetter',
  name: 'Dreh Wetter Wächter',
  beschreibung: 'Prüft das Wetter vor Kundendrehs und schlägt Ausweichtermine vor',
  symbol: 'drehwetter',
  reihenfolge: 52,
  tabellen: [PRUEFUNGEN],
  regeln: [
    {
      id: 'gefaehrdet',
      name: 'Dreh wetterbedingt gefährdet',
      beschreibung:
        '72, 48, 24 und 4 Stunden vor einem Dreh, wenn das Mindestwetter des Ortes nicht erfüllt ist. Mit Ausweichterminen.',
      prioritaet: 3,
      cooldownMin: 600,
    },
    {
      id: 'wieder_ok',
      name: 'Dreh wieder im grünen Bereich',
      beschreibung: 'Die Prognose für einen gefährdeten Dreh ist wieder gut.',
      prioritaet: 2,
      cooldownMin: 600,
    },
  ],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  const heim = konfig.wetterOrte[0] ?? { name: 'Kirchberg SG', lat: 47.41079, lon: 9.0411 };

  const wetter = ctx.quelle<{ lat: number; lon: number }, Vorhersage>({
    id: 'drehwetter.vorhersage',
    name: 'Open-Meteo (Drehorte)',
    modul: 'drehwetter',
    ttlSek: 3600,
    abruf: (p) => vorhersageHolen(p.lat, p.lon),
    demo: (p) => demoVorhersage(p.lat, p.lon, ctx.jetzt()),
    namensnennung: OPENMETEO_NAMENSNENNUNG,
    testParameter: () => ({ lat: 47.41, lon: 9.04 }),
  });

  async function ortFuer(d: Dreh): Promise<Ort | { name: string; lat: number; lon: number }> {
    if (d.ort_id) {
      const o = await daten.hole<Ort>('drohnen_orte', d.ort_id);
      if (o) return o;
    }
    const [o] = await daten.liste<Ort>('drohnen_orte', { filter: { dreh_id: d.id }, limit: 1 });
    return o ?? heim;
  }

  const grenzenVon = (o: Partial<Grenzen>): Grenzen => {
    const g = { ...STANDARD_GRENZEN };
    for (const k of Object.keys(g) as (keyof Grenzen)[]) if (typeof o[k] === 'number') g[k] = o[k] as number;
    return g;
  };

  async function belegungen(von: Date, bis: Date, ohne: string): Promise<Belegung[]> {
    const t = await ctx.kern.timeline(von, bis);
    return (
      t
        .filter((e) => e.id !== `dreh-${ohne}` && !e.id.endsWith(ohne))
        // ganztägige Kalendereinträge (z.B. Feiertage) blockieren nicht, Einsätze und Drehs schon
        .filter((e) => !(e.art === 'Termin' && e.start.length <= 10))
        .map((e) => ({
          start: Date.parse(e.start),
          ende: e.ende ? Date.parse(e.ende) : Date.parse(e.start) + 3600000,
          titel: e.titel,
        }))
    );
  }

  async function bewerten(d: Dreh, mitAlternativen = true) {
    const ort = await ortFuer(d);
    const g = grenzenVon(ort as Partial<Grenzen>);
    const start = Date.parse(d.termin!);
    const ende = start + (d.dauer_min ?? 120) * 60000;
    const r = await wetter.hole({ lat: ort.lat, lon: ort.lon });
    const stunden = r.daten?.stunden ?? [];
    const urteil = drehBewerten(stunden, start, ende, g);
    let alternativen: { start: string; ende: string }[] = [];
    if (!urteil.ok && mitAlternativen) {
      const jetzt = ctx.jetzt();
      const bel = await belegungen(jetzt, new Date(jetzt.getTime() + 8 * 86400000), d.id);
      alternativen = alternativenFinden(
        stunden,
        d.dauer_min ?? 120,
        g,
        bel,
        Math.max(jetzt.getTime() + 2 * 3600000, start - 3 * 86400000),
      );
    }
    return { ort: ort.name, urteil, alternativen, fehler: r.fehler, demo: r.demo };
  }

  async function kommende() {
    const jetzt = ctx.jetzt();
    if (!daten.tabelle('drehs')) return [];
    return (
      await daten.liste<Dreh>('drehs', {
        filter: {
          termin: {
            gte: new Date(jetzt.getTime() - 3 * 3600000).toISOString(),
            lte: new Date(jetzt.getTime() + 8 * 86400000).toISOString(),
          },
        },
        sortierung: 'termin',
        limit: 50,
      })
    ).filter((d) => d.termin && !['abgeschlossen', 'Lieferung', 'Schnitt'].includes(d.status));
  }

  const terminText = (iso: string) =>
    new Date(iso).toLocaleString('de-CH', {
      timeZone: 'Europe/Zurich',
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function pruefen(): Promise<string | undefined> {
    const jetzt = ctx.jetzt().getTime();
    let n = 0;
    for (const d of await kommende()) {
      const stufe = faelligeStufe((Date.parse(d.termin!) - jetzt) / 3600000);
      if (!stufe) continue;
      const schon = await daten.anzahl('dreh_wetter', { dreh_id: d.id, stufe: String(stufe) });
      if (schon) continue;
      const b = await bewerten(d);
      if (b.urteil.unbekannt) continue;
      const [vorher] = await daten.liste<{ ok: boolean }>('dreh_wetter', {
        filter: { dreh_id: d.id },
        sortierung: '-erstellt',
        limit: 1,
      });
      await daten.einfuegen('dreh_wetter', [
        {
          dreh_id: d.id,
          stufe: String(stufe),
          ok: b.urteil.ok,
          gruende: b.urteil.gruende,
          alternativen: b.alternativen,
        },
      ]);
      n++;
      if (!b.urteil.ok) {
        const alt = b.alternativen.length
          ? `Ausweichtermine: ${b.alternativen.map((a) => terminText(a.start)).join(', ')}`
          : 'Kein freier Ausweichtermin mit gutem Wetter in den nächsten Tagen.';
        await ctx.alarm.melden({
          regel: 'drehwetter.gefaehrdet',
          titel: `Dreh ${d.titel} gefährdet (${stufe} h vorher)`,
          text: `${terminText(d.termin!)} in ${b.ort}: ${b.urteil.gruende.join(', ')}. ${alt}`,
          prioritaet: stufe <= 4 ? 4 : undefined,
          schluessel: `drehwetter:${d.id}:${stufe}`,
          link: '/modul/drehwetter',
        });
      } else if (vorher && !vorher.ok) {
        await ctx.alarm.melden({
          regel: 'drehwetter.wieder_ok',
          titel: `Dreh ${d.titel}: Wetter wieder gut`,
          text: `${terminText(d.termin!)} in ${b.ort}, Mindestwetter erfüllt.`,
          schluessel: `drehwetter-ok:${d.id}:${stufe}`,
        });
      }
    }
    return n ? `${n} Drehs geprüft` : undefined;
  }

  async function uebersicht(mitAlternativen = true) {
    const liste = await kommende();
    return Promise.all(
      liste.map(async (d) => {
        const b = await bewerten(d, mitAlternativen);
        const verlauf = await daten.liste<{ stufe: string; ok: boolean; erstellt: string }>('dreh_wetter', {
          filter: { dreh_id: d.id },
          sortierung: 'erstellt',
          limit: 10,
        });
        return { dreh: d, ...b, verlauf };
      }),
    );
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => ({ drehs: await uebersicht(), stufen: STUFEN }));
  }

  const jobs: JobDef[] = [
    { id: 'pruefen', name: 'Drehs prüfen', intervallSek: 1800, startVerzoegerungSek: 150, lauf: pruefen },
  ];

  async function kachel(): Promise<Kachel> {
    const l = await uebersicht(false);
    const gef = l.filter((x) => !x.urteil.ok);
    return {
      status: (gef.length ? 'warnung' : 'ok') as Ampel,
      titel: 'Dreh Wetter',
      wert: gef.length ? String(gef.length) : String(l.length),
      einheit: gef.length ? 'gefährdet' : 'Drehs',
      unter: gef.length
        ? 'Ausweichtermine auf der Seite'
        : l.length
          ? 'Wetter passt für alle Drehs'
          : 'keine Drehs in den nächsten 8 Tagen',
      zeilen: l.slice(0, 3).map((x) => ({
        text: x.dreh.titel,
        wert: x.urteil.unbekannt ? 'noch keine Prognose' : x.urteil.ok ? 'ok' : x.urteil.gruende[0],
        status: (x.urteil.unbekannt ? 'neutral' : x.urteil.ok ? 'ok' : 'warnung') as Ampel,
      })),
      demo: konfig.demo,
    };
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    // Markiert gefährdete Drehs in der Timeline (ohne Ausweichtermine, sonst fragt sich die Timeline selbst ab)
    const l = await uebersicht(false);
    return l
      .filter(
        (x) =>
          !x.urteil.ok && x.dreh.termin && new Date(x.dreh.termin) >= von && new Date(x.dreh.termin) <= bis,
      )
      .map((x) => ({
        id: `drehwetter-${x.dreh.id}`,
        modul: 'drehwetter',
        art: 'Dreh gefährdet',
        titel: `${x.dreh.titel}: ${x.urteil.gruende.join(', ')}`,
        start: x.dreh.termin!,
        link: '/modul/drehwetter',
        status: 'warnung' as Ampel,
      }));
  }

  return { routen, jobs, kachel, timeline };
}
