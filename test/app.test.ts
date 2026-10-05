// Integrationstest des Servers: Netzsperre, Login, CSRF Schutz, Bestätigungen, Modul Schalter.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { appErstellen } from '../src/server/app.ts';
import { Daten } from '../src/server/daten/index.ts';
import { LokalTreiber } from '../src/server/daten/lokal.ts';
import { konfigLaden } from '../src/server/konfig.ts';

let app: FastifyInstance;
let cookie = '';
const LAN = '192.168.1.10';

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pihub-app-'));
  const konfig = konfigLaden({
    DEMO_MODUS: 'true',
    DATEN_VERZEICHNIS: dir,
    SESSION_SECRET: 'test-geheimnis-test-geheimnis',
    EINRICHTUNG_ABGESCHLOSSEN: 'true',
  });
  konfig.envPfad = join(dir, '.env');
  ({ app } = await appErstellen({
    konfig,
    daten: new Daten(new LokalTreiber(':memory:'), null),
    logger: false,
    webVerzeichnis: dir,
  }));
});
after(async () => {
  await app.close();
});

function anfrage(
  methode: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return app.inject({
    method: methode,
    url,
    remoteAddress: extra.ip ?? LAN,
    headers: {
      cookie,
      'x-pihub': extra.csrf ?? '1',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    payload: body ? JSON.stringify(body) : undefined,
  });
}

describe('Server', () => {
  it('sperrt Anfragen aus dem Internet', async () => {
    const r = await anfrage('GET', '/api/gesundheit', undefined, { ip: '8.8.8.8' });
    assert.equal(r.statusCode, 403);
  });
  it('verlangt Login für Daten', async () => {
    assert.equal((await anfrage('GET', '/api/start')).statusCode, 401);
    assert.equal((await anfrage('GET', '/api/gesundheit')).statusCode, 200);
  });
  it('lehnt schreibende Anfragen ohne CSRF Header ab', async () => {
    const r = await anfrage('POST', '/api/login', { benutzer: 'jerome', passwort: 'demo' }, { csrf: '' });
    assert.equal(r.statusCode, 403);
  });
  it('meldet mit falschem Passwort ab und mit richtigem an', async () => {
    assert.equal(
      (await anfrage('POST', '/api/login', { benutzer: 'jerome', passwort: 'falsch' })).statusCode,
      401,
    );
    const r = await anfrage('POST', '/api/login', { benutzer: 'jerome', passwort: 'demo' });
    assert.equal(r.statusCode, 200);
    const set = String(r.headers['set-cookie']);
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Strict/);
    cookie = set.split(';')[0];
    assert.equal((await anfrage('GET', '/api/start')).statusCode, 200);
  });
  it('liefert Status, Module und Alarmregeln', async () => {
    const s = (await anfrage('GET', '/api/status')).json();
    assert.ok(Array.isArray(s.module));
    const regeln = (await anfrage('GET', '/api/alarm/regeln')).json();
    assert.ok(regeln.length > 0);
  });
  it('braucht Bestätigung für Aktionen und Löschen', async () => {
    assert.equal((await anfrage('POST', '/api/aktionen/backup', {})).statusCode, 400);
    const b = await anfrage('POST', '/api/aktionen/backup', { bestaetigt: true });
    assert.equal(b.statusCode, 200);
    const n = (await anfrage('POST', '/api/daten/notizen', { text: 'Test' })).json();
    assert.equal((await anfrage('DELETE', `/api/daten/notizen/${n.id}`)).statusCode, 400);
    assert.equal((await anfrage('DELETE', `/api/daten/notizen/${n.id}?bestaetigt=ja`)).statusCode, 200);
  });
  it('validiert Eingaben', async () => {
    const r = await anfrage('POST', '/api/daten/notizen', { bezug_typ: 'unbekannt', text: 'x' });
    assert.equal(r.statusCode, 400);
    assert.equal((await anfrage('GET', '/api/daten/einstellungen')).statusCode, 400);
    const regel = (await anfrage('GET', '/api/alarm/regeln')).json()[0];
    assert.equal(
      (await anfrage('PUT', `/api/alarm/regeln/${regel.id}`, { ruhe_von: '25:99x' })).statusCode,
      400,
    );
    assert.equal((await anfrage('PUT', `/api/alarm/regeln/${regel.id}`, { prioritaet: 9 })).statusCode, 400);
  });
  it('gibt keine Geheimnisse über die Einrichtung aus', async () => {
    const r = (await anfrage('GET', '/api/einrichtung')).json();
    assert.equal(JSON.stringify(r).includes('test-geheimnis'), false);
    assert.equal(r.werte.SUPABASE_DB_URL, undefined);
  });
  it('setzt Sicherheits Header', async () => {
    const r = await anfrage('GET', '/api/gesundheit');
    assert.match(String(r.headers['content-security-policy']), /default-src 'self'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  });
});

describe('scont im Demo Modus', () => {
  it('legt Demo Daten an und liefert Übersicht und Details', async () => {
    const u = (await anfrage('GET', '/api/m/scont/uebersicht')).json();
    assert.ok(u.seiten.length >= 3);
    assert.ok(u.seiten[0].verfuegbarkeit.woche > 90);
    const d = (await anfrage('GET', `/api/m/scont/seite/${u.seiten[0].seite.id}`)).json();
    assert.ok(d.pruefungen.length > 10);
    const start = (await anfrage('GET', '/api/start')).json();
    assert.equal(start.kacheln.scont.status, 'warnung');
  });
  it('setzt Standardwerte beim Anlegen einer Seite', async () => {
    const seite = (
      await anfrage('POST', '/api/daten/seiten', { name: 'Testseite', url: 'https://t.example' })
    ).json();
    assert.equal(seite.intervall_min, 5);
  });
});

describe('Tagesrückblick', () => {
  it('sammelt Teile der Module und hat eine Regel ohne Nachtmeldung', async () => {
    const r = (await anfrage('GET', '/api/abendbericht')).json();
    const module = r.teile.map((t: { modul: string }) => t.modul);
    for (const m of ['scont', 'rettung', 'zentrale']) assert.ok(module.includes(m), m);
    const morgen = r.teile.find((t: { titel: string }) => t.titel === 'Morgen');
    assert.ok(morgen.zeilen.length >= 1);
    const regel = (await anfrage('GET', '/api/alarm/regeln'))
      .json()
      .find((x: { id: string }) => x.id === 'zentrale.tagesrueckblick');
    assert.ok(regel);
    assert.equal(regel.nachts, false);
  });
});
