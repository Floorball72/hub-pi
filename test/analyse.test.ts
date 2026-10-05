import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  auswerten,
  distanz,
  type Ereignis,
  plusMinus,
  resultat,
  situationAus,
  type Strafe,
  spezialteams,
  strafeEndetDurchTor,
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

const st = (teil: Partial<Strafe>): Strafe => ({
  id: Math.random().toString(36),
  spiel_id: 'a',
  team: 'eigen',
  spieler_id: null,
  minuten: 2,
  zeit_sek: 0,
  ende_sek: null,
  ...teil,
});

test('Analyse: Situation aus laufenden Strafen', () => {
  const strafen = [st({ team: 'gegner', zeit_sek: 100 }), st({ team: 'eigen', zeit_sek: 160 })];
  assert.equal(situationAus(strafen, 50), 'gleich');
  assert.equal(situationAus(strafen, 120), 'ueberzahl');
  assert.equal(situationAus(strafen, 200), 'gleich');
  assert.equal(situationAus(strafen, 230), 'unterzahl');
  assert.equal(situationAus(strafen, 300), 'gleich');
  // 10 Minuten Strafen ändern nichts am Kräfteverhältnis
  assert.equal(situationAus([st({ minuten: 10 })], 30), 'gleich');
  // Höchstens zwei Spieler weniger
  const drei = [st({ zeit_sek: 0 }), st({ zeit_sek: 10 }), st({ zeit_sek: 20 })];
  assert.equal(situationAus([...drei, st({ team: 'gegner', zeit_sek: 30 })], 40), 'unterzahl');
  assert.equal(
    situationAus([...drei, st({ team: 'gegner', zeit_sek: 30 }), st({ team: 'gegner', zeit_sek: 31 })], 40),
    'gleich',
  );
  // Vorzeitig beendet
  assert.equal(situationAus([st({ ende_sek: 50 })], 60), 'gleich');
});

test('Analyse: Tor in Überzahl beendet die älteste 2 Minuten Strafe', () => {
  const a = st({ team: 'gegner', zeit_sek: 100 });
  const b = st({ team: 'gegner', zeit_sek: 130 });
  assert.equal(strafeEndetDurchTor([b, a], 'eigen', 150)?.id, a.id);
  // Gegentor in Unterzahl beendet nichts
  assert.equal(strafeEndetDurchTor([a], 'gegner', 150), null);
  // Gleich viele Spieler: nichts
  assert.equal(strafeEndetDurchTor([a, st({ team: 'eigen', zeit_sek: 110 })], 'eigen', 150), null);
  // 5 Minuten laufen weiter
  assert.equal(strafeEndetDurchTor([st({ team: 'gegner', minuten: 5 })], 'eigen', 60), null);
});

test('Analyse: Plus Minus und Spezialteams', () => {
  const liste = [
    e({ typ: 'tor', auf_feld: 'a,b' }),
    e({ typ: 'tor', auf_feld: 'a,c', situation: 'ueberzahl' }),
    e({ typ: 'tor', team: 'gegner', auf_feld: 'b,c' }),
    e({ typ: 'tor', team: 'gegner', auf_feld: 'a', situation: 'unterzahl' }),
    e({ typ: 'tor', auf_feld: 'c', situation: 'penalty' }),
    e({ typ: 'gehalten', auf_feld: 'a' }),
  ];
  const pm = plusMinus(liste);
  assert.equal(pm.get('a'), 1);
  assert.equal(pm.get('b'), 0);
  assert.equal(pm.get('c'), -1);
  const sp = spezialteams(liste, [
    st({ team: 'gegner' }),
    st({ team: 'gegner', minuten: 10 }),
    st({ team: 'eigen' }),
    st({ team: 'eigen', minuten: 5 }),
  ]);
  assert.deepEqual(sp.ueberzahl, { chancen: 1, tore: 1, quote: 100 });
  assert.deepEqual(sp.unterzahl, { chancen: 2, gegentore: 1, quote: 50 });
  assert.deepEqual(sp.strafminuten, { eigen: 7, gegner: 12 });
});
