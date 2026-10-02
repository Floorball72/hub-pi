// Tests für swiss unihockey (echte API Antworten), iCal Parser, Einsätze und Checkliste.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ablaufParsen,
  einsatzAusTermin,
  schritteFuer,
} from '../src/server/modules/swissunihockey/einsatz.ts';
import { icalParsen } from '../src/server/quellen/ical.ts';
import {
  aktuelleSaison,
  aktuelleSpieleParsen,
  ranglisteParsen,
  suhZeit,
  teamSpieleParsen,
} from '../src/server/quellen/swissunihockey.ts';

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'));

describe('swiss unihockey API v2', () => {
  it('liest den Spielplan eines Teams', () => {
    const r = teamSpieleParsen(json('suh_games_vipers.json'));
    assert.match(r.titel, /Vipers/);
    assert.equal(r.spiele.length, 22);
    const s = r.spiele[0];
    assert.equal(s.datumText, '31.05.2026');
    assert.equal(s.zeit, '2026-05-31T11:00:00.000Z');
    assert.equal(s.resultat, '2:18');
    assert.ok(s.lat! > 47 && s.lon! > 9);
    assert.ok(r.spiele.some((x) => x.resultat === null));
    assert.ok(r.spiele.every((x) => x.id));
  });
  it('liest Zusätze wie «n.V.»', () => {
    const r = teamSpieleParsen(json('suh_games_team.json'));
    assert.ok(r.spiele.some((x) => x.zusatz === 'n.V.'));
  });
  it('liest die Rangliste mit eigenem Team', () => {
    const r = ranglisteParsen(json('suh_ranking.json'), '429092');
    assert.ok(r.zeilen.length > 5);
    assert.equal(r.zeilen[0].rang, 1);
    assert.equal(typeof r.zeilen[0].punkte, 'number');
    assert.deepEqual(
      r.zeilen.filter((z) => z.hervorgehoben).map((z) => z.team),
      ['United Toggenburg Bazenheid'],
    );
  });
  it('liest die Spiele eines Tages mit Status', () => {
    const s = aktuelleSpieleParsen(json('suh_games_current.json'), '2026-09-27');
    assert.ok(s.length > 5);
    assert.ok(s.every((x) => x.liga));
    assert.ok(s.some((x) => x.beendet && x.resultat));
    const heute = aktuelleSpieleParsen(json('suh_current_heute.json'), '2026-10-02');
    assert.equal(heute[0].zeit, '2026-10-02T18:00:00.000Z');
    assert.equal(heute[0].beendet, false);
  });
  it('rechnet Saison und Zeiten', () => {
    assert.equal(aktuelleSaison(new Date('2026-10-02')), 2026);
    assert.equal(aktuelleSaison(new Date('2027-02-02')), 2026);
    assert.equal(suhZeit('1.2.2027', '19:30'), '2027-02-01T18:30:00.000Z');
    assert.equal(suhZeit(null, null), null);
  });
});

describe('iCal', () => {
  const t = icalParsen(readFileSync('test/fixtures/kalender.ics', 'utf8'), new Date('2027-01-01'));
  it('liest Zeitzonen, Ganztägiges, gefaltete Zeilen und Sonderzeichen', () => {
    const a = t.find((x) => x.uid === 'abc123@google.com')!;
    assert.equal(a.start, '2026-10-10T14:00:00.000Z');
    assert.equal(a.beschreibung, 'Herren NLB, Damen NLB\nLetztes Spiel 16:00');
    const g = t.find((x) => x.uid === 'ganz@google.com')!;
    assert.equal(g.ganztags, true);
    assert.equal(g.start, '2026-10-12');
    assert.match(g.titel, /Zeilenlänge hinausgeht$/);
  });
  it('erweitert Wiederholungen und beachtet Ausnahmen, ignoriert VALARM', () => {
    const serie = t.filter((x) => x.uid.startsWith('serie@'));
    assert.deepEqual(
      serie.map((x) => x.start),
      ['2026-11-01T08:00:00.000Z', '2026-11-15T08:00:00.000Z'],
    );
    assert.equal(serie[0].beschreibung, '');
  });
});

describe('Einsätze', () => {
  const t = icalParsen(readFileSync('test/fixtures/kalender.ics', 'utf8'), new Date('2027-01-01'));
  it('erkennt nur Termine mit Präfix', () => {
    const e = t.map(einsatzAusTermin).filter(Boolean);
    assert.equal(e.length, 2);
  });
  it('liest Typ, Status, Ersatz und schätzt die Postzeit', () => {
    const [a, b] = t.map(einsatzAusTermin).filter((x) => x !== null);
    assert.equal(a.typ, 'Resultatpost');
    assert.equal(a.status, 'fix');
    assert.equal(a.postzeit, '2026-10-10T17:00:00.000Z');
    assert.equal(b.typ, 'Matchbericht');
    assert.equal(b.status, 'evtl.');
    assert.equal(b.ersatzFuer, 'Muster');
  });
  it('liest den Ablauf als Checkliste, Vorlage im Repository ist noch leer', () => {
    const s = ablaufParsen(
      '# Titel\n- [ ] ohne Abschnitt\n## Vorbereitung\n- [ ] Login prüfen\n* [x] Spielplan öffnen\n## Matchbericht\n- [ ] Text schreiben\n## Resultatpost\n- [ ] Resultat posten',
    );
    assert.deepEqual(
      s.map((x) => [x.abschnitt, x.text, x.fuer]),
      [
        ['Vorbereitung', 'Login prüfen', 'alle'],
        ['Vorbereitung', 'Spielplan öffnen', 'alle'],
        ['Matchbericht', 'Text schreiben', 'Matchbericht'],
        ['Resultatpost', 'Resultat posten', 'Resultatpost'],
      ],
    );
    assert.deepEqual(
      schritteFuer(s, 'Resultatpost').map((x) => x.text),
      ['Login prüfen', 'Spielplan öffnen', 'Resultat posten'],
    );
    assert.equal(
      ablaufParsen(readFileSync('docs/swissunihockey-ablauf.md', 'utf8')).length,
      0,
      'Vorlage darf nichts erfinden',
    );
  });
});
