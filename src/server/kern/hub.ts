// Der Hub setzt Konfiguration, Daten, Alarmzentrale, Scheduler und Module zusammen.
import type { FastifyBaseLogger } from 'fastify';
import { type Daten, datenErstellen } from '../daten/index.ts';
import type { Tabelle } from '../daten/schema.ts';
import type { ModulInfo } from '../geteilt/typen.ts';
import { geheimeWerte, type Konfig } from '../konfig.ts';
import { MODULE } from '../modules/index.ts';
import { Quelle, type QuellenDef } from '../quellen/quelle.ts';
import { AKTIVITAET_TABELLE, schwaerzen } from './aktivitaet.ts';
import { ALARM_TABELLEN, Alarmzentrale } from './alarm.ts';
import { EINSTELLUNGEN_TABELLE, Einstellungen } from './einstellungen.ts';
import { fehlerText } from './fehler.ts';
import type { Kontext, ModulDef, ModulLaufzeit } from './modul.ts';
import { Scheduler } from './scheduler.ts';

export const KERN_TABELLEN: Tabelle[] = [EINSTELLUNGEN_TABELLE, AKTIVITAET_TABELLE, ...ALARM_TABELLEN];

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
      quelle: <P, T>(def: QuellenDef<P, T>) => {
        const q = new Quelle<P, T>(def, {
          demo: () => this.konfig.demo,
          aktiv: () => this.modulAktiv(def.modul),
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

  private kernJobs() {
    this.scheduler.hinzufuegen('kern', {
      id: 'puffer',
      name: 'Offline Puffer nachsenden',
      intervallSek: 60,
      lauf: async () => {
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
    await this.daten.schliessen();
  }
}
