// Demo Kalender und Demo Spiele für swiss unihockey (erfunden).
import { lokalDatum, vonLokal } from '../../kern/zeit.ts';
import type { Termin } from '../../quellen/ical.ts';
import type { Spiel } from '../../quellen/swissunihockey.ts';

function naechsterWochentag(jetzt: Date, wochentag: number, stunde: number, plusWochen = 0): string {
  const d = new Date(jetzt);
  const heute = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((wochentag - heute + 7) % 7) + plusWochen * 7);
  const [j, m, t] = lokalDatum(d).split('-').map(Number);
  return vonLokal(j, m, t, stunde).toISOString();
}

export function demoTermine(jetzt: Date): Termin[] {
  const heute = lokalDatum(jetzt).split('-').map(Number);
  const t = (start: string, std: number, titel: string, beschreibung = '', uid = titel): Termin => ({
    uid: `demo-${uid}`,
    titel,
    beschreibung,
    ort: '',
    start,
    ende: new Date(new Date(start).getTime() + std * 3600000).toISOString(),
    ganztags: false,
  });
  const gestern = lokalDatum(new Date(jetzt.getTime() - 86400000))
    .split('-')
    .map(Number);
  return [
    t(
      vonLokal(gestern[0], gestern[1], gestern[2], 14).toISOString(),
      2,
      'swiss unihockey | Matchbericht | fix',
      'Herren NLB',
      'gestern',
    ),
    t(
      naechsterWochentag(jetzt, 6, 16),
      2,
      'swiss unihockey | Resultatpost | fix',
      'Herren NLB, Damen NLB',
      'sa',
    ),
    t(naechsterWochentag(jetzt, 0, 14), 2, 'swiss unihockey | Matchbericht | evtl.', 'Herren NLB', 'so'),
    t(
      naechsterWochentag(jetzt, 6, 17, 1),
      2,
      'swiss unihockey | Resultatpost | Ersatz für Demo Person',
      'Junioren U21 A',
      'sa2',
    ),
    t(vonLokal(heute[0], heute[1], heute[2], 15).toISOString(), 1, 'Kundentermin Bäckerei (Demo)'),
    t(vonLokal(heute[0], heute[1], heute[2], 19, 30).toISOString(), 2, 'Training (Demo)'),
  ];
}

export function demoSpieleAmTag(datum: string, jetzt: Date): Spiel[] {
  const [j, m, d] = datum.split('-').map(Number);
  const ligen = [
    ['Herren NLB', ['Demo Lions', 'UHC Beispiel'], 14],
    ['Herren NLB', ['Floorball Muster', 'Demo Rangers'], 16],
    ['Damen NLB', ['Demo Ladies', 'UH Test'], 15],
    ['Junioren U21 A', ['Demo Juniors', 'Beispiel U21'], 17],
  ] as const;
  return ligen.map(([liga, [heim, gast], stunde], i) => {
    const start = vonLokal(j, m, d, stunde);
    const vorbei = jetzt.getTime() > start.getTime() + 2 * 3600000;
    const laeuft = !vorbei && jetzt.getTime() > start.getTime();
    return {
      id: `demo-tag-${i}`,
      zeit: start.toISOString(),
      datumText: `${d}.${m}.${j}`,
      zeitText: `${stunde}:00`,
      heim,
      gast,
      resultat: vorbei ? `${4 + i}:${3 + (i % 3)}` : laeuft ? `${i}:${i + 1}` : null,
      zusatz: null,
      ort: null,
      lat: null,
      lon: null,
      status: vorbei ? 'Spiel beendet' : laeuft ? 'läuft' : `${stunde}:00`,
      beendet: vorbei,
      liga,
    };
  });
}
