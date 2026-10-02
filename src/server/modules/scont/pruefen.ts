// Prüfungen für Kundenseiten: Erreichbarkeit, SSL, Qualität (Header, Links, Cookie Hinweis), PageSpeed.
// Alle Prüfungen sind passiv: normale Abrufe wie ein Browser, keine Scans.
import { connect } from 'node:tls';
import { HubFehler } from '../../kern/fehler.ts';
import { httpAnfrage } from '../../quellen/http.ts';

export interface PruefErgebnis {
  ok: boolean;
  status: number | null;
  ms: number | null;
  fehler: string | null;
}

export async function seitePruefen(url: string, erwarteterText?: string | null): Promise<PruefErgebnis> {
  try {
    const r = await httpAnfrage(url, { timeoutMs: 15000, abstandMs: 200, maxBytes: 3_000_000 });
    let ok = r.status >= 200 && r.status < 400;
    let fehler: string | null = ok ? null : `HTTP ${r.status}`;
    if (ok && erwarteterText && !r.text.includes(erwarteterText)) {
      ok = false;
      fehler = 'Erwarteter Text fehlt';
    }
    return { ok, status: r.status, ms: r.dauerMs, fehler };
  } catch (e) {
    return { ok: false, status: null, ms: null, fehler: (e as Error).message.slice(0, 200) };
  }
}

export interface SslErgebnis {
  gueltigBis: string | null;
  aussteller: string | null;
  fehler: string | null;
}

export function sslPruefen(host: string, timeoutMs = 10000): Promise<SslErgebnis> {
  return new Promise((resolve) => {
    const socket = connect({
      host,
      port: 443,
      servername: host,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });
    const fertig = (e: SslErgebnis) => {
      socket.destroy();
      resolve(e);
    };
    socket.once('secureConnect', () => {
      const c = socket.getPeerCertificate();
      if (!c?.valid_to) return fertig({ gueltigBis: null, aussteller: null, fehler: 'Kein Zertifikat' });
      const fehler = socket.authorized ? null : String(socket.authorizationError ?? 'Zertifikat ungültig');
      const aussteller =
        (c.issuer as Record<string, string> | undefined)?.O ??
        (c.issuer as Record<string, string> | undefined)?.CN ??
        null;
      fertig({ gueltigBis: new Date(c.valid_to).toISOString(), aussteller, fehler });
    });
    socket.once('timeout', () =>
      fertig({ gueltigBis: null, aussteller: null, fehler: 'Zeitüberschreitung' }),
    );
    socket.once('error', (e) =>
      fertig({ gueltigBis: null, aussteller: null, fehler: e.message.slice(0, 200) }),
    );
  });
}

export function tageBis(iso: string, jetzt = new Date()): number {
  return Math.floor((new Date(iso).getTime() - jetzt.getTime()) / 86400000);
}

// Qualitätscheck

export interface HeaderPruefung {
  name: string;
  vorhanden: boolean;
  wert?: string;
  empfehlung: string;
  gewicht: number;
}

const SICHERHEITS_HEADER: {
  name: string;
  empfehlung: string;
  gewicht: number;
  pruefen?: (w: string) => boolean;
}[] = [
  {
    name: 'strict-transport-security',
    empfehlung: 'HSTS setzen, z.B. «max-age=31536000; includeSubDomains»',
    gewicht: 20,
    pruefen: (w) => /max-age=\d{6,}/.test(w),
  },
  { name: 'content-security-policy', empfehlung: 'Content Security Policy definieren', gewicht: 20 },
  {
    name: 'x-content-type-options',
    empfehlung: '«nosniff» setzen',
    gewicht: 10,
    pruefen: (w) => /nosniff/i.test(w),
  },
  { name: 'x-frame-options', empfehlung: '«SAMEORIGIN» oder CSP frame-ancestors setzen', gewicht: 10 },
  { name: 'referrer-policy', empfehlung: 'z.B. «strict-origin-when-cross-origin»', gewicht: 10 },
  { name: 'permissions-policy', empfehlung: 'Nicht benötigte Browser Funktionen abschalten', gewicht: 5 },
];

/** Bekannte Cookie Banner Lösungen (an Skript Adressen oder Klassen erkennbar) */
const COOKIE_LOESUNGEN: [string, RegExp][] = [
  ['Cookiebot', /cookiebot/i],
  ['Usercentrics', /usercentrics/i],
  ['OneTrust', /onetrust|cookielaw\.org/i],
  ['Borlabs', /borlabs/i],
  ['Complianz', /complianz/i],
  ['CookieYes', /cookieyes|cookie-law-info/i],
  ['Klaro', /klaro/i],
  ['iubenda', /iubenda/i],
  ['Real Cookie Banner', /real-cookie-banner/i],
  ['Termly', /termly/i],
];

export function cookieHinweisErkennen(html: string): { gefunden: boolean; loesung: string | null } {
  for (const [name, re] of COOKIE_LOESUNGEN) if (re.test(html)) return { gefunden: true, loesung: name };
  // Allgemein: Wort Cookie zusammen mit einer Zustimmung im sichtbaren Text
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  if (/cookie/i.test(text) && /(akzeptier|zustimm|einverstanden|accept|consent|einwillig)/i.test(text)) {
    return { gefunden: true, loesung: null };
  }
  return { gefunden: false, loesung: null };
}

export function linksExtrahieren(html: string, basis: string, max = 40): string[] {
  const urls = new Set<string>();
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const href = m[1].trim();
    if (href.startsWith('#') || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const u = new URL(href, basis);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      u.hash = '';
      urls.add(u.toString());
    } catch {
      // ungültige Adresse ignorieren
    }
    if (urls.size >= max) break;
  }
  return [...urls];
}

export interface QualitaetsErgebnis {
  header: HeaderPruefung[];
  https: boolean;
  cookie: { gefunden: boolean; loesung: string | null };
  links: { geprueft: number; defekt: { url: string; status: number | string }[] };
  punkte: number;
  note: string;
  vorschlaege: string[];
}

export function note(punkte: number): string {
  if (punkte >= 90) return 'A';
  if (punkte >= 75) return 'B';
  if (punkte >= 60) return 'C';
  if (punkte >= 40) return 'D';
  return 'E';
}

/** Bewertet Header, HTTPS und Cookie Hinweis. Links werden separat ergänzt. */
export function qualitaetBewerten(
  url: string,
  headers: Headers | Record<string, string>,
  html: string,
): QualitaetsErgebnis {
  const h = (n: string) => (headers instanceof Headers ? headers.get(n) : (headers[n] ?? null));
  const header: HeaderPruefung[] = SICHERHEITS_HEADER.map((d) => {
    let wert = h(d.name);
    // CSP frame-ancestors ersetzt X-Frame-Options
    if (!wert && d.name === 'x-frame-options' && /frame-ancestors/i.test(h('content-security-policy') ?? ''))
      wert = 'über CSP';
    const vorhanden = !!wert && (!d.pruefen || d.pruefen(wert));
    return { name: d.name, vorhanden, wert: wert ?? undefined, empfehlung: d.empfehlung, gewicht: d.gewicht };
  });
  const https = url.startsWith('https://');
  const cookie = cookieHinweisErkennen(html);
  let punkte = header.filter((x) => x.vorhanden).reduce((s, x) => s + x.gewicht, 0) + (https ? 25 : 0);
  punkte = Math.min(100, punkte);
  const vorschlaege = header.filter((x) => !x.vorhanden).map((x) => `${x.name}: ${x.empfehlung}`);
  if (!https) vorschlaege.unshift('Seite auf HTTPS umstellen');
  if (!cookie.gefunden)
    vorschlaege.push('Kein Cookie Hinweis erkannt. Prüfen, ob einer nötig ist (Tracking, Einbettungen).');
  return {
    header,
    https,
    cookie,
    links: { geprueft: 0, defekt: [] },
    punkte,
    note: note(punkte),
    vorschlaege,
  };
}

/** Prüft Links schonend: HEAD, bei 405/501 GET, höchstens ein Abruf pro Sekunde und Host. */
export async function linksPruefen(links: string[]): Promise<{ url: string; status: number | string }[]> {
  const defekt: { url: string; status: number | string }[] = [];
  for (const url of links) {
    try {
      let r = await httpAnfrage(url, {
        methode: 'HEAD',
        timeoutMs: 10000,
        abstandMs: 1000,
        maxBytes: 100_000,
      });
      if (r.status === 405 || r.status === 501 || r.status === 403) {
        r = await httpAnfrage(url, { timeoutMs: 10000, abstandMs: 1000, maxBytes: 2_000_000 });
      }
      if (r.status >= 400) defekt.push({ url, status: r.status });
    } catch (e) {
      defekt.push({ url, status: (e as Error).message.slice(0, 80) });
    }
  }
  return defekt;
}

// PageSpeed Insights API v5

export interface PageSpeedWerte {
  performance: number | null;
  barrierefreiheit: number | null;
  best_practices: number | null;
  seo: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
}

interface PsiAntwort {
  error?: { code: number; message: string };
  lighthouseResult?: {
    categories?: Record<string, { score: number | null }>;
    audits?: Record<string, { numericValue?: number }>;
  };
}

export function pagespeedAuswerten(d: PsiAntwort): PageSpeedWerte {
  if (d.error)
    throw new HubFehler(
      d.error.code === 429
        ? 'PageSpeed Kontingent erschöpft (API Schlüssel eintragen)'
        : `PageSpeed Fehler ${d.error.code}`,
    );
  const lr = d.lighthouseResult;
  if (!lr) throw new HubFehler('PageSpeed Antwort ohne Ergebnis');
  const kat = (k: string) => {
    const s = lr.categories?.[k]?.score;
    return s === null || s === undefined ? null : Math.round(s * 100);
  };
  const wert = (a: string) => lr.audits?.[a]?.numericValue ?? null;
  const rund = (n: number | null) => (n === null ? null : Math.round(n));
  return {
    performance: kat('performance'),
    barrierefreiheit: kat('accessibility'),
    best_practices: kat('best-practices'),
    seo: kat('seo'),
    lcp_ms: rund(wert('largest-contentful-paint')),
    cls:
      wert('cumulative-layout-shift') === null
        ? null
        : Math.round((wert('cumulative-layout-shift') as number) * 1000) / 1000,
    tbt_ms: rund(wert('total-blocking-time')),
  };
}

export function pagespeedUrl(url: string, schluessel: string, strategie = 'mobile'): string {
  const p = new URLSearchParams({ url, strategy: strategie });
  for (const k of ['performance', 'accessibility', 'best-practices', 'seo']) p.append('category', k);
  if (schluessel) p.set('key', schluessel);
  return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${p}`;
}
