// Tests für das Modul Rettung und Mobilität mit echten API Antworten als Fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { abfahrtenParsen } from '../src/server/modules/mobilitaet/oev.ts';
import {
  type AdsbFlugzeug,
  FlugErkennung,
  flugStatistik,
  type HeliPosition,
  heliFiltern,
  musterPasst,
  organisationFinden,
} from '../src/server/modules/rettung/heli.ts';
import {
  alertInRegion,
  alertswissParsen,
  istErdbeben,
  kategorie,
  meteoalarmParsen,
  opendatasoftMeldungen,
  overpassAbfrage,
  overpassParsen,
  sedParsen,
  warnungFuerGebiete,
} from '../src/server/modules/rettung/quellen.ts';
import { distanzKm, imPolygon } from '../src/server/quellen/geo.ts';
import { feedParsen } from '../src/server/quellen/rss.ts';

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'));
const REGION = { lat: 47.41, lon: 9.2, radiusKm: 40 };

describe('Helikopter', () => {
  it('erkennt Kennzeichen Muster', () => {
    assert.equal(musterPasst('HB-ZRX', 'HB-ZR*'), true);
    assert.equal(musterPasst('hb-zrx', 'HB-ZR*'), true);
    assert.equal(musterPasst('HB-ZQX', 'HB-ZR*'), false);
    assert.equal(musterPasst('HB-ZRX', 'HB-ZRX'), true);
    assert.equal(organisationFinden('HB-TIE', [{ organisation: 'Rega', muster: 'HB-TI*' }]), 'Rega');
  });
  it('filtert echte ADS-B Daten auf Helikopter in der Region', () => {
    const ac = json('adsb_ch.json').ac as AdsbFlugzeug[];
    const alle = heliFiltern(ac, [], true, { lat: 46.8, lon: 8.2, radiusKm: 300 }, Date.now());
    assert.ok(alle.length > 0);
    assert.ok(alle.every((h) => h.organisation === null));
    const nurListe = heliFiltern(
      ac,
      [{ organisation: 'Test', muster: 'HB-Z*' }],
      false,
      { lat: 46.8, lon: 8.2, radiusKm: 300 },
      Date.now(),
    );
    assert.ok(nurListe.every((h) => h.kennzeichen?.startsWith('HB-Z')));
    const eng = heliFiltern(ac, [], true, { lat: 46.8, lon: 8.2, radiusKm: 1 }, Date.now());
    assert.equal(eng.length, 0);
  });
  it('erkennt Start, Landung und Signalverlust', () => {
    const e = new FlugErkennung();
    const p = (zeit: number, boden: boolean, kn: number, ft: number | null = 2000): HeliPosition => ({
      hex: 'a',
      kennzeichen: 'HB-ZRX',
      typ: 'A109',
      rufzeichen: null,
      organisation: 'Rega',
      lat: 47.4,
      lon: 9.3,
      hoeheFt: ft,
      amBoden: boden,
      speedKn: kn,
      kurs: 0,
      zeit,
    });
    assert.deepEqual(e.aktualisieren([p(0, true, 0, 0)], 0), []);
    assert.deepEqual(
      e.aktualisieren([p(30000, false, 90)], 30000).map((x) => x.art),
      ['start'],
    );
    assert.equal(e.laufende().length, 1);
    const landung = e.aktualisieren([p(600000, true, 0, 0)], 600000);
    assert.deepEqual(
      landung.map((x) => x.art),
      ['landung'],
    );
    assert.equal(landung[0].flug.ende, 600000);
    // Neu erfasst in der Luft, dann tief verschwunden
    const b = new FlugErkennung();
    assert.deepEqual(
      b.aktualisieren([p(0, false, 100, 3000)], 0).map((x) => x.art),
      ['erfasst'],
    );
    assert.deepEqual(b.aktualisieren([], 60000), []);
    assert.deepEqual(
      b.aktualisieren([], 240000).map((x) => x.art),
      ['signalverlust'],
    );
  });
  it('berechnet die Statistik nach Stunde, Wochentag und Raster', () => {
    const s = flugStatistik([
      { start: '2026-10-02T10:05:00Z', start_lat: 47.4, start_lon: 9.3, ende_lat: 47.41, ende_lon: 9.31 },
      { start: '2026-10-03T10:30:00Z', start_lat: 47.4, start_lon: 9.3, ende_lat: null, ende_lon: null },
    ]);
    assert.equal(s.anzahl, 2);
    assert.equal(s.proStunde[12], 2);
    assert.equal(s.proWochentag[4], 1);
    assert.equal(s.proWochentag[5], 1);
    assert.ok(s.heat.find((h) => h[2] === 2));
  });
});

describe('Alertswiss', () => {
  const alerts = alertswissParsen(json('alertswiss.json'));
  it('liest echte Meldungen mit Polygonen', () => {
    assert.ok(alerts.length > 5);
    assert.ok(alerts[0].titel);
    assert.ok(alerts[0].polygone[0].length > 3);
    assert.ok(alerts.every((a) => typeof a.landesweit === 'boolean'));
  });
  it('ordnet Meldungen der Region zu', () => {
    const ar = alerts.find((a) => a.herausgeber.includes('Appenzell Ausserrhoden'))!;
    assert.equal(alertInRegion(ar, { lat: 47.38, lon: 9.28, radiusKm: 5 }), true);
    const bs = alerts.find((a) => a.herausgeber.includes('Basel-Stadt'))!;
    assert.equal(alertInRegion(bs, REGION), false);
  });
  it('Geometrie Hilfen', () => {
    assert.equal(
      imPolygon(1, 1, [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
      ]),
      true,
    );
    assert.equal(
      imPolygon(3, 1, [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
      ]),
      false,
    );
    assert.ok(Math.abs(distanzKm(47.4233, 9.3696, 47.3769, 8.5417) - 62.4) < 1.5);
  });
});

describe('MeteoAlarm', () => {
  it('liest Warnstufe, Gebiet und deutsche Fassung (echter Feed)', () => {
    const w = meteoalarmParsen(json('meteoalarm_beispiel.json'));
    assert.ok(w.length > 0);
    assert.ok(w.every((x) => x.stufe >= 1 && x.stufe <= 4));
    assert.ok(w.some((x) => x.sprache.startsWith('de')));
    assert.equal(warnungFuerGebiete({ ...w[0], gebiet: 'Kanton St. Gallen' }, ['St. Gallen']), true);
    assert.equal(warnungFuerGebiete({ ...w[0], gebiet: 'Genf' }, ['St. Gallen']), false);
  });
});

describe('Erdbeben', () => {
  it('liest den SED Text und filtert Sprengungen und Erdrutsche', () => {
    const e = sedParsen(readFileSync('test/fixtures/sed.txt', 'utf8'));
    assert.ok(e.length > 20);
    const beben = e.filter(istErdbeben);
    assert.ok(beben.length < e.length);
    assert.ok(beben.every((x) => x.typ === 'earthquake'));
    assert.match(e[0].zeit, /Z$/);
  });
});

describe('OpenStreetMap', () => {
  it('baut die Overpass Abfrage und liest Knoten und Flächen (Format laut Overpass Doku)', () => {
    assert.match(
      overpassAbfrage('spital', REGION),
      /\["amenity"="hospital"\]\["emergency"="yes"\]\(around:40000,47.41,9.2\)/,
    );
    assert.throws(() => overpassAbfrage('x', REGION));
    const o = overpassParsen({
      elements: [
        { type: 'node', id: 1, lat: 47.4, lon: 9.3, tags: { name: 'A' } },
        { type: 'way', id: 2, center: { lat: 47.5, lon: 9.1 }, tags: { operator: 'B' } },
        { type: 'relation', id: 3 },
      ],
    });
    assert.deepEqual(
      o.map((x) => x.name),
      ['A', 'B'],
    );
  });
});

describe('Medienmitteilungen', () => {
  it('liest den RSS Feed des Kantons (echt)', () => {
    const f = feedParsen(readFileSync('test/fixtures/sg_rss.xml', 'utf8'));
    assert.ok(f.length > 0);
    assert.match(f[0].link, /^https:\/\/www\.sg\.ch\//);
    assert.ok(!f[0].text.includes('<'));
  });
  it('liest Atom', () => {
    const f = feedParsen(
      '<feed><entry><title>T &amp; U</title><link href="https://x.example/a"/><updated>2026-10-01T10:00:00Z</updated><summary>S</summary></entry></feed>',
    );
    assert.deepEqual(f, [
      { titel: 'T & U', link: 'https://x.example/a', zeit: '2026-10-01T10:00:00.000Z', text: 'S' },
    ]);
  });
  it('liest die Stadtpolizei St.Gallen (Opendatasoft, echt)', () => {
    const m = opendatasoftMeldungen(json('stapo_sg.json'), 'Stapo');
    assert.equal(m.length, 5);
    assert.match(m[0].link, /^https:\/\/www\.stadt\.sg\.ch\//);
    assert.ok(m[0].zeit);
    assert.ok(!m[0].titel.includes('​'));
  });
  it('ordnet Meldungen grob ein', () => {
    assert.equal(kategorie({ titel: 'Selbstunfall auf der A1', text: '' }), 'Verkehrsunfall');
    assert.equal(kategorie({ titel: 'Brand in Garage', text: '' }), 'Brand');
    assert.equal(kategorie({ titel: 'Herbstmarkt', text: 'Verkehrsanordnungen' }), 'Mitteilung');
  });
});

describe('ÖV', () => {
  it('liest die Abfahrtstafel (echt)', () => {
    const t = abfahrtenParsen(json('stationboard.json'));
    assert.equal(t.haltestelle, 'Kirchberg SG, Post');
    assert.ok(t.abfahrten.length > 3);
    assert.match(t.abfahrten[0].zeit, /^\d{4}-/);
    assert.ok(t.lat! > 47 && t.lon! > 9);
    assert.ok(!/\d{6}/.test(t.abfahrten[0].linie));
  });
});
