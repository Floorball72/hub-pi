import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  berichtAbsatz,
  entwurf,
  pushText,
  spielBericht,
} from '../src/server/modules/swissunihockey/bericht.ts';
import type { Spiel, SpielEreignis } from '../src/server/quellen/swissunihockey.ts';

const spiel = (resultat: string): Spiel => ({
  id: 's1',
  zeit: null,
  datumText: '',
  zeitText: '',
  heim: 'UHC Heim',
  gast: 'UHC Gast',
  resultat,
  zusatz: null,
  ort: null,
  lat: null,
  lon: null,
  status: 'Spiel beendet',
  beendet: true,
  liga: 'Herren NLB',
});
const tor = (
  zeit: string,
  seite: 'heim' | 'gast',
  spieler: string,
  assist: string | null = null,
): SpielEreignis => ({
  zeit,
  typ: 'tor',
  text: 'Torschütze',
  seite,
  spieler,
  assist,
  minuten: null,
});

test('Spielbericht: Torfolge, Siegtreffer und Wende', () => {
  const e = {
    heim: 'UHC Heim',
    gast: 'UHC Gast',
    ereignisse: [
      tor('03:10', 'gast', 'M. Bösch'),
      tor('11:00', 'gast', 'M. Bösch', 'P. Frei'),
      tor('25:30', 'heim', 'A. Wyler', 'A. Huber'),
      tor('40:02', 'heim', 'A. Huber'),
      tor('52:44', 'heim', 'A. Wyler'),
    ],
  };
  const b = spielBericht(spiel('3:2'), e);
  assert.deepEqual(
    b.tore.map((t) => t.stand),
    ['0:1', '0:2', '1:2', '2:2', '3:2'],
  );
  assert.equal(b.siegtreffer?.spieler, 'A. Wyler');
  assert.equal(b.siegtreffer?.stand, '3:2');
  assert.equal(b.rueckstandSieger, 2);
  const absatz = berichtAbsatz(b);
  assert.match(absatz, /UHC Heim gewinnt zu Hause gegen UHC Gast mit 3:2\./);
  assert.match(absatz, /mit 2 Toren im Rückstand und drehte das Spiel/);
  assert.match(absatz, /zum 3:2 erzielte A\. Wyler in der 53\. Minute/);
  assert.match(absatz, /Tore UHC Heim: A\. Wyler 2, A\. Huber\. Tore UHC Gast: M\. Bösch 2\./);
  assert.doesNotMatch(absatz, /[–—]/);
  const nv = spielBericht(spiel('2:3'), {
    heim: 'UHC Heim',
    gast: 'UHC Gast',
    ereignisse: [
      tor('10:00', 'heim', 'A'),
      tor('20:00', 'heim', 'A'),
      tor('30:00', 'gast', 'B'),
      tor('59:00', 'gast', 'B'),
      tor('62:15', 'gast', 'C'),
    ],
  });
  assert.match(
    berichtAbsatz(nv),
    /mit 3:2 nach Verlängerung\. .*Bester Skorer bei UHC Heim war A mit 2 Toren\./,
  );
});

test('Spielbericht: Auswärtssieg, Unentschieden und fehlende Ereignisse', () => {
  const ohne = spielBericht(spiel('1:4'), null);
  assert.equal(ohne.ohneEreignisse, true);
  assert.equal(berichtAbsatz(ohne), 'UHC Gast gewinnt auswärts bei UHC Heim mit 4:1.');
  assert.equal(berichtAbsatz(spielBericht(spiel('2:2'), null)), 'UHC Heim und UHC Gast trennen sich 2:2.');

  const e = entwurf([ohne]);
  assert.equal(e.resultate, 'Herren NLB\nUHC Heim gegen UHC Gast 1:4');
  assert.equal(pushText([ohne]), 'UHC Heim gegen UHC Gast 1:4');
  const lang = pushText(
    Array.from({ length: 50 }, () => ohne),
    100,
  );
  assert.equal(lang.length, 100);
});
