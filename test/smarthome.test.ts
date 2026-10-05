import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vonLokal } from '../src/server/kern/zeit.ts';
import { adresseOk, feldLesen, istAn, urlOk } from '../src/server/modules/smarthome/adapter.ts';
import {
  faellige,
  naechster,
  tageParsen,
  type Zeitplan,
  zeitpunkt,
} from '../src/server/modules/smarthome/zeitplan.ts';

const LAT = 47.41;
const LON = 9.04;
const plan = (p: Partial<Zeitplan>): Zeitplan => ({
  id: 'p',
  geraet_id: 'g',
  aktion: 'an',
  art: 'uhrzeit',
  uhrzeit: '06:30',
  versatz_min: 0,
  tage: 'Mo-So',
  aktiv: true,
  ...p,
});

test('Tage lesen', () => {
  assert.deepEqual([...tageParsen('Mo-Fr')].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual([...tageParsen('Sa,So')].sort(), [0, 6]);
  assert.equal(tageParsen('Mo-So').size, 7);
  assert.equal(tageParsen('täglich').size, 7);
  assert.equal(tageParsen('').size, 7);
  // Über das Wochenende hinweg
  assert.deepEqual([...tageParsen('Fr-Mo')].sort(), [0, 1, 5, 6]);
});

test('Zeitpunkt und fällige Pläne', () => {
  // Montag, 5. Oktober 2026
  const mo = vonLokal(2026, 10, 5, 12);
  const z = zeitpunkt(plan({}), mo, LAT, LON);
  assert.equal(z?.getTime(), vonLokal(2026, 10, 5, 6, 30).getTime());
  assert.equal(zeitpunkt(plan({ tage: 'Sa,So' }), mo, LAT, LON), null);
  assert.equal(zeitpunkt(plan({ uhrzeit: 'quatsch' }), mo, LAT, LON), null);

  const von = vonLokal(2026, 10, 5, 6, 29);
  const bis = vonLokal(2026, 10, 5, 6, 30);
  assert.equal(faellige([plan({})], von, bis, LAT, LON).length, 1);
  assert.equal(faellige([plan({ aktiv: false })], von, bis, LAT, LON).length, 0);
  // Intervall ist links offen: genau auf der Zeit beim letzten Lauf zählt nicht nochmals
  assert.equal(faellige([plan({})], bis, vonLokal(2026, 10, 5, 6, 31), LAT, LON).length, 0);

  // Sonnenuntergang mit Versatz liegt im Oktober am frühen Abend
  const s = zeitpunkt(plan({ art: 'sonnenuntergang', versatz_min: 15 }), mo, LAT, LON);
  assert.ok(s && s > vonLokal(2026, 10, 5, 18, 30) && s < vonLokal(2026, 10, 5, 19, 45));

  // Nächster Zeitpunkt nach 6:30 ist am Dienstag
  const n = naechster(plan({ tage: 'Mo-Fr' }), vonLokal(2026, 10, 5, 7), LAT, LON);
  assert.equal(n?.getTime(), vonLokal(2026, 10, 6, 6, 30).getTime());
});

test('Adapter Hilfen', () => {
  assert.ok(adresseOk('192.168.1.40'));
  assert.ok(adresseOk('steckdose.local:8080'));
  assert.ok(!adresseOk('http://192.168.1.40'));
  assert.ok(!adresseOk('1.2.3.4/relay'));
  assert.ok(urlOk('http://192.168.1.40/on'));
  assert.ok(!urlOk('file:///etc/passwd'));
  assert.equal(feldLesen({ relays: [{ ison: true }] }, 'relays.0.ison'), true);
  assert.equal(istAn('ON'), true);
  assert.equal(istAn('off'), false);
  assert.equal(istAn(1), true);
  assert.equal(istAn('vielleicht'), null);
});
