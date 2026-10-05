import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoSpielEreignisse } from '../src/server/modules/unihockey/demo.ts';
import {
  bilanz,
  gegnerVon,
  gespielte,
  namensKern,
  ranglistenZeile,
  skorer,
} from '../src/server/modules/unihockey/gegner.ts';
import { type Spiel, spielEreignisseParsen } from '../src/server/quellen/swissunihockey.ts';

const sp = (teil: Partial<Spiel>): Spiel => ({
  id: Math.random().toString(36),
  zeit: '2026-09-20T07:00:00.000Z',
  datumText: '',
  zeitText: '',
  heim: 'A',
  gast: 'B',
  resultat: null,
  zusatz: null,
  ort: null,
  lat: null,
  lon: null,
  status: null,
  beendet: false,
  liga: null,
  ...teil,
});

test('Gegner: Namen ohne Zusatz vergleichen', () => {
  assert.equal(namensKern('UHC Jonschwil Vipers II'), 'uhc jonschwil vipers');
  assert.equal(namensKern('UHC Uster IV'), 'uhc uster');
  assert.equal(namensKern('United Toggenburg Bazenheid (Herren GF 2. Liga)'), 'united toggenburg bazenheid');
  const z = [
    { rang: 3, team: 'UHCevi Gossau II', spiele: 4, punkte: 9, tore: '20:10', hervorgehoben: false },
  ];
  assert.equal(ranglistenZeile(z, 'UHCevi Gossau II')?.rang, 3);
  assert.equal(ranglistenZeile(z, 'UHCevi Gossau')?.rang, 3);
});

test('Gegner: Form und Bilanz aus Sicht des Teams', () => {
  const spiele = [
    sp({ id: '1', zeit: '2026-09-01T10:00:00Z', heim: 'X', gast: 'G', resultat: '3:5', eigen: 'gast' }),
    sp({ id: '2', zeit: '2026-09-08T10:00:00Z', heim: 'G', gast: 'Y', resultat: '4:4', eigen: 'heim' }),
    sp({ id: '3', zeit: '2026-09-15T10:00:00Z', heim: 'G', gast: 'Z', resultat: '1:6' }),
    sp({ id: '4', zeit: '2026-09-22T10:00:00Z', heim: 'G', gast: 'Z' }),
  ];
  const f = gespielte(spiele, 'G');
  assert.deepEqual(
    f.map((x) => [x.id, x.ausgang, x.resultat]),
    [
      ['3', 'N', '1:6'],
      ['2', 'U', '4:4'],
      ['1', 'S', '5:3'],
    ],
  );
  const b = bilanz(f);
  assert.deepEqual(b, {
    spiele: 3,
    siege: 1,
    unentschieden: 1,
    niederlagen: 1,
    toreSchnitt: 3.3,
    gegentoreSchnitt: 4.3,
  });
  assert.equal(gegnerVon(spiele[0]), 'X');
  assert.equal(gegnerVon(sp({ heim: 'P', gast: 'Q' })), null);
});

test('Gegner: Spielereignisse lesen und Skorer zählen', () => {
  const zeile = (zeit: string, art: string, team: string, wer: string) => ({
    cells: [{ text: [zeit] }, { text: [art] }, { text: team ? [team] : [] }, { text: [wer] }],
  });
  const e = spielEreignisseParsen({
    data: {
      headers: [],
      tabs: [{ text: 'Alle Ereignisse' }, { text: 'UHC Heim' }, { text: 'UHC Gast' }],
      regions: [
        {
          rows: [
            zeile('', 'Spielende', '', ''),
            zeile('39:42', 'Torschütze 2:1', 'UHC Heim', 'A. Wyler (A. Huber)'),
            zeile('22:01', "2'-Strafe (Wechselfehler)", 'UHC Gast', 'M. Bösch'),
            zeile('12:40', 'Torschütze 1:1', 'UHC Gast', 'M. Bösch'),
            zeile('05:04', 'Torschütze 1:0', 'UHC Heim', 'A. Huber (A. Wyler)'),
            zeile('00:00', 'Spielbeginn', '', ''),
          ],
        },
      ],
    },
  });
  assert.equal(e.heim, 'UHC Heim');
  assert.equal(e.ereignisse[0].text, 'Spielbeginn');
  const tor = e.ereignisse.find((x) => x.zeit === '39:42');
  assert.deepEqual(
    { typ: tor?.typ, seite: tor?.seite, spieler: tor?.spieler, assist: tor?.assist },
    { typ: 'tor', seite: 'heim', spieler: 'A. Wyler', assist: 'A. Huber' },
  );
  const strafe = e.ereignisse.find((x) => x.typ === 'strafe');
  assert.equal(strafe?.minuten, 2);
  assert.equal(strafe?.assist, null);

  const heim = skorer([{ ereignisse: e, seite: 'heim' }]);
  assert.deepEqual(
    heim.map((s) => [s.name, s.tore, s.assists, s.punkte, s.spiele]),
    [
      ['A. Huber', 1, 1, 2, 1],
      ['A. Wyler', 1, 1, 2, 1],
    ],
  );
  const gast = skorer([{ ereignisse: e, seite: 'gast' }]);
  assert.deepEqual(gast, [{ name: 'M. Bösch', tore: 1, assists: 0, punkte: 1, strafminuten: 2, spiele: 1 }]);
});

test('Gegner: Demo Ereignisse passen zum Resultat', () => {
  const e = demoSpielEreignisse('demo-x-1', 'H', 'G', '5:3');
  const tore = e.ereignisse.filter((x) => x.typ === 'tor');
  assert.equal(tore.filter((x) => x.seite === 'heim').length, 5);
  assert.equal(tore.filter((x) => x.seite === 'gast').length, 3);
  assert.deepEqual(demoSpielEreignisse('demo-x-1', 'H', 'G', '5:3'), e);
});
