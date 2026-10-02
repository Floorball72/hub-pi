// Tests für scont: Qualitätscheck mit echter Seite als Fixture, PageSpeed Auswertung, Wächter Ablauf.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  cookieHinweisErkennen,
  linksExtrahieren,
  note,
  pagespeedAuswerten,
  pagespeedUrl,
  qualitaetBewerten,
  tageBis,
} from '../src/server/modules/scont/pruefen.ts';

function headerLesen(datei: string): Headers {
  const h = new Headers();
  for (const zeile of readFileSync(datei, 'utf8').split(/\r?\n/).slice(1)) {
    const i = zeile.indexOf(':');
    if (i > 0) h.append(zeile.slice(0, i).trim(), zeile.slice(i + 1).trim());
  }
  return h;
}

describe('Qualitätscheck', () => {
  const html = readFileSync('test/fixtures/sg_start.html', 'utf8');
  const headers = headerLesen('test/fixtures/sg_header.txt');

  it('bewertet Sicherheits Header einer echten Seite', () => {
    const q = qualitaetBewerten('https://www.sg.ch/', headers, html);
    const h = Object.fromEntries(q.header.map((x) => [x.name, x.vorhanden]));
    assert.equal(h['x-frame-options'], true);
    assert.equal(h['x-content-type-options'], true);
    // HSTS mit max-age=0 zählt nicht
    assert.equal(h['strict-transport-security'], false);
    assert.equal(q.https, true);
    assert.ok(q.punkte > 0 && q.punkte <= 100);
    assert.equal(q.note, note(q.punkte));
    assert.ok(q.vorschlaege.some((v) => v.startsWith('strict-transport-security')));
  });

  it('erkennt X-Frame-Options über CSP frame-ancestors', () => {
    const q = qualitaetBewerten(
      'https://x.example',
      { 'content-security-policy': "frame-ancestors 'self'" },
      '',
    );
    assert.equal(q.header.find((x) => x.name === 'x-frame-options')?.vorhanden, true);
  });

  it('zieht Links heraus, ohne mailto und Anker, absolut', () => {
    const links = linksExtrahieren(
      '<a href="/a">a</a><a href="mailto:x@y.ch">m</a><a href="#top">t</a><a href=\'https://b.example/x#y\'>b</a>',
      'https://s.example/seite',
    );
    assert.deepEqual(links, ['https://s.example/a', 'https://b.example/x']);
    assert.ok(linksExtrahieren(html, 'https://www.sg.ch/', 40).length > 10);
  });

  it('erkennt Cookie Lösungen', () => {
    assert.deepEqual(cookieHinweisErkennen('<script src="https://consent.cookiebot.com/uc.js"></script>'), {
      gefunden: true,
      loesung: 'Cookiebot',
    });
    assert.equal(
      cookieHinweisErkennen('<p>Wir verwenden Cookies. <button>Akzeptieren</button></p>').gefunden,
      true,
    );
    assert.equal(cookieHinweisErkennen('<p>Hallo</p>').gefunden, false);
  });

  it('rechnet Noten und Tage', () => {
    assert.equal(note(95), 'A');
    assert.equal(note(10), 'E');
    assert.equal(tageBis('2026-10-12T12:00:00Z', new Date('2026-10-02T12:00:00Z')), 10);
  });
});

describe('PageSpeed', () => {
  it('meldet ein erschöpftes Kontingent verständlich (echte 429 Antwort)', () => {
    const d = JSON.parse(readFileSync('test/fixtures/pagespeed_fehler_429.json', 'utf8'));
    assert.throws(() => pagespeedAuswerten(d), /Kontingent/);
  });
  it('liest Kategorien und Messwerte (Struktur nach API Dokumentation v5)', () => {
    const w = pagespeedAuswerten({
      lighthouseResult: {
        categories: {
          performance: { score: 0.87 },
          accessibility: { score: 1 },
          'best-practices': { score: 0.96 },
          seo: { score: null },
        },
        audits: {
          'largest-contentful-paint': { numericValue: 2345.6 },
          'cumulative-layout-shift': { numericValue: 0.01234 },
          'total-blocking-time': { numericValue: 120.4 },
        },
      },
    });
    assert.deepEqual(w, {
      performance: 87,
      barrierefreiheit: 100,
      best_practices: 96,
      seo: null,
      lcp_ms: 2346,
      cls: 0.012,
      tbt_ms: 120,
    });
  });
  it('baut die Abfrage mit allen Kategorien und optionalem Schlüssel', () => {
    const u = new URL(pagespeedUrl('https://a.example', 'k1'));
    assert.deepEqual(u.searchParams.getAll('category'), [
      'performance',
      'accessibility',
      'best-practices',
      'seo',
    ]);
    assert.equal(u.searchParams.get('key'), 'k1');
    assert.equal(new URL(pagespeedUrl('https://a.example', '')).searchParams.has('key'), false);
  });
});
