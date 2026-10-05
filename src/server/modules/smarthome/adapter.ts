// Adapter für schaltbare Geräte im lokalen Netz. Jede Marke ist ein Adapter mit derselben Schnittstelle,
// damit die Steckdosen später ohne Umbau getauscht oder ergänzt werden können.
import { httpJson, httpText } from '../../quellen/http.ts';

export const ADAPTER = ['virtuell', 'shelly1', 'shelly2', 'tasmota', 'http'] as const;
export type AdapterId = (typeof ADAPTER)[number];

export const ADAPTER_NAMEN: Record<AdapterId, string> = {
  virtuell: 'Virtuell (zum Ausprobieren)',
  shelly1: 'Shelly Gen 1',
  shelly2: 'Shelly Plus und Gen 2 bis 4',
  tasmota: 'Tasmota',
  http: 'Eigene HTTP Adressen',
};

export interface Geraet {
  id: string;
  name: string;
  adapter: AdapterId;
  adresse: string | null;
  kanal: number | null;
  an_url: string | null;
  aus_url: string | null;
  status_url: string | null;
  status_feld: string | null;
}

export interface Zustand {
  an: boolean | null;
  /** Momentane Leistung in Watt, falls das Gerät misst */
  leistungW: number | null;
}

interface Adapter {
  status(g: Geraet): Promise<Zustand>;
  schalten(g: Geraet, an: boolean): Promise<Zustand>;
}

const TIMEOUT = { timeoutMs: 4000 };

/** Nur Hostname oder IP mit optionalem Port, kein Pfad und kein Schema */
export function adresseOk(a: string | null | undefined): a is string {
  return !!a && /^[a-zA-Z0-9.-]{1,253}(:\d{1,5})?$/.test(a);
}

/** Eigene Adressen müssen http oder https sein */
export function urlOk(u: string | null | undefined): u is string {
  if (!u) return false;
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch {
    return false;
  }
}

function basis(g: Geraet) {
  if (!adresseOk(g.adresse)) throw new Error('Adresse fehlt oder ist ungültig (nur IP oder Hostname)');
  return `http://${g.adresse}`;
}

const zahl = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** Wert aus einem JSON über einen Pfad wie «relays.0.ison» */
export function feldLesen(obj: unknown, pfad: string): unknown {
  return pfad
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );
}

/** Deutet verschiedene Schreibweisen von «an» */
export function istAn(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['on', 'an', 'true', '1', 'ein'].includes(s)) return true;
    if (['off', 'aus', 'false', '0'].includes(s)) return false;
  }
  return null;
}

// Virtuelle Geräte: Zustand nur im Speicher, für Demo und zum Ausprobieren von Zeitplänen und Szenen
const virtuell = new Map<string, boolean>();
export function virtuellerZustand(id: string): Zustand {
  return { an: virtuell.get(id) ?? false, leistungW: virtuell.get(id) ? 12 : 0 };
}

const ADAPTER_IMPL: Record<AdapterId, Adapter> = {
  virtuell: {
    status: async (g) => virtuellerZustand(g.id),
    schalten: async (g, an) => {
      virtuell.set(g.id, an);
      return virtuellerZustand(g.id);
    },
  },
  // Shelly Gen 1: /status liefert relays und meters
  shelly1: {
    status: async (g) => {
      const k = g.kanal ?? 0;
      const d = await httpJson<{ relays?: { ison: boolean }[]; meters?: { power?: number }[] }>(
        `${basis(g)}/status`,
        TIMEOUT,
      );
      return { an: d.relays?.[k]?.ison ?? null, leistungW: zahl(d.meters?.[k]?.power) };
    },
    schalten: async (g, an) => {
      const d = await httpJson<{ ison: boolean }>(
        `${basis(g)}/relay/${g.kanal ?? 0}?turn=${an ? 'on' : 'off'}`,
        TIMEOUT,
      );
      return { an: d.ison, leistungW: null };
    },
  },
  // Shelly Plus, Pro und neuere: RPC Schnittstelle
  shelly2: {
    status: async (g) => {
      const d = await httpJson<{ output?: boolean; apower?: number }>(
        `${basis(g)}/rpc/Switch.GetStatus?id=${g.kanal ?? 0}`,
        TIMEOUT,
      );
      return { an: d.output ?? null, leistungW: zahl(d.apower) };
    },
    schalten: async (g, an) => {
      await httpJson(`${basis(g)}/rpc/Switch.Set?id=${g.kanal ?? 0}&on=${an}`, TIMEOUT);
      return ADAPTER_IMPL.shelly2.status(g);
    },
  },
  // Tasmota: Befehle über /cm?cmnd=
  tasmota: {
    status: async (g) => {
      const n = (g.kanal ?? 0) + 1;
      const d = await httpJson<Record<string, unknown>>(`${basis(g)}/cm?cmnd=Power${n}`, TIMEOUT);
      const an = istAn(d[`POWER${n}`] ?? d.POWER);
      let leistungW: number | null = null;
      try {
        const e = await httpJson<{ StatusSNS?: { ENERGY?: { Power?: number | number[] } } }>(
          `${basis(g)}/cm?cmnd=Status%208`,
          TIMEOUT,
        );
        const p = e.StatusSNS?.ENERGY?.Power;
        leistungW = zahl(Array.isArray(p) ? p[g.kanal ?? 0] : p);
      } catch {
        // Ohne Messung ist das kein Fehler
      }
      return { an, leistungW };
    },
    schalten: async (g, an) => {
      const n = (g.kanal ?? 0) + 1;
      const d = await httpJson<Record<string, unknown>>(
        `${basis(g)}/cm?cmnd=Power${n}%20${an ? 'On' : 'Off'}`,
        TIMEOUT,
      );
      return { an: istAn(d[`POWER${n}`] ?? d.POWER), leistungW: null };
    },
  },
  // Eigene Adressen, z.B. für Geräte mit lokaler HTTP Schnittstelle
  http: {
    status: async (g) => {
      if (!urlOk(g.status_url)) return { an: null, leistungW: null };
      const t = await httpText(g.status_url, TIMEOUT);
      let d: unknown = t;
      try {
        d = JSON.parse(t);
      } catch {
        // Auch reiner Text wie «ON» ist erlaubt
      }
      return { an: istAn(g.status_feld ? feldLesen(d, g.status_feld) : d), leistungW: null };
    },
    schalten: async (g, an) => {
      const url = an ? g.an_url : g.aus_url;
      if (!urlOk(url)) throw new Error(`Adresse für «${an ? 'an' : 'aus'}» fehlt`);
      await httpText(url, TIMEOUT);
      return urlOk(g.status_url) ? ADAPTER_IMPL.http.status(g) : { an, leistungW: null };
    },
  },
};

export function adapter(g: Geraet): Adapter {
  return ADAPTER_IMPL[g.adapter] ?? ADAPTER_IMPL.virtuell;
}
