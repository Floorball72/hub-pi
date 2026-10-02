// Tests für Event Zentrale, Content Kalender, Veranstaltungen und Parkplätze.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { appErstellen } from '../src/server/app.ts';
import { Daten } from '../src/server/daten/index.ts';
import { LokalTreiber } from '../src/server/daten/lokal.ts';
import { sitzungErstellen } from '../src/server/kern/auth.ts';
import { konfigLaden } from '../src/server/konfig.ts';
import {
  checklisteFuer,
  faelligeErinnerungen,
  STANDARD_CHECKLISTEN,
} from '../src/server/modules/content/index.ts';
import { farbeFuer, parkhaeuserParsen, typischeBelegung } from '../src/server/modules/parken/index.ts';
import { anlaesseLesen, stichwortTreffer } from '../src/server/modules/veranstaltungen/index.ts';

const fixture = (n: string) => readFileSync(join(import.meta.dirname, 'fixtures', n), 'utf8');

describe('Parkplätze', () => {
  it('liest die echte Antwort der Stadt St. Gallen', () => {
    const l = parkhaeuserParsen(JSON.parse(fixture('parkplaetze_sg.json')));
    assert.ok(l.length >= 10);
    const r = l.find((p) => p.name === 'Parkgarage Raiffeisenzentrum');
    assert.ok(r);
    assert.equal(r.total, 96);
    assert.equal(r.frei, 41);
    assert.equal(r.prozent, 57);
    assert.equal(r.offen, true);
    assert.ok(r.lat! > 47.4 && r.lon! > 9.3);
  });
  it('berechnet Prozent, wenn die Quelle keinen Wert liefert', () => {
    const [p] = parkhaeuserParsen({
      results: [{ ph_id: 1, ph_name: 'X', ph_status: 'offen', anzahl_parkplatze: 200, frei: 50 }],
    });
    assert.equal(p.prozent, 75);
  });
  it('typische Belegung ist der Median je Wochentag und Stunde (Lokalzeit)', () => {
    // Montag 5. Oktober 2026, 10:30 Lokalzeit = 08:30 UTC
    const werte = [
      { zeit: '2026-10-05T08:30:00Z', prozent: 40 },
      { zeit: '2026-10-12T08:10:00Z', prozent: 60 },
      { zeit: '2026-10-19T08:50:00Z', prozent: 90 },
      { zeit: '2026-10-19T08:55:00Z', prozent: null },
    ];
    const t = typischeBelegung(werte);
    assert.equal(t[0][10], 60);
    assert.equal(t[1][10], null);
    assert.equal(t.length, 7);
    assert.equal(t[0].length, 24);
  });
  it('färbt nach Belegung', () => {
    assert.equal(farbeFuer(50), '#34d399');
    assert.equal(farbeFuer(85), '#fbbf24');
    assert.equal(farbeFuer(97), '#f87171');
    assert.equal(farbeFuer(50, false), '#64748b');
  });
});

describe('Content Kalender', () => {
  it('erstellt die Checkliste passend zur Art', () => {
    const l = checklisteFuer('Reel', STANDARD_CHECKLISTEN);
    assert.ok(l.some((p) => p.text === 'Untertitel'));
    assert.ok(l.every((p) => !p.erledigt));
    assert.deepEqual(
      checklisteFuer('Unbekannt', STANDARD_CHECKLISTEN),
      checklisteFuer('Post', STANDARD_CHECKLISTEN),
    );
  });
  it('meldet Erinnerungen genau einmal im Fenster und nie für Veröffentlichtes', () => {
    const jetzt = Date.parse('2026-10-05T10:00:00Z');
    const basis = {
      titel: 'x',
      plattform: 'Instagram',
      art: 'Post',
      notizen: null,
      checkliste: null,
      event_id: null,
      kunde_id: null,
    };
    const liste = [
      { ...basis, id: 'a', zeit: '2026-10-05T11:00:00Z', status: 'bereit', erinnerung_min: 60 },
      { ...basis, id: 'b', zeit: '2026-10-05T11:00:00Z', status: 'veröffentlicht', erinnerung_min: 60 },
      { ...basis, id: 'c', zeit: '2026-10-05T12:00:00Z', status: 'Idee', erinnerung_min: 60 },
      { ...basis, id: 'd', zeit: '2026-10-05T11:04:00Z', status: 'Idee', erinnerung_min: 60 },
    ];
    assert.deepEqual(
      faelligeErinnerungen(liste, jetzt, 300000).map((b) => b.id),
      ['a'],
    );
    assert.deepEqual(
      faelligeErinnerungen(liste, jetzt + 300000, 300000).map((b) => b.id),
      ['d'],
    );
  });
});

describe('Veranstaltungen', () => {
  const q = {
    id: 'q1',
    name: 'Test',
    url: 'https://example.org/k.ics',
    art: 'iCal',
    kategorie: 'Sport',
    ort_name: 'Wattwil',
    lat: 47.3,
    lon: 9.08,
    nutzung_geprueft: true,
    aktiv: true,
  };
  it('liest Anlässe aus iCal mit Kategorie und Ort der Quelle', () => {
    const l = anlaesseLesen(q, fixture('kalender.ics'), new Date('2026-10-01T00:00:00Z'));
    assert.ok(l.length > 0);
    assert.ok(l.every((a) => a.kategorie === 'Sport' && a.quelle_id === 'q1'));
    assert.ok(l.some((a) => a.ort === 'Wattwil'));
    assert.equal(new Set(l.map((a) => a.uid)).size, l.length);
  });
  it('liest RSS Einträge', () => {
    const l = anlaesseLesen({ ...q, art: 'RSS' }, fixture('sg_rss.xml'), new Date('2020-01-01T00:00:00Z'));
    assert.ok(l.length > 0);
    assert.ok(l[0].titel.length > 0);
  });
  it('findet Stichworte ohne Gross und Kleinschreibung', () => {
    assert.deepEqual(stichwortTreffer('Unihockey Cup Ostschweiz', ['unihockey', 'Drohne', ' ']), [
      'unihockey',
    ]);
    assert.deepEqual(stichwortTreffer('Konzert', ['Film']), []);
  });
});

let app: FastifyInstance;
let daten: Daten;
const geheim = 'p7-geheimnis-p7-geheimnis-p7-xx';
const cookie = `pihub_sitzung=${encodeURIComponent(sitzungErstellen({ benutzer: 'jerome', art: 'lokal' }, geheim))}`;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pihub-p7-'));
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

const anfrage = (methode: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) =>
  app.inject({
    method: methode,
    url,
    remoteAddress: '100.80.1.2',
    headers: { cookie, 'x-pihub': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    payload: body ? JSON.stringify(body) : undefined,
  });

describe('Phase 7 im Server', () => {
  it('erstellt eine Veranstaltung aus einer Vorlage mit Fristen relativ zum Beginn', async () => {
    const liste = (await anfrage('GET', '/api/m/events/liste')).json() as { id: string }[];
    assert.ok(liste.length >= 2);
    const vorlagen = await daten.liste<{ id: string }>('event_vorlagen');
    const r = await anfrage('POST', '/api/m/events/neu', {
      titel: 'Test Turnier',
      start: '2026-12-05T08:00:00.000Z',
      vorlage_id: vorlagen[0].id,
    });
    assert.equal(r.statusCode, 200);
    const ev = r.json() as { id: string };
    const d = (await anfrage('GET', `/api/m/events/event/${ev.id}`)).json() as {
      aufgaben: { id: string; text: string; frist: string; erledigt: boolean }[];
      checkliste: unknown[];
      ablauf: { zeit: string; text: string }[];
    };
    const halle = d.aufgaben.find((a) => a.text === 'Halle reservieren');
    assert.equal(halle?.frist, '2026-11-05T08:00:00.000Z');
    assert.equal(d.checkliste.length, 3);
    assert.equal(d.ablauf[0].zeit, '2026-12-05T07:00:00.000Z');
    const h = await anfrage('POST', `/api/m/events/aufgabe/${halle!.id}`, { erledigt: true });
    assert.equal((h.json() as { erledigt: boolean }).erledigt, true);
  });
  it('verlangt Bestätigung für «Als Vorlage speichern» und prüft Eingaben', async () => {
    const [ev] = await daten.liste<{ id: string }>('events');
    assert.equal(
      (await anfrage('POST', `/api/m/events/event/${ev.id}/als-vorlage`, { name: 'x' })).statusCode,
      400,
    );
    assert.equal(
      (
        await anfrage('POST', `/api/m/events/event/${ev.id}/als-vorlage`, {
          name: 'Neue Vorlage',
          bestaetigt: true,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await anfrage('POST', '/api/m/events/neu', { titel: '', start: 'morgen' })).statusCode,
      400,
    );
  });
  it('plant Content mit Checkliste und ändert Status', async () => {
    const r = await anfrage('POST', '/api/m/content/neu', {
      titel: 'Reel Test',
      zeit: '2026-10-20T16:00:00Z',
      art: 'Reel',
    });
    const b = r.json() as { id: string; checkliste: { text: string }[]; plattform: string };
    assert.equal(b.plattform, 'Instagram');
    assert.ok(b.checkliste.length > 3);
    assert.equal(
      (await anfrage('POST', `/api/m/content/beitrag/${b.id}`, { status: 'erfunden' })).statusCode,
      400,
    );
    const s = await anfrage('POST', `/api/m/content/beitrag/${b.id}`, { status: 'bereit' });
    assert.equal((s.json() as { status: string }).status, 'bereit');
    const k = (
      await anfrage('GET', '/api/m/content/beitraege?von=2026-10-01T00:00:00Z&bis=2026-11-01T00:00:00Z')
    ).json() as { beitraege: { id: string }[] };
    assert.ok(k.beitraege.some((x) => x.id === b.id));
    assert.equal(
      (await anfrage('GET', '/api/m/content/beitraege?von=2026-01-01T00:00:00Z&bis=2027-01-01T00:00:00Z'))
        .statusCode,
      400,
    );
  });
  it('liefert Veranstaltungen mit Distanz und Parkhäuser als Kartenpunkte', async () => {
    const v = (await anfrage('GET', '/api/m/veranstaltungen/liste')).json() as {
      anlaesse: { distanzKm: number | null; treffer: string[] }[];
    };
    assert.ok(v.anlaesse.length > 0);
    assert.ok(v.anlaesse.some((a) => a.treffer.includes('Unihockey')));
    assert.ok(v.anlaesse.every((a) => a.distanzKm === null || a.distanzKm < 100));
    const p = (await anfrage('GET', '/api/m/parken/punkte')).json() as {
      punkte: { symbol: string }[];
      demo: boolean;
    };
    assert.ok(p.demo);
    assert.ok(p.punkte.length > 0 && p.punkte.every((x) => x.symbol === 'parken'));
    const ph = (await anfrage('GET', '/api/m/parken/parkhaus/10')).json() as { typisch: (number | null)[][] };
    assert.ok(ph.typisch.flat().some((x) => x !== null));
  });
});
