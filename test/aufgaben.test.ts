import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tabelleFehlt } from '../src/server/kern/backup.ts';
import { schnellErfassen } from '../src/server/modules/aufgaben/schnell.ts';
import {
  naechsteFaelligkeit,
  periode,
  plusMonate,
  schritte,
  serie,
} from '../src/server/modules/aufgaben/wiederholung.ts';

// Montag, 5. Oktober 2026
const HEUTE = '2026-10-05';

test('Wiederholung', () => {
  assert.equal(plusMonate('2026-01-31', 1), '2026-02-28');
  assert.equal(plusMonate('2028-01-31', 1), '2028-02-29');
  assert.equal(naechsteFaelligkeit('2026-10-05', 'woechentlich', HEUTE), '2026-10-12');
  // Verspätet erledigt: bleibt auf dem Wochentag, liegt aber in der Zukunft
  assert.equal(naechsteFaelligkeit('2026-09-14', 'woechentlich', HEUTE), '2026-10-12');
  // Monatsende bleibt erhalten und wandert nicht auf den 28.
  assert.equal(naechsteFaelligkeit('2026-01-31', 'monatlich', '2026-02-10'), '2026-02-28');
  assert.equal(naechsteFaelligkeit('2026-01-31', 'monatlich', '2026-03-01'), '2026-03-31');
  assert.equal(naechsteFaelligkeit(null, 'taeglich', HEUTE), '2026-10-06');
  assert.equal(naechsteFaelligkeit('2026-10-05', 'einmalig', HEUTE), null);
});

test('Routinen: Periode, Serie und Schritte', () => {
  assert.equal(periode('2026-10-08', 'woechentlich'), '2026-10-05');
  assert.equal(periode('2026-10-11', 'woechentlich'), '2026-10-05');
  assert.equal(periode('2026-10-08', 'taeglich'), '2026-10-08');
  // Heute offen, die drei Tage davor erledigt
  assert.equal(serie(new Set(['2026-10-04', '2026-10-03', '2026-10-02']), HEUTE, 'taeglich'), 3);
  assert.equal(serie(new Set([HEUTE, '2026-10-04']), HEUTE, 'taeglich'), 2);
  assert.equal(serie(new Set(['2026-10-03']), HEUTE, 'taeglich'), 0);
  assert.equal(serie(new Set(['2026-09-28', '2026-09-21']), '2026-10-07', 'woechentlich'), 2);
  assert.deepEqual(schritte('- Akkus laden\n\n2. Propeller\n* SD Karte  '), [
    'Akkus laden',
    'Propeller',
    'SD Karte',
  ]);
});

test('Schnellerfassung', () => {
  const a = schnellErfassen('Offerte schreiben morgen 9:00 #scont !', HEUTE);
  assert.deepEqual(a, {
    titel: 'Offerte schreiben',
    faellig: '2026-10-06',
    uhrzeit: '09:00',
    liste: 'scont',
    prioritaet: 'hoch',
    rhythmus: 'einmalig',
  });
  assert.equal(schnellErfassen('Training am Freitag', HEUTE).faellig, '2026-10-09');
  // Heute ist Montag: «mo» meint den nächsten Montag
  assert.equal(schnellErfassen('Altglas mo', HEUTE).faellig, '2026-10-12');
  // Datum ohne Jahr, das schon vorbei ist, liegt im nächsten Jahr
  assert.equal(schnellErfassen('Vignette kaufen 1.2.', HEUTE).faellig, '2027-02-01');
  assert.equal(schnellErfassen('Rechnung 20.10.2026', HEUTE).faellig, '2026-10-20');
  const w = schnellErfassen('Pflanzen giessen wöchentlich', HEUTE);
  assert.equal(w.rhythmus, 'woechentlich');
  assert.equal(w.faellig, HEUTE);
  assert.equal(w.titel, 'Pflanzen giessen');
  // «so» als Wort bleibt im Titel
  const s = schnellErfassen('so bald wie möglich anrufen', HEUTE);
  assert.equal(s.faellig, null);
  assert.equal(s.titel, 'so bald wie möglich anrufen');
  assert.equal(schnellErfassen('Anruf 14:30', HEUTE).faellig, HEUTE);
});

test('Backup erkennt fehlende Tabellen', () => {
  assert.ok(tabelleFehlt(new Error('relation "analyse_spiele" does not exist')));
  assert.ok(tabelleFehlt(new Error('no such table: aufgaben')));
  assert.ok(!tabelleFehlt(new Error('connection refused')));
});
