import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lageEreignisse } from '../src/server/modules/rettung/lagebild.ts';

test('Lagebild: Ereignisse im Fenster, sortiert', () => {
  const t0 = Date.parse('2026-10-05T00:00:00Z');
  const h = 3600000;
  const e = lageEreignisse({
    von: t0,
    bis: t0 + 24 * h,
    fluege: [
      {
        id: 'f1',
        hex: 'abc',
        organisation: 'Rega',
        kennzeichen: 'HB-ZRA',
        von: 'Basis',
        nach: 'Spital',
        start: t0 + 2 * h,
        ende: t0 + 3 * h,
        punkte: [
          [47, 9, t0 + 2 * h],
          [47.1, 9.1, t0 + 3 * h],
        ],
      },
      {
        id: 'f2',
        hex: 'def',
        organisation: 'Rega',
        kennzeichen: null,
        von: null,
        nach: null,
        start: t0 - 2 * h,
        ende: t0 - h,
        punkte: [],
      },
    ],
    alerts: [
      {
        id: 'a1',
        titel: 'Brand',
        text: '',
        ereignis: '',
        schwere: 'severe',
        herausgeber: 'Kanton',
        gesendet: new Date(t0 + 5 * h).toISOString(),
        landesweit: false,
        entwarnung: false,
        test: false,
        polygone: [],
        link: null,
        mitte: [47.2, 9.2],
      },
    ],
    warnungen: [
      {
        id: 'w1',
        ereignis: 'Gewitter',
        gebiet: 'St. Gallen',
        stufe: 3,
        farbe: '#f97316',
        art: '',
        beginn: new Date(t0 - h).toISOString(),
        ende: new Date(t0 + h).toISOString(),
        text: '',
        sprache: 'de',
      },
    ],
    erdbeben: [
      {
        id: 'e1',
        zeit: new Date(t0 + 30 * h).toISOString(),
        lat: 46,
        lon: 8,
        tiefeKm: 5,
        magnitude: 2,
        ort: 'X',
        typ: 'earthquake',
      },
    ],
  });
  assert.deepEqual(
    e.map((x) => x.id),
    ['warnung-w1', 'start-f1', 'landung-f1', 'alert-a1'],
  );
  assert.equal(e[0].zeit, t0);
  assert.deepEqual([e[2].lat, e[2].lon], [47.1, 9.1]);
  assert.equal(e[3].farbe, '#f87171');
});
