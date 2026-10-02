// Passive Sicherheitsprüfung einer Webseite: nur das, was jeder Browser oder Mailserver auch sieht.
// Keine Angriffe, keine Port Scans, keine Formulare. Je Prüfung höchstens einige Anfragen.
import { Resolver } from 'node:dns/promises';
import { connect } from 'node:tls';
import { httpAnfrage } from '../../quellen/http.ts';
import { note } from '../scont/pruefen.ts';

export interface TlsInfo {
  protokoll: string | null;
  gueltig: boolean;
  gueltigBis: string | null;
  fehler: string | null;
  /** Akzeptiert der Server noch TLS 1.0 oder 1.1? null = nicht feststellbar */
  altAkzeptiert: boolean | null;
}
export interface DnsInfo {
  mx: boolean;
  spf: string | null;
  dmarc: string | null;
  dkimSelektor: string | null;
}
export interface Weiterleitung {
  status: number | null;
  ziel: string | null;
  aufHttps: boolean;
}
export interface Eingabe {
  url: string;
  headers: Record<string, string>;
  html: string;
  tls: TlsInfo;
  dns: DnsInfo;
  weiterleitung: Weiterleitung;
}
export interface Punkt {
  bereich: 'Transport' | 'Header' | 'E-Mail' | 'Software';
  name: string;
  ok: boolean;
  /** erreichte und mögliche Punkte */
  punkte: number;
  max: number;
  text: string;
  vorschlag?: string;
}
export interface Bewertung {
  domain: string;
  punkte: number;
  note: string;
  einzel: Punkt[];
  vorschlaege: string[];
}

/** PHP Versionen und Ende der Sicherheitsupdates laut php.net/supported-versions */
export const PHP_EOL: Record<string, string> = {
  '5.6': '2018-12-31',
  '7.0': '2019-01-10',
  '7.1': '2019-12-01',
  '7.2': '2020-11-30',
  '7.3': '2021-12-06',
  '7.4': '2022-11-28',
  '8.0': '2023-11-26',
  '8.1': '2025-12-31',
  '8.2': '2026-12-31',
  '8.3': '2027-12-31',
  '8.4': '2028-12-31',
};

export interface SoftwareHinweis {
  software: string;
  version: string | null;
  text: string;
  veraltet: boolean;
}

export function softwareErkennen(
  headers: Record<string, string>,
  html: string,
  jetzt = new Date(),
): SoftwareHinweis[] {
  const aus: SoftwareHinweis[] = [];
  const server = headers.server ?? '';
  const powered = headers['x-powered-by'] ?? '';
  const php = /PHP\/(\d+)\.(\d+)(?:\.(\d+))?/i.exec(`${server} ${powered}`);
  if (php) {
    const zweig = `${php[1]}.${php[2]}`;
    const eol = PHP_EOL[zweig];
    const veraltet = eol ? new Date(eol).getTime() < jetzt.getTime() : Number(php[1]) < 8;
    aus.push({
      software: 'PHP',
      version: php[0].split('/')[1],
      veraltet,
      text: veraltet
        ? `PHP ${zweig} erhält seit ${eol ?? 'längerem'} keine Sicherheitsupdates mehr. Auf eine unterstützte Version wechseln.`
        : `PHP ${zweig} wird öffentlich angezeigt. Version im Header verbergen (expose_php = Off).`,
    });
  }
  for (const [name, re, rat] of [
    ['nginx', /nginx\/(\d[\d.]*)/i, 'server_tokens off'],
    ['Apache', /Apache\/(\d[\d.]*)/i, 'ServerTokens Prod'],
    ['Microsoft IIS', /Microsoft-IIS\/(\d[\d.]*)/i, 'Server Header entfernen'],
  ] as const) {
    const m = re.exec(server);
    if (m)
      aus.push({
        software: name,
        version: m[1],
        veraltet: false,
        text: `${name} ${m[1]} wird im Header angezeigt. Version verbergen (${rat}) und aktuell halten.`,
      });
  }
  const gen =
    /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator["']/i.exec(html);
  if (gen) {
    const wp = /WordPress\s+(\d+)\.(\d+)/i.exec(gen[1]);
    if (wp) {
      const alt = Number(wp[1]) < 6;
      aus.push({
        software: 'WordPress',
        version: `${wp[1]}.${wp[2]}`,
        veraltet: alt,
        text: alt
          ? `WordPress ${wp[1]}.${wp[2]} ist sehr alt. Kern, Themes und Plugins aktualisieren.`
          : `WordPress ${wp[1]}.${wp[2]} wird im Quelltext angezeigt. Mit der aktuellen Version vergleichen und die Angabe entfernen.`,
      });
    } else
      aus.push({
        software: gen[1].slice(0, 60),
        version: null,
        veraltet: false,
        text: `Generator «${gen[1].slice(0, 60)}» im Quelltext sichtbar. Aktuell halten, Angabe wenn möglich entfernen.`,
      });
  }
  return aus;
}

export function basisDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  const teile = h.split('.');
  return teile.length > 2 ? teile.slice(-2).join('.') : h;
}

export function bewerten(e: Eingabe, jetzt = new Date()): Bewertung {
  const h = e.headers;
  const p: Punkt[] = [];
  const add = (x: Punkt) => p.push(x);

  add({
    bereich: 'Transport',
    name: 'Weiterleitung auf HTTPS',
    ok: e.weiterleitung.aufHttps,
    punkte: e.weiterleitung.aufHttps ? 12 : 0,
    max: 12,
    text: e.weiterleitung.aufHttps
      ? `HTTP leitet weiter (${e.weiterleitung.status})`
      : e.weiterleitung.status
        ? `HTTP antwortet mit ${e.weiterleitung.status} ohne Weiterleitung auf HTTPS`
        : 'HTTP nicht erreichbar',
    vorschlag: e.weiterleitung.aufHttps
      ? undefined
      : 'Alle Aufrufe über http:// mit 301 auf https:// umleiten.',
  });
  const tageGueltig = e.tls.gueltigBis
    ? Math.floor((new Date(e.tls.gueltigBis).getTime() - jetzt.getTime()) / 86400000)
    : null;
  add({
    bereich: 'Transport',
    name: 'Zertifikat',
    ok: e.tls.gueltig,
    punkte: e.tls.gueltig ? 15 : 0,
    max: 15,
    text: e.tls.gueltig ? `gültig, noch ${tageGueltig} Tage` : (e.tls.fehler ?? 'ungültig'),
    vorschlag: e.tls.gueltig
      ? undefined
      : 'Gültiges Zertifikat einrichten (z.B. Let’s Encrypt mit automatischer Erneuerung).',
  });
  const modern = e.tls.protokoll === 'TLSv1.3' || e.tls.protokoll === 'TLSv1.2';
  add({
    bereich: 'Transport',
    name: 'TLS Version',
    ok: modern && e.tls.altAkzeptiert !== true,
    punkte: (modern ? 8 : 0) + (e.tls.altAkzeptiert === true ? 0 : 5),
    max: 13,
    text: `${e.tls.protokoll ?? 'unbekannt'}${e.tls.altAkzeptiert === true ? ', akzeptiert noch TLS 1.0 oder 1.1' : e.tls.altAkzeptiert === false ? ', alte Versionen abgelehnt' : ''}`,
    vorschlag:
      e.tls.altAkzeptiert === true
        ? 'TLS 1.0 und 1.1 abschalten (nur 1.2 und 1.3 erlauben).'
        : !modern
          ? 'TLS 1.2 oder 1.3 verwenden.'
          : undefined,
  });

  const hsts = h['strict-transport-security'] ?? '';
  const hstsOk = /max-age=(\d{7,}|[3-9]\d{6})/.test(hsts) && !/max-age=0\b/.test(hsts);
  const csp = h['content-security-policy'] ?? '';
  const header: [string, boolean, number, string, string][] = [
    [
      'HSTS',
      hstsOk,
      10,
      hsts || 'fehlt',
      '«Strict-Transport-Security: max-age=31536000; includeSubDomains» setzen.',
    ],
    [
      'Content Security Policy',
      !!csp,
      10,
      csp ? 'gesetzt' : 'fehlt',
      'Content Security Policy definieren (mit «default-src» beginnen, im Report Only Modus testen).',
    ],
    [
      'X-Content-Type-Options',
      /nosniff/i.test(h['x-content-type-options'] ?? ''),
      5,
      h['x-content-type-options'] ?? 'fehlt',
      '«X-Content-Type-Options: nosniff» setzen.',
    ],
    [
      'Schutz vor Einbettung',
      !!h['x-frame-options'] || /frame-ancestors/i.test(csp),
      5,
      h['x-frame-options'] ?? (/frame-ancestors/i.test(csp) ? 'über CSP' : 'fehlt'),
      '«X-Frame-Options: SAMEORIGIN» oder CSP «frame-ancestors» setzen.',
    ],
    [
      'Referrer-Policy',
      !!h['referrer-policy'],
      3,
      h['referrer-policy'] ?? 'fehlt',
      '«Referrer-Policy: strict-origin-when-cross-origin» setzen.',
    ],
    [
      'Permissions-Policy',
      !!h['permissions-policy'],
      2,
      h['permissions-policy'] ? 'gesetzt' : 'fehlt',
      'Nicht benötigte Browser Funktionen mit «Permissions-Policy» abschalten.',
    ],
  ];
  for (const [name, ok, max, text, vorschlag] of header)
    add({
      bereich: 'Header',
      name,
      ok,
      punkte: ok ? max : 0,
      max,
      text: text.slice(0, 120),
      vorschlag: ok ? undefined : vorschlag,
    });

  const spfOk = !!e.dns.spf && /[-~]all\b/.test(e.dns.spf);
  add({
    bereich: 'E-Mail',
    name: 'SPF',
    ok: spfOk,
    punkte: spfOk ? 8 : e.dns.spf ? 4 : 0,
    max: 8,
    text: e.dns.spf ?? 'kein SPF Eintrag',
    vorschlag: spfOk
      ? undefined
      : e.dns.mx
        ? 'SPF Eintrag mit «-all» oder «~all» am Ende setzen.'
        : 'Domain versendet keine Mails: «v=spf1 -all» setzen, damit niemand in ihrem Namen sendet.',
  });
  const dmarcPolicy = /p=(none|quarantine|reject)/i.exec(e.dns.dmarc ?? '')?.[1]?.toLowerCase() ?? null;
  add({
    bereich: 'E-Mail',
    name: 'DMARC',
    ok: dmarcPolicy === 'quarantine' || dmarcPolicy === 'reject',
    punkte: dmarcPolicy === 'reject' || dmarcPolicy === 'quarantine' ? 7 : dmarcPolicy === 'none' ? 3 : 0,
    max: 7,
    text: e.dns.dmarc ?? 'kein DMARC Eintrag',
    vorschlag:
      dmarcPolicy === 'reject' || dmarcPolicy === 'quarantine'
        ? undefined
        : dmarcPolicy === 'none'
          ? 'DMARC von «p=none» auf «p=quarantine» erhöhen, sobald die Berichte sauber sind.'
          : 'DMARC Eintrag unter _dmarc setzen, z.B. «v=DMARC1; p=quarantine; rua=mailto:…».',
  });
  add({
    bereich: 'E-Mail',
    name: 'DKIM',
    ok: !!e.dns.dkimSelektor || !e.dns.mx,
    punkte: e.dns.dkimSelektor || !e.dns.mx ? 5 : 0,
    max: 5,
    text: e.dns.dkimSelektor
      ? `gefunden (Selektor «${e.dns.dkimSelektor}»)`
      : e.dns.mx
        ? 'bei üblichen Selektoren nicht gefunden'
        : 'keine Mailserver (MX), nicht nötig',
    vorschlag:
      e.dns.dkimSelektor || !e.dns.mx
        ? undefined
        : 'DKIM beim Mailanbieter aktivieren. Hinweis: Der Hub kennt nur übliche Selektoren, DKIM kann trotzdem aktiv sein.',
  });

  const sw = softwareErkennen(h, e.html, jetzt);
  const abzug =
    sw.filter((s) => s.veraltet).length * 10 + sw.filter((s) => !s.veraltet && s.version).length * 2;
  add({
    bereich: 'Software',
    name: 'Software Hinweise',
    ok: abzug === 0,
    punkte: Math.max(0, 10 - abzug),
    max: 10,
    text: sw.length
      ? sw.map((s) => `${s.software}${s.version ? ` ${s.version}` : ''}`).join(', ')
      : 'keine Versionen sichtbar',
    vorschlag: sw.length ? sw.map((s) => s.text).join(' ') : undefined,
  });

  const max = p.reduce((s, x) => s + x.max, 0);
  const punkte = Math.round((100 * p.reduce((s, x) => s + x.punkte, 0)) / max);
  return {
    domain: basisDomain(new URL(e.url).hostname),
    punkte,
    note: note(punkte),
    einzel: p,
    vorschlaege: p.filter((x) => x.vorschlag).map((x) => `${x.name}: ${x.vorschlag}`),
  };
}

// Netzwerk Teil

function tlsVerbinden(
  host: string,
  alt: boolean,
  timeoutMs = 8000,
): Promise<TlsInfo & { verbunden: boolean }> {
  return new Promise((resolve) => {
    const s = connect({
      host,
      port: 443,
      servername: host,
      rejectUnauthorized: false,
      timeout: timeoutMs,
      ...(alt
        ? { minVersion: 'TLSv1' as const, maxVersion: 'TLSv1.1' as const, ciphers: 'DEFAULT:@SECLEVEL=0' }
        : {}),
    });
    const ende = (r: TlsInfo & { verbunden: boolean }) => {
      s.destroy();
      resolve(r);
    };
    s.once('secureConnect', () => {
      const c = s.getPeerCertificate();
      ende({
        verbunden: true,
        protokoll: s.getProtocol(),
        gueltig: s.authorized,
        gueltigBis: c?.valid_to ? new Date(c.valid_to).toISOString() : null,
        fehler: s.authorized ? null : String(s.authorizationError ?? 'Zertifikat ungültig'),
        altAkzeptiert: null,
      });
    });
    const fehler = (m: string) =>
      ende({
        verbunden: false,
        protokoll: null,
        gueltig: false,
        gueltigBis: null,
        fehler: m,
        altAkzeptiert: null,
      });
    s.once('timeout', () => fehler('Zeitüberschreitung'));
    s.once('error', (e) => fehler(e.message.slice(0, 200)));
  });
}

export async function tlsPruefen(host: string): Promise<TlsInfo> {
  const neu = await tlsVerbinden(host, false);
  // Zweiter Handshake nur mit TLS 1.0/1.1: zeigt, ob der Server veraltete Versionen noch annimmt.
  // Lehnt die lokale OpenSSL Bibliothek alte Versionen selbst ab, bleibt das Ergebnis «nicht feststellbar».
  const alt = await tlsVerbinden(host, true);
  const lokalGesperrt =
    /no protocols available|unsupported protocol|wrong version/i.test(alt.fehler ?? '') &&
    !/alert/i.test(alt.fehler ?? '');
  return { ...neu, altAkzeptiert: alt.verbunden ? true : lokalGesperrt ? null : false };
}

const DKIM_SELEKTOREN = [
  'default',
  'google',
  'selector1',
  'selector2',
  'k1',
  'k2',
  'mail',
  'dkim',
  's1',
  's2',
  'smtp',
  'protonmail',
  'mxvault',
];

export async function dnsPruefen(domain: string): Promise<DnsInfo> {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  const txt = async (name: string) => {
    try {
      return (await r.resolveTxt(name)).map((t) => t.join(''));
    } catch {
      return [];
    }
  };
  const [mx, wurzel, dmarc] = await Promise.all([
    r.resolveMx(domain).then(
      (m) => m.length > 0,
      () => false,
    ),
    txt(domain),
    txt(`_dmarc.${domain}`),
  ]);
  let dkimSelektor: string | null = null;
  const treffer = await Promise.all(
    DKIM_SELEKTOREN.map(async (s) =>
      (await txt(`${s}._domainkey.${domain}`)).some((t) => /v=DKIM1|p=/i.test(t)) ? s : null,
    ),
  );
  dkimSelektor = treffer.find((t) => t) ?? null;
  return {
    mx,
    spf: wurzel.find((t) => /^v=spf1/i.test(t))?.slice(0, 300) ?? null,
    dmarc: dmarc.find((t) => /^v=DMARC1/i.test(t))?.slice(0, 300) ?? null,
    dkimSelektor,
  };
}

export async function weiterleitungPruefen(host: string): Promise<Weiterleitung> {
  try {
    const a = await httpAnfrage(`http://${host}/`, {
      weiterleitung: 'manual',
      timeoutMs: 10000,
      maxBytes: 100000,
    });
    const ziel = a.headers.get('location');
    return {
      status: a.status,
      ziel,
      aufHttps: a.status >= 300 && a.status < 400 && !!ziel && /^https:\/\//i.test(ziel),
    };
  } catch {
    return { status: null, ziel: null, aufHttps: false };
  }
}

export async function seiteSicherheitPruefen(url: string, jetzt = new Date()): Promise<Bewertung> {
  const u = new URL(url);
  const https = `https://${u.host}${u.pathname}`;
  const [seite, tls, dns, weiterleitung] = await Promise.all([
    httpAnfrage(https, { timeoutMs: 15000, maxBytes: 1_500_000 }),
    tlsPruefen(u.hostname),
    dnsPruefen(basisDomain(u.hostname)),
    weiterleitungPruefen(u.host),
  ]);
  const headers: Record<string, string> = {};
  seite.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return bewerten({ url: https, headers, html: seite.text, tls, dns, weiterleitung }, jetzt);
}
