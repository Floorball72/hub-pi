// Der Hub setzt Konfiguration, Daten, Alarmzentrale, Scheduler und Module zusammen.
import type { FastifyBaseLogger } from 'fastify';
import { type Daten, datenErstellen } from '../daten/index.ts';
import type { Tabelle } from '../daten/schema.ts';
import type { BriefingTeil, ModulInfo, SuchTreffer, TimelineEintrag } from '../geteilt/typen.ts';
import { geheimeWerte, type Konfig } from '../konfig.ts';
import { MODULE } from '../modules/index.ts';
import { Quelle, type QuellenDef } from '../quellen/quelle.ts';
import { AKTIVITAET_TABELLE, schwaerzen } from './aktivitaet.ts';
import { ALARM_TABELLEN, Alarmzentrale } from './alarm.ts';
import { EINSTELLUNGEN_TABELLE, Einstellungen } from './einstellungen.ts';
import { fehlerText } from './fehler.ts';
import { kachelnSammeln, mitTimeout } from './routen.ts';
import type { Kontext, ModulDef, ModulLaufzeit } from './modul.ts';
import { METRIK_STUNDEN, METRIK_WERTE, MetrikRegistry } from './metriken.ts';
import { Abrufplaner, type PlanerEinstellung } from './planer.ts';
import { Scheduler } from './scheduler.ts';
import type { Rueckblick } from './zeit.ts';

export const KERN_TABELLEN: Tabelle[] = [
  EINSTELLUNGEN_TABELLE,
  AKTIVITAET_TABELLE,
  ...ALARM_TABELLEN,
  METRIK_WERTE,
  METRIK_STUNDEN,
];

export function alleTabellen(module: ModulDef[] = MODULE): Tabelle[] {
  return [...KERN_TABELLEN, ...module.flatMap((m) => m.tabellen ?? [])];
}

export interface GeladenesModul {
  def: ModulDef;
  laufzeit: ModulLaufzeit;
  quellen: Quelle<never, unknown>[];
  fehler?: string;
}

export class Hub {
  readonly daten: Daten;
  readonly einstellungen: Einstellungen;
  readonly alarm: Alarmzentrale;
  readonly scheduler: Scheduler;
  readonly planer: Abrufplaner;
  readonly metriken: MetrikRegistry;
  readonly module = new Map<string, GeladenesModul>();
  readonly start = new Date();

  readonly konfig: Konfig;
  readonly log: FastifyBaseLogger;
  readonly definitionen: ModulDef[];
  readonly jetzt: () => Date;

  constructor(
    konfig: Konfig,
    log: FastifyBaseLogger,
    definitionen: ModulDef[] = MODULE,
    daten?: Daten,
    jetzt: () => Date = () => new Date(),
  ) {
    this.konfig = konfig;
    this.log = log;
    this.definitionen = definitionen;
    this.jetzt = jetzt;
    this.daten = daten ?? datenErstellen(konfig);
    this.einstellungen = new Einstellungen(this.daten);
    this.alarm = new Alarmzentrale(
      this.daten,
      () => this.konfig.ntfy,
      () => this.konfig.demo,
      jetzt,
    );
    this.planer = new Abrufplaner(
      (id) => this.einstellungen.hole<PlanerEinstellung | null>(`abruf.${id}`, null),
      jetzt,
      () => this.modulAktiv('abrufe'),
    );
    this.metriken = new MetrikRegistry(
      (zeilen) => this.daten.einfuegen('metrik_werte', zeilen),
      () => this.modulAktiv('auffaelligkeiten'),
      jetzt,
    );
    this.scheduler = new Scheduler(
      (m) => this.modulAktiv(m),
      jetzt,
      (modul, job, fehler) => void this.aktivitaet(modul, `Job «${job}» fehlgeschlagen: ${fehler}`, 'fehler'),
    );
  }

  modulAktiv(id: string): boolean {
    if (id === 'kern') return true;
    const def = this.definitionen.find((d) => d.id === id);
    if (!def) return false;
    if (def.pflicht) return true;
    return this.einstellungen.hole<boolean>(`modul.${id}.aktiv`, true);
  }

  async aktivitaet(modul: string, text: string, art: 'info' | 'warnung' | 'fehler' | 'aktion' = 'info') {
    const sauber = schwaerzen(text, geheimeWerte(this.konfig)).slice(0, 500);
    try {
      await this.daten.einfuegen('aktivitaet', [{ modul, art, text: sauber }]);
    } catch {
      this.log.warn({ modul, art }, sauber);
    }
  }

  kontext(modulId: string): Kontext {
    return {
      konfig: this.konfig,
      daten: this.daten,
      log: this.log.child({ modul: modulId }),
      alarm: this.alarm,
      einstellungen: this.einstellungen,
      aktivitaet: (m, t, a) => this.aktivitaet(m, t, a),
      modulAktiv: (id) => this.modulAktiv(id),
      jetzt: this.jetzt,
      kern: {
        planer: this.planer,
        scheduler: this.scheduler,
        quellen: () => this.alleQuellen(),
        module: () =>
          [...this.module.values()].map((m) => ({
            id: m.def.id,
            name: m.def.name,
            aktiv: this.modulAktiv(m.def.id),
            fehler: m.fehler,
          })),
        modulNeuLaden: (id) => this.modulNeuLaden(id),
        metriken: this.metriken,
        timeline: (von, bis) => this.timeline(von, bis),
        abendbericht: (zeitraum) => this.abendbericht(zeitraum),
        suche: (q) => this.suche(q),
        briefing: () => this.briefing(),
        kacheln: () => kachelnSammeln(this),
      },
      metrik: (def) => this.metriken.registrieren({ modul: modulId, ...def }),
      quelle: <P, T>(def: QuellenDef<P, T>) => {
        const q = new Quelle<P, T>(def, {
          demo: () => this.konfig.demo,
          aktiv: () => this.modulAktiv(def.modul),
          planer: this.planer,
        });
        this.module.get(modulId)?.quellen.push(q as unknown as Quelle<never, unknown>);
        return q;
      },
    };
  }

  async starten() {
    await this.daten.vorbereiten(alleTabellen(this.definitionen));
    await this.einstellungen.laden();
    await this.alarm.regelnLaden(
      this.definitionen.flatMap((m) => (m.regeln ?? []).map((vorlage) => ({ modul: m.id, vorlage }))),
    );
    for (const def of [...this.definitionen].sort((a, b) => a.reihenfolge - b.reihenfolge)) {
      const eintrag: GeladenesModul = { def, laufzeit: {}, quellen: [] };
      this.module.set(def.id, eintrag);
      try {
        eintrag.laufzeit = await def.erstellen(this.kontext(def.id));
        for (const job of eintrag.laufzeit.jobs ?? []) this.scheduler.hinzufuegen(def.id, job);
      } catch (e) {
        eintrag.fehler = fehlerText(e);
        this.log.error({ modul: def.id, err: e }, 'Modul konnte nicht geladen werden');
      }
    }
    this.kernJobs();
  }

  /** Alle Einträge der Timeline aus allen aktiven Modulen (Kalender, Einsätze, Drehs, Veranstaltungen …) */
  async timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    const eintraege: TimelineEintrag[] = [];
    await Promise.all(
      [...this.module.entries()].map(async ([id, m]) => {
        if (!m.laufzeit.timeline || !this.modulAktiv(id)) return;
        try {
          eintraege.push(
            ...(await Promise.race([
              m.laufzeit.timeline(von, bis),
              new Promise<TimelineEintrag[]>((_, r) =>
                setTimeout(() => r(new Error('Zeitüberschreitung')), 8000).unref(),
              ),
            ])),
          );
        } catch (e) {
          this.log.warn({ modul: id, fehler: fehlerText(e) }, 'Timeline fehlgeschlagen');
        }
      }),
    );
    return eintraege.sort((a, b) => a.start.localeCompare(b.start));
  }

  /** Globale Suche über alle Tabellen mit Suchfeldern und die Suche der Module */
  async suche(eingabe: string): Promise<SuchTreffer[]> {
    const q = eingabe.trim().slice(0, 80);
    if (q.length < 2) return [];
    const treffer: SuchTreffer[] = [];
    for (const t of this.daten.alleTabellen()) {
      if (!t.suche?.length || !this.modulAktiv(t.modul)) continue;
      for (const feld of t.suche) {
        try {
          const zeilen = await this.daten.liste<Record<string, unknown>>(t.name, {
            filter: { [feld]: { like: `%${q}%` } },
            limit: 10,
          });
          for (const z of zeilen) {
            treffer.push({
              modul: t.modul,
              titel: String(z[t.anzeige ?? feld] ?? z[feld]),
              text: t.label,
              link: `/modul/${t.modul}?tabelle=${t.name}&id=${z.id}`,
            });
          }
        } catch {
          // Suche in einer Tabelle darf scheitern
        }
      }
    }
    await Promise.all(
      [...this.module.entries()].map(async ([id, m]) => {
        if (!m.laufzeit.suche || !this.modulAktiv(id)) return;
        try {
          treffer.push(...(await mitTimeout(m.laufzeit.suche(q), 4000)));
        } catch {
          // egal
        }
      }),
    );
    const gesehen = new Set<string>();
    return treffer
      .filter((t) => {
        if (gesehen.has(t.link)) return false;
        gesehen.add(t.link);
        return true;
      })
      .slice(0, 50);
  }

  /** Morgenbriefing: Teile aller aktiven Module, sortiert */
  async briefing(): Promise<BriefingTeil[]> {
    const teile: BriefingTeil[] = [];
    await Promise.all(
      [...this.module.entries()].map(async ([id, m]) => {
        if (!m.laufzeit.briefing || !this.modulAktiv(id)) return;
        try {
          const t = await mitTimeout(m.laufzeit.briefing(), 8000);
          if (t) teile.push(t);
        } catch {
          // egal
        }
      }),
    );
    return teile.sort((a, b) => a.reihenfolge - b.reihenfolge);
  }

  /** Tages oder Wochenrückblick: Teile aller aktiven Module, sortiert */
  async abendbericht(zeitraum: Rueckblick = 'tag'): Promise<BriefingTeil[]> {
    const teile: BriefingTeil[] = [];
    await Promise.all(
      [...this.module.entries()].map(async ([id, m]) => {
        if (!m.laufzeit.abendbericht || !this.modulAktiv(id)) return;
        try {
          const t = await Promise.race([
            m.laufzeit.abendbericht(zeitraum),
            new Promise<null>((_, r) => setTimeout(() => r(new Error('Zeitüberschreitung')), 8000).unref()),
          ]);
          if (t) teile.push(t);
        } catch (e) {
          this.log.warn({ modul: id, fehler: fehlerText(e) }, 'Tagesrückblick fehlgeschlagen');
        }
      }),
    );
    return teile.sort((a, b) => a.reihenfolge - b.reihenfolge);
  }

  /** Erstellt ein Modul neu (z.B. nach einem Fehler beim Laden). Jobs werden ersetzt. */
  async modulNeuLaden(id: string): Promise<boolean> {
    const def = this.definitionen.find((d) => d.id === id);
    if (!def) return false;
    const eintrag: GeladenesModul = { def, laufzeit: {}, quellen: [] };
    this.module.set(id, eintrag);
    try {
      eintrag.laufzeit = await def.erstellen(this.kontext(id));
      this.scheduler.modulEntfernen(id);
      for (const job of eintrag.laufzeit.jobs ?? []) this.scheduler.hinzufuegen(id, job);
      return true;
    } catch (e) {
      eintrag.fehler = fehlerText(e);
      return false;
    }
  }

  private kernJobs() {
    this.scheduler.hinzufuegen('kern', {
      id: 'puffer',
      name: 'Offline Puffer nachsenden',
      intervallSek: 60,
      lauf: async () => {
        await this.metriken.leeren();
        const n = await this.daten.pufferNachsenden();
        if (n) await this.aktivitaet('kern', `${n} gepufferte Messwerte nachgesendet`);
        return n ? `${n} nachgesendet` : undefined;
      },
    });
    this.scheduler.hinzufuegen('kern', {
      id: 'aufraeumen',
      name: 'Alte Log Einträge löschen',
      taeglich: '03:40',
      lauf: async () => {
        const grenze = new Date(this.jetzt().getTime() - 90 * 86400000).toISOString();
        const a = await this.daten.loescheWo('aktivitaet', { erstellt: { lt: grenze } });
        const b = await this.daten.loescheWo('alarme', { erstellt: { lt: grenze } });
        return `${a + b} Einträge gelöscht`;
      },
    });
  }

  modulInfos(): ModulInfo[] {
    return [...this.definitionen]
      .sort((a, b) => a.reihenfolge - b.reihenfolge)
      .map((d) => ({
        id: d.id,
        name: d.name,
        beschreibung: d.beschreibung,
        symbol: d.symbol,
        aktiv: this.modulAktiv(d.id),
        pflicht: !!d.pflicht,
        reihenfolge: d.reihenfolge,
      }));
  }

  alleQuellen() {
    return [...this.module.values()].flatMap((m) => m.quellen);
  }

  async stoppen() {
    this.scheduler.stoppen();
    await this.metriken.leeren();
    await this.daten.schliessen();
  }
}
