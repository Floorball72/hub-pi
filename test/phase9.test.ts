// Tests für Abrufplaner, Auffälligkeiten, Selbstheilung, Sichere Updates und Dreh Wetter Wächter.
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
import { sitzungErstellen } from '../src/server/kern/auth.ts';
import {
  bewerten,
  eimer,
  faktorNachRueckmeldung,
  medianMad,
  MetrikRegistry,
  SCHWELLE,
} from '../src/server/kern/metriken.ts';
import { Abrufplaner, type PlanerEinstellung } from '../src/server/kern/planer.ts';
import { Scheduler } from '../src/server/kern/scheduler.ts';
import { vonLokal } from '../src/server/kern/zeit.ts';
import { konfigLaden } from '../src/server/konfig.ts';
import { basisBerechnen, basisFuer, stundenMittel } from '../src/server/modules/auffaelligkeiten/index.ts';
import { alternativenFinden, drehBewerten, faelligeStufe } from '../src/server/modules/drehwetter/index.ts';
import { STANDARD_GRENZEN } from '../src/server/modules/drohne/fenster.ts';
import { jobMassnahme, PAUSEN_MIN, speicherKnapp } from '../src/server/modules/selbstheilung/index.ts';
import { ergebnisLesen, updateFaellig } from '../src/server/modules/updates/index.ts';
import { bedingteAbrufe, httpText } from '../src/server/quellen/http.ts';
import type { Stunde } from '../src/server/quellen/openmeteo.ts';
import { Quelle } from '../src/server/quellen/quelle.ts';

describe('Abrufplaner', () => {
  const tag = vonLokal(2026, 10, 5, 14); // Montag 14 Uhr
  const nacht = vonLokal(2026, 10, 6, 2);
  it('streckt den Takt je nach Nutzung, wichtige Quellen nur wenig', () => {
    let jetzt = tag;
    const p = new Abrufplaner(
      () => null,
      () => jetzt,
    );
    p.nutzung();
    assert.equal(p.ttlSek({ id: 'a', ttlSek: 600 }), 600);
    jetzt = new Date(tag.getTime() + 3 * 3600000);
    assert.equal(p.nutzungsStufe(), 'schlaf');
    assert.equal(p.ttlSek({ id: 'a', ttlSek: 600 }), 1500);
    jetzt = nacht;
    assert.equal(p.nutzungsStufe(), 'nacht');
    assert.equal(p.ttlSek({ id: 'a', ttlSek: 600 }), 1800);
    assert.equal(p.ttlSek({ id: 'b', ttlSek: 600, wichtig: true }), 900);
    // nie über das Maximum
    assert.equal(p.ttlSek({ id: 'c', ttlSek: 600, maxSek: 1000 }), 1000);
  });
  it('macht nach 3 Fehlern eine Pause, aber nur für diese Adresse', () => {
    const jetzt = tag;
    const p = new Abrufplaner(
      () => null,
      () => jetzt,
    );
    const q = { id: 'x', ttlSek: 60 };
    for (let i = 0; i < 3; i++) p.fehler('x', 60, 'kaputt');
    assert.equal(p.darf(q, 'kaputt').ok, false);
    assert.equal(p.darf(q, 'gut').ok, true);
    assert.equal(p.darf({ ...q, wichtig: true }, 'kaputt').ok, true);
    p.erfolg('x', 'kaputt');
    assert.equal(p.darf(q, 'kaputt').ok, true);
  });
  it('beachtet Modus aus, fix und das Tagesbudget', () => {
    const e: Record<string, PlanerEinstellung> = {
      aus: { modus: 'aus' },
      fix: { modus: 'fix', fixSek: 120 },
      budget: { modus: 'auto', budget: 2 },
    };
    const p = new Abrufplaner(
      (id) => e[id] ?? null,
      () => tag,
    );
    assert.equal(p.darf({ id: 'aus', ttlSek: 60 }).ok, false);
    assert.equal(p.ttlSek({ id: 'fix', ttlSek: 600 }), 120);
    p.abgerufen('budget');
    p.abgerufen('budget');
    const r = p.darf({ id: 'budget', ttlSek: 60 });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.grund : '', /Tagesbudget/);
  });
  it('Quelle: liefert bei Mindestabstand und Pause den letzten Stand', async () => {
    let abrufe = 0;
    let fehler = false;
    const p = new Abrufplaner(() => null);
    const q = new Quelle<string, number>(
      {
        id: 't',
        name: 't',
        modul: 'm',
        ttlSek: 600,
        minSek: 30,
        abruf: async () => {
          abrufe++;
          if (fehler) throw new Error('weg');
          return abrufe;
        },
        demo: () => 0,
      },
      { demo: () => false, aktiv: () => true, planer: p },
    );
    assert.equal((await q.hole('a')).daten, 1);
    assert.equal((await q.hole('a', true)).daten, 1); // Mindestabstand
    assert.equal(abrufe, 1);
    fehler = true;
    for (let i = 0; i < 3; i++) await q.hole('b', true);
    assert.equal((await q.hole('b', true)).fehler?.startsWith('Pause'), true);
    assert.equal(p.zaehlerVon('t').heute, 4);
  });
});

describe('Bedingte Abrufe (ETag)', () => {
  let server: ReturnType<typeof createServer>;
  let url = '';
  let antworten304 = 0;
  before(async () => {
    server = createServer((req, res) => {
      if (req.headers['if-none-match'] === '"v1"') {
        antworten304++;
        res.writeHead(304).end();
        return;
      }
      res.writeHead(200, { etag: '"v1"', 'content-type': 'text/plain' }).end('Inhalt v1');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/daten`;
  });
  after(() => server.close());
  it('fragt beim zweiten Mal mit If-None-Match und nutzt die gemerkte Antwort', async () => {
    const vorher = bedingteAbrufe.nichtGeaendert;
    assert.equal(await httpText(url, { abstandMs: 0 }), 'Inhalt v1');
    assert.equal(await httpText(url, { abstandMs: 0 }), 'Inhalt v1');
    assert.equal(antworten304, 1);
    assert.equal(bedingteAbrufe.nichtGeaendert, vorher + 1);
  });
});

describe('Auffälligkeiten', () => {
  it('Median und MAD sind robust gegen Ausreisser', () => {
    const r = medianMad([10, 11, 9, 10, 12, 10, 500]);
    assert.equal(r.median, 10);
    assert.equal(r.mad, 1);
  });
  it('erkennt Abweichungen je nach Richtung und Mindestabweichung', () => {
    const b = { median: 50, mad: 2, n: 40 };
    assert.equal(bewerten(70, b, { id: 't', name: 't' }, SCHWELLE.normal).ausserhalb, true);
    assert.equal(bewerten(53, b, { id: 't', name: 't' }, SCHWELLE.normal).ausserhalb, false);
    assert.equal(
      bewerten(30, b, { id: 't', name: 't', richtung: 'hoch' }, SCHWELLE.normal).ausserhalb,
      false,
    );
    assert.equal(
      bewerten(70, b, { id: 't', name: 't', minAbweichung: 30 }, SCHWELLE.normal).ausserhalb,
      false,
    );
  });
  it('teilt nach Werktag und Wochenende und Stunde ein, mit Rückfall', () => {
    assert.equal(eimer(vonLokal(2026, 10, 5, 9)), 'wt-9');
    assert.equal(eimer(vonLokal(2026, 10, 4, 9)), 'we-9');
    const stunden = [];
    for (let t = 0; t < 21; t++)
      stunden.push({ zeit: vonLokal(2026, 9, 7 + t, 9).toISOString(), wert: 100 + (t % 3) });
    const b = basisBerechnen(stunden);
    const werktag = basisFuer(b, vonLokal(2026, 10, 5, 9));
    assert.ok(werktag && werktag.median >= 100 && werktag.median <= 102);
    assert.equal(basisFuer(b, vonLokal(2026, 10, 5, 3)), null);
  });
  it('bildet Stundenmittel und passt den Faktor nach Rückmeldung an', () => {
    const m = stundenMittel([
      { zeit: '2026-10-05T08:10:00Z', wert: 10 },
      { zeit: '2026-10-05T08:50:00Z', wert: 20 },
      { zeit: '2026-10-05T09:05:00Z', wert: 5 },
    ]);
    assert.deepEqual(
      m.map((x) => x.wert),
      [15, 5],
    );
    assert.equal(faktorNachRueckmeldung(1, 'normal'), 1.15);
    assert.equal(faktorNachRueckmeldung(1, 'relevant'), 0.95);
    assert.equal(faktorNachRueckmeldung(2.4, 'normal'), 2.5);
  });
  it('Registry schreibt gesammelt und nur wenn eingeschaltet', async () => {
    const geschrieben: unknown[] = [];
    let an = false;
    const r = new MetrikRegistry(
      async (z) => geschrieben.push(...z),
      () => an,
    );
    const m = r.registrieren({ id: 'test.wert', name: 'Test' });
    await m(5);
    assert.equal(r.letzte.has('test.wert'), false);
    an = true;
    await m(5);
    await m(Number.NaN);
    await r.leeren();
    assert.equal(geschrieben.length, 1);
  });
});

describe('Selbstheilung', () => {
  const job = {
    id: 'm.j',
    name: 'J',
    modul: 'm',
    laeuft: false,
    letzterLauf: null,
    letzteDauerMs: null,
    letzterFehler: 'x',
    letzteMeldung: null,
    naechsterLauf: null,
    laeufe: 5,
    fehler: 3,
    fehlerInFolge: 3,
    laeuftSeit: null,
    pausiertBis: null,
  };
  const jetzt = Date.parse('2026-10-05T12:00:00Z');
  it('lädt zuerst das Modul neu, dann Pausen mit wachsender Dauer, dann Hilfe', () => {
    assert.deepEqual(jobMassnahme({ ...job, fehlerInFolge: 2 }, { pausen: 0 }, jetzt, 60), { art: 'nichts' });
    assert.deepEqual(jobMassnahme(job, { pausen: 0 }, jetzt, 60), { art: 'modul_neu_laden', modul: 'm' });
    const p1 = jobMassnahme(job, { pausen: 0, neuGeladen: jetzt - 60000 }, jetzt, 60);
    assert.deepEqual(p1, { art: 'pausieren', job: 'm.j', minuten: PAUSEN_MIN[0], hilfe: false });
    const p4 = jobMassnahme(job, { pausen: 3, neuGeladen: jetzt - 60000 }, jetzt, 60);
    assert.equal(p4.art === 'pausieren' && p4.hilfe && p4.minuten === 720, true);
  });
  it('erkennt hängende Jobs und knappen Speicher', () => {
    const m = jobMassnahme(
      { ...job, fehlerInFolge: 0, laeuft: true, laeuftSeit: jetzt - 45 * 60000 },
      { pausen: 0 },
      jetzt,
      60,
    );
    assert.equal(m.art, 'dienst_neustart');
    assert.equal(
      jobMassnahme(
        { ...job, fehlerInFolge: 0, laeuft: true, laeuftSeit: jetzt - 45 * 60000 },
        { pausen: 0 },
        jetzt,
        3600,
      ).art,
      'nichts',
    );
    assert.equal(speicherKnapp(10, 30), 'ok');
    assert.equal(speicherKnapp(1.5, 30), 'knapp');
    assert.equal(speicherKnapp(2.5, 30), 'knapp');
    assert.equal(speicherKnapp(0.5, 30), 'kritisch');
  });
  it('Scheduler: pausierte Jobs laufen nicht, Fehler in Folge werden gezählt', async () => {
    let jetzt = new Date('2026-10-05T12:00:00Z');
    let laeufe = 0;
    const s = new Scheduler(
      () => true,
      () => jetzt,
    );
    s.hinzufuegen('m', {
      id: 'j',
      name: 'J',
      intervallSek: 60,
      startVerzoegerungSek: 0,
      lauf: async () => {
        laeufe++;
        throw new Error('kaputt');
      },
    });
    await s.takt();
    assert.equal(s.status()[0].fehlerInFolge, 1);
    s.pausieren('m.j', new Date(jetzt.getTime() + 3600000));
    jetzt = new Date(jetzt.getTime() + 120000);
    await s.takt();
    assert.equal(laeufe, 1);
    s.pausieren('m.j', null);
    await s.takt();
    assert.equal(laeufe, 2);
    assert.equal(s.status()[0].fehlerInFolge, 2);
  });
});

describe('Sichere Updates', () => {
  it('aktualisiert nur im Fenster, einmal pro Tag und nur bei neuem Stand', () => {
    const basis = { auto: true, imFenster: true, aktuell: 'a', neuester: 'b', heuteVersucht: false };
    assert.equal(updateFaellig(basis), true);
    assert.equal(updateFaellig({ ...basis, auto: false }), false);
    assert.equal(updateFaellig({ ...basis, imFenster: false }), false);
    assert.equal(updateFaellig({ ...basis, neuester: 'a' }), false);
    assert.equal(updateFaellig({ ...basis, heuteVersucht: true }), false);
    assert.equal(updateFaellig({ ...basis, aktuell: null }), false);
  });
  it('liest die Ergebnisdatei der Pipeline', () => {
    const e = ergebnisLesen(
      '{"zeit":"2026-10-05T03:10:00+02:00","ok":false,"schritt":"selbsttest","meldung":"Selbsttest nach dem Update rot. Automatisch auf 20261001-031000 zurückgeschaltet.","von":"20261001-031000","nach":"20261005-030500","commit":"abc"}',
    );
    assert.equal(e?.ok, false);
    assert.equal(e?.schritt, 'selbsttest');
    assert.equal(ergebnisLesen('kaputt'), null);
  });
});

describe('Dreh Wetter Wächter', () => {
  const start = vonLokal(2026, 10, 8, 6).getTime();
  const stunden: Stunde[] = Array.from({ length: 72 }, (_, i) => {
    const t = start + i * 3600000;
    const h = (i + 6) % 24;
    const windig = i >= 3 && i <= 6; // 9 bis 12 Uhr am ersten Tag windig
    return {
      t,
      temp: 12,
      regen: 0,
      regenWahrsch: 0,
      code: 1,
      wind10: windig ? 30 : 8,
      wind80: windig ? 38 : 10,
      wind120: windig ? 41 : 12,
      boeen: windig ? 55 : 20,
      richtung: 250,
      wolken: 20,
      wolkenTief: 0,
      wolkenMittel: 0,
      wolkenHoch: 20,
      sicht: 30000,
      feuchte: 60,
      tag: h >= 7 && h < 19,
    };
  });
  it('fasst Gründe zusammen', () => {
    const u = drehBewerten(
      stunden,
      vonLokal(2026, 10, 8, 9).getTime(),
      vonLokal(2026, 10, 8, 11).getTime(),
      STANDARD_GRENZEN,
    );
    assert.equal(u.ok, false);
    assert.ok(u.gruende.some((g) => g.startsWith('Wind')));
    assert.ok(u.gruende.some((g) => g.startsWith('Böen')));
    assert.equal(
      drehBewerten(
        stunden,
        vonLokal(2026, 10, 8, 14).getTime(),
        vonLokal(2026, 10, 8, 16).getTime(),
        STANDARD_GRENZEN,
      ).ok,
      true,
    );
    assert.equal(
      drehBewerten(stunden, start + 200 * 3600000, start + 202 * 3600000, STANDARD_GRENZEN).unbekannt,
      true,
    );
  });
  it('bestimmt die fällige Prüfstufe', () => {
    assert.equal(faelligeStufe(80), null);
    assert.equal(faelligeStufe(70), 72);
    assert.equal(faelligeStufe(47), 48);
    assert.equal(faelligeStufe(20), 24);
    assert.equal(faelligeStufe(3), 4);
    assert.equal(faelligeStufe(-1), null);
  });
  it('schlägt freie Ausweichtermine mit gutem Wetter bei Tageslicht vor', () => {
    const belegt = [
      {
        start: vonLokal(2026, 10, 8, 13).getTime(),
        ende: vonLokal(2026, 10, 8, 18).getTime(),
        titel: 'Einsatz',
      },
    ];
    const a = alternativenFinden(stunden, 120, STANDARD_GRENZEN, belegt, start);
    assert.ok(a.length >= 1);
    for (const x of a) {
      const s = Date.parse(x.start);
      assert.ok(!belegt.some((b) => b.start < s + 7200000 && b.ende > s));
      assert.ok(drehBewerten(stunden, s, s + 7200000, STANDARD_GRENZEN).ok);
    }
    // höchstens ein Vorschlag pro Tag
    assert.equal(new Set(a.map((x) => x.start.slice(0, 10))).size, a.length);
  });
});

let app: FastifyInstance;
const geheim = 'p9-geheimnis-p9-geheimnis-p9-xx';
const cookie = `pihub_sitzung=${encodeURIComponent(sitzungErstellen({ benutzer: 'jerome', art: 'lokal' }, geheim))}`;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pihub-p9-'));
  const konfig = konfigLaden({
    DEMO_MODUS: 'true',
    DATEN_VERZEICHNIS: dir,
    SESSION_SECRET: geheim,
    EINRICHTUNG_ABGESCHLOSSEN: 'true',
  });
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

const anfrage = (methode: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) =>
  app.inject({
    method: methode,
    url,
    remoteAddress: '100.80.1.2',
    headers: { cookie, 'x-pihub': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    payload: body ? JSON.stringify(body) : undefined,
  });

describe('Phase 9 im Server', () => {
  it('Abrufe: listet alle Quellen und speichert Einstellungen geprüft', async () => {
    const r = (await anfrage('GET', '/api/m/abrufe/liste')).json() as {
      quellen: { id: string; wichtig: boolean }[];
      nutzung: string;
    };
    assert.ok(r.quellen.length > 20);
    assert.equal(r.nutzung, 'aktiv');
    assert.ok(r.quellen.find((q) => q.id === 'scont.erreichbarkeit')?.wichtig);
    assert.equal(
      (await anfrage('PUT', '/api/m/abrufe/quelle/wetter.openmeteo', { modus: 'fix', fixSek: 5 })).statusCode,
      400,
    );
    assert.equal((await anfrage('PUT', '/api/m/abrufe/quelle/unbekannt', { modus: 'auto' })).statusCode, 400);
  });
  it('Auffälligkeiten: Demo mit Normalbereichen und einer auffälligen Temperatur', async () => {
    const r = (await anfrage('GET', '/api/m/auffaelligkeiten/uebersicht')).json() as {
      metriken: {
        id: string;
        basis: unknown;
        ereignisse: { id: string; ende: string | null }[];
        lernTageOffen: number;
      }[];
    };
    const t = r.metriken.find((m) => m.id === 'zentrale.temperatur');
    assert.ok(t?.basis);
    assert.equal(t.lernTageOffen, 0);
    const offen = t.ereignisse.find((e) => !e.ende);
    assert.ok(offen);
    const f = (
      await anfrage('POST', `/api/m/auffaelligkeiten/ereignis/${offen.id}/rueckmeldung`, {
        rueckmeldung: 'normal',
      })
    ).json() as { faktor: number };
    assert.equal(f.faktor, 1.15);
  });
  it('Selbstheilung, Updates und Dreh Wetter liefern ihre Übersicht', async () => {
    assert.equal((await anfrage('GET', '/api/m/selbstheilung/uebersicht')).statusCode, 200);
    const u = (await anfrage('GET', '/api/m/updates/status')).json() as {
      neuerStand: boolean;
      auto: boolean;
    };
    assert.equal(u.neuerStand, true);
    assert.equal(u.auto, false);
    assert.equal((await anfrage('POST', '/api/m/updates/jetzt', { bestaetigt: true })).statusCode, 400);
    await anfrage('GET', '/api/m/drohne/drehs');
    const d = (await anfrage('GET', '/api/m/drehwetter/uebersicht')).json() as { drehs: unknown[] };
    assert.ok(Array.isArray(d.drehs));
  });
});
