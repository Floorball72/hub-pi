// Demo Daten für das Modul Rettung. Erfunden, aber plausibel. Klar als Demo gekennzeichnet.
import type { AdsbFlugzeug } from './heli.ts';
import { distanzKm } from '../../quellen/geo.ts';
import type { Alert, Erdbeben, Meldung, OsmObjekt, Region, Warnung, Webcam } from './quellen.ts';

function zufall(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function demoHelis(jetzt: number, r: Region): AdsbFlugzeug[] {
  const w = (jetzt / 60000 / 18) * 2 * Math.PI;
  const w2 = (jetzt / 60000 / 27) * 2 * Math.PI;
  return [
    {
      hex: '4b1demo1',
      r: 'HB-ZRX',
      t: 'A109',
      flight: 'REGA7',
      category: 'A7',
      lat: r.lat + 0.12 * Math.sin(w),
      lon: r.lon + 0.18 * Math.cos(w),
      alt_baro: 2600 + Math.round(400 * Math.sin(w * 2)),
      gs: 120,
      track: ((((-w * 180) / Math.PI) % 360) + 360) % 360,
      seen: 1,
    },
    {
      hex: '4b1demo2',
      r: 'HB-TIE',
      t: 'EC45',
      flight: 'REGA4',
      category: 'A7',
      // An der Rega Basis St. Gallen
      lat: 47.40559,
      lon: 9.29009,
      alt_baro: 'ground',
      gs: 0,
      track: 0,
      seen: 3,
    },
    {
      hex: '4b1demo3',
      r: 'HB-ZEF',
      t: 'EC35',
      flight: 'HBZEF',
      category: 'A7',
      lat: r.lat - 0.2 + 0.08 * Math.sin(w2),
      lon: r.lon - 0.25 + 0.1 * Math.cos(w2),
      alt_baro: 4100,
      gs: 95,
      track: ((((w2 * 180) / Math.PI) % 360) + 360) % 360,
      seen: 2,
    },
  ];
}

export function demoAlerts(r: Region): Alert[] {
  const poly: [number, number][] = [
    [r.lat + 0.25, r.lon - 0.3],
    [r.lat + 0.25, r.lon + 0.3],
    [r.lat - 0.25, r.lon + 0.3],
    [r.lat - 0.25, r.lon - 0.3],
  ];
  return [
    {
      id: 'DEMO-1',
      titel: 'Waldbrandgefahr: Stufe 3 (erheblich)',
      text: 'Aufgrund der Trockenheit besteht erhebliche Waldbrandgefahr. Feuer nur in festen Feuerstellen. (Demo)',
      ereignis: 'Waldbrand',
      schwere: 'moderate',
      herausgeber: 'Kanton Demo',
      gesendet: 'Demo',
      landesweit: false,
      entwarnung: false,
      test: false,
      polygone: [poly],
      link: null,
    },
  ];
}

export function demoWarnungen(jetzt: Date): Warnung[] {
  return [
    {
      id: 'demo-gewitter',
      ereignis: 'Gewitter',
      gebiet: 'St. Gallen (Demo)',
      stufe: 3,
      farbe: 'orange',
      art: 'Thunderstorm',
      beginn: new Date(jetzt.getTime() + 5 * 3600000).toISOString(),
      ende: new Date(jetzt.getTime() + 10 * 3600000).toISOString(),
      text: 'Kräftige Gewitter mit Hagel und Sturmböen möglich. (Demo)',
      sprache: 'de',
    },
  ];
}

export function demoErdbeben(jetzt: Date): Erdbeben[] {
  return [
    {
      id: 'demo-e1',
      zeit: new Date(jetzt.getTime() - 3 * 3600000).toISOString(),
      lat: 47.07,
      lon: 9.08,
      tiefeKm: 6.2,
      magnitude: 1.9,
      ort: 'Glarus (Demo)',
      typ: 'earthquake',
    },
    {
      id: 'demo-e2',
      zeit: new Date(jetzt.getTime() - 26 * 3600000).toISOString(),
      lat: 46.31,
      lon: 7.55,
      tiefeKm: 8.1,
      magnitude: 2.7,
      ort: 'Leuk VS (Demo)',
      typ: 'earthquake',
    },
    {
      id: 'demo-e3',
      zeit: new Date(jetzt.getTime() - 50 * 3600000).toISOString(),
      lat: 47.55,
      lon: 7.65,
      tiefeKm: 12.4,
      magnitude: 1.4,
      ort: 'Basel (Demo)',
      typ: 'earthquake',
    },
  ];
}

export function demoLawinen(jetzt: Date) {
  return [
    {
      region: 'Alpstein (Demo)',
      stufe: 'moderate',
      gueltigBis: new Date(jetzt.getTime() + 12 * 3600000).toISOString(),
    },
  ];
}

export function demoOsm(art: string, r: Region): OsmObjekt[] {
  const namen: Record<string, string[]> = {
    spital: ['Kantonsspital (Demo)', 'Spital Region (Demo)'],
    wache: ['Rettungsdienst Wache Nord (Demo)', 'Rettungsdienst Wache Süd (Demo)'],
    landeplatz: ['Helilandeplatz Spital (Demo)'],
    defi: ['Defi Gemeindehaus (Demo)', 'Defi Bahnhof (Demo)', 'Defi Turnhalle (Demo)'],
  };
  return (namen[art] ?? []).map((name, i) => ({
    id: `demo/${art}/${i}`,
    lat: r.lat + (zufall(i + art.length) - 0.5) * 0.3,
    lon: r.lon + (zufall(i * 7 + art.length) - 0.5) * 0.45,
    name,
    tags: {},
  }));
}

export function demoMeldungen(jetzt: Date): Meldung[] {
  const vor = (h: number) => new Date(jetzt.getTime() - h * 3600000).toISOString();
  return [
    {
      quelle: 'Stadtpolizei St.Gallen (Demo)',
      titel: 'Selbstunfall auf der Autobahn, eine Person leicht verletzt',
      link: 'https://demo.example/meldung-1',
      zeit: vor(9),
      text: 'In der Nacht kam es zu einem Selbstunfall. (Demo)',
    },
    {
      quelle: 'Stadtpolizei St.Gallen (Demo)',
      titel: 'Brand in einem Keller rasch gelöscht',
      link: 'https://demo.example/meldung-2',
      zeit: vor(20),
      text: 'Die Feuerwehr konnte den Brand rasch löschen. (Demo)',
    },
    {
      quelle: 'Stadtpolizei St.Gallen (Demo)',
      titel: 'Einbrecher auf frischer Tat festgenommen',
      link: 'https://demo.example/meldung-3',
      zeit: vor(30),
      text: 'Eine Patrouille konnte zwei Personen festnehmen. (Demo)',
    },
    {
      quelle: 'Stadtpolizei St.Gallen (Demo)',
      titel: 'Verkehrsanordnungen zum Herbstmarkt',
      link: 'https://demo.example/meldung-4',
      zeit: vor(50),
      text: 'Während des Marktes gelten besondere Regeln. (Demo)',
    },
  ];
}

export function demoFluege(jetzt: Date, r: Region): Record<string, unknown>[] {
  const fluege: Record<string, unknown>[] = [];
  for (let i = 0; i < 160; i++) {
    const tageZurueck = Math.floor(zufall(i) * 90);
    // Mehr Flüge tagsüber, Spitze am Nachmittag
    const stunde = Math.floor(7 + zufall(i * 3) * 13 + (zufall(i * 5) > 0.85 ? 8 : 0)) % 24;
    const start = new Date(jetzt.getTime() - tageZurueck * 86400000);
    start.setUTCHours(stunde - 2, Math.floor(zufall(i * 11) * 60), 0, 0);
    if (start.getTime() > jetzt.getTime()) start.setTime(start.getTime() - 86400000);
    // Einige Flüge in den letzten 24 Stunden, damit die Wiedergabe etwas zeigt
    if (i < 10) start.setTime(jetzt.getTime() - (i * 2.3 + 1.2) * 3600000);
    const dauer = 20 + Math.floor(zufall(i * 13) * 50);
    const ziel = zufall(i * 17) > 0.6;
    // Erster Empfang einige Kilometer neben der Basis St. Gallen, wie in echt
    const sLat = 47.40559 + (zufall(i * 19) - 0.5) * 0.06;
    const sLon = 9.29009 + (zufall(i * 23) - 0.5) * 0.08;
    const eLat = r.lat + (zufall(i * 29) - 0.5) * (ziel ? 0.25 : 0.6);
    const eLon = r.lon + (zufall(i * 31) - 0.5) * (ziel ? 0.35 : 0.8);
    // Gleiche Kennung wie die Demo Helis, damit die Detailseite eine Geschichte zeigt
    const zrx = zufall(i * 37) > 0.5;
    fluege.push({
      hex: zrx ? '4b1demo1' : '4b1demo2',
      kennzeichen: zrx ? 'HB-ZRX' : 'HB-TIE',
      typ: 'A109',
      organisation: zufall(i * 41) > 0.15 ? 'Rega' : null,
      start: start.toISOString(),
      start_art: 'start',
      start_lat: sLat,
      start_lon: sLon,
      start_ort: 'St. Gallen (Demo)',
      ende: new Date(start.getTime() + dauer * 60000).toISOString(),
      ende_art: 'landung',
      ende_lat: eLat,
      ende_lon: eLon,
      ende_ort: ['Wattwil (Demo)', 'Wil (Demo)', 'Herisau (Demo)', 'Kirchberg (Demo)', 'Uzwil (Demo)'][i % 5],
      max_hoehe_ft: 2500 + Math.floor(zufall(i * 43) * 3000),
      // Bogen vom Start zum Ziel, Zeit als Sekunden seit dem Start
      spur: Array.from({ length: 16 }, (_, k) => {
        const t = k / 15;
        const bogen = Math.sin(t * Math.PI) * (zufall(i * 47) - 0.5) * 0.12;
        return [
          Math.round((sLat + (eLat - sLat) * t + bogen) * 1e5) / 1e5,
          Math.round((sLon + (eLon - sLon) * t - bogen) * 1e5) / 1e5,
          Math.round(t * dauer * 60),
        ];
      }),
      start_platz: 'Rega Basis St. Gallen',
      ende_platz: ziel ? ['Kantonsspital (Demo)', 'Spital Region (Demo)'][i % 2] : null,
    });
  }
  // Zwei Helis ohne Signal: einer steht an der Basis, einer ist beim Einsatzort verschwunden
  const vor = (min: number) => new Date(jetzt.getTime() - min * 60000).toISOString();
  const abgestellt = (
    hex: string,
    kz: string,
    ende: number,
    art: string,
    lat: number,
    lon: number,
    platz: string | null,
    ort: string,
  ) => ({
    hex,
    kennzeichen: kz,
    typ: 'H145',
    organisation: 'Rega',
    start: vor(ende + 35),
    start_art: 'start',
    start_lat: 46.9131,
    start_lon: 9.55096,
    start_ort: 'Untervaz (Demo)',
    ende: vor(ende),
    ende_art: art,
    ende_lat: lat,
    ende_lon: lon,
    ende_ort: ort,
    max_hoehe_ft: 4200,
    spur: [
      [46.9131, 9.55096, 0],
      [lat, lon, 35 * 60],
    ],
    start_platz: 'Rega Basis Untervaz',
    ende_platz: platz,
  });
  fluege.push(
    abgestellt('4b1demo7', 'HB-ZRS', 300, 'landung', 46.914, 9.552, 'Rega Basis Untervaz', 'Untervaz (Demo)'),
    abgestellt('4b1demo8', 'HB-ZRL', 40, 'signalverlust', r.lat + 0.05, r.lon - 0.08, null, 'Wattwil (Demo)'),
  );
  return fluege;
}

/** Demo Webcams mit gezeichnetem Bild, ohne Abruf von aussen */
export function demoWebcams(jetzt: Date, r: Region): (Webcam & { km: number })[] {
  const orte = [
    ['Säntis Gipfel', 47.249, 9.343, 2502, '#3b6ea8'],
    ['Wildhaus', 47.205, 9.354, 1090, '#4f7c5a'],
    ['Hochhamm', 47.338, 9.27, 1275, '#7a5f94'],
    ['Pizol', 46.99, 9.42, 2220, '#a8763b'],
    ['Brunnen', 46.995, 8.605, 440, '#3b8fa8'],
    ['Feldkirch', 47.24, 9.6, 460, '#8a4a4a'],
  ] as const;
  return orte.map(([name, lat, lon, hoehe, farbe], i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225"><defs><linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${farbe}"/><stop offset="1" stop-color="#0b1016"/></linearGradient></defs><rect width="400" height="225" fill="url(#h)"/><path d="M0 170 L80 ${90 + i * 6} L150 150 L230 ${70 + i * 5} L320 140 L400 110 L400 225 L0 225Z" fill="#e6edf5" fill-opacity=".85"/><path d="M0 200 L120 160 L260 190 L400 165 L400 225 L0 225Z" fill="#1f2a36"/><text x="12" y="24" font-family="sans-serif" font-size="14" fill="#fff">${name} (Demo)</text></svg>`;
    const bild = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    return {
      id: `demo-cam-${i}`,
      name,
      titel: `${name} (Demo)`,
      lat,
      lon,
      hoehe,
      richtung: (i * 60) % 360,
      bild,
      bildGross: bild,
      link: null,
      zeit: jetzt.getTime() - (i + 1) * 4 * 60000,
      takt: 600,
      land: 'ch',
      quelle: 'Demo',
      km: Math.round(distanzKm(r.lat, r.lon, lat, lon)),
    };
  });
}
