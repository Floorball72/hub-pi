// Tests der Sonnenuntergangs Prognose.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  naechsteStunde,
  punktInRichtung,
  STANDARD_GEWICHTE,
  sonnenScore,
  vergleich,
} from '../src/server/modules/drohne/sonnenuntergang.ts';
import type { Stunde } from '../src/server/quellen/openmeteo.ts';
import { distanzKm } from '../src/server/quellen/geo.ts';

const basis: Stunde = {
  t: 0,
  temp: 15,
  regen: 0,
  regenWahrsch: 0,
  code: 2,
  wind10: 5,
  wind80: 8,
  wind120: 9,
  boeen: 10,
  richtung: 270,
  wolken: 50,
  wolkenTief: 0,
  wolkenMittel: 30,
  wolkenHoch: 40,
  sicht: 40000,
  feuchte: 55,
  tag: true,
};

describe('Sonnenuntergang Score', () => {
  it('ideale Bedingungen geben einen hohen Score', () => {
    const r = sonnenScore(basis, { ...basis, wolkenTief: 0 });
    assert.ok(r.score >= 90, String(r.score));
    assert.equal(r.faktoren.length, 6);
  });
  it('geschlossene tiefe Decke oder Regen geben einen tiefen Score', () => {
    assert.ok(
      sonnenScore(
        { ...basis, wolkenTief: 100, regen: 1.5, sicht: 3000, feuchte: 98 },
        { ...basis, wolkenTief: 100 },
      ).score < 20,
    );
  });
  it('wolkenloser Himmel ist gut, aber nicht spektakulär', () => {
    const s = sonnenScore({ ...basis, wolkenHoch: 0, wolkenMittel: 0 }, null).score;
    assert.ok(s > 50 && s < 75, String(s));
  });
  it('Gewichte wirken: nur Horizont zählt', () => {
    const g = { ...STANDARD_GEWICHTE, wolken: 0, tief: 0, sicht: 0, feuchte: 0, regen: 0, horizont: 1 };
    assert.equal(sonnenScore(basis, { ...basis, wolkenTief: 40 }, g).score, 60);
  });
  it('Horizontpunkt liegt in der richtigen Richtung und Entfernung', () => {
    const p = punktInRichtung(47.41, 9.04, 270, 80);
    assert.ok(Math.abs(distanzKm(47.41, 9.04, p.lat, p.lon) - 80) < 0.5);
    assert.ok(p.lon < 9.04 && Math.abs(p.lat - 47.41) < 0.05);
  });
  it('wählt die nächste Stunde nur innerhalb einer Stunde', () => {
    const st = [
      { ...basis, t: 0 },
      { ...basis, t: 3600000 },
    ];
    assert.equal(naechsteStunde(st, 3000000)?.t, 3600000);
    assert.equal(naechsteStunde(st, 9000000), null);
  });
  it('vergleicht Prognose und Bewertung', () => {
    const v = vergleich([
      { score: 100, bewertung: 5 },
      { score: 0, bewertung: 1 },
      { score: 50, bewertung: 3 },
    ]);
    assert.equal(v.mittlererFehler, 0);
    assert.equal(v.korrelation, 1);
    assert.equal(vergleich([]).anzahl, 0);
  });
});
