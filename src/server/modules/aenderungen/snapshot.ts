// Momentaufnahmen von Webseiten und ihr Vergleich. Reine Funktionen ohne Netzwerk.
import { createHash } from 'node:crypto';
import { htmlZuText } from '../../quellen/rss.ts';

export interface Snapshot {
  url: string;
  /** Endadresse nach Weiterleitungen */
  ziel: string;
  zeilen: string[];
  skripte: string[];
  domains: string[];
  inlineSkripte: number;
  formulare: string[];
  versteckteLinks: string[];
  impressum: string[];
  preise: string[];
  meta: Record<string, string>;
}

export type Gewicht = 'hoch' | 'mittel' | 'niedrig';

export interface Unterschied {
  art: string;
  gewicht: Gewicht;
  text: string;
  vorher: string[];
  nachher: string[];
}

const MAX_ZEILEN = 1500;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function absolut(href: string, basis: string): string | null {
  try {
    return new URL(href.trim(), basis).toString();
  } catch {
    return null;
  }
}

/** Dynamische Inhalte neutralisieren, damit nicht jede Uhrzeit als Änderung zählt */
export function normalisieren(zeile: string, ausnahmen: RegExp[] = []): string {
  let z = zeile
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?(\s*Uhr)?/g, '‹Zeit›')
    .replace(/\b\d{1,2}\.\d{2}\s*Uhr\b/g, '‹Zeit›')
    .replace(/\b\d{1,2}\.\s?\d{1,2}\.\s?(\d{2,4})?\b/g, '‹Datum›')
    .replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?\b/g, '‹Datum›')
    .replace(/\b[0-9a-f]{24,}\b/gi, '‹Kennung›')
    .replace(/\s+/g, ' ')
    .trim();
  for (const re of ausnahmen) z = z.replace(re, '‹ignoriert›');
  return z;
}

export function ausnahmenLesen(text: string | null): RegExp[] {
  const aus: RegExp[] = [];
  for (const zeile of (text ?? '').split('\n')) {
    const t = zeile.trim();
    if (!t) continue;
    try {
      aus.push(new RegExp(t, 'gi'));
    } catch {
      aus.push(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
    }
  }
  return aus.slice(0, 30);
}

export function snapshotErstellen(
  html: string,
  url: string,
  ziel: string,
  ausnahmen: RegExp[] = [],
): Snapshot {
  const eigenerHost = new URL(ziel).hostname.replace(/^www\./, '');
  const skripte = new Set<string>();
  let inlineSkripte = 0;
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(m[0], 'src');
    if (src) {
      const a = absolut(src, ziel);
      if (a) skripte.add(a.replace(/\?.*$/, ''));
    } else if (!/type\s*=\s*["']?application\/(ld\+)?json/i.test(m[0])) inlineSkripte++;
  }
  const domains = new Set<string>();
  for (const s of skripte) {
    const h = new URL(s).hostname.replace(/^www\./, '');
    if (h !== eigenerHost) domains.add(h);
  }
  for (const m of html.matchAll(/<(iframe|link)\b[^>]*>/gi)) {
    const href = attr(m[0], m[1].toLowerCase() === 'iframe' ? 'src' : 'href');
    if (
      !href ||
      (m[1].toLowerCase() === 'link' && !/stylesheet|preload|modulepreload/i.test(attr(m[0], 'rel') ?? ''))
    )
      continue;
    const a = absolut(href, ziel);
    if (a) {
      const h = new URL(a).hostname.replace(/^www\./, '');
      if (h !== eigenerHost && /^https?:/.test(a)) domains.add(h);
    }
  }
  const formulare = new Set<string>();
  for (const m of html.matchAll(/<form\b[^>]*>/gi)) {
    const action = attr(m[0], 'action');
    const a = action ? absolut(action, ziel) : ziel;
    formulare.add(`${(attr(m[0], 'method') ?? 'get').toUpperCase()} ${a ? a.replace(/\?.*$/, '') : '?'}`);
  }
  const versteckteLinks = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const stil = (attr(m[0], 'style') ?? '').replace(/\s/g, '').toLowerCase();
    const versteckt =
      /display:none|visibility:hidden|font-size:0|left:-\d{3,}|opacity:0(?![.\d])/.test(stil) ||
      /\shidden(\s|>|=)/i.test(m[0]);
    const href = attr(m[0], 'href');
    if (versteckt && href && !href.startsWith('#')) {
      const a = absolut(href, ziel);
      if (a && /^https?:/.test(a)) versteckteLinks.add(a);
    }
  }
  const meta: Record<string, string> = {};
  const titel = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titel) meta.title = htmlZuText(titel[1]).slice(0, 300);
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = (attr(m[0], 'name') ?? attr(m[0], 'property') ?? '').toLowerCase();
    if (['description', 'robots', 'generator', 'og:title', 'og:description'].includes(name))
      meta[name] = (attr(m[0], 'content') ?? '').slice(0, 300);
  }
  const canonical = /<link\b[^>]*rel=["']canonical["'][^>]*>/i.exec(html);
  if (canonical) meta.canonical = attr(canonical[0], 'href') ?? '';

  // Sichtbarer Text, in Blöcke getrennt
  const ohne = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(
      /<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th|\/section|\/article|\/header|\/footer|\/nav|\/dd|\/dt|\/option)\b[^>]*>/gi,
      '\n',
    );
  const zeilen: string[] = [];
  for (const z of htmlZuText(ohne.replace(/\n/g, '¶')).split('¶')) {
    const n = normalisieren(z, ausnahmen);
    if (n.length >= 2 && zeilen[zeilen.length - 1] !== n) zeilen.push(n.slice(0, 500));
    if (zeilen.length >= MAX_ZEILEN) break;
  }
  const preise = zeilen
    .filter((z) => /(CHF|Fr\.|€|EUR)\s?\d|\d[\d'.,]*\s?(CHF|Fr\.|€|\.–|\.-)/.test(z))
    .slice(0, 100);
  const impressum = zeilen
    .filter((z) =>
      /CHE-\d{3}\.\d{3}\.\d{3}|Handelsregister|\bUID\b|Impressum|Inhaber|Geschäftsführ|Verantwortlich/i.test(
        z,
      ),
    )
    .slice(0, 50);

  return {
    url,
    ziel,
    zeilen,
    skripte: [...skripte].sort(),
    domains: [...domains].sort(),
    inlineSkripte,
    formulare: [...formulare].sort(),
    versteckteLinks: [...versteckteLinks].sort(),
    impressum,
    preise,
    meta,
  };
}

export function snapshotHash(s: Snapshot): string {
  const { url: _u, ...rest } = s;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 32);
}

function mengenDiff(a: string[], b: string[]) {
  const sa = new Set(a);
  const sb = new Set(b);
  return { weg: a.filter((x) => !sb.has(x)), neu: b.filter((x) => !sa.has(x)) };
}

/** Vergleicht zwei Momentaufnahmen. Hohe Gewichte für sicherheitsrelevante Änderungen. */
export function vergleichen(alt: Snapshot, neu: Snapshot): Unterschied[] {
  const u: Unterschied[] = [];
  const hostVon = (x: string) => {
    try {
      return new URL(x).hostname.replace(/^www\./, '');
    } catch {
      return x;
    }
  };
  if (hostVon(alt.ziel) !== hostVon(neu.ziel))
    u.push({
      art: 'Weiterleitung',
      gewicht: 'hoch',
      text: `Seite leitet neu auf ${hostVon(neu.ziel)} weiter`,
      vorher: [alt.ziel],
      nachher: [neu.ziel],
    });
  else if (alt.ziel !== neu.ziel)
    u.push({
      art: 'Weiterleitung',
      gewicht: 'niedrig',
      text: 'Zieladresse innerhalb der Domain geändert',
      vorher: [alt.ziel],
      nachher: [neu.ziel],
    });

  const d = mengenDiff(alt.domains, neu.domains);
  if (d.neu.length)
    u.push({
      art: 'Externe Skripte',
      gewicht: 'hoch',
      text: `Neue externe Domain${d.neu.length > 1 ? 's' : ''}: ${d.neu.join(', ')}`,
      vorher: d.weg,
      nachher: d.neu,
    });
  else if (d.weg.length)
    u.push({
      art: 'Externe Skripte',
      gewicht: 'niedrig',
      text: `Externe Domain entfernt: ${d.weg.join(', ')}`,
      vorher: d.weg,
      nachher: [],
    });
  const s = mengenDiff(alt.skripte, neu.skripte);
  if ((s.neu.length || s.weg.length) && !d.neu.length)
    u.push({
      art: 'Skripte',
      gewicht: 'mittel',
      text: `${s.neu.length} Skripte neu, ${s.weg.length} entfernt`,
      vorher: s.weg.slice(0, 20),
      nachher: s.neu.slice(0, 20),
    });

  const v = mengenDiff(alt.versteckteLinks, neu.versteckteLinks);
  if (v.neu.length)
    u.push({
      art: 'Versteckte Links',
      gewicht: 'hoch',
      text: `${v.neu.length} neue versteckte Links (typisch für eingeschleusten Spam)`,
      vorher: [],
      nachher: v.neu.slice(0, 20),
    });

  const f = mengenDiff(alt.formulare, neu.formulare);
  if (f.neu.length) {
    const fremd = f.neu.some((x) => hostVon(x.split(' ')[1] ?? '') !== hostVon(neu.ziel));
    u.push({
      art: 'Formulare',
      gewicht: fremd ? 'hoch' : 'mittel',
      text: fremd ? 'Formular sendet neu an eine fremde Adresse' : 'Formularziel geändert',
      vorher: f.weg,
      nachher: f.neu,
    });
  }

  const imp = mengenDiff(alt.impressum, neu.impressum);
  if (imp.neu.length || imp.weg.length)
    u.push({
      art: 'Impressum',
      gewicht: 'mittel',
      text: 'Angaben zu Firma oder Impressum geändert',
      vorher: imp.weg,
      nachher: imp.neu,
    });
  const pr = mengenDiff(alt.preise, neu.preise);
  if (pr.neu.length || pr.weg.length)
    u.push({
      art: 'Preise',
      gewicht: 'mittel',
      text: `${pr.neu.length} Preisangaben neu oder geändert`,
      vorher: pr.weg.slice(0, 20),
      nachher: pr.neu.slice(0, 20),
    });

  const metaAlt = Object.entries(alt.meta).map(([k, w]) => `${k}: ${w}`);
  const metaNeu = Object.entries(neu.meta).map(([k, w]) => `${k}: ${w}`);
  const m = mengenDiff(metaAlt, metaNeu);
  if (m.neu.length || m.weg.length) {
    const noindex = /noindex/i.test(neu.meta.robots ?? '') && !/noindex/i.test(alt.meta.robots ?? '');
    u.push({
      art: 'Meta Angaben',
      gewicht: noindex ? 'hoch' : 'niedrig',
      text: noindex
        ? 'Seite ist neu für Suchmaschinen gesperrt (noindex)'
        : 'Titel oder Beschreibung geändert',
      vorher: m.weg,
      nachher: m.neu,
    });
  }

  const t = mengenDiff(alt.zeilen, neu.zeilen);
  if (t.neu.length || t.weg.length)
    u.push({
      art: 'Text',
      gewicht: 'niedrig',
      text: `${t.neu.length} Textstellen neu, ${t.weg.length} entfernt`,
      vorher: t.weg.slice(0, 40),
      nachher: t.neu.slice(0, 40),
    });
  return u;
}

export const GEWICHT_RANG: Record<Gewicht, number> = { hoch: 3, mittel: 2, niedrig: 1 };

export function hoechstesGewicht(u: Unterschied[]): Gewicht | null {
  return u.reduce<Gewicht | null>(
    (g, x) => (!g || GEWICHT_RANG[x.gewicht] > GEWICHT_RANG[g] ? x.gewicht : g),
    null,
  );
}
