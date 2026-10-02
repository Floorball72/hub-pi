// Screenshots aller Seiten in mobiler und breiter Ansicht. Meldet Konsolenfehler und fehlgeschlagene API Aufrufe.
// Aufruf: BASIS=http://127.0.0.1:8099 node scripts/screenshots.mjs [seite ...]
// Playwright wird nicht als Abhängigkeit installiert. Pfad mit PLAYWRIGHT_MODUL setzen, falls nötig.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Playwright schickt sonst auch localhost über den Proxy
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK ??= '1';
const { chromium } = require(process.env.PLAYWRIGHT_MODUL ?? 'playwright');

const BASIS = process.env.BASIS ?? 'http://127.0.0.1:8099';
const ALLE = [
  '/',
  '/karte',
  '/timeline',
  '/alarme',
  '/hub-status',
  '/status',
  '/system',
  '/notizen',
  '/einrichtung',
  '/modul/zentrale',
  '/modul/scont',
  '/modul/rettung',
  '/modul/wetter',
  '/modul/drohne',
  '/modul/mobilitaet',
  '/modul/unihockey',
  '/modul/swissunihockey',
  '/suche?q=Kirchberg',
  '/modul/scont#tab=Zeit',
  '/modul/scont#tab=Berichte',
  '/modul/drohne#tab=Logbuch',
  '/modul/drohne#tab=Akkus',
  '/modul/drohne#tab=Dokumente',
  '/modul/rettung#tab=Toolbox',
  '/modul/rettung#tab=Rega',
  '/modul/rettung#tab=Einsätze',
  '/modul/swissunihockey#tab=Checkliste',
  '/modul/unihockey#tab=Einstellungen',
  '/modul/drohne#tab=Sonne',
  '/modul/drehwetter',
  '/modul/events',
  '/modul/content',
  '/modul/veranstaltungen',
  '/modul/parken',
  '/modul/dienste',
  '/modul/sicherheit',
  '/modul/abhaengigkeiten',
  '/modul/aenderungen',
  '/modul/teams',
  '/modul/auffaelligkeiten',
  '/modul/abrufe',
  '/modul/selbstheilung',
  '/modul/updates',
];
const seiten = process.argv.slice(2).length ? process.argv.slice(2) : ALLE;
const ansichten = [
  { name: 'mobil', viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 },
  { name: 'breit', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];

mkdirSync('screenshots', { recursive: true });
// In Umgebungen mit HTTPS Proxy (z.B. Cloud) Kartenkacheln über den Proxy laden
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined, proxy });
let fehler = 0;
for (const a of ansichten) {
  const ctx = await browser.newContext({ viewport: a.viewport, isMobile: a.isMobile, deviceScaleFactor: a.deviceScaleFactor, locale: 'de-CH', timezoneId: 'Europe/Zurich', ignoreHTTPSErrors: !!proxy });
  const page = await ctx.newPage();
  const probleme = [];
  page.on('console', (m) => m.type() === 'error' && probleme.push(`Konsole: ${m.text()}`));
  page.on('pageerror', (e) => probleme.push(`Seitenfehler: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().startsWith(BASIS) && r.status() >= 400 && !r.url().includes('/api/sitzung')) probleme.push(`HTTP ${r.status()} ${r.url().replace(BASIS, '')}`);
  });
  await page.goto(`${BASIS}/login`);
  await page.fill('#benutzer', 'jerome');
  await page.fill('#passwort', process.env.PASSWORT ?? 'demo');
  await Promise.all([page.waitForURL(`${BASIS}/`), page.click('button[type=submit]')]);
  for (const s of seiten) {
    probleme.length = 0;
    // «/modul/x#tab=Name» öffnet die Seite und klickt den Tab
    const [pfad, tab] = s.split('#tab=');
    await page.goto(`${BASIS}${pfad}`, { waitUntil: 'networkidle' }).catch(() => {});
    if (tab) {
      await page.locator('nav.tabs button', { hasText: decodeURIComponent(tab) }).first().click().catch(() => probleme.push(`Tab ${tab} fehlt`));
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    await page.waitForTimeout(s === '/karte' ? 3500 : 1200);
    const datei = `screenshots/${a.name}${s === '/' ? '-start' : s.replace(/[/?=#%]/g, '-')}.png`;
    await page.screenshot({ path: datei, fullPage: s !== '/karte' });
    const relevant = probleme.filter((p) => !/tile|wmts|wms\.geo|openstreetmap|rainviewer|ERR_TOO_MANY_RETRIES|ERR_CERT|ERR_TUNNEL/i.test(p));
    if (relevant.length) {
      fehler += relevant.length;
      console.log(`✗ ${a.name} ${s}\n  ${relevant.join('\n  ')}`);
    } else console.log(`✓ ${a.name} ${s} -> ${datei}`);
  }
  await ctx.close();
}
await browser.close();
process.exit(fehler ? 1 : 0);
