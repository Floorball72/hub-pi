// geo.admin.ch (swisstopo, BAZL): Luftraum Einschränkungen für Drohnen an einem Punkt.
// Nutzung der Geodienste des Bundes ist kostenlos, Quelle angeben.
import { httpJson } from './http.ts';

export const GEOADMIN_NAMENSNENNUNG = '© swisstopo, BAZL (geo.admin.ch)';

export interface DrohnenZone {
  name: string;
  einschraenkung: string;
  grund: string;
  art: string;
  hinweis: string | null;
  bewilligung: string | null;
}

interface IdentifyAntwort {
  results: { attributes: Record<string, unknown> }[];
}

export function drohnenZonenUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    geometryType: 'esriGeometryPoint',
    geometry: `${lon},${lat}`,
    sr: '4326',
    layers: 'all:ch.bazl.einschraenkungen-drohnen',
    tolerance: '0',
    mapExtent: `${lon - 0.1},${lat - 0.1},${lon + 0.1},${lat + 0.1}`,
    imageDisplay: '500,500,96',
    returnGeometry: 'false',
    lang: 'de',
  });
  return `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?${p}`;
}

export function drohnenZonenParsen(d: IdentifyAntwort): DrohnenZone[] {
  // Einzelne Felder (z.B. auth_url_de) kommen als Liste
  const text = (w: unknown): string | null => {
    const x = Array.isArray(w) ? w[0] : w;
    return x === null || x === undefined || x === '' ? null : String(x);
  };
  return (d.results ?? []).map((r) => ({
    name: text(r.attributes.zone_name_de) ?? 'Zone',
    einschraenkung: text(r.attributes.zone_restriction_de) ?? '',
    grund: text(r.attributes.zone_reason_id) ?? '',
    art: text(r.attributes.zone_restriction_id) ?? '',
    hinweis: text(r.attributes.zone_message_de),
    bewilligung: text(r.attributes.auth_url_de),
  }));
}

export async function drohnenZonen(lat: number, lon: number): Promise<DrohnenZone[]> {
  return drohnenZonenParsen(await httpJson<IdentifyAntwort>(drohnenZonenUrl(lat, lon), { timeoutMs: 12000 }));
}

export const WMTS = (layer: string, format = 'png') =>
  `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.${format}`;
export const WMS = 'https://wms.geo.admin.ch/';
