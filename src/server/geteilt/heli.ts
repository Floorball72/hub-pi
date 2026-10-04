// Farben der Heli Betreiber, gleich auf Karte, Listen und Detailseite.
export const HELI_FARBEN: Record<string, string> = {
  Rega: '#ff5d5d',
  'Air Zermatt': '#facc15',
  'Air Glaciers': '#a78bfa',
  Polizei: '#60a5fa',
};

/** Farbe eines Betreibers: bekannte eigene Farbe, sonst orange, ohne Betreiber grau */
export function heliFarbe(organisation: string | null | undefined): string {
  if (!organisation) return '#94a3b8';
  return HELI_FARBEN[organisation] ?? '#fb923c';
}

export interface RegaBasis {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/**
 * Rega Basen (Quelle Liste: rega.ch, Illustration «Die Rega Basis»; Koordinaten: OpenStreetMap,
 * Objekte air_rescue_service, hangar und helipad, Stand Oktober 2026). Genf ist eine Partnerbasis.
 */
export const REGA_BASEN: RegaBasis[] = [
  { id: 'zuerich', name: 'Zürich', lat: 47.39606, lon: 8.63793 },
  { id: 'basel', name: 'Basel', lat: 47.60597, lon: 7.52339 },
  { id: 'bern', name: 'Bern', lat: 46.90973, lon: 7.50483 },
  { id: 'lausanne', name: 'Lausanne', lat: 46.54741, lon: 6.61819 },
  { id: 'untervaz', name: 'Untervaz', lat: 46.9131, lon: 9.55096 },
  { id: 'locarno', name: 'Locarno', lat: 46.16304, lon: 8.88105 },
  { id: 'stgallen', name: 'St. Gallen', lat: 47.40559, lon: 9.29009 },
  { id: 'erstfeld', name: 'Erstfeld', lat: 46.8342, lon: 8.63833 },
  { id: 'samedan', name: 'Samedan', lat: 46.53034, lon: 9.87845 },
  { id: 'wilderswil', name: 'Wilderswil', lat: 46.66989, lon: 7.87653 },
  { id: 'mollis', name: 'Mollis', lat: 47.07986, lon: 9.06679 },
  { id: 'zweisimmen', name: 'Zweisimmen', lat: 46.55498, lon: 7.37928 },
  { id: 'genf', name: 'Genf', lat: 46.23377, lon: 6.09669 },
];

export const basisName = (b: RegaBasis) => `Rega Basis ${b.name}`;

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Nächste Rega Basis innerhalb von maxKm, sonst null */
export function basisBei(lat: number, lon: number, maxKm: number): (RegaBasis & { km: number }) | null {
  let beste: (RegaBasis & { km: number }) | null = null;
  for (const b of REGA_BASEN) {
    const d = km(lat, lon, b.lat, b.lon);
    if (d <= maxKm && (!beste || d < beste.km)) beste = { ...b, km: d };
  }
  return beste;
}

/** Basis eines Startplatz Namens («Rega Basis Untervaz»), sonst null */
export function basisAusPlatz(platz: string | null | undefined): RegaBasis | null {
  if (!platz) return null;
  return REGA_BASEN.find((b) => basisName(b) === platz) ?? null;
}

/**
 * Startplatz eines Rega Flugs. Am Boden und tief an der Basis empfängt ADS-B oft nichts,
 * der erste Fix liegt dann einige Kilometer daneben. Liegt er nahe einer Basis, gilt diese als Start.
 * Bei einem beobachteten Start (vorher am Boden gesehen) bis 3 km, beim ersten Empfang in der Luft bis 8 km.
 */
export function startBasis(
  organisation: string | null,
  art: 'start' | 'erfasst',
  lat: number,
  lon: number,
): RegaBasis | null {
  if (organisation !== 'Rega') return null;
  return basisBei(lat, lon, art === 'start' ? 3 : 8);
}

/** Landeplatz an der Basis: Landung bis 3 km, tief verschwunden (Funkschatten) bis 5 km */
export function endeBasis(
  organisation: string | null,
  art: 'landung' | 'signalverlust',
  lat: number,
  lon: number,
): RegaBasis | null {
  if (organisation !== 'Rega') return null;
  return basisBei(lat, lon, art === 'landung' ? 3 : 5);
}
