// Ablauftest des Webseiten Wächters gegen einen lokalen Testserver (ohne Demo Modus).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { appErstellen } from '../src/server/app.ts';
import { Daten } from '../src/server/daten/index.ts';
import { LokalTreiber } from '../src/server/daten/lokal.ts';
import { konfigLaden } from '../src/server/konfig.ts';

let app: FastifyInstance;
let daten: Daten;
let antwort = 200;
const server = createServer((_req, res) => {
  res.statusCode = antwort;
  res.end('Hallo Welt');
});
let url = '';
let cookie = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const dir = mkdtempSync(join(tmpdir(), 'pihub-w-'));
  const konfig = konfigLaden({
    DEMO_MODUS: 'false',
    DATEN_VERZEICHNIS: dir,
    SESSION_SECRET: 'x'.repeat(32),
    ADMIN_PASSWORT_HASH: '',
    EINRICHTUNG_ABGESCHLOSSEN: 'true',
    NTFY_THEMA: '',
  });
  daten = new Daten(new LokalTreiber(':memory:'), null);
  ({ app } = await appErstellen({ konfig, daten, logger: false, webVerzeichnis: dir }));
  // Login direkt über ein gültiges Sitzungscookie
  const { sitzungErstellen } = await import('../src/server/kern/auth.ts');
  cookie = `pihub_sitzung=${encodeURIComponent(sitzungErstellen({ benutzer: 'jerome', art: 'lokal' }, 'x'.repeat(32)))}`;
});
after(async () => {
  await app.close();
  server.close();
});

const post = (u: string, body: unknown) =>
  app.inject({
    method: 'POST',
    url: u,
    remoteAddress: '127.0.0.1',
    headers: { cookie, 'x-pihub': '1', 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });

describe('Webseiten Wächter', () => {
  it('meldet Ausfall erst nach zwei Fehlern und Rückkehr danach', async () => {
    const s = (await post('/api/daten/seiten', { name: 'Lokal', url, erwarteter_text: 'Hallo' })).json();
    assert.equal((await post(`/api/m/scont/seite/${s.id}/pruefen`, { bestaetigt: true })).json().ok, true);
    antwort = 500;
    assert.equal((await post(`/api/m/scont/seite/${s.id}/pruefen`, { bestaetigt: true })).json().ok, false);
    assert.equal(await daten.anzahl('vorfaelle'), 0, 'ein einzelner Fehler ist noch kein Ausfall');
    await post(`/api/m/scont/seite/${s.id}/pruefen`, { bestaetigt: true });
    const [v] = await daten.liste<{ ende: string | null; grund: string }>('vorfaelle');
    assert.equal(v.ende, null);
    assert.equal(v.grund, 'HTTP 500');
    const alarme = await daten.liste<{ regel: string; status: string }>('alarme', {
      filter: { regel: 'scont.ausfall' },
    });
    assert.equal(alarme.length, 1);
    assert.equal(alarme[0].status, 'nicht_konfiguriert');
    antwort = 200;
    await post(`/api/m/scont/seite/${s.id}/pruefen`, { bestaetigt: true });
    const [v2] = await daten.liste<{ ende: string | null }>('vorfaelle');
    assert.ok(v2.ende);
    assert.equal(await daten.anzahl('alarme', { regel: 'scont.wieder_da' }), 1);
    assert.equal(await daten.anzahl('pruefungen', { seite_id: s.id }), 4);
  });
});
