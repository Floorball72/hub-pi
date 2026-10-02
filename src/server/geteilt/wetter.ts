// Wettertexte und Symbole (geteilt mit dem Frontend, ohne Node Abhängigkeiten).

/** WMO Wettercodes laut Open-Meteo Dokumentation */
export function wetterText(code: number | null): string {
  if (code === null) return 'unbekannt';
  const t: Record<number, string> = {
    0: 'klar',
    1: 'überwiegend klar',
    2: 'teilweise bewölkt',
    3: 'bedeckt',
    45: 'Nebel',
    48: 'Raureifnebel',
    51: 'leichter Niesel',
    53: 'Niesel',
    55: 'starker Niesel',
    56: 'gefrierender Niesel',
    57: 'starker gefrierender Niesel',
    61: 'leichter Regen',
    63: 'Regen',
    65: 'starker Regen',
    66: 'gefrierender Regen',
    67: 'starker gefrierender Regen',
    71: 'leichter Schneefall',
    73: 'Schneefall',
    75: 'starker Schneefall',
    77: 'Schneegriesel',
    80: 'leichte Regenschauer',
    81: 'Regenschauer',
    82: 'heftige Regenschauer',
    85: 'Schneeschauer',
    86: 'starke Schneeschauer',
    95: 'Gewitter',
    96: 'Gewitter mit Hagel',
    99: 'Gewitter mit starkem Hagel',
  };
  return t[code] ?? `Code ${code}`;
}

/** Grobe Kategorie für Symbole */
export function wetterSymbol(code: number | null, tag = true): string {
  if (code === null) return 'unbekannt';
  if (code === 0 || code === 1) return tag ? 'sonne' : 'mond';
  if (code === 2) return tag ? 'sonne-wolke' : 'mond-wolke';
  if (code === 3) return 'wolke';
  if (code === 45 || code === 48) return 'nebel';
  if (code >= 71 && code <= 77) return 'schnee';
  if (code === 85 || code === 86) return 'schnee';
  if (code >= 95) return 'gewitter';
  return 'regen';
}

const RICHTUNGEN = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
export function himmelsrichtung(grad: number | null): string {
  if (grad === null) return '';
  return RICHTUNGEN[Math.round((((grad % 360) + 360) % 360) / 45) % 8];
}
