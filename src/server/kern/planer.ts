// Abrufplaner: entscheidet zentral, wie oft jede Quelle abgerufen wird.
// Grundtakt aus der Quelle, angepasst an die Nutzung (aktiv, ruhig, Nacht), mit Backoff nach Fehlern,
// Tagesbudget und manueller Einstellung (auto, fix, aus). Spart Daten, Strom und schont die Anbieter.
import { lokal, lokalDatum } from './zeit.ts';

export type Modus = 'auto' | 'fix' | 'aus';

export interface PlanerEinstellung {
  modus: Modus;
  /** Intervall bei «fix» */
  fixSek?: number;
  /** Höchstens so viele Abrufe pro Tag (0 = ohne Grenze) */
  budget?: number;
}

export interface PlanerQuelle {
  id: string;
  ttlSek: number;
  minSek?: number;
  maxSek?: number;
  /** Wichtig für Alarme: wird auch nachts und ohne Nutzung nur wenig gestreckt */
  wichtig?: boolean;
  tagesBudget?: number;
}

interface Zaehler {
  tag: string;
  heute: number;
  gesamt: number;
  fehlerInFolge: number;
  letzterAbruf: number;
  verweigert: number;
}

export type Nutzung = 'aktiv' | 'ruhig' | 'schlaf' | 'nacht';

export const FAKTOR: Record<Nutzung, number> = { aktiv: 1, ruhig: 1.5, schlaf: 2.5, nacht: 3 };

export class Abrufplaner {
  private zaehler = new Map<string, Zaehler>();
  /** Fehler und Pausen je Quelle und Parameter, damit eine kaputte Adresse nicht alle anderen bremst */
  private sperren = new Map<string, { fehler: number; bis: number }>();
  letzteNutzung = 0;
  private holeEinstellung: (id: string) => PlanerEinstellung | null;
  private jetzt: () => Date;
  private eingeschaltet: () => boolean;

  constructor(
    holeEinstellung: (id: string) => PlanerEinstellung | null,
    jetzt: () => Date = () => new Date(),
    eingeschaltet: () => boolean = () => true,
  ) {
    this.holeEinstellung = holeEinstellung;
    this.jetzt = jetzt;
    this.eingeschaltet = eingeschaltet;
  }

  /** Vom Server bei jeder angemeldeten Anfrage aufgerufen */
  nutzung() {
    this.letzteNutzung = this.jetzt().getTime();
  }

  nutzungsStufe(): Nutzung {
    const jetzt = this.jetzt();
    const seit = jetzt.getTime() - this.letzteNutzung;
    if (seit < 15 * 60000) return 'aktiv';
    const h = lokal(jetzt).stunde;
    if (h >= 23 || h < 6) return 'nacht';
    return seit < 2 * 3600000 ? 'ruhig' : 'schlaf';
  }

  private z(id: string): Zaehler {
    const tag = lokalDatum(this.jetzt());
    let z = this.zaehler.get(id);
    if (!z) {
      z = { tag, heute: 0, gesamt: 0, fehlerInFolge: 0, letzterAbruf: 0, verweigert: 0 };
      this.zaehler.set(id, z);
    }
    if (z.tag !== tag) {
      z.tag = tag;
      z.heute = 0;
      z.verweigert = 0;
    }
    return z;
  }

  einstellung(id: string): PlanerEinstellung {
    return this.holeEinstellung(id) ?? { modus: 'auto' };
  }

  /** Wirksame Gültigkeit eines Ergebnisses in Sekunden */
  ttlSek(q: PlanerQuelle, schluessel = ''): number {
    const e = this.einstellung(q.id);
    if (e.modus === 'fix' && e.fixSek) return Math.max(10, e.fixSek);
    if (!this.eingeschaltet()) return q.ttlSek;
    const min = q.minSek ?? Math.min(q.ttlSek, 60);
    const max = q.maxSek ?? q.ttlSek * 6;
    let faktor = FAKTOR[this.nutzungsStufe()];
    if (q.wichtig) faktor = Math.min(faktor, 1.5);
    const f = this.sperren.get(`${q.id}|${schluessel}`)?.fehler ?? 0;
    const backoff = f && !q.wichtig ? 2 ** Math.min(f, 6) : 1;
    return Math.round(Math.max(min, Math.min(max * (backoff > 1 ? 4 : 1), q.ttlSek * faktor * backoff)));
  }

  /** Mindestabstand zwischen zwei Abrufen mit denselben Parametern, auch wenn ein Job frische Daten will */
  minSek(q: PlanerQuelle): number {
    const e = this.einstellung(q.id);
    if (e.modus === 'fix' && e.fixSek) return e.fixSek;
    return q.minSek ?? Math.min(q.ttlSek, 60);
  }

  /** Darf jetzt abgerufen werden? (ausgeschaltet, Pause nach Fehlern, Tagesbudget) */
  darf(q: PlanerQuelle, schluessel = ''): { ok: true } | { ok: false; grund: string } {
    const e = this.einstellung(q.id);
    const z = this.z(q.id);
    const jetzt = this.jetzt().getTime();
    if (e.modus === 'aus') return this.nein(z, 'Abruf ausgeschaltet');
    if (!this.eingeschaltet() && e.modus !== 'fix') return { ok: true };
    const sperre = this.sperren.get(`${q.id}|${schluessel}`);
    // Wichtige Quellen (Alarme) werden nie pausiert
    if (!q.wichtig && sperre && sperre.bis > jetzt)
      return this.nein(
        z,
        `Pause nach Fehlern bis ${new Date(sperre.bis).toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })}`,
      );
    const budget = e.budget ?? q.tagesBudget ?? 0;
    if (budget > 0 && z.heute >= budget) return this.nein(z, `Tagesbudget von ${budget} Abrufen erreicht`);
    return { ok: true };
  }

  private nein(z: Zaehler, grund: string) {
    z.verweigert++;
    return { ok: false as const, grund };
  }

  abgerufen(id: string) {
    const z = this.z(id);
    z.heute++;
    z.gesamt++;
    z.letzterAbruf = this.jetzt().getTime();
  }

  erfolg(id: string, schluessel = '') {
    this.sperren.delete(`${id}|${schluessel}`);
    this.z(id).fehlerInFolge = 0;
  }

  fehler(id: string, ttlSek: number, schluessel = '') {
    const k = `${id}|${schluessel}`;
    const s = this.sperren.get(k) ?? { fehler: 0, bis: 0 };
    s.fehler++;
    // Ab dem dritten Fehler in Folge: Pause mit wachsender Dauer (höchstens 6 Stunden)
    if (s.fehler >= 3)
      s.bis = this.jetzt().getTime() + Math.min(6 * 3600, Math.max(60, ttlSek) * 2 ** (s.fehler - 2)) * 1000;
    this.sperren.set(k, s);
    if (this.sperren.size > 500) this.sperren.delete(this.sperren.keys().next().value!);
    const z = this.z(id);
    z.fehlerInFolge = Math.max(z.fehlerInFolge, s.fehler);
  }

  private pauseBis(id: string): string | null {
    let bis = 0;
    for (const [k, s] of this.sperren) if (k.startsWith(`${id}|`) && s.bis > bis) bis = s.bis;
    return bis > this.jetzt().getTime() ? new Date(bis).toISOString() : null;
  }

  zaehlerVon(id: string) {
    const z = this.z(id);
    return {
      heute: z.heute,
      gesamt: z.gesamt,
      fehlerInFolge: z.fehlerInFolge,
      gesperrtBis: this.pauseBis(id),
      verweigert: z.verweigert,
      letzterAbruf: z.letzterAbruf ? new Date(z.letzterAbruf).toISOString() : null,
    };
  }
}
