// HTTP Zugriff für alle externen Aufrufe: Zeitüberschreitung, Rate Limit pro Host, Grössenlimit.
import { HubFehler } from '../kern/fehler.ts';

export const USER_AGENT = 'PiHub/1.0 (privates Dashboard; schonender Abruf)';

interface Optionen {
  timeoutMs?: number;
  headers?: Record<string, string>;
  methode?: string;
  body?: string;
  /** Mindestabstand zwischen Aufrufen auf denselben Host */
  abstandMs?: number;
  maxBytes?: number;
  /** Weiterleitungen nicht folgen (z.B. Wächter) */
  weiterleitung?: 'follow' | 'manual';
}

const letzterAufruf = new Map<string, number>();
const warteschlange = new Map<string, Promise<void>>();

async function rateLimit(host: string, abstandMs: number) {
  const vorher = warteschlange.get(host) ?? Promise.resolve();
  const jetzt = vorher.then(async () => {
    const warten = (letzterAufruf.get(host) ?? 0) + abstandMs - Date.now();
    if (warten > 0) await new Promise((r) => setTimeout(r, warten));
    letzterAufruf.set(host, Date.now());
  });
  warteschlange.set(
    host,
    jetzt.catch(() => {}),
  );
  await jetzt;
}

export interface Antwort {
  status: number;
  headers: Headers;
  text: string;
  dauerMs: number;
  url: string;
}

export async function httpAnfrage(url: string, o: Optionen = {}): Promise<Antwort> {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HubFehler('Nur http und https erlaubt');
  await rateLimit(u.host, o.abstandMs ?? 1000);
  const start = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 10000);
  try {
    const r = await fetch(u, {
      method: o.methode ?? 'GET',
      headers: { 'User-Agent': USER_AGENT, ...o.headers },
      body: o.body,
      signal: ctrl.signal,
      redirect: o.weiterleitung ?? 'follow',
    });
    const text = await textBegrenzt(r, o.maxBytes ?? 5_000_000);
    return {
      status: r.status,
      headers: r.headers,
      text,
      dauerMs: Math.round(performance.now() - start),
      url: r.url,
    };
  } catch (e) {
    if ((e as Error).name === 'AbortError')
      throw new HubFehler(`Zeitüberschreitung nach ${o.timeoutMs ?? 10000} ms`);
    throw new HubFehler(`Nicht erreichbar: ${(e as Error).cause ?? (e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function textBegrenzt(r: Response, max: number): Promise<string> {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const teile: Uint8Array[] = [];
  let laenge = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    laenge += value.length;
    if (laenge > max) {
      await reader.cancel();
      throw new HubFehler('Antwort zu gross');
    }
    teile.push(value);
  }
  return Buffer.concat(teile).toString('utf8');
}

export async function httpJson<T = unknown>(url: string, o: Optionen = {}): Promise<T> {
  const r = await httpAnfrage(url, { ...o, headers: { Accept: 'application/json', ...o.headers } });
  if (r.status >= 400) throw new HubFehler(`HTTP ${r.status}`);
  try {
    return JSON.parse(r.text) as T;
  } catch {
    throw new HubFehler('Antwort ist kein gültiges JSON');
  }
}

export async function httpText(url: string, o: Optionen = {}): Promise<string> {
  const r = await httpAnfrage(url, o);
  if (r.status >= 400) throw new HubFehler(`HTTP ${r.status}`);
  return r.text;
}
