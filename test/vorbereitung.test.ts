import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auswerten, type Ereignis } from '../src/server/modules/analyse/auswertung.ts';
import { saisonverlauf } from '../src/server/modules/analyse/verlauf.ts';
import { einschaetzung, gleicherGegner } from '../src/server/modules/analyse/vorbereitung.ts';

let n = 0;
const tor = (spiel: string, team: 'eigen' | 'gegner', drittel: number): Ereignis => ({
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
  situation: null,
});

describe('Spielvorbereitung', () => {
  it('nennt bestes und schlechtestes Drittel und die Serie', () => {
    const spiele = [
      { id: 'a', datum: '2026-10-01', gegner: 'A' },
      { id: 'b', datum: '2026-10-08', gegner: 'B' },
    ];
    const liste = [
      tor('a', 'eigen', 1),
      tor('a', 'eigen', 1),
      tor('a', 'gegner', 3),
      tor('b', 'eigen', 1),
      tor('b', 'gegner', 3),
      tor('b', 'gegner', 3),
      tor('b', 'eigen', 2),
      tor('b', 'eigen', 2),
    ];
    const e = einschaetzung(auswerten(liste, []), saisonverlauf(spiele, liste, []));
    const texte = [...e.staerken, ...e.schwaechen].map((p) => p.text);
    assert.ok(texte.includes('Stark im 1. Drittel'));
    assert.ok(texte.includes('Schwach im 3. Drittel'));
    assert.ok(texte.includes('In Form'));
  });

  it('sagt nach einem einzigen Spiel noch nichts', () => {
    const liste = [tor('x', 'eigen', 1)];
    const e = einschaetzung(
      auswerten(liste, []),
      saisonverlauf([{ id: 'x', datum: '2026-10-01', gegner: 'X' }], liste, []),
    );
    assert.deepEqual(e, { staerken: [], schwaechen: [] });
  });

  it('erkennt gleiche Gegner trotz Zusätzen', () => {
    assert.ok(gleicherGegner('UHC Uster', 'Uster II'));
    assert.ok(gleicherGegner('Floorball Thurgau (Damen)', 'Thurgau'));
    assert.ok(!gleicherGegner('Uster', 'Wil'));
  });
});
