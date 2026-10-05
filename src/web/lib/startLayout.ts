// Anpassbare Startseite: Reihenfolge und ausgeblendete Kacheln, pro Gerät gespeichert.

export interface StartLayout {
  /** Modul ids in gewünschter Reihenfolge. Neue Module fehlen hier und kommen hinten an. */
  reihenfolge: string[];
  /** Ausgeblendete Kacheln und Abschnitte (z.B. «abschnitt.rettung») */
  versteckt: string[];
}

export const LEERES_LAYOUT: StartLayout = { reihenfolge: [], versteckt: [] };

/** Sortiert nach der gespeicherten Reihenfolge, unbekannte behalten ihre Reihenfolge am Ende */
export function ordnen<T extends { id: string }>(liste: T[], reihenfolge: string[]): T[] {
  const pos = new Map(reihenfolge.map((id, i) => [id, i]));
  return [...liste].sort(
    (a, b) => (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Verschiebt eine id um einen Platz. Gibt die neue vollständige Reihenfolge zurück. */
export function verschieben(ids: string[], id: string, richtung: -1 | 1): string[] {
  const neu = [...ids];
  const i = neu.indexOf(id);
  const j = i + richtung;
  if (i < 0 || j < 0 || j >= neu.length) return neu;
  [neu[i], neu[j]] = [neu[j], neu[i]];
  return neu;
}

export function umschalten(versteckt: string[], id: string): string[] {
  return versteckt.includes(id) ? versteckt.filter((x) => x !== id) : [...versteckt, id];
}
