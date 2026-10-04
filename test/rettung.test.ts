// Tests für das Modul Rettung und Mobilität mit echten API Antworten als Fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { abfahrtenParsen } from '../src/server/modules/mobilitaet/oev.ts';
import {
  type AdsbFlugzeug,
  FlugErkennung,
  flugStatistik,
  type HeliPosition,
  heliFiltern,
  inSchweiz,
  platzBei,
  positionenVereinen,
  heatRaster,
  rueckblickFenster,
  startPasst,
  schweizFiltern,
  musterPasst,
  organisationFinden,
} from '../src/server/modules/rettung/heli.ts';
import {
  alertInRegion,
  alertswissParsen,
  istErdbeben,
  kategorie,
  meteoalarmParsen,
  opendatasoftMeldungen,
  overpassAbfrage,
  overpassParsen,
  sedParsen,
  warnungFuerGebiete,
} from '../src/server/modules/rettung/quellen.ts';
import { distanzKm, imPolygon } from '../src/server/quellen/geo.ts';
import { feedParsen } from '../src/server/quellen/rss.ts';

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'));
const REGION = { lat: 47.41, lon: 9.2, radiusKm: 40 };

describe('Helikopter', () => {
  it('erkennt Kennzeichen Muster', () => {
    assert.equal(musterPasst('HB-ZRX', 'HB-ZR*'), true);
    assert.equal(musterPasst('hb-zrx', 'HB-ZR*'), true);
    assert.equal(musterPasst('HB-ZQX', 'HB-ZR*'), false);
    assert.equal(musterPasst('HB-ZRX', 'HB-ZRX'), true);
    assert.equal(organisationFinden('HB-TIE', [{ organisation: 'Rega', muster: 'HB-TI*' }]), 'Rega');
  });
  it('filtert echte ADS-B Daten auf Helikopter in der Region', () => {
    const ac = json('adsb_ch.json').ac as AdsbFlugzeug[];
    const alle = heliFiltern(ac, [], true, { lat: 46.8, lon: 8.2, radiusKm: 300 }, Date.now());
    assert.ok(alle.length > 0);
    assert.ok(alle.every((h) => h.organisation === null));
    const nurListe = heliFiltern(
      ac,
      [{ organisation: 'Test', muster: 'HB-Z*' }],
      false,
      { lat: 46.8, lon: 8.2, radiusKm: 300 },
      Date.now(),
    );
    assert.ok(nurListe.every((h) => h.kennzeichen?.startsWith('HB-Z')));
    const eng = heliFiltern(ac, [], true, { lat: 46.8, lon: 8.2, radiusKm: 1 }, Date.now());
    assert.equal(eng.length, 0);
  });
  it('erkennt Start, Landung und Signalverlust', () => {
    const e = new FlugErkennung();
    const p = (zeit: number, boden: boolean, kn: number, ft: number | null = 2000): HeliPosition => ({
      hex: 'a',
      kennzeichen: 'HB-ZRX',
      typ: 'A109',
      rufzeichen: null,
      organisation: 'Rega',
      lat: 47.4,
      lon: 9.3,
      hoeheFt: ft,
      amBoden: boden,
      speedKn: kn,
      kurs: 0,
      zeit,
    });
    assert.deepEqual(e.aktualisieren([p(0, true, 0, 0)], 0), []);
    assert.deepEqual(
      e.aktualisieren([p(30000, false, 90)], 30000).map((x) => x.art),
      ['start'],
    );
    assert.equal(e.laufende().length, 1);
    const landung = e.aktualisieren([p(600000, true, 0, 0)], 600000);
    assert.deepEqual(
      landung.map((x) => x.art),
      ['landung'],
    );
    assert.equal(landung[0].flug.ende, 600000);
    // Neu erfasst in der Luft, dann tief verschwunden
    const b = new FlugErkennung();
    assert.deepEqual(
      b.aktualisieren([p(0, false, 100, 3000)], 0).map((x) => x.art),
      ['erfasst'],
    );
    assert.deepEqual(b.aktualisieren([], 60000), []);
    assert.deepEqual(
      b.aktualisieren([], 240000).map((x) => x.art),
      ['signalverlust'],
    );
  });
  it('berechnet die Statistik nach Stunde, Wochentag und Raster', () => {
    const s = flugStatistik([
      { start: '2026-10-02T10:05:00Z', start_lat: 47.4, start_lon: 9.3, ende_lat: 47.41, ende_lon: 9.31 },
      { start: '2026-10-03T10:30:00Z', start_lat: 47.4, start_lon: 9.3, ende_lat: null, ende_lon: null },
    ]);
    assert.equal(s.anzahl, 2);
    assert.equal(s.proStunde[12], 2);
    assert.equal(s.proWochentag[4], 1);
    assert.equal(s.proWochentag[5], 1);
    assert.ok(s.heat.find((h) => h[2] === 2));
  });
});

describe('Alertswiss', () => {
  const alerts = alertswissParsen(json('alertswiss.json'));
  it('liest echte Meldungen mit Polygonen', () => {
    assert.ok(alerts.length > 5);
    assert.ok(alerts[0].titel);
    assert.ok(alerts[0].polygone[0].length > 3);
    assert.ok(alerts.every((a) => typeof a.landesweit === 'boolean'));
  });
  it('ordnet Meldungen der Region zu', () => {
    const ar = alerts.find((a) => a.herausgeber.includes('Appenzell Ausserrhoden'))!;
    assert.equal(alertInRegion(ar, { lat: 47.38, lon: 9.28, radiusKm: 5 }), true);
    const bs = alerts.find((a) => a.herausgeber.includes('Basel-Stadt'))!;
    assert.equal(alertInRegion(bs, REGION), false);
  });
  it('Geometrie Hilfen', () => {
    assert.equal(
      imPolygon(1, 1, [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
      ]),
      true,
    );
    assert.equal(
      imPolygon(3, 1, [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
      ]),
      false,
    );
    assert.ok(Math.abs(distanzKm(47.4233, 9.3696, 47.3769, 8.5417) - 62.4) < 1.5);
  });
});

describe('MeteoAlarm', () => {
  it('liest Warnstufe, Gebiet und deutsche Fassung (echter Feed)', () => {
    const w = meteoalarmParsen(json('meteoalarm_beispiel.json'));
    assert.ok(w.length > 0);
    assert.ok(w.every((x) => x.stufe >= 1 && x.stufe <= 4));
    assert.ok(w.some((x) => x.sprache.startsWith('de')));
    assert.equal(warnungFuerGebiete({ ...w[0], gebiet: 'Kanton St. Gallen' }, ['St. Gallen']), true);
    assert.equal(warnungFuerGebiete({ ...w[0], gebiet: 'Genf' }, ['St. Gallen']), false);
  });
});

describe('Erdbeben', () => {
  it('liest den SED Text und filtert Sprengungen und Erdrutsche', () => {
    const e = sedParsen(readFileSync('test/fixtures/sed.txt', 'utf8'));
    assert.ok(e.length > 20);
    const beben = e.filter(istErdbeben);
    assert.ok(beben.length < e.length);
    assert.ok(beben.every((x) => x.typ === 'earthquake'));
    assert.match(e[0].zeit, /Z$/);
  });
});

describe('OpenStreetMap', () => {
  it('baut die Overpass Abfrage und liest Knoten und Flächen (Format laut Overpass Doku)', () => {
    assert.match(
      overpassAbfrage('spital', REGION),
      /\["amenity"="hospital"\]\["emergency"="yes"\]\(around:40000,47.41,9.2\)/,
    );
    assert.throws(() => overpassAbfrage('x', REGION));
    assert.match(overpassAbfrage('spital.ch', REGION), /area\["ISO3166-1"="CH"\].*\(area\.ch\)/);
    const o = overpassParsen({
      elements: [
        { type: 'node', id: 1, lat: 47.4, lon: 9.3, tags: { name: 'A' } },
        { type: 'way', id: 2, center: { lat: 47.5, lon: 9.1 }, tags: { operator: 'B' } },
        { type: 'relation', id: 3 },
      ],
    });
    assert.deepEqual(
      o.map((x) => x.name),
      ['A', 'B'],
    );
  });
});

describe('Medienmitteilungen', () => {
  it('liest den RSS Feed des Kantons (echt)', () => {
    const f = feedParsen(readFileSync('test/fixtures/sg_rss.xml', 'utf8'));
    assert.ok(f.length > 0);
    assert.match(f[0].link, /^https:\/\/www\.sg\.ch\//);
    assert.ok(!f[0].text.includes('<'));
  });
  it('liest Atom', () => {
    const f = feedParsen(
      '<feed><entry><title>T &amp; U</title><link href="https://x.example/a"/><updated>2026-10-01T10:00:00Z</updated><summary>S</summary></entry></feed>',
    );
    assert.deepEqual(f, [
      { titel: 'T & U', link: 'https://x.example/a', zeit: '2026-10-01T10:00:00.000Z', text: 'S' },
    ]);
  });
  it('liest die Stadtpolizei St.Gallen (Opendatasoft, echt)', () => {
    const m = opendatasoftMeldungen(json('stapo_sg.json'), 'Stapo');
    assert.equal(m.length, 5);
    assert.match(m[0].link, /^https:\/\/www\.stadt\.sg\.ch\//);
    assert.ok(m[0].zeit);
    assert.ok(!m[0].titel.includes('​'));
  });
  it('ordnet Meldungen grob ein', () => {
    assert.equal(kategorie({ titel: 'Selbstunfall auf der A1', text: '' }), 'Verkehrsunfall');
    assert.equal(kategorie({ titel: 'Brand in Garage', text: '' }), 'Brand');
    assert.equal(kategorie({ titel: 'Herbstmarkt', text: 'Verkehrsanordnungen' }), 'Mitteilung');
  });
});

describe('ÖV', () => {
  it('liest die Abfahrtstafel (echt)', () => {
    const t = abfahrtenParsen(json('stationboard.json'));
    assert.equal(t.haltestelle, 'Kirchberg SG, Post');
    assert.ok(t.abfahrten.length > 3);
    assert.match(t.abfahrten[0].zeit, /^\d{4}-/);
    assert.ok(t.lat! > 47 && t.lon! > 9);
    assert.ok(!/\d{6}/.test(t.abfahrten[0].linie));
  });
});

describe('Landeplätze', () => {
  const spitaeler = [{ name: 'Kantonsspital St.Gallen', lat: 47.4318, lon: 9.3889 }];
  const plaetze = [
    { name: '', lat: 47.432, lon: 9.3895 },
    { name: 'Rega Basis', lat: 47.5, lon: 9.0 },
    { name: '', lat: 47.6, lon: 9.1 },
  ];
  it('erkennt Spital, benannten und unbenannten Landeplatz', () => {
    assert.equal(platzBei(47.4321, 9.3893, spitaeler, plaetze), 'Kantonsspital St.Gallen');
    assert.equal(platzBei(47.5005, 9.0005, spitaeler, plaetze), 'Rega Basis');
    assert.equal(platzBei(47.6, 9.1, spitaeler, plaetze), 'Helikopterlandeplatz');
  });
  it('liefert nichts abseits von Plätzen', () => {
    assert.equal(platzBei(47.3, 9.2, spitaeler, plaetze), null);
  });
});

describe('Ganze Schweiz', () => {
  const k = [{ organisation: 'Rega', muster: 'HB-ZR*' }];
  const jetzt = Date.parse('2026-10-04T12:00:00Z');
  const ac = (hex: string, r: string, lat: number, lon: number): AdsbFlugzeug => ({
    hex,
    r,
    lat,
    lon,
    alt_baro: 3000,
    category: 'A7',
  });

  it('erkennt Positionen in der Schweiz', () => {
    assert.equal(inSchweiz(46.0, 8.95), true); // Lugano
    assert.equal(inSchweiz(46.2, 6.15), true); // Genf
    assert.equal(inSchweiz(48.14, 11.58), false); // München
  });

  it('nimmt nur Kennzeichen der Liste in der Schweiz', () => {
    const p = schweizFiltern(
      [ac('a', 'HB-ZRA', 46.0, 8.95), ac('b', 'HB-ZRB', 48.14, 11.58), ac('c', 'D-HXYZ', 46.5, 8.0)],
      k,
      jetzt,
    );
    assert.deepEqual(
      p.map((x) => [x.hex, x.organisation]),
      [['a', 'Rega']],
    );
  });

  it('führt Region und Schweiz ohne Doppel zusammen', () => {
    const a = schweizFiltern([ac('a', 'HB-ZRA', 46.0, 8.95)], k, jetzt);
    const b = schweizFiltern([ac('a', 'HB-ZRA', 46.1, 8.9), ac('d', 'HB-ZRD', 47, 8)], k, jetzt);
    const v = positionenVereinen(a, b);
    assert.deepEqual(
      v.map((x) => [x.hex, x.lat]),
      [
        ['a', 46.0],
        ['d', 47],
      ],
    );
  });
});

describe('Rückblick Fenster', () => {
  it('vormittags ab 20 Uhr des Vortags (Sommerzeit)', () => {
    const f = rueckblickFenster(new Date('2026-07-15T05:00:00Z')); // 07:00 lokal
    assert.equal(f.von.toISOString(), '2026-07-14T18:00:00.000Z');
    assert.equal(f.titel, 'Seit gestern 20 Uhr');
  });
  it('nachmittags ab Mitternacht (Winterzeit)', () => {
    const f = rueckblickFenster(new Date('2026-01-15T14:00:00Z')); // 15:00 lokal
    assert.equal(f.von.toISOString(), '2026-01-14T23:00:00.000Z');
    assert.equal(f.titel, 'Heute');
  });
  it('kurz nach Mitternacht zählt die Nacht ab dem Vorabend', () => {
    const f = rueckblickFenster(new Date('2026-03-01T23:30:00Z')); // 00:30 lokal am 2. März
    assert.equal(f.von.toISOString(), '2026-03-01T19:00:00.000Z');
  });
});

describe('Heatmap mit Filtern', () => {
  it('zählt jede Zelle einmal pro Flug, Start und Landung doppelt', () => {
    const h = heatRaster([
      {
        start_lat: 47.0,
        start_lon: 9.0,
        ende_lat: 47.2,
        ende_lon: 9.2,
        spur: [
          [47.0, 9.0],
          [47.1, 9.1],
          [47.1, 9.1],
          [47.2, 9.2],
        ],
      },
    ]);
    const wert = (la: number, lo: number) =>
      h.find(([a, b]) => Math.abs(a - la) < 1e-6 && Math.abs(b - lo) < 1e-6)?.[2];
    assert.equal(wert(47.0, 9.0), 2);
    assert.equal(wert(47.1, 9.1), 1);
    assert.equal(wert(47.2, 9.2), 2);
    assert.equal(h.length, 3);
  });
  it('filtert nach Tageszeit und Wochentag in Schweizer Zeit', () => {
    // Samstag 4. Juli 2026, 23:30 lokal
    const sa = '2026-07-04T21:30:00Z';
    assert.equal(startPasst(sa, 'nacht', 'alle'), true);
    assert.equal(startPasst(sa, 'tag', 'alle'), false);
    assert.equal(startPasst(sa, 'alle', 'wochenende'), true);
    assert.equal(startPasst(sa, 'alle', 'werktag'), false);
    // Montag 6. Juli 2026, 08:15 lokal
    assert.equal(startPasst('2026-07-06T06:15:00Z', 'morgen', 'werktag'), true);
  });
});

describe('Rega Basen', () => {
  it('ordnet den ersten Empfang in der Luft nahe einer Basis dieser zu', async () => {
    const { startBasis, endeBasis, basisAusPlatz, basisName } = await import('../src/server/geteilt/heli.ts');
    // 4 km neben Untervaz, erster Empfang in der Luft
    const b = startBasis('Rega', 'erfasst', 46.95, 9.55);
    assert.equal(b?.id, 'untervaz');
    assert.equal(basisAusPlatz(basisName(b!))?.id, 'untervaz');
    // Beobachteter Start auf einem Feld 4 km weg bleibt das Feld
    assert.equal(startBasis('Rega', 'start', 46.95, 9.55), null);
    // Andere Betreiber und weit weg: keine Basis
    assert.equal(startBasis('Air Zermatt', 'erfasst', 46.95, 9.55), null);
    assert.equal(startBasis('Rega', 'erfasst', 47.2, 8.3), null);
    // Tief verschwunden 4 km neben Erstfeld: Basis
    assert.equal(endeBasis('Rega', 'signalverlust', 46.87, 8.64)?.id, 'erstfeld');
    assert.equal(endeBasis('Rega', 'landung', 46.87, 8.64), null);
  });
});

describe('Wiedergabe', () => {
  it('nutzt gespeicherte Zeiten und verteilt alte Spuren gleichmässig', async () => {
    const { wiedergabePunkte } = await import('../src/server/modules/rettung/heli.ts');
    const mit = wiedergabePunkte(
      [
        [47, 9, 0],
        [47.1, 9.1, 60],
      ],
      1000,
      999999,
    );
    assert.deepEqual(mit, {
      punkte: [
        [47, 9, 1000],
        [47.1, 9.1, 61000],
      ],
      geschaetzt: false,
    });
    const ohne = wiedergabePunkte(
      [
        [47, 9],
        [47.1, 9.1],
        [47.2, 9.2],
      ],
      0,
      100,
    );
    assert.equal(ohne.geschaetzt, true);
    assert.deepEqual(
      ohne.punkte.map((p) => p[2]),
      [0, 50, 100],
    );
    assert.deepEqual(wiedergabePunkte(null, 0, 1).punkte, []);
  });
});

describe('Letzter Standort', () => {
  it('zeigt Helis ohne Signal an der Basis oder am letzten Ort', async () => {
    const { letzteStandorte } = await import('../src/server/modules/rettung/heli.ts');
    const ende = (
      hex: string,
      zeit: string,
      art: string,
      lat: number,
      lon: number,
      platz: string | null = null,
    ) => ({
      hex,
      organisation: 'Rega',
      kennzeichen: hex.toUpperCase(),
      ende: zeit,
      ende_art: art,
      ende_lat: lat,
      ende_lon: lon,
      ende_platz: platz,
      ende_ort: 'Feld',
    });
    const liste = letzteStandorte(
      [
        // Älterer Flug von a zählt nicht, nur der letzte
        ende('a', '2026-10-01T08:00:00Z', 'landung', 47.0, 9.0),
        ende('a', '2026-10-01T10:00:00Z', 'landung', 46.914, 9.552),
        ende('b', '2026-10-01T11:00:00Z', 'signalverlust', 47.3, 9.1),
        // Hoch verschwunden: Standort unbekannt
        ende('c', '2026-10-01T12:00:00Z', 'verlassen', 47.3, 9.1),
        ende('c', '2026-10-01T09:00:00Z', 'landung', 47.3, 9.1),
        // Sendet gerade, erscheint live
        ende('d', '2026-10-01T09:00:00Z', 'landung', 47.3, 9.1),
      ],
      [
        {
          hex: 'e',
          kennzeichen: 'E',
          typ: null,
          organisation: 'Rega',
          start: 0,
          startArt: 'start',
          startLat: 47,
          startLon: 9,
          ende: null,
          endeArt: null,
          endeLat: null,
          endeLon: null,
          maxHoeheFt: null,
          spur: [[47.2, 9.2, Date.parse('2026-10-01T13:00:00Z')]],
        },
      ],
      new Set(['d']),
    );
    assert.deepEqual(
      liste.map((h) => [h.hex, h.art, h.anBasis]),
      [
        ['e', 'laufend', false],
        ['b', 'signalverlust', false],
        ['a', 'landung', true],
      ],
    );
    // Landung neben Untervaz steht auf der Basis
    const a = liste.find((h) => h.hex === 'a')!;
    assert.equal(a.platz, 'Rega Basis Untervaz');
    assert.equal(a.lat, 46.9131);
  });
});

describe('Webcams', () => {
  it('liest foto-webcam.eu und wählt die Kameras nahe der Region', async () => {
    const { fotoWebcamParsen, webcamsAuswaehlen } = await import('../src/server/modules/rettung/quellen.ts');
    const cams = fotoWebcamParsen({
      cams: [
        {
          id: 'wildhaus',
          name: 'Wildhaus',
          imgurl: 'https://www.foto-webcam.eu/webcam/wildhaus/current/400.jpg',
          latitude: 47.2,
          longitude: 9.35,
          country: 'ch',
          modtime: 1000,
        },
        {
          id: 'aus',
          name: 'Aus',
          offline: true,
          imgurl: 'https://x/400.jpg',
          latitude: 47.2,
          longitude: 9.35,
        },
        {
          id: 'garda',
          name: 'Garda',
          imgurl: 'https://x/garda/current/400.jpg',
          latitude: 45.5,
          longitude: 10.7,
          country: 'it',
        },
        {
          id: 'feldkirch',
          name: 'Feldkirch',
          imgurl: 'https://x/feldkirch/current/400.jpg',
          latitude: 47.24,
          longitude: 9.6,
          country: 'at',
        },
      ],
    });
    assert.equal(cams.length, 3);
    assert.equal(cams[0].bildGross, 'https://www.foto-webcam.eu/webcam/wildhaus/current/1200.jpg');
    assert.equal(cams[0].zeit, 1000000);
    const nah = webcamsAuswaehlen(cams, { lat: 47.3, lon: 9.1, radiusKm: 30 });
    assert.deepEqual(
      nah.map((c) => c.name),
      ['Wildhaus', 'Feldkirch'],
    );
  });
});

describe('Rega Landung beim Einsatzort', () => {
  it('meldet nur Rega Landungen ohne Basis und Platz in der Region', async () => {
    const { einsatzLandung, ortArt } = await import('../src/server/modules/rettung/heli.ts');
    const region = { lat: 47.3, lon: 9.1, radiusKm: 40 };
    assert.equal(einsatzLandung('Rega', 'landung', null, 47.35, 9.2, region), true);
    assert.equal(einsatzLandung('Rega', 'signalverlust', null, 47.35, 9.2, region), false);
    assert.equal(einsatzLandung('Rega', 'landung', 'Kantonsspital St. Gallen', 47.35, 9.2, region), false);
    assert.equal(einsatzLandung('Rega', 'landung', null, 46.2, 7.3, region), false);
    assert.equal(einsatzLandung('Air Zermatt', 'landung', null, 47.35, 9.2, region), false);
    assert.equal(ortArt('Rega Basis Untervaz'), 'basis');
    assert.equal(ortArt('Kantonsspital St. Gallen'), 'spital');
    assert.equal(ortArt('Helikopterlandeplatz'), 'landeplatz');
    assert.equal(ortArt(null), 'einsatzort');
  });
});
