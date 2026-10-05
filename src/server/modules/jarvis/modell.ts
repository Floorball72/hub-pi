// Anbindung an die Claude API (Messages API, Streaming per SSE) ohne SDK, damit der RAM klein bleibt.
// Das Modell ist über `ModellFn` austauschbar. Tests und der Demo Modus laufen ohne Netz.

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  // Serverseitige Websuche der Claude API: wird nur im laufenden Gespräch weitergereicht, nicht gespeichert
  | { type: 'server_tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'web_search_tool_result'; tool_use_id: string; content: unknown };

export interface Nachricht {
  role: 'user' | 'assistant';
  content: string | Block[];
}

export interface WerkzeugDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface ModellAnfrage {
  modell: string;
  system: SystemBlock[];
  nachrichten: Nachricht[];
  werkzeuge: WerkzeugDef[];
  maxTokens: number;
  websuche?: boolean;
  signal?: AbortSignal;
}

export type ModellEreignis =
  | { art: 'text'; text: string }
  | { art: 'ende'; bloecke: Block[]; grund: string; tokensEin: number; tokensAus: number };

export type ModellFn = (a: ModellAnfrage) => AsyncGenerator<ModellEreignis>;

export class ModellFehler extends Error {
  status: number;
  constructor(text: string, status = 502) {
    super(text);
    this.status = status;
  }
}

function fehlerText(status: number, body: string): string {
  if (status === 401) return 'Der API Schlüssel wurde abgelehnt (ANTHROPIC_API_KEY prüfen).';
  if (status === 429)
    return 'Die Claude API ist gerade ausgelastet oder das Limit ist erreicht. Gleich nochmals versuchen.';
  if (status === 529) return 'Die Claude API ist überlastet. Gleich nochmals versuchen.';
  if (status === 400 && /credit/i.test(body)) return 'Das Guthaben bei Anthropic ist aufgebraucht.';
  return `Claude API Fehler ${status}`;
}

/** Liest einen SSE Strom und gibt Ereignisse (Name und JSON) zurück. */
export async function* sseLesen(
  body: AsyncIterable<Uint8Array>,
): AsyncGenerator<{ name: string; daten: Record<string, unknown> }> {
  const dec = new TextDecoder();
  let rest = '';
  for await (const stueck of body) {
    rest += dec.decode(stueck, { stream: true });
    let i = rest.indexOf('\n\n');
    while (i >= 0) {
      const roh = rest.slice(0, i);
      rest = rest.slice(i + 2);
      let name = '';
      let daten = '';
      for (const zeile of roh.split('\n')) {
        if (zeile.startsWith('event:')) name = zeile.slice(6).trim();
        else if (zeile.startsWith('data:')) daten += zeile.slice(5).trim();
      }
      if (daten) {
        try {
          yield { name, daten: JSON.parse(daten) as Record<string, unknown> };
        } catch {
          // kaputtes Ereignis überspringen
        }
      }
      i = rest.indexOf('\n\n');
    }
  }
}

// biome-ignore lint/suspicious/noExplicitAny: SSE Nutzdaten der API sind lose typisiert
type Roh = Record<string, any>;

export function claudeModell(apiKey: () => string): ModellFn {
  return async function* (a) {
    const key = apiKey();
    if (!key) throw new ModellFehler('ANTHROPIC_API_KEY fehlt in der .env', 503);
    let antwort: Response;
    try {
      antwort = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: a.modell,
          max_tokens: a.maxTokens,
          system: a.system,
          messages: a.nachrichten,
          tools:
            a.werkzeuge.length || a.websuche
              ? [
                  ...a.werkzeuge,
                  ...(a.websuche ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] : []),
                ]
              : undefined,
          stream: true,
        }),
        signal: a.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ModellFehler('Die Claude API ist nicht erreichbar (Internet prüfen).', 503);
    }
    if (!antwort.ok || !antwort.body) {
      const t = await antwort.text().catch(() => '');
      throw new ModellFehler(fehlerText(antwort.status, t), antwort.status === 401 ? 401 : 502);
    }
    const bloecke: Block[] = [];
    const jsonTeile = new Map<number, string>();
    let grund = 'end_turn';
    let tokensEin = 0;
    let tokensAus = 0;
    for await (const ev of sseLesen(antwort.body as unknown as AsyncIterable<Uint8Array>)) {
      const d = ev.daten as Roh;
      if (ev.name === 'message_start') {
        const u = d.message?.usage ?? {};
        tokensEin =
          (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      } else if (ev.name === 'content_block_start') {
        const b = d.content_block;
        if (b?.type === 'text') bloecke[d.index] = { type: 'text', text: '' };
        else if (b?.type === 'tool_use' || b?.type === 'server_tool_use') {
          bloecke[d.index] = { type: b.type, id: b.id, name: b.name, input: {} };
          jsonTeile.set(d.index, '');
        } else if (b?.type === 'web_search_tool_result')
          bloecke[d.index] = {
            type: 'web_search_tool_result',
            tool_use_id: b.tool_use_id,
            content: b.content,
          };
      } else if (ev.name === 'content_block_delta') {
        const b = bloecke[d.index];
        if (d.delta?.type === 'text_delta' && b?.type === 'text') {
          b.text += d.delta.text;
          yield { art: 'text', text: d.delta.text as string };
        } else if (d.delta?.type === 'input_json_delta') {
          jsonTeile.set(d.index, (jsonTeile.get(d.index) ?? '') + (d.delta.partial_json ?? ''));
        }
      } else if (ev.name === 'content_block_stop') {
        const b = bloecke[d.index];
        if (b?.type === 'tool_use' || b?.type === 'server_tool_use') {
          try {
            b.input = JSON.parse(jsonTeile.get(d.index) || '{}');
          } catch {
            b.input = {};
          }
        }
      } else if (ev.name === 'message_delta') {
        grund = d.delta?.stop_reason ?? grund;
        tokensAus = d.usage?.output_tokens ?? tokensAus;
      } else if (ev.name === 'error') {
        throw new ModellFehler(fehlerText(529, ''), 502);
      }
    }
    yield { art: 'ende', bloecke: bloecke.filter(Boolean), grund, tokensEin, tokensAus };
  };
}

/** Antwortet ohne Netz, damit der Demo Modus und die Tests den ganzen Ablauf zeigen können. */
export function demoModell(): ModellFn {
  return async function* (a) {
    const letzte = a.nachrichten[a.nachrichten.length - 1];
    const ergebnisse =
      letzte && Array.isArray(letzte.content)
        ? letzte.content.filter((b): b is Extract<Block, { type: 'tool_result' }> => b.type === 'tool_result')
        : [];
    const frage = typeof letzte?.content === 'string' ? letzte.content : '';
    const hat = (n: string) => a.werkzeuge.some((w) => w.name === n);
    let bloecke: Block[];
    if (ergebnisse.length) {
      const text = `Erledigt. Das habe ich gefunden: ${ergebnisse.map((r) => r.content.slice(0, 160)).join(' | ')}`;
      bloecke = [{ type: 'text', text }];
    } else if (/briefing|guten morgen|was steht an/i.test(frage) && hat('briefing')) {
      bloecke = [
        { type: 'text', text: 'Einen Moment, ich schaue nach. ' },
        { type: 'tool_use', id: 'demo_1', name: 'briefing', input: {} },
      ];
    } else if (/merk|erinner dich/i.test(frage) && hat('merken')) {
      bloecke = [
        {
          type: 'tool_use',
          id: 'demo_2',
          name: 'merken',
          input: { kategorie: 'fakt', inhalt: frage.slice(0, 300), wichtigkeit: 3 },
        },
      ];
    } else {
      bloecke = [
        {
          type: 'text',
          text: 'Jarvis im Demo Modus, bereit. Trage ANTHROPIC_API_KEY in die .env ein, dann denke ich richtig mit. Probier «Briefing» oder «Merk dir, dass ich Kaffee schwarz trinke».',
        },
      ];
    }
    for (const b of bloecke) if (b.type === 'text') yield { art: 'text', text: b.text };
    const grund = bloecke.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
    yield { art: 'ende', bloecke, grund, tokensEin: 0, tokensAus: 0 };
  };
}
