// Tests für Logik der Oberfläche ohne Browser (Befehlspalette, Startseite).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { filtern, MODUL_TABS, modulBefehle, normalisieren, SEITEN } from '../src/web/lib/befehle.ts';
import { ordnen, umschalten, verschieben } from '../src/web/lib/startLayout.ts';

describe('Befehlspalette', () => {
  it('kennt die Tabs aller Module (Liste aktuell halten)', () => {
    const ordner = 'src/web/module';
    const gefunden: Record<string, string[]> = {};
    const ids: Record<string, string> = {};
    for (const datei of readdirSync(ordner).filter((d) => d.endsWith('.svelte'))) {
      const text = readFileSync(`${ordner}/${datei}`, 'utf8');
      const id = /<ModulRahmen modulId="([a-z]+)"/.exec(text)?.[1];
      const tabs = /<ModulRahmen[^>]*tabs=\{\[([^\]]*)\]\}/.exec(text)?.[1];
      if (!id || !tabs) continue;
      ids[id] = datei;
      gefunden[id] = [...tabs.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    }
    assert.ok(Object.keys(gefunden).length >= 15);
    assert.deepEqual(MODUL_TABS, gefunden);
  });

  it('findet ohne Umlaute und mit Teilwörtern', () => {
    const alle = [
      ...SEITEN,
      ...modulBefehle([
        { id: 'rettung', name: 'Rettung', symbol: 'rettung', aktiv: true },
        { id: 'aenderungen', name: 'Änderungs Wächter', symbol: 'aenderungen', aktiv: true },
        { id: 'scont', name: 'scont', symbol: 'scont', aktiv: true },
      ]),
    ];
    assert.equal(normalisieren('Änderungen'), normalisieren('Aenderungen'));
    assert.equal(filtern(alle, 'aenderung')[0].id, 'm:aenderungen');
    assert.equal(filtern(alle, 'rega stat')[0].id, 't:rettung:Rega Statistik');
    assert.equal(filtern(alle, 'chronik')[0].link, '/modul/rettung#tab=Chronik');
    assert.equal(filtern(alle, 'karte')[0].id, 's:/karte');
    assert.equal(filtern(alle, 'gibtsnicht').length, 0);
  });
});

describe('Startseite anpassen', () => {
  const m = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  it('ordnet nach Vorgabe, neue Module hinten in alter Reihenfolge', () => {
    assert.deepEqual(
      ordnen(m, ['c', 'a']).map((x) => x.id),
      ['c', 'a', 'b', 'd'],
    );
  });
  it('verschiebt und bleibt an den Rändern stehen', () => {
    assert.deepEqual(verschieben(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
    assert.deepEqual(verschieben(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
    assert.deepEqual(umschalten(umschalten([], 'x'), 'x'), []);
  });
});

describe('Seitenleiste', () => {
  it('ausgeschaltete Module stehen in einer eigenen Gruppe ganz unten', async () => {
    const { gruppieren } = await import('../src/web/lib/navigation.ts');
    const m = (id: string, aktiv: boolean) =>
      ({ id, name: id, symbol: id, aktiv }) as unknown as Parameters<typeof gruppieren>[0][number];
    const g = gruppieren([
      m('zentrale', true),
      m('wetter', true),
      m('mobilitaet', false),
      m('rettung', true),
    ]);
    const letzte = g[g.length - 1];
    assert.equal(letzte.id, 'aus');
    assert.deepEqual(
      letzte.seiten.map((s) => s.pfad),
      ['/modul/mobilitaet'],
    );
    const alltag = g.find((x) => x.id === 'alltag');
    assert.deepEqual(
      alltag?.seiten.map((s) => s.pfad),
      ['/modul/wetter'],
    );
  });
});
