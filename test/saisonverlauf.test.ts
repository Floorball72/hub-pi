import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Ereignis } from '../src/server/modules/analyse/auswertung.ts';
import { saisonverlauf } from '../src/server/modules/analyse/verlauf.ts';

let n = 0;
const tor = (
  spiel: string,
  team: 'eigen' | 'gegner',
  drittel: number,
  situation: string | null = null,
): Ereignis => ({
  id: `e${n++}`,
  spiel_id: spiel,
  typ: 'tor',
  team,
  x: 0,
  y: 0,
  spieler_id: null,
  assist_id: null,
  drittel,
  minute: null,
  situation,
});
const strafe = (spiel: string, team: 'eigen' | 'gegner') => ({
  id: `s${n++}`,
  spiel_id: spiel,
  team,
  spieler_id: null,
  minuten: 2,
  zeit_sek: null,
  ende_sek: null,
});

describe('Saisonverlauf', () => {
  it('rechnet Punkte, Form, Drittel und Spezialteams über die Saison', () => {
    const v = saisonverlauf(
      [
        { id: 'c', datum: '2026-10-20', gegner: 'C' },
        { id: 'a', datum: '2026-10-01', gegner: 'A' },
        { id: 'b', datum: '2026-10-10', gegner: 'B' },
        { id: 'leer', datum: '2026-10-25', gegner: 'D' },
      ],
      [
        tor('a', 'eigen', 1),
        tor('a', 'eigen', 2, 'ueberzahl'),
        tor('a', 'gegner', 3),
        tor('b', 'eigen', 1),
        tor('b', 'gegner', 2),
        tor('b', 'eigen', 4),
        tor('c', 'gegner', 1, 'unterzahl'),
      ],
      [strafe('a', 'gegner'), strafe('a', 'gegner'), strafe('c', 'eigen')],
    );
    assert.deepEqual(
      v.spiele.map((s) => [s.gegner, s.ausgang, s.verlaengerung, s.punkte, s.punkteSumme]),
      [
        ['A', 'S', false, 3, 3],
        ['B', 'S', true, 2, 5],
        ['C', 'N', false, 0, 5],
      ],
    );
    assert.deepEqual(v.form, ['S', 'S', 'N']);
    assert.equal(v.serie, null);
    assert.deepEqual(v.bilanz, {
      spiele: 3,
      siege: 2,
      unentschieden: 0,
      niederlagen: 1,
      punkte: 5,
      punkteProSpiel: 1.67,
      tore: 4,
      gegentore: 3,
    });
    assert.deepEqual(v.drittel, [
      { drittel: 1, tore: 2, gegentore: 1 },
      { drittel: 2, tore: 1, gegentore: 1 },
      { drittel: 3, tore: 0, gegentore: 1 },
      { drittel: 4, tore: 1, gegentore: 0 },
    ]);
    assert.deepEqual(v.ueberzahl, { tore: 1, chancen: 2, quote: 50 });
    assert.deepEqual(v.unterzahl, { gegentore: 1, chancen: 1, quote: 0 });
    assert.equal(v.spiele[0].ueberzahlQuote, 50);
  });
});
