// Modul System: Jedes Modul beschreibt sich mit einer Definition. Der Kern lädt sie über das Manifest.
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Daten } from '../daten/index.ts';
import type { Tabelle } from '../daten/schema.ts';
import type { BriefingTeil, Ebene, Kachel, SuchTreffer, TimelineEintrag } from '../geteilt/typen.ts';
import type { Konfig } from '../konfig.ts';
import type { Quelle, QuellenDef } from '../quellen/quelle.ts';
import type { Alarmzentrale, RegelVorlage } from './alarm.ts';
import type { Einstellungen } from './einstellungen.ts';

export interface JobDef {
  id: string;
  name: string;
  /** Wiederholung in Sekunden */
  intervallSek?: number;
  /** Täglich um diese Zeit (Europe/Zurich), Format HH:MM */
  taeglich?: string;
  /** Verzögerung nach dem Start, damit nicht alles gleichzeitig läuft */
  startVerzoegerungSek?: number;
  lauf: () => Promise<string | undefined>;
}

export interface Kontext {
  konfig: Konfig;
  daten: Daten;
  log: FastifyBaseLogger;
  alarm: Alarmzentrale;
  einstellungen: Einstellungen;
  aktivitaet: (modul: string, text: string, art?: 'info' | 'warnung' | 'fehler' | 'aktion') => Promise<void>;
  modulAktiv: (id: string) => boolean;
  /** Erstellt eine Datenquelle, die zum Modul gehört */
  quelle: <P, T>(def: QuellenDef<P, T>) => Quelle<P, T>;
  jetzt: () => Date;
}

export interface ModulLaufzeit {
  routen?: (app: FastifyInstance) => void | Promise<void>;
  /** Routen ohne Login an der Wurzel (z.B. öffentliche Statusseite). Nur Daten, die öffentlich sein dürfen! */
  oeffentlicheRouten?: (app: FastifyInstance) => void | Promise<void>;
  jobs?: JobDef[];
  kachel?: () => Promise<Kachel>;
  ebenen?: () => Ebene[];
  suche?: (q: string) => Promise<SuchTreffer[]>;
  timeline?: (von: Date, bis: Date) => Promise<TimelineEintrag[]>;
  briefing?: () => Promise<BriefingTeil | null>;
}

export interface ModulDef {
  id: string;
  name: string;
  beschreibung: string;
  symbol: string;
  reihenfolge: number;
  /** Kann nicht ausgeschaltet werden */
  pflicht?: boolean;
  tabellen?: Tabelle[];
  regeln?: RegelVorlage[];
  erstellen: (ctx: Kontext) => ModulLaufzeit | Promise<ModulLaufzeit>;
}
