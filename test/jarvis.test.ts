import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { appErstellen } from '../src/server/app.ts';
import { Daten } from '../src/server/daten/index.ts';
import { LokalTreiber } from '../src/server/daten/lokal.ts';
import { alleTabellen } from '../src/server/kern/hub.ts';
import type { Kontext } from '../src/server/kern/modul.ts';
import { Einstellungen } from '../src/server/kern/einstellungen.ts';
import { konfigLaden } from '../src/server/konfig.ts';
import { Agent, type AgentEreignis, verlaufBereinigen } from '../src/server/modules/jarvis/agent.ts';
import { Gedaechtnis, woerter } from '../src/server/modules/jarvis/gedaechtnis.ts';
import {
  type Block,
  type ModellAnfrage,
  type ModellEreignis,
  type ModellFn,
  openaiModell,
  sseLesen,
  zuOpenAi,
} from '../src/server/modules/jarvis/modell.ts';
import {
  HUB_ZIEL,
  adresseSicher,
  entscheid,
  htmlZuText,
  suchTreffer,
} from '../src/server/modules/jarvis/werkzeuge.ts';

describe('Jarvis Vollmacht', () => {
  it('lesen geht immer, Schreiben und Kritisches je nach Stufe', () => {
    assert.equal(entscheid('lesen', 'nur_lesen'), 'ja');
    assert.equal(entscheid('schreiben', 'nur_lesen'), 'nein');
    assert.equal(entscheid('schreiben', 'fragen'), 'fragen');
    assert.equal(entscheid('schreiben', 'autonom'), 'ja');
    assert.equal(entscheid('kritisch', 'autonom'), 'fragen');
    assert.equal(entscheid('kritisch', 'voll'), 'ja');
  });
});

function strom(zeilen: string[], status = 200, kopf: Record<string, string> = {}): Response {
  return new Response(zeilen.map((z) => `data: ${z}\n\n`).join(''), { status, headers: kopf });
}

describe('Jarvis Gratis Anbieter (OpenAI Format)', () => {
  const anfrage: ModellAnfrage = {
    modell: 'm',
    system: [{ type: 'text', text: 'System' }],
    nachrichten: [
      { role: 'user', content: 'Wie ist das Wetter?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Ich schaue nach.' },
          { type: 'tool_use', id: 'a1', name: 'briefing', input: { x: 1 } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'sonnig' }] },
    ],
    werkzeuge: [
      { name: 'briefing', description: 'd', input_schema: { type: 'object', additionalProperties: false } },
    ],
    maxTokens: 100,
  };

  it('wandelt Nachrichten und Werkzeugergebnisse um', () => {
    const m = zuOpenAi(anfrage);
    assert.deepEqual(m[0], { role: 'system', content: 'System' });
    assert.equal(m[2].tool_calls[0].function.arguments, '{"x":1}');
    assert.deepEqual(m[3], { role: 'tool', tool_call_id: 'a1', content: 'sonnig' });
  });

  it('liest Text und Werkzeugaufrufe aus dem Strom, sendet Schlüssel und bereinigt das Schema', async () => {
    let gesendet: { headers: Record<string, string>; body: string } | undefined;
    const holen = (async (_u: string, init: { headers: Record<string, string>; body: string }) => {
      gesendet = init;
      return strom([
        '{"choices":[{"delta":{"content":"Ein "}}]}',
        '{"choices":[{"delta":{"content":"Moment."}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"briefing","arguments":"{\\"a\\""}}]}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":2}"}}]}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c2","function":{"name":"merken","arguments":"{}"}}]}}]}',
        '{"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":7}}',
        '[DONE]',
      ]);
    }) as unknown as typeof fetch;
    const aus: ModellEreignis[] = [];
    for await (const e of openaiModell('gemini', () => 'geheim', holen)(anfrage)) aus.push(e);
    const ende = aus[aus.length - 1] as Extract<ModellEreignis, { art: 'ende' }>;
    assert.equal(gesendet?.headers.authorization, 'Bearer geheim');
    assert.ok(!gesendet?.body.includes('additionalProperties'));
    assert.equal(ende.grund, 'tool_use');
    assert.equal(ende.tokensEin, 12);
    assert.deepEqual(ende.bloecke, [
      { type: 'text', text: 'Ein Moment.' },
      { type: 'tool_use', id: 'c1', name: 'briefing', input: { a: 2 } },
      { type: 'tool_use', id: 'c2', name: 'merken', input: {} },
    ]);
  });

  it('versucht es bei Limit (429) einmal nochmals und meldet danach den Fehler', async () => {
    let n = 0;
    const holen = (async () => {
      n++;
      return n === 1
        ? strom([], 429, { 'retry-after': '0.01' })
        : strom(['{"choices":[{"delta":{"content":"Hallo"},"finish_reason":"stop"}]}']);
    }) as unknown as typeof fetch;
    const aus: unknown[] = [];
    for await (const e of openaiModell('groq', () => 'k', holen)(anfrage)) aus.push(e);
    assert.equal(n, 2);
    const immer = (async () => strom([], 429, { 'retry-after': '0.01' })) as unknown as typeof fetch;
    await assert.rejects(async () => {
      for await (const _ of openaiModell('groq', () => 'k', immer)(anfrage));
    }, /Groq/);
  });

  it('wählt den Anbieter nach dem vorhandenen Schlüssel', () => {
    assert.equal(konfigLaden({ GEMINI_API_KEY: 'x' }).jarvis.anbieter, 'gemini');
    assert.equal(konfigLaden({ GROQ_API_KEY: 'x' }).jarvis.modell, 'openai/gpt-oss-120b');
    assert.equal(konfigLaden({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'x' }).jarvis.anbieter, 'claude');
    assert.equal(
      konfigLaden({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'x', JARVIS_ANBIETER: 'gemini' }).jarvis.apiKey,
      'x',
    );
  });

  it('liest Suchtreffer aus der DuckDuckGo Seite', () => {
    const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbeispiel.ch%2Fa&amp;rut=1">Titel <b>A</b></a>
      <a class="result__snippet" href="x">Auszug A</a>
      <a class="result__a" href="http://unsicher.ch">B</a>`;
    assert.deepEqual(suchTreffer(html), [
      { titel: 'Titel A', adresse: 'https://beispiel.ch/a', auszug: 'Auszug A' },
    ]);
  });
});

describe('Jarvis Hilfsfunktionen', () => {
  it('liest SSE Ströme in Teilstücken', async () => {
    const teile = ['event: a\ndata: {"x"', ':1}\n\nevent: b\ndata: {"y":2}\n\n'];
    const strom = (async function* () {
      for (const t of teile) yield new TextEncoder().encode(t);
    })();
    const aus: unknown[] = [];
    for await (const e of sseLesen(strom)) aus.push(e);
    assert.deepEqual(aus, [
      { name: 'a', daten: { x: 1 } },
      { name: 'b', daten: { y: 2 } },
    ]);
  });

  it('bereinigt den Verlauf: Start mit Nutzertext, keine offenen Werkzeugaufrufe', () => {
    const v = verlaufBereinigen([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'a' }] },
      { role: 'user', content: 'Hallo' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'y', name: 'briefing', input: {} }] },
    ]);
    assert.equal(v.length, 1);
    assert.equal(v[0].content, 'Hallo');
  });

  it('sperrt private und unsichere Adressen', async () => {
    await assert.rejects(adresseSicher('http://example.com'));
    await assert.rejects(adresseSicher('https://127.0.0.1/'));
    await assert.rejects(adresseSicher('https://192.168.1.5/x'));
    await assert.rejects(adresseSicher('https://[::1]/'));
    await assert.rejects(adresseSicher('https://user:pw@example.com/'));
  });

  it('erlaubt als Ziel nur Hub Seiten', () => {
    for (const ok of ['/timeline', '/modul/rettung#tab=Karte', '/suche?q=Kaffee'])
      assert.ok(HUB_ZIEL.test(ok), ok);
    for (const nein of [
      'https://example.com',
      '//example.com',
      '/api/logout',
      '/login',
      'javascript:alert(1)',
    ])
      assert.ok(!HUB_ZIEL.test(nein), nein);
  });

  it('macht aus HTML Text', () => {
    assert.equal(htmlZuText('<style>a{}</style><p>Hallo <b>Welt</b></p>'), 'Hallo Welt');
  });

  it('zieht Suchwörter ohne Füllwörter', () => {
    assert.deepEqual(woerter('Was ist mein Lieblingskaffee?'), ['lieblingskaffee']);
  });
});

async function stub() {
  const daten = new Daten(new LokalTreiber(':memory:'), null);
  await daten.vorbereiten(alleTabellen());
  const einstellungen = new Einstellungen(daten);
  await einstellungen.laden();
  const protokoll: string[] = [];
  const ctx = {
    konfig: konfigLaden({ DEMO_MODUS: 'true', DATEN_VERZEICHNIS: mkdtempSync(join(tmpdir(), 'pihub-j-')) }),
    daten,
    einstellungen,
    aktivitaet: async (_m: string, t: string) => {
      protokoll.push(t);
    },
    jetzt: () => new Date('2026-10-05T10:00:00Z'),
    kern: {},
  } as unknown as Kontext;
  return { ctx, daten, einstellungen, protokoll };
}

function skript(...schritte: Array<(a: ModellAnfrage) => Block[]>): ModellFn {
  let i = 0;
  return async function* (a) {
    const bloecke = schritte[Math.min(i++, schritte.length - 1)](a);
    for (const b of bloecke) if (b.type === 'text') yield { art: 'text', text: b.text };
    yield {
      art: 'ende',
      bloecke,
      grund: bloecke.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      tokensEin: 10,
      tokensAus: 5,
    };
  };
}

async function sammeln(g: AsyncGenerator<AgentEreignis>) {
  const aus: AgentEreignis[] = [];
  for await (const e of g) aus.push(e);
  return aus;
}

describe('Jarvis Agent', () => {
  it('merkt sich etwas und beantwortet danach', async () => {
    const { ctx, daten } = await stub();
    const g = new Gedaechtnis(daten);
    const modell = skript(
      () => [
        {
          type: 'tool_use',
          id: 't1',
          name: 'merken',
          input: { kategorie: 'vorliebe', inhalt: 'Jerome trinkt Kaffee schwarz', wichtigkeit: 4 },
        },
      ],
      () => [{ type: 'text', text: 'Gemerkt.' }],
    );
    const agent = new Agent(
      ctx,
      g,
      () => modell,
      () => ({ standard: 'x', schnell: 'y' }),
    );
    const ev = await sammeln(agent.lauf({ nachricht: 'Merk dir: Kaffee schwarz' }));
    assert.ok(ev.some((e) => e.art === 'werkzeug' && e.name === 'merken'));
    assert.ok(ev.some((e) => e.art === 'text' && e.text === 'Gemerkt.'));
    assert.equal(ev[ev.length - 1].art, 'fertig');
    const treffer = await g.suchen('Kaffee');
    assert.equal(treffer.length, 1);
    assert.equal(treffer[0].wichtigkeit, 4);
    assert.ok((await agent.tokensHeute()) > 0);
  });

  it('autonom: Löschen wartet auf Bestätigung, Anlegen läuft direkt', async () => {
    const { ctx, daten } = await stub();
    const g = new Gedaechtnis(daten);
    const notiz = await daten.eins<{ id: string }>('notizen', { bezug_typ: 'allgemein', text: 'weg damit' });
    const modell = skript(
      () => [
        {
          type: 'tool_use',
          id: 'a',
          name: 'daten_erstellen',
          input: { tabelle: 'notizen', werte: { bezug_typ: 'allgemein', text: 'Neu von Jarvis' } },
        },
        { type: 'tool_use', id: 'b', name: 'daten_loeschen', input: { tabelle: 'notizen', id: notiz.id } },
      ],
      () => [{ type: 'text', text: 'Fertig.' }],
    );
    const agent = new Agent(
      ctx,
      g,
      () => modell,
      () => ({ standard: 'x', schnell: 'y' }),
    );
    const ev = await sammeln(agent.lauf({ nachricht: 'Räum auf' }));
    const bestaetigung = ev.find((e) => e.art === 'bestaetigung');
    assert.ok(bestaetigung && bestaetigung.art === 'bestaetigung');
    assert.equal(await daten.anzahl('notizen'), 2, 'noch nichts gelöscht');
    const r = await agent.bestaetigen(bestaetigung.id, true);
    assert.equal(r.ok, true);
    assert.equal(await daten.anzahl('notizen'), 1);
  });

  it('nur lesen: Schreiben wird abgelehnt, Einstellungen sind gesperrt', async () => {
    const { ctx, daten, einstellungen } = await stub();
    await einstellungen.setze('jarvis.vollmacht', 'nur_lesen');
    const g = new Gedaechtnis(daten);
    const modell = skript(
      () => [
        {
          type: 'tool_use',
          id: 'a',
          name: 'daten_erstellen',
          input: { tabelle: 'notizen', werte: { text: 'x' } },
        },
        { type: 'tool_use', id: 'b', name: 'daten_lesen', input: { tabelle: 'einstellungen' } },
      ],
      () => [{ type: 'text', text: 'ok' }],
    );
    const agent = new Agent(
      ctx,
      g,
      () => modell,
      () => ({ standard: 'x', schnell: 'y' }),
    );
    const ev = await sammeln(agent.lauf({ nachricht: 'Mach was' }));
    const ergebnisse = ev.filter(
      (e): e is Extract<AgentEreignis, { art: 'ergebnis' }> => e.art === 'ergebnis',
    );
    assert.equal(ergebnisse.length, 2);
    assert.ok(ergebnisse.every((e) => !e.ok));
    assert.equal(await daten.anzahl('notizen'), 0);
  });

  it('Tageslimit stoppt den Lauf', async () => {
    const { ctx, daten, einstellungen } = await stub();
    await einstellungen.setze('jarvis.tageslimit', 100);
    await daten.eins('jarvis_nutzung', { modell: 'x', tokens_ein: 500, tokens_aus: 0 });
    const agent = new Agent(
      ctx,
      new Gedaechtnis(daten),
      () => skript(() => []),
      () => ({ standard: 'x', schnell: 'y' }),
    );
    const ev = await sammeln(agent.lauf({ nachricht: 'Hallo' }));
    assert.equal(ev[0].art, 'fehler');
  });
});

describe('Jarvis über den Server (Demo Modus)', () => {
  it('antwortet per SSE, braucht Login und speichert Erinnerungen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pihub-js-'));
    const konfig = konfigLaden({
      DEMO_MODUS: 'true',
      DATEN_VERZEICHNIS: dir,
      SESSION_SECRET: 'test-geheimnis-test-geheimnis',
      EINRICHTUNG_ABGESCHLOSSEN: 'true',
    });
    konfig.envPfad = join(dir, '.env');
    const { app } = await appErstellen({
      konfig,
      daten: new Daten(new LokalTreiber(':memory:'), null),
      logger: false,
      webVerzeichnis: dir,
    });
    try {
      const h = { 'x-pihub': '1', 'content-type': 'application/json' };
      const roh = await app.inject({
        method: 'POST',
        url: '/api/m/jarvis/chat',
        headers: h,
        remoteAddress: '192.168.1.10',
        payload: '{"nachricht":"Hallo"}',
      });
      assert.equal(roh.statusCode, 401);
      const login = await app.inject({
        method: 'POST',
        url: '/api/login',
        headers: h,
        remoteAddress: '192.168.1.10',
        payload: JSON.stringify({ benutzer: 'jerome', passwort: 'demo' }),
      });
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const mitLogin = { ...h, cookie };
      const chat = await app.inject({
        method: 'POST',
        url: '/api/m/jarvis/chat',
        headers: mitLogin,
        remoteAddress: '192.168.1.10',
        payload: JSON.stringify({ nachricht: 'Merk dir, dass ich Kaffee schwarz trinke' }),
      });
      assert.equal(chat.statusCode, 200);
      assert.match(chat.body, /"art":"werkzeug"/);
      assert.match(chat.body, /"art":"fertig"/);
      const status = (
        await app.inject({
          method: 'GET',
          url: '/api/m/jarvis/status',
          headers: mitLogin,
          remoteAddress: '192.168.1.10',
        })
      ).json();
      assert.equal(status.demo, true);
      assert.equal(status.erinnerungen, 1);
    } finally {
      await app.close();
    }
  });
});
