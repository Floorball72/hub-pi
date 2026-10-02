// Minimaler Parser für RSS 2.0, RDF und Atom Feeds (nur Titel, Link, Datum, Beschreibung).
export interface FeedEintrag {
  titel: string;
  link: string;
  zeit: string | null;
  text: string;
}

function entschluesseln(t: string): string {
  return t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

export function htmlZuText(html: string): string {
  return entschluesseln(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function feld(block: string, ...namen: string[]): string | null {
  for (const n of namen) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(block);
    if (m) return m[1].trim();
  }
  return null;
}

function datum(t: string | null): string | null {
  if (!t) return null;
  const d = new Date(entschluesseln(t).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function feedParsen(xml: string): FeedEintrag[] {
  const eintraege: FeedEintrag[] = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const b of items) {
    eintraege.push({
      titel: htmlZuText(feld(b, 'title') ?? ''),
      link: entschluesseln(feld(b, 'link') ?? '').trim(),
      zeit: datum(feld(b, 'pubDate', 'dc:date', 'published', 'updated')),
      text: htmlZuText(feld(b, 'description', 'content:encoded') ?? '').slice(0, 1000),
    });
  }
  for (const b of xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []) {
    const link = /<link[^>]*href=["']([^"']+)["']/i.exec(b)?.[1] ?? '';
    eintraege.push({
      titel: htmlZuText(feld(b, 'title') ?? ''),
      link,
      zeit: datum(feld(b, 'published', 'updated')),
      text: htmlZuText(feld(b, 'summary', 'content') ?? '').slice(0, 1000),
    });
  }
  return eintraege.filter((e) => e.titel);
}
