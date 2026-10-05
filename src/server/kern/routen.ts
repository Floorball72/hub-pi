// Kern Routen: Module, Kacheln, Status, System, Alarmzentrale, Suche, Timeline, Briefing, Karte.
import type { FastifyInstance } from 'fastify';
import type { AlarmRegel, Ampel, BriefingTeil, Ebene, Kachel, SuchTreffer } from '../geteilt/typen.ts';
import { EingabeFehler } from '../daten/schema.ts';
import { fehlerText } from './fehler.ts';
import type { Hub } from './hub.ts';
import { systemStatus } from './system.ts';
import { hhmmZuMinuten } from './zeit.ts';

export async function mitTimeout<T>(p: Promise<T>, ms: number, text = 'Zeitüberschreitung'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(text)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const RANG: Record<Ampel, number> = { neutral: 0, ok: 1, warnung: 2, ausfall: 3 };

export function schlimmste(liste: Ampel[]): Ampel {
  return liste.reduce<Ampel>((a, b) => (RANG[b] > RANG[a] ? b : a), 'ok');
}

export async function kachelnSammeln(hub: Hub): Promise<Record<string, Kachel>> {
  const aus: Record<string, Kachel> = {};
  await Promise.all(
    [...hub.module.entries()].map(async ([id, m]) => {
      if (!hub.modulAktiv(id)) {
        aus[id] = { status: 'neutral', wert: 'Aus', unter: 'Modul ausgeschaltet' };
        return;
      }
      if (m.fehler) {
        aus[id] = { status: 'ausfall', hinweis: 'Modul konnte nicht geladen werden' };
        return;
      }
      if (!m.laufzeit.kachel) return;
      try {
        aus[id] = await mitTimeout(m.laufzeit.kachel(), 8000);
      } catch (e) {
        aus[id] = { status: 'ausfall', hinweis: fehlerText(e).slice(0, 120) };
      }
    }),
  );
  return aus;
}

function regelPruefen(a: Partial<AlarmRegel>): Partial<AlarmRegel> {
  const r: Partial<AlarmRegel> = {};
  if (a.aktiv !== undefined) r.aktiv = !!a.aktiv;
  if (a.nachts !== undefined) r.nachts = !!a.nachts;
  if (a.prioritaet !== undefined) {
    const p = Number(a.prioritaet);
    if (!Number.isInteger(p) || p < 1 || p > 5) throw new EingabeFehler('Priorität 1 bis 5');
    r.prioritaet = p;
  }
  if (a.schwelle !== undefined) {
    if (a.schwelle === null) r.schwelle = null;
    else {
      const s = Number(a.schwelle);
      if (!Number.isFinite(s)) throw new EingabeFehler('Schwelle muss eine Zahl sein');
      r.schwelle = s;
    }
  }
  for (const f of ['ruhe_von', 'ruhe_bis'] as const) {
    if (a[f] !== undefined) {
      if (a[f] === null || a[f] === '') r[f] = null;
      else {
        try {
          hhmmZuMinuten(String(a[f]));
        } catch {
          throw new EingabeFehler('Zeit im Format HH:MM');
        }
        r[f] = String(a[f]);
      }
    }
  }
  if (a.cooldown_min !== undefined) {
    const c = Number(a.cooldown_min);
    if (!Number.isInteger(c) || c < 0 || c > 10080) throw new EingabeFehler('Sperrfrist 0 bis 10080 Minuten');
    r.cooldown_min = c;
  }
  return r;
}

export function kernRouten(app: FastifyInstance, hub: Hub) {
  app.get('/api/module', async () => hub.modulInfos());

  app.post<{ Params: { id: string }; Body: { aktiv: boolean; bestaetigt?: boolean } }>(
    '/api/module/:id',
    async (req) => {
      const def = hub.definitionen.find((d) => d.id === req.params.id);
      if (!def) throw new EingabeFehler('Unbekanntes Modul');
      if (def.pflicht) throw new EingabeFehler('Dieses Modul kann nicht ausgeschaltet werden');
      if (req.body?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
      await hub.einstellungen.setze(`modul.${def.id}.aktiv`, !!req.body.aktiv);
      await hub.aktivitaet(
        'kern',
        `Modul ${def.name} ${req.body.aktiv ? 'eingeschaltet' : 'ausgeschaltet'}`,
        'aktion',
      );
      return hub.modulInfos();
    },
  );

  app.get('/api/start', async () => {
    const kacheln = await kachelnSammeln(hub);
    const status = schlimmste(Object.values(kacheln).map((k) => k.status));
    return {
      status,
      kacheln,
      module: hub.modulInfos(),
      demo: hub.konfig.demo,
      zeit: hub.jetzt().toISOString(),
    };
  });

  app.get('/api/status', async () => {
    let pufferAnzahl = 0;
    try {
      pufferAnzahl = await hub.daten.pufferAnzahl();
    } catch {
      // egal
    }
    let datenOk = false;
    try {
      datenOk = await mitTimeout(hub.daten.treiber.ping(), 5000);
    } catch {
      datenOk = false;
    }
    return {
      module: hub.modulInfos().map((m) => ({ ...m, fehler: hub.module.get(m.id)?.fehler ?? null })),
      quellen: hub.alleQuellen().map((q) => q.status()),
      jobs: hub.scheduler.status(),
      daten: {
        treiber: hub.daten.treiber.name,
        verbunden: datenOk,
        letzterFehler: hub.daten.letzterFehler,
        puffer: pufferAnzahl,
      },
      push: { konfiguriert: !!hub.konfig.ntfy.thema, server: hub.konfig.ntfy.server },
      demo: hub.konfig.demo,
      start: hub.start.toISOString(),
    };
  });

  app.get('/api/system', async () => systemStatus(hub.konfig.datenVerzeichnis));

  app.get('/api/alarm/regeln', async () =>
    hub.alarm.alleRegeln().map((r) => ({ ...r, modulAktiv: hub.modulAktiv(r.modul) })),
  );
  app.put<{ Params: { id: string }; Body: Partial<AlarmRegel> }>('/api/alarm/regeln/:id', async (req) => {
    if (!hub.alarm.regel(req.params.id)) throw new EingabeFehler('Unbekannte Regel');
    const r = await hub.alarm.regelAendern(req.params.id, regelPruefen(req.body ?? {}));
    await hub.aktivitaet('kern', `Alarmregel «${r.name}» geändert`, 'aktion');
    return r;
  });
  app.get<{ Querystring: { limit?: string } }>('/api/alarm/verlauf', async (req) =>
    hub.daten.liste('alarme', {
      sortierung: '-erstellt',
      limit: Math.min(Number(req.query.limit) || 100, 500),
    }),
  );
  app.post('/api/alarm/test', async () => {
    if (hub.konfig.demo) return { ok: true, hinweis: 'Demo Modus: keine echte Nachricht gesendet' };
    if (!hub.konfig.ntfy.thema) throw new EingabeFehler('ntfy Thema fehlt');
    await hub.alarm.test();
    await hub.aktivitaet('kern', 'Testnachricht über ntfy gesendet', 'aktion');
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: string; modul?: string } }>('/api/aktivitaet', async (req) =>
    hub.daten.liste('aktivitaet', {
      filter: req.query.modul ? { modul: req.query.modul } : undefined,
      sortierung: '-erstellt',
      limit: Math.min(Number(req.query.limit) || 100, 500),
    }),
  );

  app.get<{ Querystring: { q?: string } }>('/api/suche', async (req) => {
    const q = String(req.query.q ?? '')
      .trim()
      .slice(0, 80);
    if (q.length < 2) return [];
    const treffer: SuchTreffer[] = [];
    // Bearbeitbare Tabellen mit Suchfeldern
    for (const t of hub.daten.alleTabellen()) {
      if (!t.suche?.length || !hub.modulAktiv(t.modul)) continue;
      for (const feld of t.suche) {
        try {
          const zeilen = await hub.daten.liste<Record<string, unknown>>(t.name, {
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
      [...hub.module.entries()].map(async ([id, m]) => {
        if (!m.laufzeit.suche || !hub.modulAktiv(id)) return;
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
  });

  app.get<{ Querystring: { von?: string; bis?: string } }>('/api/timeline', async (req) => {
    const von = req.query.von ? new Date(req.query.von) : new Date(hub.jetzt().getTime() - 86400000);
    const bis = req.query.bis ? new Date(req.query.bis) : new Date(hub.jetzt().getTime() + 30 * 86400000);
    if (Number.isNaN(von.getTime()) || Number.isNaN(bis.getTime()))
      throw new EingabeFehler('Ungültiger Zeitraum');
    return hub.timeline(von, bis);
  });

  app.get('/api/briefing', async () => {
    const teile: BriefingTeil[] = [];
    await Promise.all(
      [...hub.module.entries()].map(async ([id, m]) => {
        if (!m.laufzeit.briefing || !hub.modulAktiv(id)) return;
        try {
          const t = await mitTimeout(m.laufzeit.briefing(), 8000);
          if (t) teile.push(t);
        } catch {
          // egal
        }
      }),
    );
    return {
      teile: teile.sort((a, b) => a.reihenfolge - b.reihenfolge),
      zeit: hub.jetzt().toISOString(),
      demo: hub.konfig.demo,
    };
  });

  app.get('/api/abendbericht', async () => ({
    teile: await hub.abendbericht(),
    zeit: hub.jetzt().toISOString(),
    demo: hub.konfig.demo,
  }));

  app.get('/api/karte/ebenen', async () => {
    const ebenen: Ebene[] = [];
    for (const [id, m] of hub.module) {
      if (!m.laufzeit.ebenen || !hub.modulAktiv(id)) continue;
      ebenen.push(...m.laufzeit.ebenen());
    }
    return { ebenen, auswahl: hub.einstellungen.hole<string[] | null>('karte.auswahl', null) };
  });
  app.put<{ Body: { auswahl: string[] } }>('/api/karte/auswahl', async (req) => {
    const a = req.body?.auswahl;
    if (!Array.isArray(a) || a.length > 100 || !a.every((x) => typeof x === 'string' && x.length < 80)) {
      throw new EingabeFehler('Ungültige Auswahl');
    }
    await hub.einstellungen.setze('karte.auswahl', a);
    return { ok: true };
  });
}
