// Tests für Toolbox, PDF Bericht, öffentliche Statusseite und Zeiterfassung.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { appErstellen } from '../src/server/app.ts';
import { Daten } from '../src/server/daten/index.ts';
import { LokalTreiber } from '../src/server/daten/lokal.ts';
import {
  dosis,
  gcs,
  news2,
  sauerstoffMinuten,
  tropfen,
  UMRECHNUNGEN,
} from '../src/server/geteilt/toolbox.ts';
import { sitzungErstellen } from '../src/server/kern/auth.ts';
import { Pdf, textBreite, winAnsi } from '../src/server/kern/pdf.ts';
import { konfigLaden } from '../src/server/konfig.ts';
import { monatsGrenzen, statusHtml } from '../src/server/modules/scont/bericht.ts';

describe('Rettungs Toolbox', () => {
  it('GCS summiert und teilt ein', () => {
    assert.equal(gcs(4, 5, 6).summe, 15);
    assert.equal(gcs(1, 1, 1).summe, 3);
    assert.match(gcs(2, 2, 4).einteilung, /schwer/);
    assert.match(gcs(3, 4, 5).einteilung, /mittel/);
  });
  it('NEWS2: gesunde Werte 0, Grenzwerte nach RCP Tabelle', () => {
    const normal = {
      atemfrequenz: 16,
      spo2: 97,
      skala2: false,
      sauerstoff: false,
      systolisch: 125,
      puls: 78,
      bewusstseinVeraendert: false,
      temperatur: 36.8,
    };
    assert.equal(news2(normal).summe, 0);
    assert.equal(news2({ ...normal, atemfrequenz: 8 }).punkte.Atemfrequenz, 3);
    assert.equal(news2({ ...normal, atemfrequenz: 21 }).punkte.Atemfrequenz, 2);
    assert.equal(news2({ ...normal, spo2: 93 }).punkte.SpO2, 2);
    assert.equal(news2({ ...normal, systolisch: 220 }).punkte.Blutdruck, 3);
    assert.equal(news2({ ...normal, puls: 131 }).punkte.Puls, 3);
    assert.equal(news2({ ...normal, temperatur: 39.1 }).punkte.Temperatur, 2);
    assert.equal(news2({ ...normal, temperatur: 35.0 }).punkte.Temperatur, 3);
    assert.equal(news2({ ...normal, sauerstoff: true }).punkte.Sauerstoff, 2);
    // Skala 2: 95 % unter Sauerstoff gibt 2 Punkte, 95 % an Raumluft 0
    assert.equal(news2({ ...normal, skala2: true, sauerstoff: true, spo2: 95 }).punkte.SpO2, 2);
    assert.equal(news2({ ...normal, skala2: true, spo2: 95 }).punkte.SpO2, 0);
    assert.equal(
      news2({ ...normal, bewusstseinVeraendert: true }).risiko,
      'niedrig bis mittel (ein Parameter mit 3)',
    );
    assert.equal(news2({ ...normal, atemfrequenz: 25, puls: 131, sauerstoff: true }).risiko, 'hoch');
  });
  it('Tropfen, Dosis, Sauerstoff und Umrechnungen', () => {
    assert.deepEqual(tropfen(500, 120, 20), {
      tropfenProMinute: 83.3,
      mlProStunde: 250,
      quelle: tropfen(1, 1)!.quelle,
    });
    assert.equal(tropfen(0, 10), null);
    assert.deepEqual(dosis(0.1, 70, 10), { mg: 7, ml: 0.7, quelle: 'Dreisatz' });
    assert.equal(sauerstoffMinuten(2, 200, 10, 20)?.minuten, 36);
    const cf = UMRECHNUNGEN.find((u) => u.id === 'c-f')!;
    assert.equal(cf.hin(100), 212);
    const lb = UMRECHNUNGEN.find((u) => u.id === 'kg-lb')!;
    assert.ok(Math.abs(lb.zurueck(1) - 0.45359237) < 1e-12);
  });
});

describe('PDF', () => {
  it('erzeugt ein gültiges PDF mit Umlauten (geprüft mit pdftotext)', () => {
    const pdf = new Pdf();
    pdf.text(50, 60, 'Monatsreport Bäckerei «Müller» Zürich', { groesse: 18, fett: true });
    pdf.absatz(50, 100, 200, 'Ein langer Absatz, der umgebrochen werden muss, damit er in die Spalte passt.');
    pdf.linie(50, 120, 300, 120);
    pdf.rechteck(50, 130, 100, 20, [0.2, 0.6, 0.8]);
    pdf.neueSeite();
    pdf.text(50, 60, 'Zweite Seite (mit Klammern) \\ und Backslash');
    const buf = pdf.erstellen('Test');
    assert.equal(buf.subarray(0, 8).toString('latin1'), '%PDF-1.4');
    const dir = mkdtempSync(join(tmpdir(), 'pdf-'));
    writeFileSync(join(dir, 't.pdf'), buf);
    try {
      const text = execFileSync('pdftotext', ['-layout', join(dir, 't.pdf'), '-'], { encoding: 'utf8' });
      assert.match(text, /Monatsreport Bäckerei «Müller» Zürich/);
      assert.match(text, /Zweite Seite \(mit Klammern\) \\ und Backslash/);
      const info = execFileSync('pdfinfo', [join(dir, 't.pdf')], { encoding: 'utf8' });
      assert.match(info, /Pages:\s+2/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; // pdftotext nicht installiert
      throw e;
    }
  });
  it('Hilfen für Zeichensatz und Breite', () => {
    assert.deepEqual(winAnsi('Aä€'), [65, 228, 128]);
    assert.ok(textBreite('WWW', 10) > textBreite('iii', 10));
    const g = monatsGrenzen('2026-12');
    assert.equal(g.von.toISOString(), '2026-11-30T23:00:00.000Z');
    assert.equal(g.bis.toISOString(), '2026-12-31T23:00:00.000Z');
  });
});

describe('Öffentliche Statusseite (HTML)', () => {
  it('zeigt nur Namen und Verfügbarkeit und maskiert HTML', () => {
    const html = statusHtml(
      [{ name: '<b>Kunde</b>', online: false, tage: [100, 99, null], verfuegbarkeit30: 99.5 }],
      new Date(),
    );
    assert.ok(html.includes('&#60;b&#62;Kunde'));
    assert.ok(html.includes('Störung'));
    assert.ok(!html.includes('<script'));
  });
});

let app: FastifyInstance;
let daten: Daten;
const geheim = 'p6-geheimnis-p6-geheimnis-p6-xx';
const cookie = `pihub_sitzung=${encodeURIComponent(sitzungErstellen({ benutzer: 'jerome', art: 'lokal' }, geheim))}`;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pihub-p6-'));
  const konfig = konfigLaden({
    DEMO_MODUS: 'true',
    DATEN_VERZEICHNIS: dir,
    SESSION_SECRET: geheim,
    EINRICHTUNG_ABGESCHLOSSEN: 'true',
  });
  daten = new Daten(new LokalTreiber(':memory:'), null);
  ({ app } = await appErstellen({ konfig, daten, logger: false, webVerzeichnis: dir }));
});
after(async () => {
  await app.close();
});

const anfrage = (methode: 'GET' | 'POST', url: string, body?: unknown, mitLogin = true) =>
  app.inject({
    method: methode,
    url,
    remoteAddress: '100.80.1.2',
    headers: {
      ...(mitLogin ? { cookie } : {}),
      'x-pihub': '1',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    payload: body ? JSON.stringify(body) : undefined,
  });

describe('Phase 6 im Server', () => {
  it('liefert die öffentliche Statusseite ohne Login und ohne Adressen', async () => {
    await anfrage('GET', '/api/m/scont/uebersicht');
    const r = await anfrage('GET', '/status', undefined, false);
    assert.equal(r.statusCode, 200);
    assert.match(String(r.headers['content-type']), /text\/html/);
    assert.ok(r.body.includes('Bäckerei Beispiel'));
    assert.ok(!r.body.includes('.example'), 'keine Adressen');
    assert.ok(!r.body.includes('Turnverein'), 'nur freigegebene Seiten');
    assert.ok(!r.body.includes('HTTP 5'), 'keine Fehlermeldungen');
  });
  it('erfasst Zeit per Start und Stopp', async () => {
    const z = (await anfrage('GET', '/api/m/scont/zeit')).json();
    const kunde = z.kunden[0].id;
    assert.equal(
      (await anfrage('POST', '/api/m/scont/zeit/start', { kunde_id: kunde, beschreibung: 'Test' }))
        .statusCode,
      200,
    );
    assert.ok((await anfrage('GET', '/api/m/scont/zeit')).json().laufend);
    const s = (await anfrage('POST', '/api/m/scont/zeit/stopp', {})).json();
    assert.ok(s.gestoppt.minuten >= 0);
    assert.equal((await anfrage('GET', '/api/m/scont/zeit')).json().laufend, null);
    assert.equal(
      (await anfrage('POST', '/api/m/scont/zeit/start', { kunde_id: 'gibtsnicht' })).statusCode,
      400,
    );
  });
  it('erstellt den Monatsreport als PDF', async () => {
    const kunden = (await anfrage('GET', '/api/daten/kunden')).json();
    const r = await anfrage('GET', `/api/m/scont/report?kunde=${kunden[0].id}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.equal(r.rawPayload.subarray(0, 5).toString(), '%PDF-');
    const d = (
      await anfrage(
        'GET',
        `/api/m/scont/report/daten?kunde=${kunden.find((k: { name: string }) => k.name === 'Velo Muster GmbH').id}`,
      )
    ).json();
    assert.ok(d.seiten[0].verfuegbarkeit > 90);
  });
  it('liefert die Drohnen Extras', async () => {
    const x = (await anfrage('GET', '/api/m/drohne/extras')).json();
    assert.ok(x.statistik.anzahl > 0);
    assert.ok(x.akkus[0].zyklen > 0);
  });
});
