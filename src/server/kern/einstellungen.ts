// Einstellungen als Schlüssel und JSON Wert in der Datenbank, mit Zwischenspeicher im RAM.
import type { Daten } from '../daten/index.ts';
import { tabelle } from '../daten/schema.ts';

export const EINSTELLUNGEN_TABELLE = tabelle({
  name: 'einstellungen',
  modul: 'kern',
  label: 'Einstellungen',
  spalten: [{ name: 'wert', typ: 'json' }],
});

export class Einstellungen {
  private cache = new Map<string, unknown>();
  private geladen = false;

  private daten: Daten;
  constructor(daten: Daten) {
    this.daten = daten;
  }

  async laden() {
    try {
      const zeilen = await this.daten.liste<{ id: string; wert: unknown }>('einstellungen', { limit: 1000 });
      for (const z of zeilen) this.cache.set(z.id, z.wert);
      this.geladen = true;
    } catch {
      // Datenbank nicht erreichbar: mit Standardwerten weiterarbeiten
    }
  }

  hole<T>(schluessel: string, standard: T): T {
    return this.cache.has(schluessel) ? (this.cache.get(schluessel) as T) : standard;
  }

  async setze(schluessel: string, wert: unknown) {
    if (!/^[a-z0-9_.:-]{1,80}$/i.test(schluessel)) throw new Error('Ungültiger Schlüssel');
    const alt = this.cache.has(schluessel);
    this.cache.set(schluessel, wert);
    if (alt || !this.geladen) {
      const vorhanden = await this.daten.hole('einstellungen', schluessel);
      if (vorhanden) {
        await this.daten.aendern('einstellungen', schluessel, { wert });
        return;
      }
    }
    await this.daten.einfuegen('einstellungen', [{ id: schluessel, wert }]);
  }
}
