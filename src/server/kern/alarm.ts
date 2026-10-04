// Alarmzentrale: Module melden Ereignisse, die Zentrale entscheidet anhand der Regeln über ntfy.
import type { Daten } from '../daten/index.ts';
import { tabelle } from '../daten/schema.ts';
import type { AlarmRegel } from '../geteilt/typen.ts';
import { fehlerText } from './fehler.ts';
import { type NtfyKonfig, type NtfyNachricht, ntfySenden } from './ntfy.ts';
import { imFenster } from './zeit.ts';

export const ALARM_TABELLEN = [
  tabelle({
    name: 'alarm_regeln',
    modul: 'kern',
    label: 'Alarmregeln',
    spalten: [
      { name: 'modul', typ: 'text' },
      { name: 'name', typ: 'text' },
      { name: 'beschreibung', typ: 'text' },
      { name: 'aktiv', typ: 'bool' },
      { name: 'prioritaet', typ: 'int' },
      { name: 'schwelle', typ: 'real' },
      { name: 'schwelle_label', typ: 'text' },
      { name: 'ruhe_von', typ: 'text' },
      { name: 'ruhe_bis', typ: 'text' },
      { name: 'nachts', typ: 'bool' },
      { name: 'cooldown_min', typ: 'int' },
    ],
  }),
  tabelle({
    name: 'alarme',
    modul: 'kern',
    label: 'Alarme',
    spalten: [
      { name: 'regel', typ: 'text' },
      { name: 'modul', typ: 'text' },
      { name: 'titel', typ: 'text' },
      { name: 'text', typ: 'text' },
      { name: 'prioritaet', typ: 'int' },
      { name: 'status', typ: 'text' },
      { name: 'grund', typ: 'text' },
      { name: 'schluessel', typ: 'text' },
      { name: 'wert', typ: 'real' },
    ],
    indizes: [['erstellt'], ['schluessel']],
  }),
];

export interface RegelVorlage {
  /** Kurze id, wird mit dem Modul zu «modul.id» */
  id: string;
  name: string;
  beschreibung: string;
  aktiv?: boolean;
  prioritaet?: number;
  schwelle?: number;
  schwelleLabel?: string;
  /** Darf in der Ruhezeit senden */
  nachts?: boolean;
  cooldownMin?: number;
}

export interface Ereignis {
  /** Volle Regel id, z.B. «scont.ausfall» */
  regel: string;
  titel: string;
  text: string;
  /** Messwert, der mit der Schwelle der Regel verglichen wird */
  wert?: number;
  /** «unter»: Ereignis zählt, wenn der Wert die Schwelle unterschreitet (Standard: überschreitet) */
  richtung?: 'ueber' | 'unter';
  /** Gleicher Schlüssel innerhalb der Sperrfrist wird nur einmal gemeldet */
  schluessel?: string;
  prioritaet?: number;
  tags?: string[];
  link?: string;
}

export type Entscheid = { aktion: 'senden' | 'unterdrueckt' | 'verworfen'; grund: string };

export const STANDARD_RUHE = { von: '22:00', bis: '07:00' };

/** Reine Entscheidungslogik, ohne Seiteneffekte (getestet). */
export function entscheiden(
  regel: AlarmRegel | undefined,
  e: Ereignis,
  jetzt: Date,
  letzteMeldung: Date | undefined,
): Entscheid {
  if (!regel) return { aktion: 'verworfen', grund: 'Keine Regel' };
  if (!regel.aktiv) return { aktion: 'verworfen', grund: 'Regel ausgeschaltet' };
  if (regel.schwelle !== null && e.wert !== undefined) {
    if (e.richtung === 'unter' ? e.wert > regel.schwelle : e.wert < regel.schwelle) {
      return {
        aktion: 'verworfen',
        grund: `Schwelle nicht erreicht (${e.wert}, Schwelle ${regel.schwelle})`,
      };
    }
  }
  if (letzteMeldung && jetzt.getTime() - letzteMeldung.getTime() < regel.cooldown_min * 60000) {
    return { aktion: 'verworfen', grund: 'Bereits gemeldet (Sperrfrist)' };
  }
  if (!regel.nachts && regel.ruhe_von && regel.ruhe_bis && imFenster(jetzt, regel.ruhe_von, regel.ruhe_bis)) {
    return { aktion: 'unterdrueckt', grund: 'Ruhezeit' };
  }
  return { aktion: 'senden', grund: 'Regel erfüllt' };
}

export function regelAusVorlage(modul: string, v: RegelVorlage): AlarmRegel {
  return {
    id: `${modul}.${v.id}`,
    modul,
    name: v.name,
    beschreibung: v.beschreibung,
    aktiv: v.aktiv ?? true,
    prioritaet: v.prioritaet ?? 3,
    schwelle: v.schwelle ?? null,
    schwelle_label: v.schwelleLabel ?? null,
    ruhe_von: STANDARD_RUHE.von,
    ruhe_bis: STANDARD_RUHE.bis,
    nachts: v.nachts ?? false,
    cooldown_min: v.cooldownMin ?? 60,
  };
}

export class Alarmzentrale {
  private regeln = new Map<string, AlarmRegel>();
  private zuletzt = new Map<string, Date>();

  private daten: Daten;
  private ntfy: () => NtfyKonfig;
  private demo: () => boolean;
  private jetzt: () => Date;
  private sender: (k: NtfyKonfig, n: NtfyNachricht) => Promise<void>;

  constructor(
    daten: Daten,
    ntfy: () => NtfyKonfig,
    demo: () => boolean,
    jetzt: () => Date = () => new Date(),
    sender: (k: NtfyKonfig, n: NtfyNachricht) => Promise<void> = ntfySenden,
  ) {
    this.daten = daten;
    this.ntfy = ntfy;
    this.demo = demo;
    this.jetzt = jetzt;
    this.sender = sender;
  }

  /** Lädt gespeicherte Regeln und legt fehlende Standardregeln an. */
  async regelnLaden(vorlagen: { modul: string; vorlage: RegelVorlage }[]) {
    let gespeichert: AlarmRegel[] = [];
    try {
      gespeichert = await this.daten.liste<AlarmRegel>('alarm_regeln', { limit: 500 });
    } catch {
      // Datenbank nicht erreichbar: Standardregeln im RAM verwenden
    }
    const bekannt = new Map(gespeichert.map((r) => [r.id, r]));
    const neu: AlarmRegel[] = [];
    for (const { modul, vorlage } of vorlagen) {
      const standard = regelAusVorlage(modul, vorlage);
      const r = bekannt.get(standard.id);
      if (r) {
        // Name und Beschreibung kommen immer aus dem Code, Einstellungen bleiben
        this.regeln.set(r.id, {
          ...r,
          name: standard.name,
          beschreibung: standard.beschreibung,
          schwelle_label: standard.schwelle_label,
        });
      } else {
        this.regeln.set(standard.id, standard);
        neu.push(standard);
      }
    }
    if (neu.length) {
      try {
        await this.daten.einfuegen('alarm_regeln', neu as unknown as Record<string, unknown>[]);
      } catch {
        // später erneut
      }
    }
    // Sperrfristen nach einem Neustart weiterführen
    try {
      const seit = new Date(this.jetzt().getTime() - 24 * 3600 * 1000).toISOString();
      const letzte = await this.daten.liste<{ schluessel: string; erstellt: string; status: string }>(
        'alarme',
        {
          filter: { erstellt: { gte: seit }, status: 'gesendet' },
          limit: 1000,
        },
      );
      for (const a of letzte) if (a.schluessel) this.zuletzt.set(a.schluessel, new Date(a.erstellt));
    } catch {
      // egal
    }
  }

  alleRegeln(): AlarmRegel[] {
    return [...this.regeln.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  regel(id: string) {
    return this.regeln.get(id);
  }

  async regelAendern(id: string, a: Partial<AlarmRegel>): Promise<AlarmRegel> {
    const r = this.regeln.get(id);
    if (!r) throw new Error('Unbekannte Regel');
    const neu = { ...r, ...a, id: r.id, modul: r.modul, name: r.name, beschreibung: r.beschreibung };
    this.regeln.set(id, neu);
    const { id: _, ...rest } = neu;
    const vorhanden = await this.daten.hole('alarm_regeln', id);
    if (vorhanden) await this.daten.aendern('alarm_regeln', id, rest);
    else await this.daten.einfuegen('alarm_regeln', [neu as unknown as Record<string, unknown>]);
    return neu;
  }

  /** Ein Modul meldet ein Ereignis. Gibt den Entscheid zurück. */
  async melden(e: Ereignis): Promise<Entscheid & { status: string }> {
    const regel = this.regeln.get(e.regel);
    const jetzt = this.jetzt();
    const schluessel = e.schluessel ?? `${e.regel}:${e.titel}`;
    const entscheid = entscheiden(regel, e, jetzt, this.zuletzt.get(schluessel));
    let status: string = entscheid.aktion;
    let grund = entscheid.grund;
    if (entscheid.aktion === 'senden') {
      this.zuletzt.set(schluessel, jetzt);
      if (this.demo()) {
        status = 'demo';
        grund = 'Demo Modus: nur protokolliert';
      } else if (!this.ntfy().thema) {
        status = 'nicht_konfiguriert';
        grund = 'ntfy Thema fehlt';
      } else {
        try {
          await this.sender(this.ntfy(), {
            titel: e.titel,
            text: e.text,
            prioritaet: e.prioritaet ?? regel?.prioritaet ?? 3,
            tags: e.tags,
            klickUrl: e.link,
          });
          status = 'gesendet';
        } catch (err) {
          status = 'fehler';
          grund = fehlerText(err).slice(0, 200);
        }
      }
    }
    // Sperrfrist und nicht erreichte Schwelle nicht speichern: Messwerte wie die Temperatur kommen
    // alle paar Minuten und würden die Alarmzentrale mit Rauschen füllen
    if (!(entscheid.aktion === 'verworfen' && /^(Bereits|Schwelle nicht)/.test(grund))) {
      try {
        await this.daten.einfuegen('alarme', [
          {
            regel: e.regel,
            modul: regel?.modul ?? e.regel.split('.')[0],
            titel: e.titel,
            text: e.text,
            prioritaet: e.prioritaet ?? regel?.prioritaet ?? 3,
            status,
            grund,
            schluessel,
            wert: e.wert ?? null,
          },
        ]);
      } catch {
        // Protokoll ist nicht kritisch
      }
    }
    return { ...entscheid, status, grund };
  }

  /** Testnachricht direkt über ntfy, unabhängig von Regeln */
  async test(): Promise<void> {
    if (this.demo()) return;
    await this.sender(this.ntfy(), {
      titel: 'Pi Hub Test',
      text: 'Testnachricht vom Pi Hub. Push funktioniert.',
      prioritaet: 3,
      tags: ['white_check_mark'],
    });
  }
}
