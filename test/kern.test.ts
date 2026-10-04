// Tests für den Kern: Scheduler, Alarmregeln, Netz, Login, Zeit, .env Datei.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Daten } from '../src/server/daten/index.ts';
import { LokalTreiber } from '../src/server/daten/lokal.ts';
import type { AlarmRegel } from '../src/server/geteilt/typen.ts';
import { schwaerzen } from '../src/server/kern/aktivitaet.ts';
import { ALARM_TABELLEN, Alarmzentrale, entscheiden, regelAusVorlage } from '../src/server/kern/alarm.ts';
import {
  LoginBremse,
  passwortHash,
  passwortPruefen,
  sitzungErstellen,
  sitzungLesen,
} from '../src/server/kern/auth.ts';
import { envLesen, envSchreiben, parseEnv } from '../src/server/kern/env-datei.ts';
import { erlaubteAdresse, imNetz } from '../src/server/kern/netz.ts';
import { klickAdresse } from '../src/server/kern/ntfy.ts';
import { Scheduler } from '../src/server/kern/scheduler.ts';
import { imFenster, lokalDatum, lokalZeit, vonLokal } from '../src/server/kern/zeit.ts';

function regel(a: Partial<AlarmRegel> = {}): AlarmRegel {
  return { ...regelAusVorlage('test', { id: 'r', name: 'R', beschreibung: '' }), ...a };
}

describe('Zeit (Europe/Zurich)', () => {
  it('rechnet Sommer und Winterzeit korrekt', () => {
    assert.equal(vonLokal(2026, 7, 1, 12, 0).toISOString(), '2026-07-01T10:00:00.000Z');
    assert.equal(vonLokal(2026, 12, 1, 12, 0).toISOString(), '2026-12-01T11:00:00.000Z');
    assert.equal(lokalZeit(new Date('2026-10-02T20:30:00Z')), '22:30');
    assert.equal(lokalDatum(new Date('2026-10-02T23:30:00Z')), '2026-10-03');
  });
  it('erkennt Fenster über Mitternacht', () => {
    assert.equal(imFenster(vonLokal(2026, 10, 2, 23, 0), '22:00', '07:00'), true);
    assert.equal(imFenster(vonLokal(2026, 10, 2, 6, 59), '22:00', '07:00'), true);
    assert.equal(imFenster(vonLokal(2026, 10, 2, 7, 0), '22:00', '07:00'), false);
    assert.equal(imFenster(vonLokal(2026, 10, 2, 12, 0), '09:00', '17:00'), true);
  });
});

describe('Alarmregeln', () => {
  const tag = vonLokal(2026, 10, 2, 14, 0);
  const nacht = vonLokal(2026, 10, 2, 2, 0);
  it('sendet bei aktiver Regel am Tag', () => {
    assert.equal(
      entscheiden(regel(), { regel: 'test.r', titel: 'x', text: '' }, tag, undefined).aktion,
      'senden',
    );
  });
  it('verwirft ausgeschaltete oder fehlende Regeln', () => {
    assert.equal(
      entscheiden(regel({ aktiv: false }), { regel: 'test.r', titel: 'x', text: '' }, tag, undefined).aktion,
      'verworfen',
    );
    assert.equal(
      entscheiden(undefined, { regel: 'x', titel: 'x', text: '' }, tag, undefined).aktion,
      'verworfen',
    );
  });
  it('unterdrückt in der Ruhezeit, ausser «auch nachts»', () => {
    assert.equal(
      entscheiden(regel(), { regel: 'test.r', titel: 'x', text: '' }, nacht, undefined).aktion,
      'unterdrueckt',
    );
    assert.equal(
      entscheiden(regel({ nachts: true }), { regel: 'test.r', titel: 'x', text: '' }, nacht, undefined)
        .aktion,
      'senden',
    );
  });
  it('prüft Schwellen in beide Richtungen', () => {
    const r = regel({ schwelle: 3 });
    assert.equal(
      entscheiden(r, { regel: 'test.r', titel: 'x', text: '', wert: 2.9 }, tag, undefined).aktion,
      'verworfen',
    );
    assert.equal(
      entscheiden(r, { regel: 'test.r', titel: 'x', text: '', wert: 3 }, tag, undefined).aktion,
      'senden',
    );
    assert.equal(
      entscheiden(r, { regel: 'test.r', titel: 'x', text: '', wert: 2, richtung: 'unter' }, tag, undefined)
        .aktion,
      'senden',
    );
    assert.equal(
      entscheiden(r, { regel: 'test.r', titel: 'x', text: '', wert: 5, richtung: 'unter' }, tag, undefined)
        .aktion,
      'verworfen',
    );
  });
  it('hält die Sperrfrist ein', () => {
    const r = regel({ cooldown_min: 60 });
    const vorher = new Date(tag.getTime() - 30 * 60000);
    assert.equal(entscheiden(r, { regel: 'test.r', titel: 'x', text: '' }, tag, vorher).aktion, 'verworfen');
    assert.equal(
      entscheiden(r, { regel: 'test.r', titel: 'x', text: '' }, tag, new Date(tag.getTime() - 61 * 60000))
        .aktion,
      'senden',
    );
  });
  it('Standard: keine Nachtmeldungen ausser wenn so definiert', () => {
    assert.equal(regelAusVorlage('m', { id: 'a', name: 'a', beschreibung: '' }).nachts, false);
    assert.equal(regelAusVorlage('m', { id: 'a', name: 'a', beschreibung: '', nachts: true }).nachts, true);
  });

  it('Zentrale sendet über ntfy, speichert Verlauf und entprellt', async () => {
    const daten = new Daten(new LokalTreiber(':memory:'), null);
    await daten.vorbereiten(ALARM_TABELLEN);
    const gesendet: string[] = [];
    let jetzt = tag;
    const z = new Alarmzentrale(
      daten,
      () => ({ server: 'https://ntfy.example', thema: 'thema', token: '' }),
      () => false,
      () => jetzt,
      async (_k, n) => {
        gesendet.push(n.titel);
      },
    );
    await z.regelnLaden([{ modul: 'test', vorlage: { id: 'r', name: 'R', beschreibung: '' } }]);
    const a = await z.melden({ regel: 'test.r', titel: 'Ausfall', text: 'x', schluessel: 'k' });
    assert.equal(a.status, 'gesendet');
    const b = await z.melden({ regel: 'test.r', titel: 'Ausfall', text: 'x', schluessel: 'k' });
    assert.equal(b.aktion, 'verworfen');
    jetzt = nacht;
    const c = await z.melden({ regel: 'test.r', titel: 'Nacht', text: 'x', schluessel: 'n' });
    assert.equal(c.status, 'unterdrueckt');
    assert.deepEqual(gesendet, ['Ausfall']);
    const verlauf = await daten.liste('alarme');
    assert.equal(verlauf.length, 2);
    // Regel ändern und erneut laden: Einstellungen bleiben
    await z.regelAendern('test.r', { nachts: true });
    const z2 = new Alarmzentrale(
      daten,
      () => ({ server: '', thema: '', token: '' }),
      () => true,
    );
    await z2.regelnLaden([{ modul: 'test', vorlage: { id: 'r', name: 'R neu', beschreibung: '' } }]);
    assert.equal(z2.regel('test.r')?.nachts, true);
    assert.equal(z2.regel('test.r')?.name, 'R neu');
  });

  it('übernimmt die neue Ruhezeit für Regeln mit dem alten Standard', async () => {
    const daten = new Daten(new LokalTreiber(':memory:'), null);
    await daten.vorbereiten(ALARM_TABELLEN);
    const vorlage = { modul: 'test', vorlage: { id: 'r', name: 'R', beschreibung: '' } };
    const z = new Alarmzentrale(
      daten,
      () => ({ server: '', thema: '', token: '' }),
      () => true,
    );
    await z.regelnLaden([vorlage]);
    await z.regelAendern('test.r', { ruhe_von: '22:00', ruhe_bis: '07:00' });
    const z2 = new Alarmzentrale(
      daten,
      () => ({ server: '', thema: '', token: '' }),
      () => true,
    );
    await z2.regelnLaden([vorlage]);
    assert.equal(z2.regel('test.r')?.ruhe_von, '00:00');
    assert.equal(z2.regel('test.r')?.ruhe_bis, '06:00');
    const gespeichert = await daten.hole<{ ruhe_von: string }>('alarm_regeln', 'test.r');
    assert.equal(gespeichert?.ruhe_von, '00:00');
    // Eigene Ruhezeit bleibt
    await z2.regelAendern('test.r', { ruhe_von: '23:00' });
    const z3 = new Alarmzentrale(
      daten,
      () => ({ server: '', thema: '', token: '' }),
      () => true,
    );
    await z3.regelnLaden([vorlage]);
    assert.equal(z3.regel('test.r')?.ruhe_von, '23:00');
  });
});

describe('Scheduler', () => {
  it('führt Intervalljobs aus, überlappt nicht und meldet Fehler', async () => {
    let jetzt = new Date('2026-10-02T10:00:00Z');
    const fehler: string[] = [];
    const s = new Scheduler(
      () => true,
      () => jetzt,
      (_m, _j, f) => fehler.push(f),
    );
    let laeufe = 0;
    s.hinzufuegen('m', {
      id: 'a',
      name: 'A',
      intervallSek: 60,
      startVerzoegerungSek: 0,
      lauf: async () => void laeufe++,
    });
    s.hinzufuegen('m', {
      id: 'b',
      name: 'B',
      intervallSek: 60,
      startVerzoegerungSek: 0,
      lauf: async () => {
        throw new Error('kaputt');
      },
    });
    assert.deepEqual((await s.takt()).sort(), ['m.a', 'm.b']);
    assert.equal(laeufe, 1);
    assert.deepEqual(fehler, ['kaputt']);
    assert.deepEqual(await s.takt(), []);
    jetzt = new Date(jetzt.getTime() + 61000);
    assert.deepEqual((await s.takt()).sort(), ['m.a', 'm.b']);
    const status = s.status().find((x) => x.id === 'm.b')!;
    assert.equal(status.fehler, 2);
    assert.equal(status.letzterFehler, 'kaputt');
  });

  it('führt tägliche Jobs einmal pro Tag zur lokalen Zeit aus', async () => {
    let jetzt = vonLokal(2026, 10, 2, 3, 0);
    const s = new Scheduler(
      () => true,
      () => jetzt,
    );
    let laeufe = 0;
    s.hinzufuegen('m', { id: 't', name: 'T', taeglich: '03:30', lauf: async () => void laeufe++ });
    await s.takt();
    assert.equal(laeufe, 0);
    jetzt = vonLokal(2026, 10, 2, 3, 30);
    await s.takt();
    await s.takt();
    assert.equal(laeufe, 1);
    jetzt = vonLokal(2026, 10, 3, 3, 31);
    await s.takt();
    assert.equal(laeufe, 2);
  });

  it('lässt Jobs ausgeschalteter Module aus', async () => {
    const s = new Scheduler(
      (m) => m !== 'aus',
      () => new Date(),
    );
    let n = 0;
    s.hinzufuegen('aus', {
      id: 'x',
      name: 'X',
      intervallSek: 1,
      startVerzoegerungSek: 0,
      lauf: async () => void n++,
    });
    await s.takt();
    assert.equal(n, 0);
  });
});

describe('Netz', () => {
  it('erlaubt lokale Netze und Tailscale, sperrt öffentliche Adressen', () => {
    for (const ip of [
      '127.0.0.1',
      '192.168.1.20',
      '10.1.2.3',
      '172.20.0.1',
      '100.101.102.103',
      '::1',
      '::ffff:192.168.1.5',
      'fd7a:115c:a1e0::1',
    ]) {
      assert.equal(erlaubteAdresse(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '100.128.0.1', '2a02:1210::1', '::ffff:8.8.8.8'])
      assert.equal(erlaubteAdresse(ip), false, ip);
    assert.equal(erlaubteAdresse('203.0.113.9', ['203.0.113.0/24']), true);
    assert.equal(imNetz('2001:db8::5', '2001:db8::/32'), true);
  });
});

describe('Login', () => {
  it('prüft scrypt Hashes', () => {
    const h = passwortHash('geheimes-passwort');
    assert.equal(passwortPruefen('geheimes-passwort', h), true);
    assert.equal(passwortPruefen('falsch', h), false);
    assert.equal(passwortPruefen('x', 'kaputt'), false);
  });
  it('signiert Sitzungen und erkennt Manipulation und Ablauf', () => {
    const t = sitzungErstellen({ benutzer: 'jerome', art: 'lokal' }, 'geheim', 1000);
    assert.equal(sitzungLesen(t, 'geheim', 2000)?.benutzer, 'jerome');
    assert.equal(sitzungLesen(t, 'anderes', 2000), null);
    assert.equal(sitzungLesen(`${t}x`, 'geheim', 2000), null);
    assert.equal(sitzungLesen(t, 'geheim', 1000 + 31 * 86400000), null);
  });
  it('bremst nach 5 Fehlversuchen', () => {
    const b = new LoginBremse();
    for (let i = 0; i < 5; i++) b.fehlversuch('1.2.3.4', 1000);
    assert.equal(b.gesperrt('1.2.3.4', 2000), true);
    assert.equal(b.gesperrt('1.2.3.4', 1000 + 601000), false);
  });
});

describe('.env und Geheimnisse', () => {
  it('liest und schreibt ohne Kommentare zu verlieren', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pihub-'));
    const pfad = join(dir, '.env');
    envSchreiben(pfad, { A: '1' });
    envSchreiben(pfad, { B: 'mit leer zeichen', A: '2' });
    assert.deepEqual(envLesen(pfad), { A: '2', B: 'mit leer zeichen' });
    assert.deepEqual(parseEnv('# Kommentar\nX="a b"\nY=\n'), { X: 'a b', Y: '' });
    assert.match(readFileSync(pfad, 'utf8'), /A=2\nB="mit leer zeichen"/);
  });
  it('schwärzt Geheimnisse in Texten', () => {
    assert.equal(schwaerzen('Fehler bei abc123xyz', ['abc123xyz']), 'Fehler bei ***');
    assert.equal(schwaerzen('postgres://user:pw@host/db'), 'postgres://***@host/db');
    assert.equal(schwaerzen('https://x.ch/?key=GEHEIM&a=1'), 'https://x.ch/?key=***&a=1');
  });
});

describe('ntfy Links', () => {
  const k = { server: 'https://ntfy.sh', thema: 't', token: '' };
  it('ergänzt relative Links mit der Hub Adresse', () => {
    assert.equal(
      klickAdresse({ ...k, adresse: 'https://hub.example' }, '/modul/rettung'),
      'https://hub.example/modul/rettung',
    );
  });
  it('lässt relative Links ohne Adresse weg und absolute unverändert', () => {
    assert.equal(klickAdresse(k, '/modul/rettung'), undefined);
    assert.equal(klickAdresse(k, 'https://a.ch/x'), 'https://a.ch/x');
    assert.equal(klickAdresse(k, undefined), undefined);
  });
});
