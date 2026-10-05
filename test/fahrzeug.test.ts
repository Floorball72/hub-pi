import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  kmHeute,
  kmProTag,
  reifen,
  service,
  verbrauch,
  vignette,
} from '../src/server/modules/fahrzeug/rechnen.ts';

describe('Fahrzeug', () => {
  it('rechnet den Verbrauch von Volltankung zu Volltankung und zählt Teiltankungen mit', () => {
    const v = verbrauch([
      { datum: '2026-01-01', km: 10000, liter: 40, betrag: 70, voll: true },
      { datum: '2026-01-10', km: 10300, liter: 10, betrag: 18, voll: false },
      { datum: '2026-01-20', km: 10700, liter: 32, betrag: 56, voll: true },
      { datum: '2026-02-01', km: 11200, liter: 35, betrag: null, voll: true },
    ]);
    assert.equal(v.abschnitte.length, 2);
    assert.equal(v.abschnitte[0].l100, 6);
    assert.equal(v.abschnitte[1].l100, 7);
    assert.equal(v.mittel, 6.4);
    // Ein Betrag fehlt, darum keine Kosten pro 100 km
    assert.equal(v.chf100, null);
  });

  it('schätzt Fahrleistung und Kilometerstand', () => {
    const proTag = kmProTag(
      [
        { datum: '2026-01-01', km: 10000 },
        { datum: '2026-03-02', km: 11200 },
      ],
      '2026-03-10',
    );
    assert.equal(proTag, 20);
    assert.equal(kmHeute({ datum: '2026-03-02', km: 11200 }, proTag, '2026-03-12'), 11400);
    assert.equal(
      kmProTag(
        [
          { datum: '2026-03-01', km: 1 },
          { datum: '2026-03-10', km: 500 },
        ],
        '2026-03-10',
      ),
      null,
    );
  });

  it('nimmt beim Service, was zuerst kommt', () => {
    const nachKm = service('2026-01-01', 10000, 12, 15000, 24000, 50, '2026-06-01');
    assert.equal(nachKm.km, 25000);
    assert.equal(nachKm.faellig, '2026-06-21');
    assert.equal(nachKm.tage, 20);
    const nachDatum = service('2026-01-01', 10000, 12, 15000, 11000, 10, '2026-06-01');
    assert.equal(nachDatum.faellig, '2027-01-01');
    assert.equal(service(null, null, 12, 15000, 1000, 10, '2026-06-01').faellig, null);
  });

  it('empfiehlt Reifen von Oktober bis Ostern', () => {
    assert.deepEqual(reifen('Sommer', '2026-10-20'), { soll: 'Winter', wechseln: true, ab: '2027-04-15' });
    assert.equal(reifen('Winter', '2026-02-01').wechseln, false);
    assert.equal(reifen('Winter', '2026-05-01').wechseln, true);
    assert.equal(reifen('Ganzjahr', '2026-11-01').wechseln, false);
  });

  it('prüft die Vignette über den Jahreswechsel', () => {
    assert.deepEqual(vignette(2026, '2026-06-01'), { gueltig: true, kaufen: false, fuer: 2026 });
    assert.deepEqual(vignette(2026, '2026-12-05'), { gueltig: true, kaufen: true, fuer: 2027 });
    assert.equal(vignette(2026, '2027-01-20').gueltig, true);
    assert.equal(vignette(2026, '2027-02-01').gueltig, false);
    assert.equal(vignette(2027, '2026-12-05').gueltig, true);
  });
});
