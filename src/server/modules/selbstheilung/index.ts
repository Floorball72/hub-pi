// Modul Selbstheilung: Watchdog für Jobs, Module und den Dienst selbst.
// Reihenfolge: Modul neu laden, dann Jobs mit wachsender Pause aussetzen, im Notfall den Dienst neu starten
// (systemd startet ihn wieder). Räumt auf und verdichtet früher, wenn der Speicher knapp wird.
// Alles landet im Aktivitätslog. Eine Nachricht gibt es nur, wenn die Selbsthilfe nicht reicht.
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';
import { EingabeFehler } from '../../daten/schema.ts';
import { verdichten } from '../../daten/verdichtung.ts';
import type { Ampel, Kachel } from '../../geteilt/typen.ts';
import { backupListe, backupVerzeichnis } from '../../kern/backup.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import type { JobStatus } from '../../kern/scheduler.ts';
import { systemStatus } from '../../kern/system.ts';

/** Pausen nach wiederholten Fehlern in Minuten */
export const PAUSEN_MIN = [15, 60, 240, 720];
export const FEHLER_SCHWELLE = 3;
export const RSS_GRENZE_MB = 300;
export const HAENGT_MIN = 30;

export type Massnahme =
  | { art: 'nichts' }
  | { art: 'modul_neu_laden'; modul: string }
  | { art: 'pausieren'; job: string; minuten: number; hilfe: boolean }
  | { art: 'dienst_neustart'; grund: string };

export interface JobVerlauf {
  /** Wann das Modul zuletzt neu geladen wurde */
  neuGeladen?: number;
  pausen: number;
}

/** Entscheidet für einen Job, was zu tun ist. Reine Funktion, damit testbar. */
export function jobMassnahme(
  j: JobStatus,
  v: JobVerlauf,
  jetzt: number,
  intervallSek: number | undefined,
): Massnahme {
  if (
    j.laeuft &&
    j.laeuftSeit &&
    jetzt - j.laeuftSeit > Math.max(HAENGT_MIN * 60000, (intervallSek ?? 0) * 10 * 1000)
  )
    return {
      art: 'dienst_neustart',
      grund: `Job «${j.name}» hängt seit ${Math.round((jetzt - j.laeuftSeit) / 60000)} Minuten`,
    };
  if (j.fehlerInFolge < FEHLER_SCHWELLE) return { art: 'nichts' };
  if (j.pausiertBis && Date.parse(j.pausiertBis) > jetzt) return { art: 'nichts' };
  if (!v.neuGeladen || jetzt - v.neuGeladen > 6 * 3600000) return { art: 'modul_neu_laden', modul: j.modul };
  const stufe = Math.min(v.pausen, PAUSEN_MIN.length - 1);
  return {
    art: 'pausieren',
    job: j.id,
    minuten: PAUSEN_MIN[stufe],
    hilfe: v.pausen + 1 >= PAUSEN_MIN.length,
  };
}

/** Speicher knapp? Grenze: unter 2 GB oder unter 10 % frei */
export function speicherKnapp(freiGb: number | null, gesamtGb: number | null): 'ok' | 'knapp' | 'kritisch' {
  if (freiGb === null) return 'ok';
  if (freiGb < 0.8) return 'kritisch';
  if (freiGb < 2 || (gesamtGb && freiGb / gesamtGb < 0.1)) return 'knapp';
  return 'ok';
}

export const selbstheilung: ModulDef = {
  id: 'selbstheilung',
  name: 'Selbstheilung',
  beschreibung:
    'Watchdog: startet Module neu, pausiert fehlerhafte Jobs, räumt auf und verdichtet bei wenig Speicher',
  symbol: 'heilung',
  reihenfolge: 93,
  regeln: [
    {
      id: 'hilfe',
      name: 'Selbstheilung braucht Hilfe',
      beschreibung:
        'Der Hub kann ein Problem nicht selbst lösen (z.B. Job fällt trotz Pausen weiter aus, Speicher voll, häufige Neustarts).',
      prioritaet: 4,
      cooldownMin: 720,
    },
  ],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  const verlauf = new Map<string, JobVerlauf>();
  const modulGeladen = new Map<string, number>();
  let rssZuHoch = 0;
  let schleifeLangsam = 0;
  const schleife = monitorEventLoopDelay({ resolution: 50 });
  schleife.enable();

  const log = (text: string, art: 'info' | 'warnung' | 'aktion' = 'aktion') =>
    ctx.aktivitaet('selbstheilung', text, art);

  async function hilfe(titel: string, text: string, schluessel: string) {
    await log(`${titel}: ${text}`, 'warnung');
    await ctx.alarm.melden({
      regel: 'selbstheilung.hilfe',
      titel,
      text,
      schluessel,
      link: '/modul/selbstheilung',
    });
  }

  async function dienstNeustart(grund: string) {
    const neustarts = ctx.einstellungen
      .hole<string[]>('selbstheilung.neustarts', [])
      .filter((t) => ctx.jetzt().getTime() - Date.parse(t) < 86400000);
    if (neustarts.some((t) => ctx.jetzt().getTime() - Date.parse(t) < 3600000) || neustarts.length >= 3) {
      await hilfe(
        'Pi Hub: wiederholte Probleme',
        `${grund}. Neustart wurde heute schon ${neustarts.length} Mal versucht.`,
        'neustart',
      );
      return;
    }
    await ctx.einstellungen.setze('selbstheilung.neustarts', [...neustarts, ctx.jetzt().toISOString()]);
    await log(`Dienst wird neu gestartet: ${grund}`);
    if (konfig.demo || !process.env.INVOCATION_ID) {
      // Ohne systemd (Entwicklung, Demo) nicht beenden, nur protokollieren
      await log('Neustart übersprungen (läuft nicht unter systemd)', 'info');
      return;
    }
    await ctx.kern.metriken.leeren();
    setTimeout(() => process.exit(75), 500);
  }

  async function wache(): Promise<string | undefined> {
    const jetzt = ctx.jetzt().getTime();
    const aktionen: string[] = [];
    // 1. Module, die beim Start nicht geladen werden konnten
    for (const m of ctx.kern.module()) {
      if (!m.fehler || !m.aktiv) continue;
      const zuletzt = modulGeladen.get(m.id) ?? 0;
      if (jetzt - zuletzt < 30 * 60000) continue;
      modulGeladen.set(m.id, jetzt);
      const ok = await ctx.kern.modulNeuLaden(m.id);
      await log(
        `Modul «${m.name}» neu geladen: ${ok ? 'erfolgreich' : 'weiterhin fehlerhaft'}`,
        ok ? 'aktion' : 'warnung',
      );
      aktionen.push(`${m.name} neu geladen`);
    }
    // 2. Jobs mit wiederholten Fehlern oder die hängen
    for (const j of ctx.kern.scheduler.status()) {
      if (j.modul === 'selbstheilung') continue;
      const v = verlauf.get(j.id) ?? { pausen: 0 };
      verlauf.set(j.id, v);
      if (j.fehlerInFolge === 0 && !j.laeuft) v.pausen = 0;
      const m = jobMassnahme(j, { ...v, neuGeladen: modulGeladen.get(j.modul) }, jetzt, j.intervallSek);
      if (m.art === 'modul_neu_laden') {
        modulGeladen.set(j.modul, jetzt);
        const ok = await ctx.kern.modulNeuLaden(j.modul);
        await log(
          `Job «${j.name}» schlug ${j.fehlerInFolge} Mal fehl (${j.letzterFehler ?? ''}). Modul ${j.modul} neu geladen${ok ? '' : ', ohne Erfolg'}.`,
        );
        aktionen.push(`${j.modul} neu geladen`);
      } else if (m.art === 'pausieren') {
        v.pausen++;
        ctx.kern.scheduler.pausieren(j.id, new Date(jetzt + m.minuten * 60000));
        await log(
          `Job «${j.name}» pausiert für ${m.minuten} Minuten (Fehler: ${j.letzterFehler ?? 'unbekannt'})`,
        );
        aktionen.push(`${j.name} pausiert`);
        if (m.hilfe)
          await hilfe(
            `Pi Hub: ${j.name} fällt weiter aus`,
            `${j.fehlerInFolge} Fehler in Folge, letzte Meldung: ${j.letzterFehler ?? 'unbekannt'}`,
            `job:${j.id}`,
          );
      } else if (m.art === 'dienst_neustart') {
        await dienstNeustart(m.grund);
        return m.grund;
      }
    }
    // 3. Speicher und Ereignisschleife
    const s = await systemStatus(konfig.datenVerzeichnis);
    rssZuHoch = s.prozessRssMb > RSS_GRENZE_MB ? rssZuHoch + 1 : 0;
    const p99 = schleife.percentile(99) / 1e6;
    schleife.reset();
    schleifeLangsam = p99 > 2000 ? schleifeLangsam + 1 : 0;
    if (rssZuHoch >= 3) {
      rssZuHoch = 0;
      await dienstNeustart(
        `Arbeitsspeicher seit 3 Prüfungen über ${RSS_GRENZE_MB} MB (${s.prozessRssMb} MB)`,
      );
      return 'Neustart wegen RAM';
    }
    if (schleifeLangsam >= 3) {
      schleifeLangsam = 0;
      await dienstNeustart(`Hub reagiert träge (Verzögerung ${Math.round(p99)} ms)`);
      return 'Neustart wegen Trägheit';
    }
    const sp = speicherKnapp(s.speicherFreiGb, s.speicherGesamtGb);
    if (sp !== 'ok') {
      const r = await aufraeumen(true);
      aktionen.push(r);
      const nachher = await systemStatus(konfig.datenVerzeichnis);
      if (speicherKnapp(nachher.speicherFreiGb, nachher.speicherGesamtGb) === 'kritisch')
        await hilfe(
          'Pi Hub: Speicher fast voll',
          `Nur noch ${nachher.speicherFreiGb} GB frei, auch nach dem Aufräumen.`,
          'speicher',
        );
    }
    return aktionen.length ? aktionen.join(', ') : undefined;
  }

  /** Aufräumen: Temp Dateien, alte Backups; bei wenig Speicher zusätzlich früher verdichten */
  async function aufraeumen(stark: boolean): Promise<string> {
    const teile: string[] = [];
    // Temporäre Dateien des Hubs (älter als ein Tag)
    const tmp = join(konfig.datenVerzeichnis, 'tmp');
    try {
      let n = 0;
      for (const f of await readdir(tmp)) {
        const p = join(tmp, f);
        if (ctx.jetzt().getTime() - (await stat(p)).mtimeMs > 86400000) {
          await rm(p, { recursive: true, force: true });
          n++;
        }
      }
      if (n) teile.push(`${n} temporäre Dateien`);
    } catch {
      // kein tmp Verzeichnis
    }
    // Backups: normal 14, bei wenig Speicher nur 5 behalten
    const dir = backupVerzeichnis(konfig.datenVerzeichnis);
    const behalten = stark ? 5 : 14;
    const liste = backupListe(dir);
    for (const b of liste.slice(behalten)) await rm(join(dir, b.name), { force: true });
    if (liste.length > behalten) teile.push(`${liste.length - behalten} alte Backups`);
    // Gepufferte Messwerte, die seit 14 Tagen nicht nachgesendet werden konnten
    const alterPuffer = await daten.puffer
      ?.loescheWo('puffer', {
        erstellt: { lt: new Date(ctx.jetzt().getTime() - 14 * 86400000).toISOString() },
      })
      .catch(() => 0);
    if (alterPuffer) teile.push(`${alterPuffer} alte Pufferwerte`);
    if (stark) {
      // Früher verdichten: Rohdaten schon nach 3 statt 14 bis 31 Tagen zu Stundenwerten
      const regeln = [
        {
          quelle: 'pruefungen',
          ziel: 'pruefungen_stunden',
          gruppe: ['seite_id'],
          felder: [
            { ziel: 'ok', art: 'anteil' as const, feld: 'ok' },
            { ziel: 'ms', art: 'mittel' as const, feld: 'ms' },
            { ziel: 'ms_max', art: 'max' as const, feld: 'ms' },
          ],
        },
        {
          quelle: 'park_messungen',
          ziel: 'park_stunden',
          gruppe: ['ph_id'],
          felder: [
            { ziel: 'prozent', art: 'mittel' as const, feld: 'prozent' },
            { ziel: 'frei', art: 'mittel' as const, feld: 'frei' },
          ],
        },
        {
          quelle: 'metrik_werte',
          ziel: 'metrik_stunden',
          gruppe: ['metrik'],
          felder: [{ ziel: 'wert', art: 'mittel' as const, feld: 'wert' }],
        },
      ];
      let n = 0;
      for (const r of regeln)
        if (daten.tabelle(r.quelle))
          n += await verdichten(daten, { ...r, nachTagen: 3, intervall: 'stunde' }, ctx.jetzt()).catch(
            () => 0,
          );
      if (n) teile.push(`${n} Rohwerte früher verdichtet`);
    }
    const text = teile.length ? `Aufgeräumt: ${teile.join(', ')}` : 'Aufräumen: nichts zu tun';
    if (teile.length) await log(text);
    return text;
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => {
      const jobs = ctx.kern.scheduler.status();
      const s = await systemStatus(konfig.datenVerzeichnis);
      return {
        jobs: jobs.filter((j) => j.fehlerInFolge > 0 || j.pausiertBis || j.laeuft),
        anzahlJobs: jobs.length,
        module: ctx.kern.module().filter((m) => m.fehler),
        system: {
          rssMb: s.prozessRssMb,
          speicherFreiGb: s.speicherFreiGb,
          speicher: speicherKnapp(s.speicherFreiGb, s.speicherGesamtGb),
          schleifeMs: Math.round(schleife.percentile(99) / 1e6),
        },
        neustarts: ctx.einstellungen.hole<string[]>('selbstheilung.neustarts', []),
        protokoll: await daten.liste('aktivitaet', {
          filter: { modul: 'selbstheilung' },
          sortierung: '-erstellt',
          limit: 50,
        }),
      };
    });
    app.post<{ Params: { id: string }; Body: { bestaetigt?: boolean } }>(
      '/job/:id/fortsetzen',
      async (req) => {
        if (req.body?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
        ctx.kern.scheduler.pausieren(req.params.id, null);
        const v = verlauf.get(req.params.id);
        if (v) v.pausen = 0;
        await log(`Pause von ${req.params.id} von Hand aufgehoben`);
        return { ok: true };
      },
    );
    app.post('/aufraeumen', async () => ({ ergebnis: await aufraeumen(false) }));
  }

  const jobs: JobDef[] = [
    { id: 'wache', name: 'Watchdog', intervallSek: 120, startVerzoegerungSek: 90, lauf: wache },
    { id: 'aufraeumen', name: 'Aufräumen', taeglich: '04:40', lauf: () => aufraeumen(false) },
  ];

  async function kachel(): Promise<Kachel> {
    const jobs = ctx.kern.scheduler.status();
    const probleme = jobs.filter((j) => j.fehlerInFolge >= FEHLER_SCHWELLE || j.pausiertBis);
    const [letzte] = await daten.liste<{ text: string; erstellt: string }>('aktivitaet', {
      filter: { modul: 'selbstheilung', art: 'aktion' },
      sortierung: '-erstellt',
      limit: 1,
    });
    return {
      status: (probleme.length ? 'warnung' : 'ok') as Ampel,
      titel: 'Selbstheilung',
      wert: probleme.length ? String(probleme.length) : 'ok',
      einheit: probleme.length ? 'Jobs mit Problemen' : '',
      unter: letzte ? `Zuletzt: ${letzte.text.slice(0, 60)}` : `${jobs.length} Jobs überwacht`,
      zeilen: probleme.slice(0, 3).map((j) => ({
        text: j.name,
        wert: j.pausiertBis ? 'pausiert' : `${j.fehlerInFolge} Fehler`,
        status: 'warnung' as Ampel,
      })),
      demo: konfig.demo,
    };
  }

  return { routen, jobs, kachel };
}
