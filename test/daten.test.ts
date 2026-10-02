// Tests der Datenschicht: lokaler Treiber, Filter, Puffer, Verdichtung, Migrationsdateien, SQL Bau für Postgres.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Daten } from '../src/server/daten/index.ts';
import { LokalTreiber } from '../src/server/daten/lokal.ts';
import { migrationsDateien } from '../src/server/daten/migration.ts';
import { EingabeFehler, tabelle, validieren } from '../src/server/daten/schema.ts';
import { postgresDialekt } from '../src/server/daten/supabase.ts';
import type { DatenTreiber } from '../src/server/daten/treiber.ts';
import { SqlBauer } from '../src/server/daten/treiber.ts';
import { aggregieren, verdichten } from '../src/server/daten/verdichtung.ts';
import { alleTabellen } from '../src/server/kern/hub.ts';

const T = tabelle({
  name: 'messung',
  modul: 'test',
  label: 'Messung',
  puffer: true,
  spalten: [
    { name: 'ziel', typ: 'text', pflicht: true },
    { name: 'ok', typ: 'bool' },
    { name: 'ms', typ: 'int', min: 0 },
    { name: 'info', typ: 'json' },
    { name: 'tag', typ: 'datum' },
  ],
});
const STUNDEN = tabelle({
  name: 'messung_stunden',
  modul: 'test',
  label: 'Stunden',
  spalten: [
    { name: 'zeit', typ: 'zeit' },
    { name: 'anzahl', typ: 'int' },
    { name: 'ziel', typ: 'text' },
    { name: 'ok', typ: 'real' },
    { name: 'ms', typ: 'real' },
  ],
});

async function neu() {
  const d = new Daten(new LokalTreiber(':memory:'), null);
  await d.vorbereiten([T, STUNDEN]);
  return d;
}

describe('Lokaler Treiber', () => {
  it('speichert und liest alle Typen', async () => {
    const d = await neu();
    const z = await d.eins<Record<string, unknown>>('messung', {
      ziel: 'a',
      ok: true,
      ms: 120,
      info: { x: [1, 2] },
      tag: '2026-10-02',
    });
    const g = await d.hole<Record<string, unknown>>('messung', String(z.id));
    assert.equal(g?.ok, true);
    assert.equal(g?.ms, 120);
    assert.deepEqual(g?.info, { x: [1, 2] });
    assert.equal(g?.tag, '2026-10-02');
  });
  it('filtert, sortiert, zählt und löscht', async () => {
    const d = await neu();
    await d.einfuegen('messung', [
      { ziel: 'a', ms: 10 },
      { ziel: 'b', ms: 30 },
      { ziel: 'c', ms: 20 },
      { ziel: 'd', ms: null },
    ]);
    assert.deepEqual(
      (await d.liste<{ ziel: string }>('messung', { filter: { ms: { gte: 20 } }, sortierung: '-ms' })).map(
        (z) => z.ziel,
      ),
      ['b', 'c'],
    );
    assert.equal(await d.anzahl('messung', { ziel: { in: ['a', 'b'] } }), 2);
    assert.equal(await d.anzahl('messung', { ms: null }), 1);
    assert.equal(await d.anzahl('messung', { ziel: { like: '%c%' } }), 1);
    assert.equal(await d.anzahl('messung', { ziel: { ne: 'a' } }), 3);
    assert.equal(await d.loescheWo('messung', { ms: { lt: 25 } }), 2);
    await assert.rejects(() => d.loescheWo('messung', {}), /ohne Bedingung/);
  });
  it('lehnt unbekannte Spalten und Tabellen ab (kein SQL aus Eingaben)', async () => {
    const d = await neu();
    await assert.rejects(
      () => d.liste('messung', { filter: { 'x; DROP TABLE messung': 1 } }),
      /Unbekannte Spalte/,
    );
    await assert.rejects(() => d.liste('gibtsnicht'), /Unbekannte Tabelle/);
    await assert.rejects(() => d.liste('messung', { sortierung: 'ms; --' }), /Unbekannte Spalte/);
  });
  it('ergänzt fehlende Spalten bei Schemaänderung', async () => {
    const t = new LokalTreiber(':memory:');
    await t.vorbereiten([T]);
    await t.vorbereiten([{ ...T, spalten: [...T.spalten, { name: 'neu', typ: 'text' }] }]);
    await t.einfuegen('messung', [{ ziel: 'x', neu: 'ja' }]);
    assert.equal((await t.liste<{ neu: string }>('messung'))[0].neu, 'ja');
  });
});

describe('Validierung', () => {
  it('prüft Typen, Pflichtfelder und Grenzen', () => {
    assert.deepEqual(validieren(T, { ziel: 'a', ms: '12' }, false), { ziel: 'a', ms: 12 });
    assert.throws(() => validieren(T, { ms: 1 }, false), EingabeFehler);
    assert.throws(() => validieren(T, { ziel: 'a', ms: -1 }, false), /mindestens/);
    assert.throws(() => validieren(T, { ziel: 'a', tag: '2.10.2026' }, false), /Datum/);
    assert.deepEqual(validieren(T, { ok: 'true', unbekannt: 1 }, true), { ok: true });
  });
});

describe('Offline Puffer', () => {
  it('puffert Messwerte bei Verbindungsfehler und sendet sie nach', async () => {
    const echt = new LokalTreiber(':memory:');
    let offline = true;
    const wackelig: DatenTreiber = new Proxy(echt, {
      get(ziel, name, empf) {
        const w = Reflect.get(ziel, name, empf);
        if (name === 'einfuegen') {
          return (...args: unknown[]) => {
            if (offline) return Promise.reject(new Error('connect ECONNREFUSED'));
            return (w as (...a: unknown[]) => unknown).apply(ziel, args);
          };
        }
        return typeof w === 'function' ? w.bind(ziel) : w;
      },
    });
    const d = new Daten(wackelig, new LokalTreiber(':memory:'));
    await d.vorbereiten([T]);
    const [z] = await d.einfuegen<{ id: string }>('messung', [{ ziel: 'a', ms: 5 }]);
    assert.ok(z.id);
    assert.equal(d.verbunden, false);
    assert.equal(await d.pufferAnzahl(), 1);
    assert.equal(await d.pufferNachsenden(), 0);
    offline = false;
    assert.equal(await d.pufferNachsenden(), 1);
    assert.equal(await d.pufferAnzahl(), 0);
    assert.equal((await d.liste<{ id: string }>('messung'))[0].id, z.id);
  });
});

describe('Verdichtung', () => {
  it('fasst Werte pro Stunde und Gruppe zusammen', () => {
    const r = aggregieren(
      [
        { erstellt: '2026-08-01T10:05:00Z', ziel: 'a', ok: true, ms: 100 },
        { erstellt: '2026-08-01T10:35:00Z', ziel: 'a', ok: false, ms: 300 },
        { erstellt: '2026-08-01T11:05:00Z', ziel: 'a', ok: true, ms: 50 },
        { erstellt: '2026-08-01T10:10:00Z', ziel: 'b', ok: true, ms: 10 },
      ],
      {
        quelle: 'messung',
        ziel: 'messung_stunden',
        nachTagen: 30,
        intervall: 'stunde',
        gruppe: ['ziel'],
        felder: [
          { ziel: 'ok', art: 'anteil', feld: 'ok' },
          { ziel: 'ms', art: 'mittel', feld: 'ms' },
        ],
      },
    );
    const a10 = r.find((z) => z.ziel === 'a' && z.zeit === '2026-08-01T10:00:00.000Z')!;
    assert.equal(a10.anzahl, 2);
    assert.equal(a10.ok, 0.5);
    assert.equal(a10.ms, 200);
    assert.equal(r.length, 3);
  });
  it('verdichtet alte Rohdaten und löscht sie, neue bleiben', async () => {
    const d = await neu();
    const jetzt = new Date('2026-10-02T12:00:00Z');
    await d.einfuegen('messung', [
      { ziel: 'a', ok: true, ms: 100, erstellt: '2026-08-01T10:05:00Z' },
      { ziel: 'a', ok: true, ms: 200, erstellt: '2026-08-01T10:15:00Z' },
      { ziel: 'a', ok: false, ms: 0, erstellt: '2026-08-02T10:15:00Z' },
      { ziel: 'a', ok: true, ms: 50, erstellt: '2026-10-01T10:15:00Z' },
    ]);
    const n = await verdichten(
      d,
      {
        quelle: 'messung',
        ziel: 'messung_stunden',
        nachTagen: 30,
        intervall: 'stunde',
        gruppe: ['ziel'],
        felder: [
          { ziel: 'ok', art: 'anteil', feld: 'ok' },
          { ziel: 'ms', art: 'mittel', feld: 'ms' },
        ],
      },
      jetzt,
    );
    assert.equal(n, 3);
    assert.equal(await d.anzahl('messung'), 1);
    assert.equal(await d.anzahl('messung_stunden'), 2);
  });
});

describe('Supabase SQL und Migrationen', () => {
  it('baut Postgres Abfragen mit nummerierten Parametern und Casts', () => {
    const b = new SqlBauer(postgresDialekt);
    b.registrieren([T]);
    const q = b.select('messung', {
      filter: { ziel: 'a', erstellt: { gte: '2026-01-01T00:00:00Z' } },
      sortierung: '-erstellt',
      limit: 5,
    });
    assert.equal(
      q.sql,
      'SELECT * FROM "messung" WHERE "ziel" = $1 AND "erstellt" >= $2::timestamptz ORDER BY "erstellt" DESC LIMIT 5',
    );
    const i = b.insert('messung', { ziel: 'a', info: { a: 1 } });
    assert.match(i.sql, /\$\d::jsonb/);
    assert.ok(i.params.includes('{"a":1}'));
  });
  it('jede Tabelle und Spalte des Schemas steht in einer Migration, mit RLS', () => {
    const dateien = migrationsDateien('supabase/migrations');
    assert.ok(dateien.length > 0, 'keine Migrationen gefunden');
    const sql = dateien.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');
    for (const t of alleTabellen()) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${t.name}"`), `Tabelle ${t.name} fehlt`);
      assert.match(
        sql,
        new RegExp(`ALTER TABLE "${t.name}" ENABLE ROW LEVEL SECURITY`),
        `RLS für ${t.name} fehlt`,
      );
      const block =
        new RegExp(`CREATE TABLE IF NOT EXISTS "${t.name}" \\(([\\s\\S]*?)\\);`).exec(sql)?.[1] ?? '';
      const ergaenzt = [
        ...sql.matchAll(new RegExp(`ALTER TABLE "${t.name}" ADD COLUMN IF NOT EXISTS "([a-z0-9_]+)"`, 'g')),
      ].map((m) => m[1]);
      for (const s of t.spalten) {
        assert.ok(
          block.includes(`"${s.name}" `) || ergaenzt.includes(s.name),
          `Spalte ${t.name}.${s.name} fehlt`,
        );
      }
    }
  });
});
