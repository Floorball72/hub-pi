// Tests für Wetter, Sonne, KP Index, Luftraum und Wetterfenster mit echten API Antworten als Fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { vonLokal } from '../src/server/kern/zeit.ts';
import {
  fensterFinden,
  STANDARD_GRENZEN,
  stundeBewerten,
  windAufHoehe,
} from '../src/server/modules/drohne/fenster.ts';
import { demoVorhersage } from '../src/server/quellen/demo-wetter.ts';
import { drohnenZonenParsen } from '../src/server/quellen/geoadmin.ts';
import { kpParsen, kpZusammenfassen } from '../src/server/quellen/kp.ts';
import { himmelsrichtung, openMeteoParsen, wetterText } from '../src/server/quellen/openmeteo.ts';
import { mond, sonnenstand, sonnenZeiten } from '../src/server/quellen/sonne.ts';

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'));
const om = openMeteoParsen(json('openmeteo.json'));

describe('Open-Meteo', () => {
  it('liest aktuelle Werte, Stunden mit Wolkenschichten und Tage', () => {
    assert.ok(om.aktuell && typeof om.aktuell.temp === 'number');
    assert.equal(om.stunden.length, 7 * 24);
    const s = om.stunden[0];
    for (const k of [
      'wind80',
      'wind120',
      'boeen',
      'wolkenTief',
      'wolkenMittel',
      'wolkenHoch',
      'sicht',
      'feuchte',
    ] as const) {
      assert.equal(typeof s[k], 'number', k);
    }
    assert.equal(om.tage.length, 7);
    assert.match(om.tage[0].datum, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(om.tage[0].sonnenaufgang! < om.tage[0].sonnenuntergang!);
  });
  it('übersetzt Wettercodes und Windrichtungen', () => {
    assert.equal(wetterText(3), 'bedeckt');
    assert.equal(wetterText(95), 'Gewitter');
    assert.equal(himmelsrichtung(270), 'W');
    assert.equal(himmelsrichtung(359), 'N');
  });
});

describe('Sonne und Mond', () => {
  it('stimmt mit den Auf und Untergangszeiten von Open-Meteo überein (±1 Minute, Referenz auch PyEphem)', () => {
    for (const tag of om.tage) {
      const [j, m, d] = tag.datum.split('-').map(Number);
      const z = sonnenZeiten(vonLokal(j, m, d, 12), om.lat, om.lon);
      assert.ok(Math.abs(z.aufgang!.getTime() - tag.sonnenaufgang!) < 60000, `Aufgang ${tag.datum}`);
      assert.ok(Math.abs(z.untergang!.getTime() - tag.sonnenuntergang!) < 60000, `Untergang ${tag.datum}`);
      assert.ok(z.goldAbend[0]! < z.untergang! && z.untergang! < z.goldAbend[1]!);
      assert.ok(z.blauAbend[0]!.getTime() === z.goldAbend[1]!.getTime());
    }
  });
  it('Sonnenhöhe am Mittag im Sommer hoch, nachts negativ, Azimut Süden', () => {
    const mittag = sonnenstand(vonLokal(2026, 6, 21, 13, 30), 47.4, 9.0);
    assert.ok(mittag.hoehe > 60 && mittag.hoehe < 70, String(mittag.hoehe));
    assert.ok(Math.abs(mittag.azimut - 180) < 15);
    assert.ok(sonnenstand(vonLokal(2026, 6, 21, 1, 0), 47.4, 9.0).hoehe < 0);
  });
  it('Mondphase: bekannter Vollmond 3.3.2026 und Neumond 17.2.2026', () => {
    // Daten aus astronomischen Tabellen (Vollmond 3. März 2026 11:38 UTC, Neumond 17. Februar 2026 12:01 UTC)
    assert.equal(mond(new Date('2026-03-03T11:38:00Z')).name, 'Vollmond');
    assert.ok(mond(new Date('2026-03-03T11:38:00Z')).beleuchtet > 0.99);
    assert.equal(mond(new Date('2026-02-17T12:01:00Z')).name, 'Neumond');
  });
});

describe('KP Index', () => {
  it('liest das aktuelle NOAA Format (Objekte) und das alte (Tabelle)', () => {
    const w = kpParsen(json('kp_prognose.json'));
    assert.ok(w.length > 10);
    assert.ok(w.some((x) => !x.beobachtet));
    const alt = kpParsen([
      ['time_tag', 'Kp', 'observed'],
      ['2026-10-01 00:00:00', '3.33', 'observed'],
    ]);
    assert.deepEqual(alt, [{ zeit: '2026-10-01T00:00:00Z', kp: 3.33, beobachtet: true }]);
    const z = kpZusammenfassen(w, new Date(w[Math.floor(w.length / 2)].zeit));
    assert.equal(typeof z.maxPrognose, 'number');
  });
});

describe('Luftraum', () => {
  it('liest Drohnenzonen am Flughafen Zürich (echte Antwort)', () => {
    const z = drohnenZonenParsen(json('geoadmin_drohnen_zrh.json'));
    assert.equal(z.length, 3);
    assert.equal(z[0].name, 'LSZH Zürich');
    assert.match(z[0].bewilligung ?? '', /^https:\/\/www\.skyguide\.ch/);
  });
});

describe('Wetterfenster', () => {
  it('nimmt den Wind der passenden Höhe', () => {
    const s = om.stunden[0];
    assert.equal(windAufHoehe(s, 20), s.wind10);
    assert.equal(windAufHoehe(s, 80), s.wind80);
    assert.equal(windAufHoehe(s, 120), s.wind120);
  });
  it('bewertet Stunden mit Begründung', () => {
    const basis = { ...om.stunden[12], tag: true, wind120: 10, boeen: 10, regen: 0, sicht: 30000, temp: 15 };
    assert.equal(stundeBewerten(basis, STANDARD_GRENZEN, 2).ok, true);
    const u = stundeBewerten({ ...basis, wind120: 45, regen: 2 }, STANDARD_GRENZEN, 6);
    assert.equal(u.ok, false);
    assert.deepEqual(u.gruende, ['Wind 45 km/h', 'Regen 2 mm', 'KP 6']);
    assert.ok(stundeBewerten({ ...basis, tag: false }, STANDARD_GRENZEN, 2).gruende.includes('Nacht'));
  });
  it('findet zusammenhängende Fenster', () => {
    const t0 = Date.UTC(2026, 9, 3, 8);
    const gut = { ...om.stunden[12], tag: true, wind120: 10, boeen: 10, regen: 0, sicht: 30000, temp: 15 };
    const stunden = [0, 1, 2, 3, 4, 5].map((i) => ({ ...gut, t: t0 + i * 3600000, regen: i === 3 ? 1 : 0 }));
    const f = fensterFinden(stunden, STANDARD_GRENZEN, 1, t0, t0 + 6 * 3600000, 2);
    assert.deepEqual(
      f.map((x) => x.stunden),
      [3, 2],
    );
    assert.equal(f[0].start, t0);
    assert.equal(f[0].ende, t0 + 3 * 3600000);
  });
  it('Demo Vorhersage ist vollständig', () => {
    const d = demoVorhersage(47.4, 9.0, new Date('2026-10-02T10:00:00Z'));
    assert.equal(d.stunden.length, 168);
    assert.ok(d.stunden.some((s) => s.tag) && d.stunden.some((s) => !s.tag));
  });
});
