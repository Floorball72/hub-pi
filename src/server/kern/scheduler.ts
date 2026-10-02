// Scheduler für Hintergrundjobs im selben Prozess. Ein einziger Takt prüft alle Jobs.
// Jobs überlappen sich nie, Fehler werden gemeldet, stoppen aber den Hub nicht.
import { fehlerText } from './fehler.ts';
import type { JobDef } from './modul.ts';
import { hhmmZuMinuten, lokalDatum, minutenLokal } from './zeit.ts';

export interface JobStatus {
  id: string;
  name: string;
  modul: string;
  laeuft: boolean;
  letzterLauf: string | null;
  letzteDauerMs: number | null;
  letzterFehler: string | null;
  letzteMeldung: string | null;
  naechsterLauf: string | null;
  laeufe: number;
  fehler: number;
}

interface Eintrag {
  def: JobDef;
  modul: string;
  status: JobStatus;
  faellig: number;
  letzterTag: string | null;
}

export class Scheduler {
  private jobs = new Map<string, Eintrag>();
  private timer: NodeJS.Timeout | null = null;

  private aktiv: (modul: string) => boolean;
  private jetzt: () => Date;
  private melden: (modul: string, job: string, fehler: string) => void;

  constructor(
    aktiv: (modul: string) => boolean,
    jetzt: () => Date = () => new Date(),
    melden: (modul: string, job: string, fehler: string) => void = () => {},
  ) {
    this.aktiv = aktiv;
    this.jetzt = jetzt;
    this.melden = melden;
  }

  hinzufuegen(modul: string, def: JobDef) {
    const id = `${modul}.${def.id}`;
    const start = this.jetzt().getTime();
    this.jobs.set(id, {
      def,
      modul,
      faellig: start + (def.startVerzoegerungSek ?? 5) * 1000,
      letzterTag: def.taeglich ? lokalDatum(this.jetzt()) : null,
      status: {
        id,
        name: def.name,
        modul,
        laeuft: false,
        letzterLauf: null,
        letzteDauerMs: null,
        letzterFehler: null,
        letzteMeldung: null,
        naechsterLauf: null,
        laeufe: 0,
        fehler: 0,
      },
    });
    // Täglicher Job, dessen Zeit heute schon vorbei ist: erst morgen
    const e = this.jobs.get(id)!;
    if (def.taeglich && minutenLokal(this.jetzt()) < hhmmZuMinuten(def.taeglich)) e.letzterTag = null;
  }

  starten(taktMs = 15000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.takt(), taktMs);
    this.timer.unref();
  }

  stoppen() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Ein Takt: startet alle fälligen Jobs. Gibt die gestarteten Job ids zurück (für Tests). */
  async takt(): Promise<string[]> {
    const jetzt = this.jetzt();
    const gestartet: Promise<void>[] = [];
    const ids: string[] = [];
    for (const [id, e] of this.jobs) {
      if (e.status.laeuft || !this.aktiv(e.modul)) continue;
      if (this.istFaellig(e, jetzt)) {
        ids.push(id);
        gestartet.push(this.ausfuehren(e));
      }
    }
    await Promise.all(gestartet);
    return ids;
  }

  private istFaellig(e: Eintrag, jetzt: Date): boolean {
    if (e.def.taeglich) {
      const heute = lokalDatum(jetzt);
      return e.letzterTag !== heute && minutenLokal(jetzt) >= hhmmZuMinuten(e.def.taeglich);
    }
    return jetzt.getTime() >= e.faellig;
  }

  async ausfuehren(e: Eintrag) {
    const start = this.jetzt();
    e.status.laeuft = true;
    if (e.def.taeglich) e.letzterTag = lokalDatum(start);
    try {
      const meldung = await e.def.lauf();
      e.status.letzterFehler = null;
      e.status.letzteMeldung = meldung ? String(meldung).slice(0, 200) : null;
    } catch (err) {
      e.status.fehler++;
      e.status.letzterFehler = fehlerText(err).slice(0, 200);
      this.melden(e.modul, e.def.name, e.status.letzterFehler);
    } finally {
      e.status.laeuft = false;
      e.status.laeufe++;
      e.status.letzterLauf = start.toISOString();
      e.status.letzteDauerMs = this.jetzt().getTime() - start.getTime();
      if (e.def.intervallSek) e.faellig = this.jetzt().getTime() + e.def.intervallSek * 1000;
    }
  }

  /** Startet einen Job sofort (z.B. per Button) */
  async jetztAusfuehren(id: string): Promise<JobStatus | null> {
    const e = this.jobs.get(id);
    if (!e || e.status.laeuft) return e?.status ?? null;
    await this.ausfuehren(e);
    return e.status;
  }

  status(): JobStatus[] {
    return [...this.jobs.values()].map((e) => ({
      ...e.status,
      naechsterLauf: e.def.taeglich ? `täglich ${e.def.taeglich}` : new Date(e.faellig).toISOString(),
    }));
  }
}
