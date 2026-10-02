// Modul Parkplätze: freie Plätze der Parkhäuser in St. Gallen (Open Data der Stadt, Echtzeit),
// Verlauf speichern und typische Belegung nach Wochentag und Stunde berechnen.
import type { FastifyInstance } from 'fastify';
import { verdichten } from '../../daten/verdichtung.ts';
import { tabelle } from '../../daten/schema.ts';
import type { Ampel, Ebene, GeoPunkt, Kachel, PunkteAntwort } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { lokal } from '../../kern/zeit.ts';
import { httpJson } from '../../quellen/http.ts';

export const PARK_URL =
  'https://daten.stadt.sg.ch/api/explore/v2.1/catalog/datasets/freie-parkplatze-in-der-stadt-stgallen-pls/records?limit=100';
export const PARK_NAMENSNENNUNG = 'Stadt St. Gallen, Open Data (CC BY-NC 4.0)';

export const MESSUNGEN = tabelle({
  name: 'park_messungen',
  modul: 'parken',
  label: 'Parkhaus Messungen (Rohdaten)',
  puffer: true,
  spalten: [
    { name: 'ph_id', typ: 'text' },
    { name: 'frei', typ: 'int' },
    { name: 'prozent', typ: 'real' },
    { name: 'offen', typ: 'bool' },
  ],
  indizes: [['ph_id', 'erstellt'], ['erstellt']],
});

export const STUNDEN = tabelle({
  name: 'park_stunden',
  modul: 'parken',
  label: 'Parkhaus Belegung pro Stunde',
  spalten: [
    { name: 'zeit', typ: 'zeit' },
    { name: 'ph_id', typ: 'text' },
    { name: 'anzahl', typ: 'int' },
    { name: 'prozent', typ: 'real' },
    { name: 'frei', typ: 'real' },
  ],
  indizes: [['ph_id', 'zeit'], ['zeit']],
});

export interface Parkhaus {
  id: string;
  name: string;
  offen: boolean;
  total: number | null;
  frei: number | null;
  prozent: number | null;
  lat: number | null;
  lon: number | null;
  stand: string | null;
}

interface Roh {
  ph_id?: string | number;
  ph_name?: string;
  ph_status?: string;
  anzahl_parkplatze?: number | null;
  frei?: number | null;
  besetzt?: number | null;
  besetzt_prozent?: number | null;
  koordinaten?: { lat: number; lon: number } | null;
  letzte_aktualisierung?: string | null;
}

export function parkhaeuserParsen(j: { results?: Roh[] }): Parkhaus[] {
  return (j.results ?? [])
    .filter((r) => r.ph_id !== undefined && r.ph_name)
    .map((r) => {
      const total = typeof r.anzahl_parkplatze === 'number' ? r.anzahl_parkplatze : null;
      const frei = typeof r.frei === 'number' ? r.frei : null;
      let prozent = typeof r.besetzt_prozent === 'number' ? r.besetzt_prozent : null;
      if (prozent === null && total && frei !== null) prozent = Math.round((100 * (total - frei)) / total);
      return {
        id: String(r.ph_id),
        name: String(r.ph_name),
        offen: (r.ph_status ?? '').toLowerCase() === 'offen',
        total,
        frei,
        prozent,
        lat: r.koordinaten?.lat ?? null,
        lon: r.koordinaten?.lon ?? null,
        stand: r.letzte_aktualisierung ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
}

/** Typische Belegung: Median der Stundenwerte je Wochentag (0 = Montag) und Stunde (lokal) */
export function typischeBelegung(werte: { zeit: string; prozent: number | null }[]): (number | null)[][] {
  const eimer: number[][][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => [] as number[]),
  );
  for (const w of werte) {
    if (w.prozent === null || !Number.isFinite(w.prozent)) continue;
    const l = lokal(new Date(w.zeit));
    eimer[(l.wochentag + 6) % 7][l.stunde].push(w.prozent);
  }
  return eimer.map((tag) =>
    tag.map((l) => {
      if (!l.length) return null;
      const s = [...l].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
    }),
  );
}

export const farbeFuer = (p: number | null, offen = true) =>
  !offen || p === null ? '#64748b' : p >= 95 ? '#f87171' : p >= 80 ? '#fbbf24' : '#34d399';

/** Demo: plausible Belegung nach Tageszeit */
export function demoParkhaeuser(jetzt: Date): Parkhaus[] {
  const l = lokal(jetzt);
  const h = l.stunde + l.minute / 60;
  const kurve = Math.max(
    0.08,
    Math.exp(-((h - 11) ** 2) / 10) * 0.75 + Math.exp(-((h - 16.5) ** 2) / 6) * 0.7,
  );
  const samstag = l.wochentag === 6 ? 1.15 : 1;
  const basis: [string, string, number, number, number][] = [
    ['10', 'Parkgarage Brühltor (Demo)', 260, 47.4245, 9.3801],
    ['11', 'Parkgarage Neumarkt (Demo)', 170, 47.4267, 9.3719],
    ['12', 'Parkgarage Rathaus (Demo)', 320, 47.4232, 9.3698],
    ['13', 'Parkgarage Oberer Graben (Demo)', 120, 47.4262, 9.3742],
    ['14', 'Parkhaus Spisertor (Demo)', 200, 47.4228, 9.3818],
    ['15', 'Parkgarage Olma (Demo)', 610, 47.4294, 9.3852],
  ];
  return basis.map(([id, name, total, lat, lon], i) => {
    const p = Math.min(100, Math.round(kurve * samstag * (0.75 + i * 0.07) * 100));
    return {
      id,
      name,
      offen: true,
      total,
      frei: Math.round((total * (100 - p)) / 100),
      prozent: p,
      lat,
      lon,
      stand: jetzt.toISOString(),
    };
  });
}

export const parken: ModulDef = {
  id: 'parken',
  name: 'Parkplätze',
  beschreibung: 'Freie Plätze in den Parkhäusern der Stadt St. Gallen, Verlauf und typische Belegung',
  symbol: 'parken',
  reihenfolge: 58,
  tabellen: [MESSUNGEN, STUNDEN],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;

  const quelle = ctx.quelle<void, Parkhaus[]>({
    id: 'parken.sg',
    name: 'Parkleitsystem St. Gallen',
    modul: 'parken',
    ttlSek: 240,
    abruf: async () => parkhaeuserParsen(await httpJson<{ results?: Roh[] }>(PARK_URL, { timeoutMs: 12000 })),
    demo: () => demoParkhaeuser(ctx.jetzt()),
    namensnennung: PARK_NAMENSNENNUNG,
    beschreibung: 'Opendatasoft Schnittstelle der Stadt St. Gallen, Lizenz CC BY-NC (private Nutzung).',
    testParameter: () => undefined,
  });

  async function verlaufFuer(id: string, tage: number) {
    const ab = new Date(ctx.jetzt().getTime() - tage * 86400000).toISOString();
    const stunden = await daten.liste<{ zeit: string; prozent: number | null }>('park_stunden', {
      filter: { ph_id: id, zeit: { gte: ab } },
      sortierung: 'zeit',
      limit: 20000,
    });
    const roh = await daten.liste<{ erstellt: string; prozent: number | null }>('park_messungen', {
      filter: { ph_id: id, erstellt: { gte: ab } },
      sortierung: 'erstellt',
      limit: 20000,
    });
    return [...stunden, ...roh.map((r) => ({ zeit: r.erstellt, prozent: r.prozent }))];
  }

  /** Demo: synthetischer Verlauf über vier Wochen, damit Verlauf und Muster sichtbar sind */
  function demoVerlauf(id: string): { zeit: string; prozent: number | null }[] {
    const aus: { zeit: string; prozent: number | null }[] = [];
    const jetzt = ctx.jetzt().getTime();
    for (let t = jetzt - 28 * 86400000; t <= jetzt; t += 3600000) {
      const ph = demoParkhaeuser(new Date(t)).find((p) => p.id === id);
      const rauschen = Math.sin(t / 7200000 + Number(id)) * 4;
      aus.push({
        zeit: new Date(t).toISOString(),
        prozent:
          ph?.prozent !== null && ph ? Math.max(0, Math.min(100, Math.round(ph.prozent! + rauschen))) : null,
      });
    }
    return aus;
  }

  async function routen(app: FastifyInstance) {
    app.get('/liste', async () => {
      const r = await quelle.hole();
      return {
        parkhaeuser: r.daten ?? [],
        stand: r.stand,
        demo: r.demo,
        fehler: r.fehler,
        namensnennung: PARK_NAMENSNENNUNG,
      };
    });
    app.get<{ Params: { id: string } }>('/parkhaus/:id', async (req) => {
      const id = String(req.params.id).slice(0, 20);
      const werte = konfig.demo ? demoVerlauf(id) : await verlaufFuer(id, 56);
      const woche = new Date(ctx.jetzt().getTime() - 7 * 86400000).getTime();
      return {
        verlauf: werte.filter((w) => new Date(w.zeit).getTime() >= woche),
        typisch: typischeBelegung(werte),
        tageMitDaten: new Set(werte.map((w) => w.zeit.slice(0, 10))).size,
      };
    });
    app.get('/punkte', async (): Promise<PunkteAntwort> => {
      const r = await quelle.hole();
      const punkte: GeoPunkt[] = (r.daten ?? [])
        .filter((p) => p.lat !== null && p.lon !== null)
        .map((p) => ({
          id: `park-${p.id}`,
          lat: p.lat!,
          lon: p.lon!,
          titel: p.name,
          text: p.offen
            ? `${p.frei ?? '?'} frei von ${p.total ?? '?'} (${p.prozent ?? '?'} % belegt)`
            : 'geschlossen',
          symbol: 'parken',
          farbe: farbeFuer(p.prozent, p.offen),
        }));
      return { punkte, stand: r.stand, demo: r.demo, fehler: r.fehler };
    });
  }

  const jobs: JobDef[] = [
    {
      id: 'messen',
      name: 'Belegung speichern',
      intervallSek: 600,
      startVerzoegerungSek: 50,
      lauf: async () => {
        if (konfig.demo) return undefined;
        const r = await quelle.hole(undefined, true);
        if (!r.daten?.length) return r.fehler ?? 'keine Daten';
        await daten.einfuegen(
          'park_messungen',
          r.daten.map((p) => ({ ph_id: p.id, frei: p.frei, prozent: p.prozent, offen: p.offen })),
        );
        await ctx.metrik({
          id: 'parken.frei',
          name: 'Freie Parkplätze St. Gallen',
          einheit: 'Plätze',
          minAbweichung: 150,
          minDauerMin: 30,
        })(r.daten.filter((p) => p.offen).reduce((s, p) => s + (p.frei ?? 0), 0));
        return `${r.daten.length} Parkhäuser`;
      },
    },
    {
      id: 'verdichtung',
      name: 'Verlauf verdichten',
      taeglich: '03:55',
      lauf: async () => {
        const n = await verdichten(
          daten,
          {
            quelle: 'park_messungen',
            ziel: 'park_stunden',
            nachTagen: 14,
            intervall: 'stunde',
            gruppe: ['ph_id'],
            felder: [
              { ziel: 'prozent', art: 'mittel', feld: 'prozent' },
              { ziel: 'frei', art: 'mittel', feld: 'frei' },
            ],
          },
          ctx.jetzt(),
        );
        // Stundenwerte ein Jahr behalten
        await daten.loescheWo('park_stunden', {
          zeit: { lt: new Date(ctx.jetzt().getTime() - 400 * 86400000).toISOString() },
        });
        return `${n} Messungen verdichtet`;
      },
    },
  ];

  const ebenen = (): Ebene[] => [
    {
      id: 'parken.sg',
      name: 'Parkhäuser St. Gallen',
      gruppe: 'Mobilität',
      modul: 'parken',
      art: 'punkte',
      datenUrl: '/api/m/parken/punkte',
      aktualisierenSek: 300,
      standardAn: true,
      namensnennung: PARK_NAMENSNENNUNG,
    },
  ];

  async function kachel(): Promise<Kachel> {
    const r = await quelle.hole();
    const l = (r.daten ?? []).filter((p) => p.offen);
    if (!l.length)
      return {
        status: r.fehler ? 'warnung' : 'neutral',
        titel: 'Parkplätze',
        wert: '–',
        unter: r.fehler ?? 'keine Daten',
        demo: r.demo,
      };
    const frei = l.reduce((s, p) => s + (p.frei ?? 0), 0);
    const voll = l.filter((p) => (p.prozent ?? 0) >= 95).length;
    return {
      status: (voll ? 'warnung' : 'ok') as Ampel,
      titel: 'Parkplätze',
      wert: String(frei),
      einheit: 'frei',
      unter: `in ${l.length} Parkhäusern St. Gallen`,
      zeilen: [...l]
        .sort((a, b) => (b.frei ?? 0) - (a.frei ?? 0))
        .slice(0, 3)
        .map((p) => ({
          text: p.name,
          wert: `${p.frei} frei`,
          status: ((p.prozent ?? 0) >= 80 ? 'warnung' : 'ok') as Ampel,
        })),
      demo: r.demo,
    };
  }

  return { routen, jobs, ebenen, kachel };
}
