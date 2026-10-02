// Tests für Dienste Status, Sicherheits Checks, Abhängigkeiten, Änderungs Wächter und Weitere Teams.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { appErstellen } from '../src/server/app.ts';
import { Daten } from '../src/server/daten/index.ts';
import { LokalTreiber } from '../src/server/daten/lokal.ts';
import { sitzungErstellen } from '../src/server/kern/auth.ts';
import { konfigLaden } from '../src/server/konfig.ts';
import {
  behobenIn,
  paketeLesen,
  schwereLesen,
  type Vuln,
  versionVergleich,
} from '../src/server/modules/abhaengigkeiten/osv.ts';
import {
  hoechstesGewicht,
  normalisieren,
  snapshotErstellen,
  snapshotHash,
  vergleichen,
} from '../src/server/modules/aenderungen/snapshot.ts';
import { statuspageLesen, stufeAusIndikator, wechsel } from '../src/server/modules/dienste/index.ts';
import {
  basisDomain,
  bewerten,
  type Eingabe,
  softwareErkennen,
} from '../src/server/modules/sicherheit/pruefen.ts';
import { oldbSpiele, saisonTsdb, tsdbSpiel, tsdbTabelle } from '../src/server/modules/teams/quellen.ts';

const fixture = (n: string) => readFileSync(join(import.meta.dirname, 'fixtures', n), 'utf8');
const json = (n: string) => JSON.parse(fixture(n));

describe('Dienste Status', () => {
  it('liest Statuspage Antworten (Supabase, echt)', () => {
    const s = statuspageLesen(json('statuspage_supabase.json'), json('statuspage_supabase_offen.json'));
    assert.equal(s.stufe, 'gering');
    assert.equal(s.text, 'Partially Degraded Service');
    assert.ok(s.vorfaelle.length >= 1);
    assert.match(s.vorfaelle[0].link ?? '', /^https:\/\//);
  });
  it('ordnet Indikatoren zu und erkennt Wechsel', () => {
    assert.equal(stufeAusIndikator('none'), 'ok');
    assert.equal(stufeAusIndikator('critical'), 'ausfall');
    assert.equal(stufeAusIndikator('maintenance'), 'wartung');
    assert.equal(wechsel('ok', 'stoerung'), 'schlechter');
    assert.equal(wechsel('stoerung', 'ok'), 'besser');
    assert.equal(wechsel(undefined, 'ausfall'), null);
    assert.equal(wechsel('ok', 'unbekannt'), null);
  });
});

describe('Sicherheits Checks', () => {
  const gut: Eingabe = {
    url: 'https://www.beispiel.ch/',
    headers: {
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'camera=()',
    },
    html: '<html></html>',
    tls: {
      protokoll: 'TLSv1.3',
      gueltig: true,
      gueltigBis: '2027-01-01T00:00:00Z',
      fehler: null,
      altAkzeptiert: false,
    },
    dns: {
      mx: true,
      spf: 'v=spf1 include:_spf.google.com ~all',
      dmarc: 'v=DMARC1; p=reject',
      dkimSelektor: 'google',
    },
    weiterleitung: { status: 301, ziel: 'https://www.beispiel.ch/', aufHttps: true },
  };
  it('gibt einer sauberen Seite die Note A', () => {
    const b = bewerten(gut, new Date('2026-10-01'));
    assert.equal(b.punkte, 100);
    assert.equal(b.note, 'A');
    assert.equal(b.domain, 'beispiel.ch');
    assert.equal(b.vorschlaege.length, 0);
  });
  it('zieht ab für fehlende Header, alte TLS Versionen, fehlendes DMARC und HSTS max-age=0', () => {
    const b = bewerten(
      {
        ...gut,
        headers: { 'strict-transport-security': 'max-age=0', 'x-powered-by': 'PHP/7.4.33' },
        tls: { ...gut.tls, altAkzeptiert: true },
        dns: { mx: true, spf: null, dmarc: null, dkimSelektor: null },
        weiterleitung: { status: 200, ziel: null, aufHttps: false },
      },
      new Date('2026-10-01'),
    );
    assert.ok(b.punkte < 50, `Punkte ${b.punkte}`);
    assert.ok(b.vorschlaege.some((v) => v.startsWith('HSTS')));
    assert.ok(b.vorschlaege.some((v) => /PHP 7\.4/.test(v)));
    assert.ok(b.vorschlaege.some((v) => /TLS 1\.0/.test(v)));
  });
  it('erkennt Software Versionen und Ende der PHP Unterstützung', () => {
    const s = softwareErkennen(
      { server: 'nginx/1.18.0', 'x-powered-by': 'PHP/8.1.2' },
      '<meta name="generator" content="WordPress 6.5.3">',
      new Date('2026-10-01'),
    );
    assert.equal(s.find((x) => x.software === 'PHP')?.veraltet, true);
    assert.equal(s.find((x) => x.software === 'nginx')?.version, '1.18.0');
    assert.equal(s.find((x) => x.software === 'WordPress')?.version, '6.5');
    assert.equal(
      softwareErkennen({ 'x-powered-by': 'PHP/8.3.1' }, '', new Date('2026-10-01'))[0].veraltet,
      false,
    );
  });
  it('kürzt Hosts auf die Domain', () => {
    assert.equal(basisDomain('www.stadt.sg.ch'), 'sg.ch');
    assert.equal(basisDomain('scont.ch'), 'scont.ch');
  });
});

describe('Abhängigkeiten Wächter', () => {
  it('liest das Lockfile dieses Projekts', () => {
    const r = paketeLesen(readFileSync('package.json', 'utf8'), readFileSync('package-lock.json', 'utf8'));
    assert.ok(r.genau);
    assert.ok(r.pakete.some((p) => p.name === 'fastify' && p.direkt));
    assert.ok(r.pakete.some((p) => !p.direkt));
  });
  it('fällt ohne Lockfile auf package.json zurück', () => {
    const r = paketeLesen(JSON.stringify({ dependencies: { lodash: '^4.17.15', x: 'latest' } }), null);
    assert.equal(r.genau, false);
    assert.deepEqual(r.pakete, [{ name: 'lodash', version: '4.17.15', direkt: true }]);
  });
  it('vergleicht Versionen und findet die behobene Version (echte OSV Antwort)', () => {
    assert.ok(versionVergleich('4.17.19', '4.17.15') > 0);
    assert.ok(versionVergleich('1.0.0-beta', '1.0.0') < 0);
    assert.equal(versionVergleich('2.0.0', '2.0.0'), 0);
    const v = json('osv_vuln.json') as Vuln;
    assert.equal(schwereLesen(v), 'hoch');
    assert.equal(behobenIn(v, 'lodash', '4.17.15'), '4.17.19');
    assert.equal(behobenIn(v, 'lodash', '4.17.21'), null);
  });
});

describe('Änderungs Wächter', () => {
  const html = (extra = '') =>
    `<html><head><title>Shop</title><script src="/app.js"></script></head><body><p>Heute 14:35 Uhr aktualisiert</p><p>Preis CHF 12.50</p>${extra}<form action="/senden" method="post"></form></body></html>`;
  it('ignoriert Uhrzeiten und Daten', () => {
    assert.equal(normalisieren('Stand 02.10.2026, 14:35 Uhr'), normalisieren('Stand 03.10.2026, 09:10 Uhr'));
    const a = snapshotErstellen(html(), 'https://shop.example/', 'https://shop.example/');
    const b = snapshotErstellen(
      html().replace('14:35', '16:02'),
      'https://shop.example/',
      'https://shop.example/',
    );
    assert.equal(snapshotHash(a), snapshotHash(b));
  });
  it('gewichtet neue externe Skripte, versteckte Links und fremde Formulare hoch', () => {
    const a = snapshotErstellen(html(), 'https://shop.example/', 'https://shop.example/');
    const b = snapshotErstellen(
      html(
        '<script src="https://evil.example/x.js"></script><a href="https://spam.example/" style="display: none">x</a>',
      ).replace('action="/senden"', 'action="https://sammler.example/post"'),
      'https://shop.example/',
      'https://shop.example/',
    );
    const u = vergleichen(a, b);
    assert.equal(hoechstesGewicht(u), 'hoch');
    assert.ok(u.some((x) => x.art === 'Externe Skripte' && x.gewicht === 'hoch'));
    assert.ok(u.some((x) => x.art === 'Versteckte Links' && x.gewicht === 'hoch'));
    assert.ok(u.some((x) => x.art === 'Formulare' && x.gewicht === 'hoch'));
  });
  it('gewichtet Preisänderungen mittel und reine Texte niedrig', () => {
    const a = snapshotErstellen(html(), 'https://shop.example/', 'https://shop.example/');
    const preis = snapshotErstellen(
      html().replace('12.50', '13.50'),
      'https://shop.example/',
      'https://shop.example/',
    );
    assert.equal(hoechstesGewicht(vergleichen(a, preis)), 'mittel');
    const text = snapshotErstellen(
      html('<p>Neu: Herbstsortiment</p>'),
      'https://shop.example/',
      'https://shop.example/',
    );
    assert.equal(hoechstesGewicht(vergleichen(a, text)), 'niedrig');
  });
  it('liest eine echte Seite (sg.ch)', () => {
    const s = snapshotErstellen(fixture('sg_start.html'), 'https://www.sg.ch/', 'https://www.sg.ch/');
    assert.ok(s.zeilen.length > 20);
    assert.ok(s.domains.includes('analytics.silktide.com'));
    assert.equal(s.meta.robots, 'index, follow');
  });
});

describe('Weitere Teams', () => {
  it('liest TheSportsDB (FC St. Gallen, echt)', () => {
    const letztes = tsdbSpiel(json('tsdb_last.json').results[0]);
    assert.equal(letztes.heim, 'St. Gallen');
    assert.equal(letztes.beendet, true);
    assert.equal(letztes.zeit, '2026-09-12T16:00:00.000Z');
    assert.equal(letztes.toreGast, 3);
    const naechstes = tsdbSpiel(json('tsdb_next.json').events[0]);
    assert.equal(naechstes.beendet, false);
    const t = tsdbTabelle(json('tsdb_tabelle.json'), '134406');
    assert.ok(t.length >= 5);
    assert.equal(t.filter((z) => z.eigenes).length, 1);
  });
  it('liest OpenLigaDB und berechnet die Saison', () => {
    const s = oldbSpiele(json('openligadb_ch1_2025.json'), 'St. Gallen');
    assert.ok(s.length > 0);
    assert.ok(s.every((x) => /St\. Gallen/.test(x.heim + x.gast)));
    assert.equal(saisonTsdb(new Date('2026-10-02')), '2026-2027');
    assert.equal(saisonTsdb(new Date('2027-03-01')), '2026-2027');
  });
});

let app: FastifyInstance;
let daten: Daten;
const geheim = 'p8-geheimnis-p8-geheimnis-p8-xx';
const cookie = `pihub_sitzung=${encodeURIComponent(sitzungErstellen({ benutzer: 'jerome', art: 'lokal' }, geheim))}`;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pihub-p8-'));
  const konfig = konfigLaden({
    DEMO_MODUS: 'true',
    DATEN_VERZEICHNIS: dir,
    SESSION_SECRET: geheim,
    EINRICHTUNG_ABGESCHLOSSEN: 'true',
  });
  daten = new Daten(new LokalTreiber(':memory:'), null);
  ({ app } = await appErstellen({ konfig, daten, logger: false, webVerzeichnis: dir }));
});
after(async () => {
  await app.close();
});

const anfrage = (methode: 'GET' | 'POST', url: string, body?: unknown) =>
  app.inject({
    method: methode,
    url,
    remoteAddress: '100.80.1.2',
    headers: { cookie, 'x-pihub': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    payload: body ? JSON.stringify(body) : undefined,
  });

describe('Phase 8 im Server', () => {
  it('Dienste: Standard Dienste mit Demo Störung bei Cloudflare', async () => {
    const r = (await anfrage('GET', '/api/m/dienste/uebersicht')).json() as {
      dienste: { dienst: { name: string }; stufe: string }[];
    };
    assert.equal(r.dienste.length, 5);
    assert.equal(r.dienste.find((d) => d.dienst.name === 'Cloudflare')?.stufe, 'gering');
  });
  it('Sicherheit: bewertet die Seiten des Webseiten Wächters', async () => {
    await anfrage('GET', '/api/m/scont/uebersicht');
    const r = (await anfrage('GET', '/api/m/sicherheit/uebersicht')).json() as {
      seiten: { aktuell: { note: string } | null; verlauf: unknown[] }[];
    };
    assert.ok(r.seiten.length > 0);
    assert.ok(r.seiten.every((s) => s.aktuell && /^[A-E]$/.test(s.aktuell.note) && s.verlauf.length === 3));
  });
  it('Abhängigkeiten: Demo Funde und der Hub als eigenes Projekt', async () => {
    const r = (await anfrage('GET', '/api/m/abhaengigkeiten/uebersicht')).json() as {
      projekte: { projekt: { name: string }; funde: { schwere: string }[] }[];
    };
    assert.ok(r.projekte.some((p) => p.projekt.name === 'Pi Hub'));
    assert.equal(r.projekte.find((p) => p.funde.length)?.funde[0].schwere, 'hoch');
  });
  it('Änderungen: «erwartet» braucht Bestätigung und setzt die Basis', async () => {
    const r = (await anfrage('GET', '/api/m/aenderungen/uebersicht')).json() as {
      seiten: { seite: { id: string }; meldungen: { id: string; status: string; gewicht: string }[] }[];
    };
    const m = r.seiten.flatMap((s) => s.meldungen).find((x) => x.status === 'offen');
    assert.ok(m);
    assert.equal(m.gewicht, 'hoch');
    assert.equal((await anfrage('POST', `/api/m/aenderungen/meldung/${m.id}/erwartet`, {})).statusCode, 400);
    assert.equal(
      (await anfrage('POST', `/api/m/aenderungen/meldung/${m.id}/erwartet`, { bestaetigt: true })).statusCode,
      200,
    );
    const basis = await daten.liste<{ basis: boolean }>('aend_snapshots', { filter: { basis: true } });
    assert.ok(basis.length >= 2);
    assert.equal((await daten.liste('aend_snapshots', { filter: { basis: false } })).length, 0);
  });
  it('Teams: FC St. Gallen als Standard', async () => {
    const r = (await anfrage('GET', '/api/m/teams/uebersicht')).json() as {
      team: { name: string };
      naechstes: unknown;
      letztes: unknown;
    }[];
    assert.equal(r[0].team.name, 'FC St. Gallen');
    assert.ok(r[0].naechstes && r[0].letztes);
  });
});
