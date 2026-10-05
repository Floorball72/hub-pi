import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  csvFeld,
  garantieEnde,
  garantieStufe,
  naechsteWartung,
  tageBis,
} from '../src/server/modules/inventar/rechnen.ts';

describe('Inventar', () => {
  it('rechnet das Garantieende', () => {
    assert.equal(garantieEnde('2024-10-05', 24, null), '2026-10-05');
    // Monatsende wird gekappt
    assert.equal(garantieEnde('2024-08-31', 6, null), '2025-02-28');
    // Erfasstes Datum gewinnt
    assert.equal(garantieEnde('2024-10-05', 24, '2027-01-01'), '2027-01-01');
    assert.equal(garantieEnde('2024-10-05', 0, null), null);
    assert.equal(garantieEnde(null, 24, null), null);
  });

  it('rechnet die nächste Wartung', () => {
    assert.equal(naechsteWartung('2026-07-09', '2024-01-01', 3, '2026-10-05'), '2026-10-09');
    // Nie gewartet: ab Kaufdatum
    assert.equal(naechsteWartung(null, '2025-04-15', 12, '2026-10-05'), '2026-04-15');
    // Weder gewartet noch Kaufdatum: heute fällig
    assert.equal(naechsteWartung(null, null, 12, '2026-10-05'), '2026-10-05');
    assert.equal(naechsteWartung('2026-01-01', null, null, '2026-10-05'), null);
  });

  it('meldet Garantie nur an den Stichtagen', () => {
    assert.equal(tageBis('2026-11-04', '2026-10-05'), 30);
    assert.equal(garantieStufe(30), 30);
    assert.equal(garantieStufe(7), 7);
    assert.equal(garantieStufe(8), null);
    assert.equal(garantieStufe(null), null);
  });

  it('schreibt CSV Felder sicher', () => {
    assert.equal(csvFeld('Kamera'), 'Kamera');
    assert.equal(csvFeld('A;B'), '"A;B"');
    assert.equal(csvFeld('Zoll "35"'), '"Zoll ""35"""');
    assert.equal(csvFeld(null), '');
  });
});
