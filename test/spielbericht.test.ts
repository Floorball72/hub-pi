import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ereignis } from '../src/server/modules/analyse/auswertung.ts';
import { spielbericht, spielberichtPdf } from '../src/server/modules/analyse/bericht.ts';

const spieler = [
  { id: 'a', nummer: 7, name: 'Nico', position: 'Sturm' },
  { id: 'b', nummer: 10, name: 'Lars', position: 'Center' },
];
let n = 0;
const tor = (
  team: 'eigen' | 'gegner',
  sek: number,
  schuetze: string | null = null,
  assist: string | null = null,
): Ereignis => ({
  id: String(n++),
  spiel_id: 's',
  typ: 'tor',
  team,
  x: 0.5,
  y: 0.3,
  spieler_id: schuetze,
  assist_id: assist,
  drittel: 1 + Math.floor(sek / 1200),
  minute: Math.floor(sek / 60),
  situation: 'gleich',
  auf_feld: 'a,b',
  zeit_sek: sek,
});

test('Spielbericht: Torfolge, Wende, Siegtreffer und Aufholjagd', () => {
  const b = spielbericht(
    { datum: '2026-10-03', gegner: 'UHC Wil', team: 'Vipers', ort: 'heim' },
    [
      tor('gegner', 100),
      tor('gegner', 1300),
      tor('eigen', 1500, 'a', 'b'),
      tor('eigen', 2500, 'b'),
      tor('eigen', 2560, 'a'),
      tor('gegner', 3500),
    ],
    [],
    spieler,
  );
  assert.equal(b.titel, 'Vipers gegen UHC Wil 3:3 (0:1, 1:1, 2:1)');
  assert.equal(b.ausgang, 'unentschieden');
  assert.deepEqual(
    b.tore.map((t) => t.stand),
    ['0:1', '0:2', '1:2', '2:2', '3:2', '3:3'],
  );
  assert.equal(b.tore[2].schuetze, 'Nico (7)');
  assert.equal(b.tore[2].assist, 'Lars (10)');
  assert.ok(b.momente.includes('Ausgleich zum 2:2 durch Lars (41:40)'));
  assert.ok(b.momente.includes('Wende: Führung zum 3:2 durch Nico (42:40)'));
  assert.ok(b.momente.some((m) => m.startsWith('Doppelschlag von uns')));
  assert.ok(b.momente.includes('Punkt gerettet nach 2 Toren Rückstand'));
  assert.equal(b.beste[0].name, 'Nico (7)');
  assert.ok(b.text.includes('Torfolge'));
  assert.ok(!/[–—]/.test(b.text));
  assert.equal(spielberichtPdf(b).subarray(0, 5).toString(), '%PDF-');
});

test('Spielbericht: Siegtreffer', () => {
  const b = spielbericht(
    { datum: '2026-10-03', gegner: 'X', team: null, ort: 'auswaerts' },
    [tor('eigen', 60, 'a'), tor('gegner', 600), tor('eigen', 900, 'b'), tor('eigen', 3000, 'a')],
    [],
    spieler,
  );
  assert.equal(b.ausgang, 'sieg');
  assert.ok(b.momente.includes('Siegtreffer zum 2:1 durch Lars (15:00)'));
  assert.equal(b.unter, '3.10.2026, auswärts');
});
