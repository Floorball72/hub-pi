import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  kuendigung,
  monatsBetrag,
  naechsteZahlung,
  termine,
  warnstufe,
} from '../src/server/modules/finanzen/rechnen.ts';

const HEUTE = '2026-10-05';

test('Monatsbetrag und Zahltermine', () => {
  assert.equal(monatsBetrag(120, 'jaehrlich'), 10);
  assert.equal(monatsBetrag(120, 'jährlich'), 10);
  assert.equal(monatsBetrag(30, 'vierteljaehrlich'), 10);
  assert.equal(monatsBetrag(500, 'einmalig'), 0);
  assert.equal(naechsteZahlung('2026-10-05', 'monatlich', HEUTE), '2026-10-05');
  assert.equal(naechsteZahlung('2026-08-31', 'monatlich', HEUTE), '2026-10-31');
  assert.equal(naechsteZahlung('2026-01-31', 'monatlich', '2026-02-15'), '2026-02-28');
  assert.equal(naechsteZahlung('2025-03-01', 'jaehrlich', HEUTE), '2027-03-01');
  assert.equal(naechsteZahlung(null, 'monatlich', HEUTE), null);
  assert.deepEqual(termine('2026-01-31', 'monatlich', '2026-02-01', '2026-04-30'), [
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
  ]);
  assert.deepEqual(termine('2026-11-15', 'einmalig', HEUTE, '2026-12-31'), ['2026-11-15']);
  assert.deepEqual(termine('2026-01-10', 'vierteljaehrlich', HEUTE, '2027-04-30'), [
    '2026-10-10',
    '2027-01-10',
    '2027-04-10',
  ]);
});

test('Kündigungsfrist', () => {
  // Krankenkasse: Ende Jahr, ein Monat Frist
  assert.deepEqual(kuendigung('2026-12-31', 1, 12, HEUTE), {
    vertragsende: '2026-12-31',
    kuendigenBis: '2026-11-30',
    tage: 56,
    verpasst: false,
  });
  // Frist für dieses Ende verpasst: nächste Möglichkeit ein Jahr später
  const v = kuendigung('2026-10-30', 1, 12, HEUTE);
  assert.equal(v?.verpasst, true);
  assert.equal(v?.vertragsende, '2027-10-30');
  assert.equal(v?.kuendigenBis, '2027-09-30');
  // Vertragsende liegt zurück: hat sich bis Ende 2026 verlängert, die Frist dafür ist aber vorbei
  assert.equal(kuendigung('2024-12-31', 3, 12, HEUTE)?.kuendigenBis, '2027-09-30');
  // Ohne Verlängerung: endet einfach
  assert.equal(kuendigung('2026-10-20', 1, 0, HEUTE)?.kuendigenBis, null);
  assert.equal(kuendigung(null, 1, 12, HEUTE), null);
  // Ohne Frist ist der letzte Tag das Vertragsende selbst
  assert.equal(kuendigung('2026-10-05', 0, 1, HEUTE)?.tage, 0);
});

test('Warnstufen', () => {
  assert.equal(warnstufe(45), null);
  assert.equal(warnstufe(30), 30);
  assert.equal(warnstufe(20), 30);
  assert.equal(warnstufe(14), 14);
  assert.equal(warnstufe(3), 7);
  assert.equal(warnstufe(1), 1);
  assert.equal(warnstufe(0), 0);
  assert.equal(warnstufe(-1), null);
});
