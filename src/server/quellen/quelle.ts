// Basis für jede externe Datenquelle: Cache, Timeout (über http.ts), Status und Demo Daten.
// Fällt eine Quelle aus, liefert sie den letzten bekannten Stand mit Hinweis statt eines Absturzes.
import { fehlerText } from '../kern/fehler.ts';

export type QuellenZustand = 'ok' | 'fehler' | 'unbekannt' | 'aus' | 'nicht_konfiguriert' | 'demo';

export interface Ergebnis<T> {
  daten: T | null;
  /** Zeitpunkt der Daten (ISO) */
  stand: string | null;
  demo: boolean;
  veraltet: boolean;
  fehler?: string;
  quelle: string;
}

export interface QuellenDef<P, T> {
  id: string;
  name: string;
  modul: string;
  /** Wie lange ein Ergebnis gültig ist */
  ttlSek: number;
  abruf: (p: P) => Promise<T>;
  demo: (p: P) => T;
  /** Fehlt eine Einstellung (z.B. Schlüssel), ist die Quelle nicht konfiguriert */
  konfiguriert?: () => boolean;
  /** Von der Entwicklungsumgebung aus nicht geprüft */
  ungetestet?: boolean;
  namensnennung?: string;
  beschreibung?: string;
  /** Beispielparameter für den Selbsttest */
  testParameter?: () => P;
}

export interface QuellenStatus {
  id: string;
  name: string;
  modul: string;
  zustand: QuellenZustand;
  letzterErfolg: string | null;
  letzterFehler: string | null;
  fehlerText: string | null;
  latenzMs: number | null;
  ungetestet: boolean;
  namensnennung?: string;
  beschreibung?: string;
}

interface CacheEintrag<T> {
  daten: T;
  zeit: number;
}

const MAX_SCHLUESSEL = 40;

export class Quelle<P = void, T = unknown> {
  private cache = new Map<string, CacheEintrag<T>>();
  private laufend = new Map<string, Promise<Ergebnis<T>>>();
  private zustand: QuellenZustand = 'unbekannt';
  private letzterErfolg: string | null = null;
  private letzterFehler: string | null = null;
  private fehlerMeldung: string | null = null;
  private latenz: number | null = null;

  readonly def: QuellenDef<P, T>;
  private umgebung: { demo: () => boolean; aktiv: () => boolean };

  constructor(def: QuellenDef<P, T>, umgebung: { demo: () => boolean; aktiv: () => boolean }) {
    this.def = def;
    this.umgebung = umgebung;
  }

  get id() {
    return this.def.id;
  }

  async hole(p: P, frisch = false): Promise<Ergebnis<T>> {
    const basis = { quelle: this.def.id, veraltet: false };
    if (this.umgebung.demo()) {
      this.zustand = 'demo';
      return { ...basis, daten: this.def.demo(p), stand: new Date().toISOString(), demo: true };
    }
    if (!this.umgebung.aktiv()) {
      this.zustand = 'aus';
      return { ...basis, daten: null, stand: null, demo: false, fehler: 'Modul ausgeschaltet' };
    }
    if (this.def.konfiguriert && !this.def.konfiguriert()) {
      this.zustand = 'nicht_konfiguriert';
      return { ...basis, daten: null, stand: null, demo: false, fehler: 'Nicht konfiguriert' };
    }
    const schluessel = JSON.stringify(p ?? null);
    const c = this.cache.get(schluessel);
    if (!frisch && c && Date.now() - c.zeit < this.def.ttlSek * 1000) {
      return { ...basis, daten: c.daten, stand: new Date(c.zeit).toISOString(), demo: false };
    }
    const offen = this.laufend.get(schluessel);
    if (offen) return offen;
    const auftrag = this.abrufen(p, schluessel).finally(() => this.laufend.delete(schluessel));
    this.laufend.set(schluessel, auftrag);
    return auftrag;
  }

  private async abrufen(p: P, schluessel: string): Promise<Ergebnis<T>> {
    const start = performance.now();
    try {
      const daten = await this.def.abruf(p);
      this.latenz = Math.round(performance.now() - start);
      this.zustand = 'ok';
      this.letzterErfolg = new Date().toISOString();
      this.fehlerMeldung = null;
      this.cache.delete(schluessel);
      this.cache.set(schluessel, { daten, zeit: Date.now() });
      if (this.cache.size > MAX_SCHLUESSEL) this.cache.delete(this.cache.keys().next().value!);
      return { quelle: this.def.id, daten, stand: this.letzterErfolg, demo: false, veraltet: false };
    } catch (e) {
      this.zustand = 'fehler';
      this.letzterFehler = new Date().toISOString();
      this.fehlerMeldung = fehlerText(e).slice(0, 200);
      const alt = this.cache.get(schluessel);
      return {
        quelle: this.def.id,
        daten: alt?.daten ?? null,
        stand: alt ? new Date(alt.zeit).toISOString() : null,
        demo: false,
        veraltet: !!alt,
        fehler: this.fehlerMeldung,
      };
    }
  }

  status(): QuellenStatus {
    let zustand = this.zustand;
    if (this.umgebung.demo()) zustand = 'demo';
    else if (!this.umgebung.aktiv()) zustand = 'aus';
    else if (this.def.konfiguriert && !this.def.konfiguriert()) zustand = 'nicht_konfiguriert';
    return {
      id: this.def.id,
      name: this.def.name,
      modul: this.def.modul,
      zustand,
      letzterErfolg: this.letzterErfolg,
      letzterFehler: this.letzterFehler,
      fehlerText: this.fehlerMeldung,
      latenzMs: this.latenz,
      ungetestet: !!this.def.ungetestet,
      namensnennung: this.def.namensnennung,
      beschreibung: this.def.beschreibung,
    };
  }

  cacheLeeren() {
    this.cache.clear();
  }
}
