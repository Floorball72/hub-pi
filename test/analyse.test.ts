import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auswerten,
  distanz,
  type Ereignis,
  resultat,
  zone,
} from '../src/server/modules/analyse/auswertung.ts';
import { demoEreignisse } from '../src/server/modules/analyse/demo.ts';

const e = (teil: Partial<Ereignis>): Ereignis => ({
  id: Math.random().toString(36),
  spiel_id: 'a',
  typ: 'gehalten',
  team: 'eigen',
  x: 0.5,
  y: 0.4,
  spieler_id: null,
  assist_id: null,
  drittel: 1,
  minute: null,
  situation: 'gleich',
  ...teil,
});

test('Analyse: Zonen nach Distanz und Winkel', () => {
  // Tor bei 3.5 m Tiefe, Feldmitte
  assert.equal(Math.round(distanz(0.5, 0.175) * 10) / 10, 0);
  assert.equal(zone(0.5, 0.3), 'Torraum');
  assert.equal(zone(0.55, 0.5), 'Slot');
  assert.equal(zone(0.15, 0.3), 'Seite');
  assert.equal(zone(0.5, 0.9), 'Distanz');
});

test('Analyse: Werte, Spieler und Resultat', () => {
  const liste = [
    e({ typ: 'tor', spieler_id: 's1', assist_id: 's2', x: 0.5, y: 0.3 }),
    e({ typ: 'gehalten', spieler_id: 's1' }),
    e({ typ: 'daneben', spieler_id: 's2', drittel: 2 }),
    e({ typ: 'geblockt', spieler_id: 's1', spiel_id: 'b' }),
    e({ typ: 'tor', team: 'gegner', drittel: 3 }),
  ];
  const spieler = [
    { id: 's1', nummer: 7, name: 'A', position: 'Sturm' },
    { id: 's2', nummer: 10, name: 'B', position: 'Center' },
    { id: 's3', nummer: 4, name: 'C', position: 'Verteidigung' },
  ];
  const a = auswerten(liste, spieler);
  assert.equal(a.eigen.schuesse, 4);
  assert.equal(a.eigen.tore, 1);
  assert.equal(a.eigen.effizienz, 25);
  assert.equal(a.eigen.praezision, 50);
  assert.equal(a.gegner.tore, 1);
  assert.deepEqual(resultat(liste), { eigen: 1, gegner: 1 });
  // Spieler ohne Beteiligung fehlen, sortiert nach Punkten
  assert.deepEqual(
    a.spieler.map((s) => [s.spieler.name, s.tore, s.assists, s.punkte, s.spiele]),
    [
      ['A', 1, 0, 1, 2],
      ['B', 0, 1, 1, 1],
    ],
  );
  assert.equal(a.zonenEigen.find((z) => z.zone === 'Torraum')?.tore, 1);
  assert.deepEqual(
    a.drittel.map((d) => [d.drittel, d.eigen.schuesse, d.gegner.tore]),
    [
      [1, 3, 0],
      [2, 1, 0],
      [3, 0, 1],
    ],
  );
});

test('Analyse: Demo Abschlüsse sind gültig und gleichbleibend', () => {
  const a = demoEreignisse('x', ['1', '2', '3', '4', '5', '6', '7'], 3);
  const b = demoEreignisse('x', ['1', '2', '3', '4', '5', '6', '7'], 3);
  assert.deepEqual(a, b);
  assert.ok(a.length > 30);
  for (const z of a) {
    assert.ok((z.x as number) >= 0 && (z.x as number) <= 1);
    assert.ok((z.y as number) >= 0 && (z.y as number) <= 1);
    if (z.team === 'gegner') assert.equal(z.spieler_id, null);
  }
});
