// Agent Schleife: Modell fragen, Werkzeuge ausführen (nach Vollmacht), Ergebnisse zurückgeben, bis die Antwort steht.
import { randomUUID } from 'node:crypto';
import { schwaerzen } from '../../kern/aktivitaet.ts';
import { geheimeWerte } from '../../konfig.ts';
import type { Kontext } from '../../kern/modul.ts';
import type { Gedaechtnis } from './gedaechtnis.ts';
import type { Block, ModellFn, Nachricht } from './modell.ts';
import { systemBloecke } from './persona.ts';
import { entscheid, VOLLMACHTEN, type Vollmacht, type Werkzeug, werkzeugListe } from './werkzeuge.ts';

export type AgentEreignis =
  | { art: 'gespraech'; id: string }
  | { art: 'text'; text: string }
  | { art: 'werkzeug'; id: string; name: string; beschreibung: string }
  | { art: 'ergebnis'; id: string; ok: boolean; kurz: string }
  | { art: 'bestaetigung'; id: string; werkzeug: string; beschreibung: string }
  | { art: 'navigation'; ziel: string }
  | { art: 'fertig'; gespraechId: string }
  | { art: 'fehler'; text: string };

export const MAX_RUNDEN = 12;
const ERGEBNIS_MAX = 6000;
const VERLAUF_MAX = 40;
const FRIST_MS = 30 * 60 * 1000;

interface Ausstehend {
  werkzeug: Werkzeug;
  eingabe: Record<string, unknown>;
  bis: number;
}

export interface Einstellung {
  vollmacht: Vollmacht;
  tageslimit: number;
  persoenlichkeit: string;
  modell: 'standard' | 'schnell';
  web: boolean;
  morgenpush: boolean;
}

export function einstellungLesen(ctx: Kontext): Einstellung {
  const v = ctx.einstellungen.hole<string>('jarvis.vollmacht', 'autonom');
  const m = ctx.einstellungen.hole<string>('jarvis.modell', 'standard');
  return {
    vollmacht: (VOLLMACHTEN as string[]).includes(v) ? (v as Vollmacht) : 'autonom',
    tageslimit: Number(ctx.einstellungen.hole<number>('jarvis.tageslimit', 600000)) || 600000,
    persoenlichkeit: ctx.einstellungen.hole<string>('jarvis.persoenlichkeit', 'butler'),
    modell: m === 'schnell' ? 'schnell' : 'standard',
    web: ctx.einstellungen.hole<boolean>('jarvis.web', true) !== false,
    morgenpush: ctx.einstellungen.hole<boolean>('jarvis.morgenpush', false) === true,
  };
}

function kuerzen(wert: unknown, geheim: string[]): string {
  let t: string;
  try {
    t = typeof wert === 'string' ? wert : (JSON.stringify(wert) ?? 'null');
  } catch {
    t = String(wert);
  }
  t = schwaerzen(t, geheim);
  return t.length > ERGEBNIS_MAX ? `${t.slice(0, ERGEBNIS_MAX)} ... (gekürzt, ${t.length} Zeichen)` : t;
}

/** Bringt den gespeicherten Verlauf in eine gültige Form: Beginn mit Nutzertext, keine offenen Werkzeugaufrufe. */
export function verlaufBereinigen(roh: Nachricht[]): Nachricht[] {
  let n = roh.slice(-VERLAUF_MAX);
  const start = n.findIndex((m) => m.role === 'user' && typeof m.content === 'string');
  n = start < 0 ? [] : n.slice(start);
  const letzte = n[n.length - 1];
  if (
    letzte?.role === 'assistant' &&
    Array.isArray(letzte.content) &&
    letzte.content.some((b) => b.type === 'tool_use')
  )
    n = n.slice(0, -1);
  return n;
}

/** Blöcke der serverseitigen Websuche enthalten verschlüsselte Rohdaten und werden nicht gespeichert. */
function nurLokal(bloecke: Block[]): Block[] {
  return bloecke.filter((b) => b.type !== 'server_tool_use' && b.type !== 'web_search_tool_result');
}

export class Agent {
  private ctx: Kontext;
  private gedaechtnis: Gedaechtnis;
  private modell: () => ModellFn;
  private modellNamen: () => { standard: string; schnell: string };
  private werkzeuge = new Map<string, Werkzeug>();
  readonly ausstehend = new Map<string, Ausstehend>();

  constructor(
    ctx: Kontext,
    gedaechtnis: Gedaechtnis,
    modell: () => ModellFn,
    modellNamen: () => { standard: string; schnell: string },
  ) {
    this.ctx = ctx;
    this.gedaechtnis = gedaechtnis;
    this.modell = modell;
    this.modellNamen = modellNamen;
    for (const w of werkzeugListe()) this.werkzeuge.set(w.def.name, w);
  }

  werkzeugAnzahl() {
    return this.werkzeuge.size;
  }

  async tokensHeute(): Promise<number> {
    const heute = new Date(this.ctx.jetzt());
    heute.setHours(0, 0, 0, 0);
    const zeilen = await this.ctx.daten.liste<{ tokens_ein: number; tokens_aus: number }>('jarvis_nutzung', {
      filter: { erstellt: { gte: heute.toISOString() } },
      limit: 5000,
    });
    return zeilen.reduce((s, z) => s + (z.tokens_ein ?? 0) + (z.tokens_aus ?? 0), 0);
  }

  private wkKontext(web: boolean) {
    return { ctx: this.ctx, gedaechtnis: this.gedaechtnis, web };
  }

  private async speichern(gespraechId: string, rolle: 'user' | 'assistant', inhalt: string | Block[]) {
    await this.ctx.daten.einfuegen('jarvis_nachrichten', [{ gespraech_id: gespraechId, rolle, inhalt }]);
  }

  private async verlaufLaden(gespraechId: string): Promise<Nachricht[]> {
    const zeilen = await this.ctx.daten.liste<{ rolle: 'user' | 'assistant'; inhalt: string | Block[] }>(
      'jarvis_nachrichten',
      { filter: { gespraech_id: gespraechId }, sortierung: '-erstellt', limit: VERLAUF_MAX + 20 },
    );
    return verlaufBereinigen(zeilen.reverse().map((z) => ({ role: z.rolle, content: z.inhalt })));
  }

  /** Führt ein Werkzeug aus und gibt Ergebnistext und Erfolg zurück. */
  async ausfuehren(w: Werkzeug, eingabe: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
    const geheim = geheimeWerte(this.ctx.konfig);
    const s = einstellungLesen(this.ctx);
    try {
      const r = await w.lauf(eingabe, this.wkKontext(s.web));
      if (w.art !== 'lesen')
        await this.ctx.aktivitaet('jarvis', `${w.beschreibung(eingabe)}`.slice(0, 200), 'aktion');
      return { ok: true, text: kuerzen(r, geheim) };
    } catch (e) {
      return { ok: false, text: kuerzen(`Fehler: ${(e as Error).message}`, geheim) };
    }
  }

  /** Bestätigt oder verwirft eine ausstehende kritische Aktion. */
  async bestaetigen(id: string, ja: boolean): Promise<{ ok: boolean; text: string }> {
    const a = this.ausstehend.get(id);
    this.ausstehend.delete(id);
    if (!a || a.bis < Date.now()) return { ok: false, text: 'Die Anfrage ist abgelaufen oder unbekannt.' };
    if (!ja) return { ok: true, text: 'Verworfen.' };
    return this.ausfuehren(a.werkzeug, a.eingabe);
  }

  async *lauf(opt: {
    gespraechId?: string;
    nachricht: string;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentEreignis> {
    const s = einstellungLesen(this.ctx);
    const geheim = geheimeWerte(this.ctx.konfig);
    const nachricht = opt.nachricht.trim().slice(0, 4000);
    if (!nachricht) {
      yield { art: 'fehler', text: 'Leere Nachricht' };
      return;
    }
    if ((await this.tokensHeute()) >= s.tageslimit) {
      yield {
        art: 'fehler',
        text: 'Das Tageslimit für Jarvis ist erreicht. Du kannst es in den Einstellungen erhöhen.',
      };
      return;
    }

    let gespraechId = opt.gespraechId;
    if (gespraechId && !(await this.ctx.daten.hole('jarvis_gespraeche', gespraechId)))
      gespraechId = undefined;
    if (!gespraechId) {
      const g = await this.ctx.daten.eins<{ id: string }>('jarvis_gespraeche', {
        titel: nachricht.slice(0, 60),
      });
      gespraechId = g.id;
    }
    yield { art: 'gespraech', id: gespraechId };

    const verlauf = await this.verlaufLaden(gespraechId);
    verlauf.push({ role: 'user', content: nachricht });
    await this.speichern(gespraechId, 'user', nachricht);

    const namen = this.modellNamen();
    const modellName = s.modell === 'schnell' ? namen.schnell : namen.standard;
    const defs = [...this.werkzeuge.values()].map((w) => w.def);
    const system = systemBloecke({
      persoenlichkeit: s.persoenlichkeit,
      vollmacht: s.vollmacht,
      profil: await this.gedaechtnis.profilText(),
      jetzt: this.ctx.jetzt(),
      web: s.web,
    });
    const modell = this.modell();

    try {
      for (let runde = 0; runde < MAX_RUNDEN; runde++) {
        let bloecke: Block[] = [];
        let grund = 'end_turn';
        let ein = 0;
        let aus = 0;
        for await (const ev of modell({
          modell: modellName,
          system,
          nachrichten: verlauf,
          werkzeuge: defs,
          maxTokens: 2048,
          websuche: s.web,
          signal: opt.signal,
        })) {
          if (ev.art === 'text') yield { art: 'text', text: schwaerzen(ev.text, geheim) };
          else {
            bloecke = ev.bloecke;
            grund = ev.grund;
            ein = ev.tokensEin;
            aus = ev.tokensAus;
          }
        }
        await this.ctx.daten
          .eins('jarvis_nutzung', { modell: modellName, tokens_ein: ein, tokens_aus: aus })
          .catch(() => undefined);

        const aufrufe = bloecke.filter(
          (b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use',
        );
        if (grund === 'pause_turn') {
          // Die Websuche der API braucht mehr Zeit: Antwort unverändert fortsetzen lassen
          verlauf.push({ role: 'assistant', content: bloecke });
          continue;
        }
        if (grund !== 'tool_use' || !aufrufe.length) {
          const bleibt = nurLokal(bloecke);
          if (bleibt.length) await this.speichern(gespraechId, 'assistant', bleibt);
          if (grund === 'max_tokens') yield { art: 'text', text: ' ...' };
          break;
        }

        const ergebnisse: Block[] = [];
        for (const a of aufrufe) {
          const w = this.werkzeuge.get(a.name);
          if (!w) {
            ergebnisse.push({
              type: 'tool_result',
              tool_use_id: a.id,
              content: 'Unbekanntes Werkzeug',
              is_error: true,
            });
            continue;
          }
          const beschreibung = w.beschreibung(a.input);
          yield { art: 'werkzeug', id: a.id, name: a.name, beschreibung };
          const e = entscheid(w.art, s.vollmacht);
          let res: { ok: boolean; text: string };
          if (e === 'nein') {
            res = { ok: false, text: 'Nicht erlaubt: Die Vollmacht steht auf «nur lesen».' };
          } else if (e === 'fragen') {
            const id = randomUUID();
            this.ausstehend.set(id, { werkzeug: w, eingabe: a.input, bis: Date.now() + FRIST_MS });
            yield { art: 'bestaetigung', id, werkzeug: a.name, beschreibung };
            res = { ok: true, text: 'Wartet auf Bestätigung von Jerome. Noch nichts ausgeführt.' };
          } else {
            res = await this.ausfuehren(w, a.input);
          }
          yield { art: 'ergebnis', id: a.id, ok: res.ok, kurz: res.text.slice(0, 160) };
          if (res.ok && a.name === 'hub_oeffnen' && e === 'ja')
            yield { art: 'navigation', ziel: String(a.input.ziel ?? '') };
          ergebnisse.push({
            type: 'tool_result',
            tool_use_id: a.id,
            content: res.text,
            is_error: !res.ok || undefined,
          });
        }
        verlauf.push({ role: 'assistant', content: bloecke }, { role: 'user', content: ergebnisse });
        await this.speichern(gespraechId, 'assistant', nurLokal(bloecke));
        await this.speichern(gespraechId, 'user', ergebnisse);
        if (runde === MAX_RUNDEN - 1)
          yield { art: 'text', text: '\n(Abgebrochen nach zu vielen Schritten.)' };
      }
      yield { art: 'fertig', gespraechId };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      yield { art: 'fehler', text: (e as Error).message };
    }
  }
}
