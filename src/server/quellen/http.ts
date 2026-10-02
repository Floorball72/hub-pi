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

// Bedingte Abrufe: Antworten mit ETag oder Last-Modified merken und beim nächsten Abruf mitschicken.
// Antwortet der Server mit 304, wird die gemerkte Antwort verwendet (spart Daten auf beiden Seiten).
interface Gemerkt {
  etag: string | null;
  geaendert: string | null;
  status: number;
  headers: [string, string][];
  text: string;
}
const gemerkt = new Map<string, Gemerkt>();
const MAX_GEMERKT_BYTES = 6_000_000;
let gemerktBytes = 0;
export const bedingteAbrufe = { gesendet: 0, nichtGeaendert: 0 };

function merken(url: string, g: Gemerkt) {
  const alt = gemerkt.get(url);
  if (alt) gemerktBytes -= alt.text.length;
  gemerkt.delete(url);
  if (g.text.length > 300_000) return;
  gemerkt.set(url, g);
  gemerktBytes += g.text.length;
  while (gemerktBytes > MAX_GEMERKT_BYTES && gemerkt.size) {
    const [k, v] = gemerkt.entries().next().value!;
    gemerkt.delete(k);
    gemerktBytes -= v.text.length;
  }
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
  const methode = o.methode ?? 'GET';
  const bedingt =
    methode === 'GET' && !o.body && o.weiterleitung !== 'manual' ? gemerkt.get(u.toString()) : undefined;
  const zusatz: Record<string, string> = {};
  if (bedingt?.etag) zusatz['If-None-Match'] = bedingt.etag;
  if (bedingt?.geaendert) zusatz['If-Modified-Since'] = bedingt.geaendert;
  if (bedingt) bedingteAbrufe.gesendet++;
  try {
    const r = await fetch(u, {
      method: methode,
      headers: { 'User-Agent': USER_AGENT, ...zusatz, ...o.headers },
      body: o.body,
      signal: ctrl.signal,
      redirect: o.weiterleitung ?? 'follow',
    });
    if (r.status === 304 && bedingt) {
      bedingteAbrufe.nichtGeaendert++;
      await r.body?.cancel();
      return {
        status: bedingt.status,
        headers: new Headers(bedingt.headers),
        text: bedingt.text,
        dauerMs: Math.round(performance.now() - start),
        url: r.url || u.toString(),
      };
    }
    const text = await textBegrenzt(r, o.maxBytes ?? 5_000_000);
    const etag = r.headers.get('etag');
    const geaendert = r.headers.get('last-modified');
    if (methode === 'GET' && !o.body && r.status === 200 && (etag || geaendert))
      merken(u.toString(), { etag, geaendert, status: r.status, headers: [...r.headers.entries()], text });
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
