// Open-Meteo Wettervorhersage (frei, ohne Schlüssel, CC BY 4.0). Dokumentation: https://open-meteo.com/en/docs
import { httpJson } from './http.ts';

export const OPENMETEO_NAMENSNENNUNG = 'Wetterdaten: Open-Meteo.com (CC BY 4.0)';

export interface Stunde {
  t: number;
  temp: number | null;
  regen: number | null;
  regenWahrsch: number | null;
  code: number | null;
  wind10: number | null;
  wind80: number | null;
  wind120: number | null;
  boeen: number | null;
  richtung: number | null;
  wolken: number | null;
  wolkenTief: number | null;
  wolkenMittel: number | null;
  wolkenHoch: number | null;
  sicht: number | null;
  feuchte: number | null;
  tag: boolean;
}

export interface Tag {
  datum: string;
  code: number | null;
  tmax: number | null;
  tmin: number | null;
  regen: number | null;
  regenWahrsch: number | null;
  sonnenaufgang: number | null;
  sonnenuntergang: number | null;
  boeenMax: number | null;
}

export interface Vorhersage {
  lat: number;
  lon: number;
  hoehe: number | null;
  aktuell: {
    t: number;
    temp: number | null;
    gefuehlt: number | null;
    code: number | null;
    wind: number | null;
    boeen: number | null;
    richtung: number | null;
    regen: number | null;
    feuchte: number | null;
    tag: boolean;
  } | null;
  stunden: Stunde[];
  tage: Tag[];
}

const STUNDEN_FELDER = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'weather_code',
  'wind_speed_10m',
  'wind_speed_80m',
  'wind_speed_120m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'visibility',
  'relative_humidity_2m',
  'is_day',
];

export function openMeteoUrl(lat: number, lon: number, tage = 7): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,is_day,relative_humidity_2m',
    hourly: STUNDEN_FELDER.join(','),
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_gusts_10m_max',
    timezone: 'Europe/Zurich',
    forecast_days: String(tage),
    wind_speed_unit: 'kmh',
    timeformat: 'unixtime',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

type Roh = {
  latitude: number;
  longitude: number;
  elevation?: number;
  current?: Record<string, number>;
  hourly?: Record<string, (number | null)[]>;
  daily?: Record<string, (number | null)[]>;
};

export function openMeteoParsen(d: Roh): Vorhersage {
  const h = d.hourly ?? {};
  const w = (feld: string, i: number) => (h[feld]?.[i] ?? null) as number | null;
  const stunden: Stunde[] = (h.time ?? []).map((t, i) => ({
    t: Number(t) * 1000,
    temp: w('temperature_2m', i),
    regen: w('precipitation', i),
    regenWahrsch: w('precipitation_probability', i),
    code: w('weather_code', i),
    wind10: w('wind_speed_10m', i),
    wind80: w('wind_speed_80m', i),
    wind120: w('wind_speed_120m', i),
    boeen: w('wind_gusts_10m', i),
    richtung: w('wind_direction_10m', i),
    wolken: w('cloud_cover', i),
    wolkenTief: w('cloud_cover_low', i),
    wolkenMittel: w('cloud_cover_mid', i),
    wolkenHoch: w('cloud_cover_high', i),
    sicht: w('visibility', i),
    feuchte: w('relative_humidity_2m', i),
    tag: w('is_day', i) === 1,
  }));
  const dd = d.daily ?? {};
  const v = (feld: string, i: number) => (dd[feld]?.[i] ?? null) as number | null;
  // Tagesdatum: unixtime des Tagesbeginns in Europe/Zurich, mit Datum in Schweizer Zeit
  const tage: Tag[] = (dd.time ?? []).map((t, i) => ({
    datum: new Date(Number(t) * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }),
    code: v('weather_code', i),
    tmax: v('temperature_2m_max', i),
    tmin: v('temperature_2m_min', i),
    regen: v('precipitation_sum', i),
    regenWahrsch: v('precipitation_probability_max', i),
    sonnenaufgang: v('sunrise', i) !== null ? (v('sunrise', i) as number) * 1000 : null,
    sonnenuntergang: v('sunset', i) !== null ? (v('sunset', i) as number) * 1000 : null,
    boeenMax: v('wind_gusts_10m_max', i),
  }));
  const c = d.current;
  return {
    lat: d.latitude,
    lon: d.longitude,
    hoehe: d.elevation ?? null,
    aktuell: c
      ? {
          t: c.time * 1000,
          temp: c.temperature_2m ?? null,
          gefuehlt: c.apparent_temperature ?? null,
          code: c.weather_code ?? null,
          wind: c.wind_speed_10m ?? null,
          boeen: c.wind_gusts_10m ?? null,
          richtung: c.wind_direction_10m ?? null,
          regen: c.precipitation ?? null,
          feuchte: c.relative_humidity_2m ?? null,
          tag: c.is_day === 1,
        }
      : null,
    stunden,
    tage,
  };
}

export async function vorhersageHolen(lat: number, lon: number): Promise<Vorhersage> {
  return openMeteoParsen(await httpJson<Roh>(openMeteoUrl(lat, lon), { timeoutMs: 15000, abstandMs: 500 }));
}

export { himmelsrichtung, wetterSymbol, wetterText } from '../geteilt/wetter.ts';
