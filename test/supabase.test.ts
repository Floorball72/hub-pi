// Supabase Treiber gegen eine echte Postgres Datenbank. Läuft nur mit PG_TEST_URL, z.B.
// PG_TEST_URL=postgresql://pihub:test@127.0.0.1:5432/pihub_test npm test
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { migrationenAnwenden } from '../src/server/daten/migration.ts';
import { postgresVerbinden, SupabaseTreiber } from '../src/server/daten/supabase.ts';
import { alleTabellen } from '../src/server/kern/hub.ts';

const URL = process.env.PG_TEST_URL;

describe('Supabase Treiber (Postgres)', { skip: !URL && 'PG_TEST_URL nicht gesetzt' }, () => {
  it('wendet Migrationen an, auch mehrfach', async () => {
    const sql = postgresVerbinden(URL!, 1);
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sql.end();
    const a = await migrationenAnwenden(URL!, resolve('supabase/migrations'));
    assert.ok(a.angewendet.length > 0);
    const b = await migrationenAnwenden(URL!, resolve('supabase/migrations'));
    assert.equal(b.angewendet.length, 0);
    const pruef = postgresVerbinden(URL!, 1);
    const ohneRls =
      await pruef`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    await pruef.end();
    assert.deepEqual(
      ohneRls.map((r) => r.relname),
      [],
      'Tabellen ohne Row Level Security',
    );
  });

  it('liest und schreibt alle Typen', async () => {
    const t = new SupabaseTreiber(URL!);
    await t.vorbereiten(alleTabellen());
    const [z] = await t.einfuegen<{ id: string }>('notizen', [
      { text: 'Hallo «Welt»', bezug_typ: 'ort', angeheftet: true },
    ]);
    const g = await t.hole<Record<string, unknown>>('notizen', z.id);
    assert.equal(g?.text, 'Hallo «Welt»');
    assert.equal(g?.angeheftet, true);
    assert.match(String(g?.erstellt), /^\d{4}-\d{2}-\d{2}T/);
    await t.einfuegen('einstellungen', [{ id: 'test.json', wert: { a: [1, 2], b: 'x' } }]);
    assert.deepEqual((await t.hole<{ wert: unknown }>('einstellungen', 'test.json'))?.wert, {
      a: [1, 2],
      b: 'x',
    });
    await t.aendern('notizen', z.id, { angeheftet: false });
    assert.equal((await t.hole<{ angeheftet: boolean }>('notizen', z.id))?.angeheftet, false);
    assert.equal(await t.anzahl('notizen', { text: { like: '%welt%' } }), 1);
    assert.equal(
      await t.anzahl('notizen', { erstellt: { gte: new Date(Date.now() - 60000).toISOString() } }),
      1,
    );
    assert.equal(await t.loeschen('notizen', z.id), true);
    await t.schliessen();
  });
});
