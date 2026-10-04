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
