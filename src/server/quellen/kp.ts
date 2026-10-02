// KP Index (geomagnetische Aktivität) von NOAA SWPC. Gemeinfrei (US Regierung).
import { httpJson } from './http.ts';

export interface KpWert {
  zeit: string;
  kp: number;
  beobachtet: boolean;
}

/** Liest beide bekannten Formate: Liste von Objekten oder Tabelle mit Kopfzeile */
export function kpParsen(d: unknown): KpWert[] {
  if (!Array.isArray(d)) return [];
  if (Array.isArray(d[0])) {
    const [kopf, ...zeilen] = d as unknown[][];
    const iZeit = kopf.indexOf('time_tag');
    const iKp = kopf.findIndex((k) => String(k).toLowerCase() === 'kp');
    const iBeob = kopf.indexOf('observed');
    return zeilen
      .map((z) => ({
        zeit: `${String(z[iZeit]).replace(' ', 'T')}Z`,
        kp: Number(z[iKp]),
        beobachtet: iBeob < 0 || z[iBeob] === 'observed',
      }))
      .filter((w) => Number.isFinite(w.kp));
  }
  return (d as Record<string, unknown>[])
    .map((z) => ({
      zeit: `${String(z.time_tag).replace(' ', 'T')}Z`,
      kp: Number(z.Kp ?? z.kp),
      beobachtet: z.observed === undefined || z.observed === 'observed',
    }))
    .filter((w) => Number.isFinite(w.kp));
}

export async function kpHolen(): Promise<KpWert[]> {
  return kpParsen(
    await httpJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', {
      timeoutMs: 15000,
    }),
  );
}

/** Aktueller Wert (letzter beobachteter) und Maximum der Prognose für die nächsten Stunden */
export function kpZusammenfassen(werte: KpWert[], jetzt = new Date(), stunden = 48) {
  const beobachtet = werte.filter((w) => w.beobachtet && new Date(w.zeit) <= jetzt);
  const prognose = werte.filter((w) => {
    const t = new Date(w.zeit).getTime();
    return t > jetzt.getTime() - 3 * 3600000 && t <= jetzt.getTime() + stunden * 3600000;
  });
  return {
    aktuell: beobachtet.length ? beobachtet[beobachtet.length - 1].kp : null,
    maxPrognose: prognose.length ? Math.max(...prognose.map((w) => w.kp)) : null,
  };
}
