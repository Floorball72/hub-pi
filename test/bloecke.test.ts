import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Ereignis, nachBlock } from '../src/server/modules/analyse/auswertung.ts';

describe('Block Auswertung', () => {
  it('ordnet Abschlüsse dem Mehrheitsblock zu und zählt Plus Minus ohne Überzahl', () => {
    const spieler = [1, 2, 3, 4, 5, 6].map((i) => ({
      id: `s${i}`,
      nummer: i,
      name: `S${i}`,
      position: null,
      block: i <= 3 ? 1 : 2,
    }));
    let n = 0;
    const e = (
      team: 'eigen' | 'gegner',
      typ: Ereignis['typ'],
      auf_feld: string | null,
      situation: string | null = null,
    ): Ereignis => ({
      id: `e${n++}`,
      spiel_id: 'g',
      typ,
      team,
      x: 0,
      y: 0,
      spieler_id: null,
      assist_id: null,
      drittel: 1,
      minute: null,
      situation,
      auf_feld,
    });
    const r = nachBlock(
      [
        e('eigen', 'tor', 's1,s2,s3'),
        e('eigen', 'daneben', 's1,s2,s4'),
        e('gegner', 'tor', 's1,s2,s3'),
        e('eigen', 'tor', 's4,s5,s6', 'ueberzahl'),
        e('gegner', 'gehalten', 's1,s4'),
        e('eigen', 'gehalten', null),
      ],
      spieler,
    );
    assert.deepEqual(
      r.bloecke.map((b) => [b.name, b.schuesseFuer, b.schuesseGegen, b.toreFuer, b.toreGegen, b.plusMinus]),
      [
        ['Block 1', 2, 1, 1, 1, 0],
        ['Block 2', 1, 0, 1, 0, 0],
        ['Gemischt', 0, 1, 0, 0, 0],
      ],
    );
    assert.equal(r.ohneFeld, 1);
    assert.deepEqual(r.bloecke[0].spieler, ['S1 1', 'S2 2', 'S3 3']);
  });
});
