// ÖV Abfahrten über transport.opendata.ch (Daten von opentransportdata.swiss, frei nutzbar).
import { httpJson } from '../../quellen/http.ts';

export const OEV_NAMENSNENNUNG = 'Fahrplan: transport.opendata.ch (opentransportdata.swiss)';

export interface Abfahrt {
  zeit: string;
  verspaetungMin: number | null;
  gleis: string | null;
  linie: string;
  ziel: string;
  art: string;
}

export interface Abfahrtstafel {
  haltestelle: string;
  lat: number | null;
  lon: number | null;
  abfahrten: Abfahrt[];
}

type Roh = {
  station?: { name?: string; coordinate?: { x?: number | null; y?: number | null } };
  stationboard?: {
    category?: string;
    number?: string;
    to?: string;
    stop?: {
      departure?: string;
      departureTimestamp?: number;
      delay?: number | null;
      platform?: string | null;
      prognosis?: { platform?: string | null };
    };
  }[];
};

export function abfahrtenParsen(d: Roh): Abfahrtstafel {
  return {
    haltestelle: d.station?.name ?? '',
    // transport.opendata.ch: x ist die Breite, y die Länge (WGS84)
    lat: d.station?.coordinate?.x ?? null,
    lon: d.station?.coordinate?.y ?? null,
    abfahrten: (d.stationboard ?? [])
      .filter((s) => s.stop?.departureTimestamp)
      .map((s) => ({
        zeit: new Date((s.stop!.departureTimestamp as number) * 1000).toISOString(),
        verspaetungMin: s.stop?.delay ?? null,
        gleis: s.stop?.prognosis?.platform ?? s.stop?.platform ?? null,
        linie: `${s.category ?? ''}${s.number && !/^\d{5,}$/.test(s.number) ? ` ${s.number}` : ''}`.trim(),
        ziel: s.to ?? '',
        art: s.category ?? '',
      })),
  };
}

export async function abfahrtenHolen(haltestelle: string, anzahl = 8): Promise<Abfahrtstafel> {
  const url = `https://transport.opendata.ch/v1/stationboard?station=${encodeURIComponent(haltestelle)}&limit=${anzahl}`;
  return abfahrtenParsen(await httpJson<Roh>(url, { timeoutMs: 12000, abstandMs: 1000 }));
}

export function demoAbfahrten(haltestelle: string, jetzt: Date): Abfahrtstafel {
  const linien = [
    ['IR 13', 'Zürich HB', 'IR'],
    ['S 4', 'Uznach', 'S'],
    ['B 732', 'Gähwil', 'B'],
    ['S 1', 'Wil SG', 'S'],
    ['B 731', 'Bazenheid', 'B'],
  ];
  return {
    haltestelle: `${haltestelle} (Demo)`,
    lat: null,
    lon: null,
    abfahrten: Array.from({ length: 8 }, (_, i) => {
      const l = linien[i % linien.length];
      return {
        zeit: new Date(Math.ceil(jetzt.getTime() / 60000) * 60000 + (3 + i * 7) * 60000).toISOString(),
        verspaetungMin: i === 1 ? 3 : 0,
        gleis: l[2] === 'B' ? null : String((i % 3) + 1),
        linie: l[0],
        ziel: l[1],
        art: l[2],
      };
    }),
  };
}
