// Prognose für die Qualität von Sonnenauf und Sonnenuntergang (Score 0 bis 100).
// Einfache, nachvollziehbare Heuristik, dokumentiert in docs/SONNENUNTERGANG.md.
// Keine wissenschaftlich belegte Genauigkeit: Die Rückmeldungen von Jerome zeigen, wie gut sie passt.
import type { Stunde } from '../../quellen/openmeteo.ts';

export interface Gewichte {
  wolken: number;
  horizont: number;
  tief: number;
  sicht: number;
  feuchte: number;
  regen: number;
}

export const STANDARD_GEWICHTE: Gewichte = {
  wolken: 0.35,
  horizont: 0.25,
  tief: 0.15,
  sicht: 0.1,
  feuchte: 0.05,
  regen: 0.1,
};

export interface Faktor {
  name: keyof Gewichte;
  label: string;
  wert: number;
  text: string;
}

export interface SonnenPrognose {
  score: number;
  faktoren: Faktor[];
  zeit: string;
  azimut: number;
}

const grenze = (x: number) => Math.max(0, Math.min(1, x));

/**
 * @param lokal Wetter am Ort zur Stunde des Ereignisses
 * @param horizont Wetter an einem Punkt etwa 80 km in Richtung der Sonne (für den freien Horizont)
 */
export function sonnenScore(
  lokal: Stunde,
  horizont: Stunde | null,
  gewichte: Gewichte = STANDARD_GEWICHTE,
): Omit<SonnenPrognose, 'zeit' | 'azimut'> {
  const hoch = lokal.wolkenHoch ?? 0;
  const mittel = lokal.wolkenMittel ?? 0;
  const tief = lokal.wolkenTief ?? 0;
  // 1. Leinwand: hohe und mittlere Wolken färben sich. Optimum bei etwa 50 % Bedeckung.
  const leinwand = Math.min(100, hoch + 0.6 * mittel);
  const fWolken = leinwand <= 50 ? leinwand / 50 : grenze(1 - (leinwand - 50) / 60);
  // 2. Freier Horizont: tiefe Wolken in Richtung Sonne blockieren das Licht
  const tiefHorizont = horizont?.wolkenTief ?? tief;
  const fHorizont = grenze(1 - tiefHorizont / 100);
  // 3. Tiefe Wolken am Ort decken den Himmel ab
  const fTief = grenze(1 - (tief / 100) * 0.8);
  // 4. Sicht: unter 5 km schlecht, ab 30 km sehr gut
  const sichtKm = (lokal.sicht ?? 20000) / 1000;
  const fSicht = grenze((sichtKm - 5) / 25);
  // 5. Feuchte: sehr feuchte Luft macht Farben blass
  const rh = lokal.feuchte ?? 70;
  const fFeuchte = rh <= 60 ? 1 : grenze(1 - ((rh - 60) / 35) * 0.7);
  // 6. Regen zur Stunde
  const fRegen = (lokal.regen ?? 0) > 0.2 ? 0.1 : (lokal.regen ?? 0) > 0 ? 0.6 : 1;

  const faktoren: Faktor[] = [
    {
      name: 'wolken',
      label: 'Hohe und mittlere Wolken',
      wert: fWolken,
      text: `${Math.round(hoch)} % hoch, ${Math.round(mittel)} % mittel`,
    },
    {
      name: 'horizont',
      label: 'Freier Horizont Richtung Sonne',
      wert: fHorizont,
      text: `${Math.round(tiefHorizont)} % tiefe Wolken${horizont ? ' (80 km entfernt)' : ' (am Ort)'}`,
    },
    { name: 'tief', label: 'Tiefe Wolken am Ort', wert: fTief, text: `${Math.round(tief)} %` },
    { name: 'sicht', label: 'Sicht', wert: fSicht, text: `${Math.round(sichtKm)} km` },
    { name: 'feuchte', label: 'Luftfeuchte', wert: fFeuchte, text: `${Math.round(rh)} %` },
    { name: 'regen', label: 'Niederschlag', wert: fRegen, text: `${lokal.regen ?? 0} mm` },
  ];
  const summeG = faktoren.reduce((s, f) => s + Math.max(0, gewichte[f.name] ?? 0), 0) || 1;
  const score = Math.round(
    (100 * faktoren.reduce((s, f) => s + f.wert * Math.max(0, gewichte[f.name] ?? 0), 0)) / summeG,
  );
  return { score, faktoren: faktoren.map((f) => ({ ...f, wert: Math.round(f.wert * 100) / 100 })) };
}

/** Punkt in einer Richtung und Entfernung (Grosskreis) */
export function punktInRichtung(
  lat: number,
  lon: number,
  azimutGrad: number,
  km: number,
): { lat: number; lon: number } {
  const r = Math.PI / 180;
  const d = km / 6371;
  const a = azimutGrad * r;
  const la1 = lat * r;
  const lo1 = lon * r;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(a));
  const lo2 =
    lo1 + Math.atan2(Math.sin(a) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: Math.round((la2 / r) * 10000) / 10000, lon: Math.round((lo2 / r) * 10000) / 10000 };
}

/** Wetterstunde, die einem Zeitpunkt am nächsten liegt */
export function naechsteStunde(stunden: Stunde[], t: number): Stunde | null {
  let beste: Stunde | null = null;
  for (const s of stunden) if (!beste || Math.abs(s.t - t) < Math.abs(beste.t - t)) beste = s;
  return beste && Math.abs(beste.t - t) <= 3600000 ? beste : null;
}

/** Vergleich Prognose gegen Bewertung (Bewertung 1 bis 5 wird auf 0 bis 100 abgebildet) */
export function vergleich(paare: { score: number; bewertung: number }[]) {
  if (!paare.length)
    return { anzahl: 0, mittlererFehler: null as number | null, korrelation: null as number | null };
  const real = paare.map((p) => (p.bewertung - 1) * 25);
  const prog = paare.map((p) => p.score);
  const fehler = paare.reduce((s, _, i) => s + Math.abs(prog[i] - real[i]), 0) / paare.length;
  let korrelation: number | null = null;
  if (paare.length >= 3) {
    const mx = prog.reduce((a, b) => a + b, 0) / prog.length;
    const my = real.reduce((a, b) => a + b, 0) / real.length;
    const cov = prog.reduce((s, x, i) => s + (x - mx) * (real[i] - my), 0);
    const vx = Math.sqrt(prog.reduce((s, x) => s + (x - mx) ** 2, 0));
    const vy = Math.sqrt(real.reduce((s, y) => s + (y - my) ** 2, 0));
    korrelation = vx && vy ? Math.round((cov / (vx * vy)) * 100) / 100 : null;
  }
  return { anzahl: paare.length, mittlererFehler: Math.round(fehler), korrelation };
}
