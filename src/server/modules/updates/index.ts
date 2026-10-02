// Modul Sichere Updates: prüft im Nachtfenster, ob es im erlaubten Repository einen neuen Stand gibt,
// und stösst dann die Update Pipeline an (scripts/aktualisieren.sh und release.sh, laufen als root über systemd).
// Die Pipeline baut in einem eigenen Ordner, sichert die Daten, migriert, schaltet um, prüft und schaltet
// bei Fehlern zurück. Das Ergebnis meldet dieses Modul in der Alarmzentrale.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { EingabeFehler } from '../../daten/schema.ts';
import type { Ampel, Kachel } from '../../geteilt/typen.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';
import { imFenster, lokalDatum } from '../../kern/zeit.ts';
import { httpJson } from '../../quellen/http.ts';

export interface UpdateErgebnis {
  zeit: string;
  ok: boolean;
  schritt: string;
  meldung: string;
  von: string;
  nach: string;
  commit: string;
}

export interface Fenster {
  von: string;
  bis: string;
}

export function ergebnisLesen(text: string): UpdateErgebnis | null {
  try {
    const j = JSON.parse(text) as UpdateErgebnis;
    return typeof j.zeit === 'string' && typeof j.ok === 'boolean' ? j : null;
  } catch {
    return null;
  }
}

/** Soll jetzt automatisch aktualisiert werden? */
export function updateFaellig(o: {
  auto: boolean;
  imFenster: boolean;
  aktuell: string | null;
  neuester: string | null;
  heuteVersucht: boolean;
}): boolean {
  return o.auto && o.imFenster && !o.heuteVersucht && !!o.neuester && !!o.aktuell && o.neuester !== o.aktuell;
}

export const updates: ModulDef = {
  id: 'updates',
  name: 'Sichere Updates',
  beschreibung: 'Automatische Updates im Nachtfenster, nur bei grünem Selbsttest, mit Rückfall',
  symbol: 'update',
  reihenfolge: 94,
  regeln: [
    {
      id: 'ok',
      name: 'Update eingespielt',
      beschreibung: 'Ein Update wurde erfolgreich eingespielt.',
      prioritaet: 2,
      cooldownMin: 60,
    },
    {
      id: 'fehler',
      name: 'Update fehlgeschlagen',
      beschreibung: 'Ein Update ist fehlgeschlagen, die vorherige Version läuft weiter.',
      prioritaet: 3,
      cooldownMin: 60,
    },
  ],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { konfig } = ctx;
  const datenDir = konfig.datenVerzeichnis;
  const ergebnisDatei = join(datenDir, 'aktualisieren.ergebnis.json');
  const anfrageDatei = join(datenDir, 'aktualisieren.anfrage');
  const basis = '/opt/pihub';

  const auto = () => ctx.einstellungen.hole<boolean>('updates.auto', false);
  const fenster = () => ctx.einstellungen.hole<Fenster>('updates.fenster', { von: '02:30', bis: '04:30' });

  const neuester = ctx.quelle<void, { sha: string; datum: string | null; text: string }>({
    id: 'updates.github',
    name: 'GitHub (neuester Stand)',
    modul: 'updates',
    ttlSek: 3600,
    abruf: async () => {
      const j = await httpJson<{ sha: string; commit?: { message?: string; committer?: { date?: string } } }>(
        `https://api.github.com/repos/${konfig.update.repo}/commits/${encodeURIComponent(konfig.update.zweig)}`,
        {
          timeoutMs: 15000,
          headers: {
            'x-github-api-version': '2022-11-28',
            ...(konfig.githubToken ? { authorization: `Bearer ${konfig.githubToken}` } : {}),
          },
        },
      );
      return {
        sha: j.sha,
        datum: j.commit?.committer?.date ?? null,
        text: (j.commit?.message ?? '').split('\n')[0].slice(0, 200),
      };
    },
    demo: () => ({
      sha: 'b7e2c41d0a9f3e6b5c8d7a1f2e3d4c5b6a7f8e9d',
      datum: ctx.jetzt().toISOString(),
      text: 'Demo: neue Funktionen',
    }),
    beschreibung: `Nur ${konfig.update.repo}, Branch ${konfig.update.zweig}`,
  });

  function aktuellerCommit(): string | null {
    if (konfig.demo) return 'a1c9f00e5d4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f';
    try {
      return readFileSync(join(process.cwd(), 'RELEASE_COMMIT'), 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  function versionen(): string[] {
    if (konfig.demo) return ['20261002-031500', '20260925-030900', '20260918-031200'];
    try {
      return readdirSync(join(basis, 'releases')).sort().reverse().slice(0, 10);
    } catch {
      return [];
    }
  }

  function letztesErgebnis(): UpdateErgebnis | null {
    if (konfig.demo)
      return {
        zeit: new Date(ctx.jetzt().getTime() - 7 * 86400000).toISOString(),
        ok: true,
        schritt: 'fertig',
        meldung: 'Update auf 20260925-030900 erfolgreich (Demo)',
        von: '20260918-031200',
        nach: '20260925-030900',
        commit: '',
      };
    try {
      return ergebnisLesen(readFileSync(ergebnisDatei, 'utf8'));
    } catch {
      return null;
    }
  }

  const unterSystemd = () => !konfig.demo && existsSync(join(basis, 'releases'));

  function anfordern(grund: string, commit?: string) {
    if (!unterSystemd()) throw new EingabeFehler('Updates gehen nur auf dem installierten Pi (/opt/pihub)');
    writeFileSync(
      anfrageDatei,
      JSON.stringify({ zeit: ctx.jetzt().toISOString(), grund, ...(commit ? { commit } : {}) }),
    );
  }

  async function routen(app: FastifyInstance) {
    app.get('/status', async () => {
      const n = await neuester.hole();
      const aktuell = aktuellerCommit();
      return {
        repo: konfig.update.repo,
        zweig: konfig.update.zweig,
        release: konfig.demo ? '20261002-031500' : basename(process.cwd()),
        aktuell,
        neuester: n.daten,
        neuerStand: !!n.daten && !!aktuell && n.daten.sha !== aktuell,
        fehler: n.fehler,
        auto: auto(),
        fenster: fenster(),
        versionen: versionen(),
        ergebnis: letztesErgebnis(),
        installiert: unterSystemd() || konfig.demo,
        demo: konfig.demo,
      };
    });
    app.put<{ Body: { auto?: boolean; von?: string; bis?: string } }>('/einstellungen', async (req) => {
      const b = req.body ?? {};
      if (typeof b.auto === 'boolean') await ctx.einstellungen.setze('updates.auto', b.auto);
      if (b.von !== undefined || b.bis !== undefined) {
        if (!/^\d{2}:\d{2}$/.test(String(b.von)) || !/^\d{2}:\d{2}$/.test(String(b.bis)))
          throw new EingabeFehler('Zeiten im Format HH:MM');
        await ctx.einstellungen.setze('updates.fenster', { von: b.von, bis: b.bis });
      }
      await ctx.aktivitaet(
        'updates',
        `Automatische Updates ${auto() ? 'ein' : 'aus'}, Fenster ${fenster().von} bis ${fenster().bis}`,
        'aktion',
      );
      return { ok: true };
    });
    app.post<{ Body: { bestaetigt?: boolean } }>('/jetzt', async (req) => {
      if (req.body?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
      const n = await neuester.hole(undefined, true);
      anfordern('von Hand', n.daten?.sha);
      await ctx.aktivitaet('updates', 'Update von Hand angefordert', 'aktion');
      return { ok: true, meldung: 'Update angefordert. Der Hub startet in einigen Minuten neu.' };
    });
  }

  const jobs: JobDef[] = [
    {
      id: 'nachtfenster',
      name: 'Nach Updates suchen',
      intervallSek: 900,
      startVerzoegerungSek: 400,
      lauf: async () => {
        if (!auto() || !unterSystemd()) return undefined;
        const f = fenster();
        const jetzt = ctx.jetzt();
        const tag = lokalDatum(jetzt);
        const versucht = ctx.einstellungen.hole<string>('updates.versucht', '');
        const n = await neuester.hole(undefined, true);
        const faellig = updateFaellig({
          auto: true,
          imFenster: imFenster(jetzt, f.von, f.bis),
          aktuell: aktuellerCommit(),
          neuester: n.daten?.sha ?? null,
          heuteVersucht: versucht === tag,
        });
        if (!faellig) return undefined;
        await ctx.einstellungen.setze('updates.versucht', tag);
        anfordern('automatisch im Nachtfenster', n.daten!.sha);
        await ctx.aktivitaet(
          'updates',
          `Automatisches Update auf ${n.daten!.sha.slice(0, 7)} angefordert`,
          'aktion',
        );
        return 'Update angefordert';
      },
    },
    {
      id: 'ergebnis',
      name: 'Update Ergebnis melden',
      intervallSek: 120,
      startVerzoegerungSek: 60,
      lauf: async () => {
        if (konfig.demo) return undefined;
        const e = letztesErgebnis();
        if (!e || ctx.einstellungen.hole<string>('updates.gemeldet', '') === e.zeit) return undefined;
        await ctx.einstellungen.setze('updates.gemeldet', e.zeit);
        await ctx.aktivitaet('updates', e.meldung, e.ok ? 'aktion' : 'warnung');
        await ctx.alarm.melden({
          regel: e.ok ? 'updates.ok' : 'updates.fehler',
          titel: e.ok ? 'Pi Hub aktualisiert' : 'Pi Hub Update fehlgeschlagen',
          text: e.ok
            ? `${e.meldung}${e.commit ? ` (${e.commit.slice(0, 7)})` : ''}`
            : `${e.meldung} (Schritt ${e.schritt})`,
          schluessel: `update:${e.zeit}`,
          link: '/modul/updates',
        });
        return e.ok ? 'Erfolg gemeldet' : 'Fehler gemeldet';
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const e = letztesErgebnis();
    const n = await neuester.hole();
    const neu = !!n.daten && n.daten.sha !== aktuellerCommit();
    return {
      status: (e && !e.ok ? 'warnung' : 'ok') as Ampel,
      titel: 'Updates',
      wert: neu ? 'neu' : 'aktuell',
      unter: auto() ? `automatisch ${fenster().von} bis ${fenster().bis}` : 'automatische Updates aus',
      zeilen: e
        ? [
            {
              text: e.ok ? 'Letztes Update' : 'Letzter Versuch',
              wert: new Date(e.zeit).toLocaleDateString('de-CH', {
                timeZone: 'Europe/Zurich',
                day: 'numeric',
                month: 'numeric',
              }),
              status: (e.ok ? 'ok' : 'warnung') as Ampel,
            },
          ]
        : [],
      demo: konfig.demo,
    };
  }

  return { routen, jobs, kachel };
}
