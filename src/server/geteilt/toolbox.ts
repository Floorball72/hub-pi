// Rettungs Toolbox: Rechner und Scores. Hilfsmittel, ersetzt keine Entscheidung.
// Jede Formel trägt ihre Quelle. Jerome prüft jede Formel vor dem Gebrauch (Liste in docs/STATUS.md).

export const HINWEIS = 'Hilfsmittel, ersetzt keine Entscheidung';

// Glasgow Coma Scale
// Quelle: Teasdale G, Jennett B. Assessment of coma and impaired consciousness. Lancet 1974;2:81-84.
// Bezeichnungen nach glasgowcomascale.org (Teasdale 2014).
export const GCS = {
  quelle: 'Teasdale & Jennett, Lancet 1974; glasgowcomascale.org',
  augen: [
    { wert: 4, text: 'spontan' },
    { wert: 3, text: 'auf Ansprache' },
    { wert: 2, text: 'auf Druck (Schmerz)' },
    { wert: 1, text: 'keine Reaktion' },
  ],
  verbal: [
    { wert: 5, text: 'orientiert' },
    { wert: 4, text: 'verwirrt' },
    { wert: 3, text: 'einzelne Wörter' },
    { wert: 2, text: 'Laute' },
    { wert: 1, text: 'keine Reaktion' },
  ],
  motorik: [
    { wert: 6, text: 'befolgt Aufforderungen' },
    { wert: 5, text: 'lokalisiert Schmerz' },
    { wert: 4, text: 'normale Beugung (Wegziehen)' },
    { wert: 3, text: 'abnormale Beugung' },
    { wert: 2, text: 'Streckung' },
    { wert: 1, text: 'keine Reaktion' },
  ],
};

export function gcs(augen: number, verbal: number, motorik: number) {
  const summe = augen + verbal + motorik;
  // Einteilung des Schädelhirntraumas nach GCS (verbreitete Konvention)
  const einteilung =
    summe >= 13 ? 'leicht (13 bis 15)' : summe >= 9 ? 'mittel (9 bis 12)' : 'schwer (3 bis 8)';
  return { summe, einteilung, text: `GCS ${summe} (A${augen} V${verbal} M${motorik})` };
}

// NEWS2 (National Early Warning Score 2)
// Quelle: Royal College of Physicians. National Early Warning Score (NEWS) 2. London: RCP, 2017.
export interface News2Eingabe {
  atemfrequenz: number;
  spo2: number;
  /** Skala 2 nur bei ärztlich festgelegtem Zielbereich 88 bis 92 % (hyperkapnisches Atemversagen) */
  skala2: boolean;
  sauerstoff: boolean;
  systolisch: number;
  puls: number;
  /** Neu verwirrt, oder reagiert nur auf Ansprache, Schmerz oder gar nicht (ACVPU nicht A) */
  bewusstseinVeraendert: boolean;
  temperatur: number;
}

export function news2(e: News2Eingabe) {
  const p: Record<string, number> = {};
  const af = e.atemfrequenz;
  p.Atemfrequenz = af <= 8 ? 3 : af <= 11 ? 1 : af <= 20 ? 0 : af <= 24 ? 2 : 3;
  const s = e.spo2;
  if (!e.skala2) {
    p.SpO2 = s <= 91 ? 3 : s <= 93 ? 2 : s <= 95 ? 1 : 0;
  } else if (s <= 83) p.SpO2 = 3;
  else if (s <= 85) p.SpO2 = 2;
  else if (s <= 87) p.SpO2 = 1;
  else if (s <= 92 || !e.sauerstoff) p.SpO2 = 0;
  else p.SpO2 = s <= 94 ? 1 : s <= 96 ? 2 : 3;
  p.Sauerstoff = e.sauerstoff ? 2 : 0;
  const bd = e.systolisch;
  p.Blutdruck = bd <= 90 ? 3 : bd <= 100 ? 2 : bd <= 110 ? 1 : bd <= 219 ? 0 : 3;
  const hf = e.puls;
  p.Puls = hf <= 40 ? 3 : hf <= 50 ? 1 : hf <= 90 ? 0 : hf <= 110 ? 1 : hf <= 130 ? 2 : 3;
  p.Bewusstsein = e.bewusstseinVeraendert ? 3 : 0;
  const t = Math.round(e.temperatur * 10) / 10;
  p.Temperatur = t <= 35.0 ? 3 : t <= 36.0 ? 1 : t <= 38.0 ? 0 : t <= 39.0 ? 1 : 2;
  const summe = Object.values(p).reduce((a, b) => a + b, 0);
  const einzel3 = Object.values(p).some((x) => x === 3);
  const risiko =
    summe >= 7
      ? 'hoch'
      : summe >= 5
        ? 'mittel'
        : einzel3
          ? 'niedrig bis mittel (ein Parameter mit 3)'
          : 'niedrig';
  return { summe, punkte: p, risiko, quelle: 'Royal College of Physicians, NEWS2, 2017' };
}

// Infusion und Tropfrechner
// Tropfen pro Minute = Volumen (ml) × Tropffaktor (Tropfen pro ml) / Zeit (min)
// Standard Infusionsbesteck: 20 Tropfen = 1 ml (ISO 8536-4), Mikrotropfbesteck 60 Tropfen = 1 ml.
export function tropfen(volumenMl: number, minuten: number, tropffaktor = 20) {
  if (!(volumenMl > 0) || !(minuten > 0) || !(tropffaktor > 0)) return null;
  return {
    tropfenProMinute: Math.round(((volumenMl * tropffaktor) / minuten) * 10) / 10,
    mlProStunde: Math.round((volumenMl / minuten) * 60 * 10) / 10,
    quelle: 'Tropfformel; Tropffaktor nach ISO 8536-4 (20 Tropfen pro ml)',
  };
}

// Dosis nach Körpergewicht: Dosis (mg) = mg pro kg × Gewicht (kg); Volumen (ml) = Dosis / Konzentration (mg pro ml)
export function dosis(mgProKg: number, kg: number, mgProMl?: number) {
  if (!(mgProKg > 0) || !(kg > 0)) return null;
  const mg = Math.round(mgProKg * kg * 100) / 100;
  return {
    mg,
    ml: mgProMl && mgProMl > 0 ? Math.round((mg / mgProMl) * 100) / 100 : null,
    quelle: 'Dreisatz',
  };
}

// Sauerstoff Vorrat: Minuten = Flaschenvolumen (l) × (Druck minus Restdruck in bar) / Fluss (l/min)
export function sauerstoffMinuten(
  flascheLiter: number,
  druckBar: number,
  flussLMin: number,
  restdruckBar = 0,
) {
  if (!(flascheLiter > 0) || !(flussLMin > 0) || druckBar <= restdruckBar) return null;
  const liter = flascheLiter * (druckBar - restdruckBar);
  return {
    liter: Math.round(liter),
    minuten: Math.floor(liter / flussLMin),
    quelle: 'Boyle Mariotte Näherung: Volumen × Druck',
  };
}

// Umrechnungen mit exakten oder genormten Faktoren
export const UMRECHNUNGEN = [
  {
    id: 'c-f',
    von: '°C',
    nach: '°F',
    hin: (x: number) => (x * 9) / 5 + 32,
    zurueck: (x: number) => ((x - 32) * 5) / 9,
    quelle: 'Definition der Temperaturskalen',
  },
  {
    id: 'kg-lb',
    von: 'kg',
    nach: 'lb',
    hin: (x: number) => x / 0.45359237,
    zurueck: (x: number) => x * 0.45359237,
    quelle: '1 lb = 0,45359237 kg (exakt)',
  },
  {
    id: 'kpa-mmhg',
    von: 'kPa',
    nach: 'mmHg',
    hin: (x: number) => x / 0.133322,
    zurueck: (x: number) => x * 0.133322,
    quelle: '1 mmHg = 133,322 Pa',
  },
  {
    id: 'cm-in',
    von: 'cm',
    nach: 'inch',
    hin: (x: number) => x / 2.54,
    zurueck: (x: number) => x * 2.54,
    quelle: '1 inch = 2,54 cm (exakt)',
  },
  {
    id: 'glukose',
    von: 'mmol/l',
    nach: 'mg/dl',
    hin: (x: number) => x * 18.016,
    zurueck: (x: number) => x / 18.016,
    quelle: 'Glukose: Molmasse 180,16 g/mol',
  },
  {
    id: 'mg-ug',
    von: 'mg',
    nach: 'µg',
    hin: (x: number) => x * 1000,
    zurueck: (x: number) => x / 1000,
    quelle: 'SI Präfixe',
  },
];

export function runden(x: number, stellen = 2) {
  const f = 10 ** stellen;
  return Math.round(x * f) / f;
}
