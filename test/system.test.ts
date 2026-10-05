// Deutung von vcgencmd get_throttled
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drosselungDeuten, stromText } from '../src/server/kern/system.ts';

describe('Drosselung deuten', () => {
  it('erkennt Unterspannung jetzt und seit Start', () => {
    const z = drosselungDeuten('0x50005');
    assert.ok(z);
    assert.equal(z.unterspannung, true);
    assert.equal(z.gedrosselt, true);
    assert.equal(z.frequenzBegrenzt, false);
    assert.equal(z.unterspannungSeitStart, true);
    assert.equal(stromText(z), 'Unterspannung');
  });
  it('alles gut und nur vergangene Unterspannung', () => {
    assert.equal(stromText(drosselungDeuten('0x0')), 'gut');
    assert.equal(stromText(drosselungDeuten('0x50000')), 'Unterspannung seit Start');
  });
  it('ohne Pi unbekannt', () => {
    assert.equal(drosselungDeuten(null), null);
    assert.equal(drosselungDeuten('kaputt'), null);
    assert.equal(stromText(null), 'unbekannt');
  });
});
