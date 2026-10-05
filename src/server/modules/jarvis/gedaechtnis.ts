// Zweites Gehirn: Jarvis merkt sich Dinge dauerhaft in der Datenbank, unabhängig vom Modellanbieter.
// Ohne Embeddings (spart RAM): Wortsuche mit Gewichtung, dazu ein Profil der wichtigsten Erinnerungen im Prompt.
import { tabelle, type Zeile } from '../../daten/schema.ts';
import type { Daten } from '../../daten/index.ts';

export const KATEGORIEN = ['person', 'vorliebe', 'fakt', 'ziel', 'projekt', 'gewohnheit', 'regel'];
export const QUELLEN = ['jarvis', 'du', 'rueckschau'];

export const GEDAECHTNIS = tabelle({
  name: 'jarvis_gedaechtnis',
  modul: 'jarvis',
  label: 'Gedächtnis',
  bearbeitbar: true,
  anzeige: 'inhalt',
  suche: ['inhalt'],
  spalten: [
    { name: 'kategorie', typ: 'text', label: 'Art', optionen: KATEGORIEN, standard: 'fakt', pflicht: true },
    { name: 'inhalt', typ: 'text', label: 'Erinnerung', lang: true, pflicht: true, max: 1000 },
    { name: 'wichtigkeit', typ: 'int', label: 'Wichtigkeit (1 bis 5)', min: 1, max: 5, standard: 3 },
    { name: 'quelle', typ: 'text', label: 'Herkunft', optionen: QUELLEN, standard: 'du' },
  ],
  indizes: [['wichtigkeit']],
});

export const GESPRAECHE = tabelle({
  name: 'jarvis_gespraeche',
  modul: 'jarvis',
  label: 'Jarvis Gespräche',
  spalten: [{ name: 'titel', typ: 'text', label: 'Titel', max: 120 }],
});

export const NACHRICHTEN = tabelle({
  name: 'jarvis_nachrichten',
  modul: 'jarvis',
  label: 'Jarvis Nachrichten',
  spalten: [
    { name: 'gespraech_id', typ: 'text', label: 'Gespräch', pflicht: true, verweis: 'jarvis_gespraeche' },
    { name: 'rolle', typ: 'text', label: 'Rolle', pflicht: true, optionen: ['user', 'assistant'] },
    { name: 'inhalt', typ: 'json', label: 'Inhalt', pflicht: true },
  ],
  indizes: [['gespraech_id', 'erstellt']],
});

export const NUTZUNG = tabelle({
  name: 'jarvis_nutzung',
  modul: 'jarvis',
  label: 'Jarvis Nutzung',
  spalten: [
    { name: 'modell', typ: 'text', label: 'Modell' },
    { name: 'tokens_ein', typ: 'int', label: 'Tokens ein', standard: 0 },
    { name: 'tokens_aus', typ: 'int', label: 'Tokens aus', standard: 0 },
  ],
  indizes: [['erstellt']],
});

export interface Erinnerung extends Zeile {
  kategorie: string;
  inhalt: string;
  wichtigkeit: number;
  quelle: string;
}

const STOPP = new Set(
  'der die das den dem des ein eine einen einem und oder aber ist sind war hat habe mit von zu zum zur im in am an auf für fuer ich du er sie es wir mein meine meinen dein was wie wo wer wann nicht auch noch schon mal dass'.split(
    ' ',
  ),
);

export function woerter(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-zäöüéèàß0-9]+/)
        .filter((w) => w.length >= 3 && !STOPP.has(w)),
    ),
  ].slice(0, 8);
}

export class Gedaechtnis {
  private daten: Daten;
  constructor(daten: Daten) {
    this.daten = daten;
  }

  /** Neue Erinnerung speichern. Mit `ersetzt` wird eine überholte Erinnerung ersetzt. */
  async merken(
    kategorie: string,
    inhalt: string,
    wichtigkeit = 3,
    quelle = 'jarvis',
    ersetzt?: string,
  ): Promise<Erinnerung> {
    const text = inhalt.trim().slice(0, 1000);
    if (!text) throw new Error('Inhalt fehlt');
    const kat = KATEGORIEN.includes(kategorie) ? kategorie : 'fakt';
    const w = Math.min(5, Math.max(1, Math.round(wichtigkeit) || 3));
    if (ersetzt) {
      const alt = await this.daten.hole<Erinnerung>('jarvis_gedaechtnis', ersetzt);
      if (alt) {
        const neu = await this.daten.aendern<Erinnerung>('jarvis_gedaechtnis', ersetzt, {
          kategorie: kat,
          inhalt: text,
          wichtigkeit: w,
          quelle,
        });
        if (neu) return neu;
      }
    }
    // Doppelte vermeiden: gleicher Text wird nur aufgewertet
    const [gleich] = await this.daten.liste<Erinnerung>('jarvis_gedaechtnis', {
      filter: { inhalt: text },
      limit: 1,
    });
    if (gleich) {
      const neu = await this.daten.aendern<Erinnerung>('jarvis_gedaechtnis', gleich.id, {
        wichtigkeit: Math.max(gleich.wichtigkeit, w),
      });
      return neu ?? gleich;
    }
    return this.daten.eins<Erinnerung>('jarvis_gedaechtnis', {
      kategorie: kat,
      inhalt: text,
      wichtigkeit: w,
      quelle,
    });
  }

  async suchen(frage: string, limit = 8): Promise<Erinnerung[]> {
    const ws = woerter(frage);
    if (!ws.length) return this.profil(limit);
    const alle = new Map<string, { e: Erinnerung; punkte: number }>();
    for (const wort of ws) {
      const treffer = await this.daten.liste<Erinnerung>('jarvis_gedaechtnis', {
        filter: { inhalt: { like: `%${wort}%` } },
        limit: 40,
      });
      for (const e of treffer) {
        const e0 = alle.get(e.id) ?? { e, punkte: 0 };
        e0.punkte += 1;
        alle.set(e.id, e0);
      }
    }
    return [...alle.values()]
      .sort((a, b) => b.punkte * 2 + b.e.wichtigkeit - (a.punkte * 2 + a.e.wichtigkeit))
      .slice(0, limit)
      .map((x) => x.e);
  }

  /** Die wichtigsten Erinnerungen, zuerst die wichtigsten, dann die neuesten. */
  async profil(limit = 40): Promise<Erinnerung[]> {
    return this.daten.liste<Erinnerung>('jarvis_gedaechtnis', {
      sortierung: '-wichtigkeit,-erstellt',
      limit,
    });
  }

  async profilText(limit = 40): Promise<string> {
    const p = await this.profil(limit);
    if (!p.length) return 'Noch keine Erinnerungen. Lerne Jerome im Gespräch kennen und merke dir Wichtiges.';
    return p.map((e) => `- [${e.id.slice(0, 8)}] (${e.kategorie}) ${e.inhalt}`).join('\n');
  }

  async vergessen(idOderStart: string): Promise<boolean> {
    let id = idOderStart;
    if (id.length < 30) {
      const treffer = (await this.profil(500)).filter((e) => e.id.startsWith(id));
      if (treffer.length !== 1) return false;
      id = treffer[0].id;
    }
    return this.daten.loeschen('jarvis_gedaechtnis', id).then(() => true);
  }

  anzahl() {
    return this.daten.anzahl('jarvis_gedaechtnis');
  }
}
