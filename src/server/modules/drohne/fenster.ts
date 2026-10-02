// Wetterfenster: findet zusammenhängende Stunden, in denen das Mindestwetter eines Ortes erfüllt ist.
import type { Stunde } from '../../quellen/openmeteo.ts';

export interface Grenzen {
  wind_max_kmh: number | null;
  boeen_max_kmh: number | null;
  niederschlag_max_mm: number | null;
  sicht_min_m: number | null;
  temp_min: number | null;
  temp_max: number | null;
  kp_max: number | null;
  flughoehe_m: number | null;
}

export const STANDARD_GRENZEN: Grenzen = {
  wind_max_kmh: 30,
  boeen_max_kmh: 40,
  niederschlag_max_mm: 0.1,
  sicht_min_m: 5000,
  temp_min: -5,
  temp_max: 35,
  kp_max: 5,
  flughoehe_m: 120,
};

/** Wind auf Flughöhe: nächste verfügbare Messhöhe (10, 80 oder 120 m) */
export function windAufHoehe(s: Stunde, hoehe: number | null): number | null {
  const h = hoehe ?? 120;
  if (h < 45) return s.wind10;
  if (h < 100) return s.wind80 ?? s.wind10;
  return s.wind120 ?? s.wind80 ?? s.wind10;
}

export interface StundenUrteil {
  t: number;
  ok: boolean;
  gruende: string[];
}

export function stundeBewerten(s: Stunde, g: Grenzen, kp: number | null): StundenUrteil {
  const gruende: string[] = [];
  const wind = windAufHoehe(s, g.flughoehe_m);
  if (!s.tag) gruende.push('Nacht');
  if (g.wind_max_kmh !== null && wind !== null && wind > g.wind_max_kmh) gruende.push(`Wind ${wind} km/h`);
  if (g.boeen_max_kmh !== null && s.boeen !== null && s.boeen > g.boeen_max_kmh)
    gruende.push(`Böen ${s.boeen} km/h`);
  if (g.niederschlag_max_mm !== null && s.regen !== null && s.regen > g.niederschlag_max_mm)
    gruende.push(`Regen ${s.regen} mm`);
  if (g.sicht_min_m !== null && s.sicht !== null && s.sicht < g.sicht_min_m)
    gruende.push(`Sicht ${Math.round(s.sicht / 100) / 10} km`);
  if (g.temp_min !== null && s.temp !== null && s.temp < g.temp_min) gruende.push(`${s.temp} °C zu kalt`);
  if (g.temp_max !== null && s.temp !== null && s.temp > g.temp_max) gruende.push(`${s.temp} °C zu warm`);
  if (g.kp_max !== null && kp !== null && kp > g.kp_max) gruende.push(`KP ${kp}`);
  return { t: s.t, ok: gruende.length === 0, gruende };
}

export interface Fenster {
  start: number;
  ende: number;
  stunden: number;
}

/** Zusammenhängende gute Stunden ab «ab», mindestens «minStunden» lang */
export function fensterFinden(
  stunden: Stunde[],
  g: Grenzen,
  kp: number | null,
  ab: number,
  bis: number,
  minStunden = 1,
): Fenster[] {
  const aus: Fenster[] = [];
  let start: number | null = null;
  let n = 0;
  const abschliessen = (ende: number) => {
    if (start !== null && n >= minStunden) aus.push({ start, ende, stunden: n });
    start = null;
    n = 0;
  };
  for (const s of stunden) {
    if (s.t < ab - 3600000 || s.t >= bis) continue;
    if (stundeBewerten(s, g, kp).ok) {
      if (start === null) start = s.t;
      n++;
    } else abschliessen(s.t);
  }
  const letzte = stunden.filter((s) => s.t < bis).at(-1);
  abschliessen(letzte ? letzte.t + 3600000 : bis);
  return aus;
}
