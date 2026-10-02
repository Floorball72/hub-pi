// Selbsttest auf dem Pi: Speicher, Temperatur, Datenbank, ntfy, jede Datenquelle.
// Aufruf: npm run selbsttest   (Option --ohne-push: keine Testnachricht senden)
import { MODULE } from '../src/server/modules/index.ts';
import { alleTabellen } from '../src/server/kern/hub.ts';
import { datenErstellen } from '../src/server/daten/index.ts';
import { migrationsDateien } from '../src/server/daten/migration.ts';
import { postgresVerbinden } from '../src/server/daten/supabase.ts';
import { ntfySenden } from '../src/server/kern/ntfy.ts';
import { systemStatus } from '../src/server/kern/system.ts';
import { konfigLaden } from '../src/server/konfig.ts';
import { Quelle, type QuellenDef } from '../src/server/quellen/quelle.ts';
import type { Kontext } from '../src/server/kern/modul.ts';
import { Einstellungen } from '../src/server/kern/einstellungen.ts';
import { Alarmzentrale } from '../src/server/kern/alarm.ts';

const k = konfigLaden({ DEMO_MODUS: 'false' });
const ohnePush = process.argv.includes('--ohne-push');
let gruen = 0;
let rot = 0;
let gelb = 0;

function punkt(art: 'ok' | 'fehler' | 'hinweis', text: string, detail = '') {
  const zeichen =
    art === 'ok' ? '\x1b[32m●\x1b[0m' : art === 'fehler' ? '\x1b[31m●\x1b[0m' : '\x1b[33m●\x1b[0m';
  if (art === 'ok') gruen++;
  else if (art === 'fehler') rot++;
  else gelb++;
  console.log(`${zeichen} ${text}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
}

async function mitTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, r) => setTimeout(() => r(new Error(`Zeitüberschreitung ${ms} ms`)), ms)),
  ]);
}

console.log('\nPi Hub Selbsttest\n');

// System
const s = await systemStatus(k.datenVerzeichnis);
punkt(
  s.ramVerfuegbarMb > 200 ? 'ok' : 'fehler',
  'RAM verfügbar',
  `${s.ramVerfuegbarMb} von ${s.ramGesamtMb} MB`,
);
if (s.temperaturC === null) punkt('hinweis', 'Temperatur', 'nicht lesbar (kein Pi?)');
else punkt(s.temperaturC < 70 ? 'ok' : 'fehler', 'Temperatur', `${s.temperaturC} °C`);
if (s.drosselung !== null)
  punkt(s.drosselung === '0x0' ? 'ok' : 'fehler', 'Keine Drosselung (Netzteil)', s.drosselung);
punkt((s.speicherFreiGb ?? 0) > 3 ? 'ok' : 'fehler', 'Speicher frei', `${s.speicherFreiGb} GB`);
punkt(
  s.tailscale.verbunden ? 'ok' : 'hinweis',
  'Tailscale',
  s.tailscale.installiert
    ? s.tailscale.verbunden
      ? `${s.tailscale.name} ${s.tailscale.ip}`
      : 'getrennt'
    : 'nicht installiert',
);
punkt(
  s.backup.alterStunden !== null && s.backup.alterStunden < 30 ? 'ok' : 'hinweis',
  'Backup',
  s.backup.letztes ? `vor ${s.backup.alterStunden} h` : 'noch keins',
);

// Dienst
try {
  const r = await fetch(`http://127.0.0.1:${k.port}/api/gesundheit`, { signal: AbortSignal.timeout(3000) });
  punkt(r.ok ? 'ok' : 'fehler', 'Dienst antwortet', `Port ${k.port}`);
} catch {
  punkt('fehler', 'Dienst antwortet', `nicht erreichbar auf Port ${k.port} (systemctl status pihub)`);
}

// Datenbank
if (k.treiber === 'supabase') {
  try {
    const sql = postgresVerbinden(k.supabase.dbUrl, 1);
    const angewendet = (
      await mitTimeout(sql<{ name: string }[]>`SELECT name FROM "_migrationen"`, 10000)
    ).map((r) => r.name);
    await sql.end();
    const fehlend = migrationsDateien('supabase/migrations').filter((f) => !angewendet.includes(f));
    punkt('ok', 'Supabase Verbindung');
    punkt(
      fehlend.length ? 'fehler' : 'ok',
      'Migrationen',
      fehlend.length
        ? `fehlen: ${fehlend.join(', ')} (npm run db:migrate)`
        : `${angewendet.length} angewendet`,
    );
  } catch (e) {
    punkt('fehler', 'Supabase Verbindung', (e as Error).message);
  }
} else {
  punkt('hinweis', 'Datenbank', 'lokaler Treiber (SQLite). Für den Betrieb Supabase einrichten.');
}
const daten = datenErstellen(k);
try {
  await daten.vorbereiten(alleTabellen());
  punkt('ok', 'Datenzugriff', `${daten.treiber.name}, ${await daten.pufferAnzahl()} Werte im Puffer`);
} catch (e) {
  punkt('fehler', 'Datenzugriff', (e as Error).message);
}

// Push
if (!k.ntfy.thema) punkt('fehler', 'ntfy', 'Thema fehlt');
else if (ohnePush) punkt('hinweis', 'ntfy', 'übersprungen (--ohne-push)');
else {
  try {
    await ntfySenden(k.ntfy, {
      titel: 'Pi Hub Selbsttest',
      text: 'Push funktioniert.',
      prioritaet: 2,
      tags: ['white_check_mark'],
    });
    punkt('ok', 'ntfy Testnachricht gesendet', 'Ist sie auf dem Handy angekommen?');
  } catch (e) {
    punkt('fehler', 'ntfy', (e as Error).message);
  }
}

// Datenquellen: jedes Modul erstellen und jede Quelle einmal echt abfragen
console.log('\nDatenquellen\n');
const quellen: Quelle<unknown, unknown>[] = [];
const einstellungen = new Einstellungen(daten);
await einstellungen.laden();
const stillerLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return stillerLog;
  },
  level: 'silent',
  silent() {},
};
for (const m of MODULE) {
  const ctx: Kontext = {
    konfig: k,
    daten,
    log: stillerLog as unknown as Kontext['log'],
    alarm: new Alarmzentrale(
      daten,
      () => k.ntfy,
      () => true,
    ),
    einstellungen,
    aktivitaet: async () => {},
    modulAktiv: () => true,
    jetzt: () => new Date(),
    quelle: <P, T>(def: QuellenDef<P, T>) => {
      const q = new Quelle<P, T>(def, { demo: () => false, aktiv: () => true });
      quellen.push(q as unknown as Quelle<unknown, unknown>);
      return q;
    },
  };
  try {
    await m.erstellen(ctx);
  } catch (e) {
    punkt('fehler', `Modul ${m.name}`, (e as Error).message);
  }
}
for (const q of quellen) {
  if (q.def.konfiguriert && !q.def.konfiguriert()) {
    punkt('hinweis', q.def.name, 'nicht konfiguriert');
    continue;
  }
  try {
    const p = q.def.testParameter ? q.def.testParameter() : undefined;
    const start = performance.now();
    await mitTimeout(q.def.abruf(p), 20000);
    punkt(
      'ok',
      q.def.name,
      `${Math.round(performance.now() - start)} ms${q.def.ungetestet ? ', war ungetestet: bitte Anzeige prüfen' : ''}`,
    );
  } catch (e) {
    punkt('fehler', q.def.name, (e as Error).message.slice(0, 160));
  }
}

await daten.schliessen();
console.log(`\n${gruen} grün, ${gelb} Hinweise, ${rot} rot\n`);
process.exit(rot ? 1 : 0);
