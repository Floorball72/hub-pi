// Versand über ntfy (JSON Publish, damit Umlaute in Titeln sicher ankommen).
import { httpAnfrage } from '../quellen/http.ts';
import { HubFehler } from './fehler.ts';

export interface NtfyNachricht {
  titel: string;
  text: string;
  /** 1 (min) bis 5 (max) */
  prioritaet: number;
  tags?: string[];
  klickUrl?: string;
}

export interface NtfyKonfig {
  server: string;
  thema: string;
  token: string;
}

export async function ntfySenden(k: NtfyKonfig, n: NtfyNachricht): Promise<void> {
  if (!k.thema) throw new HubFehler('ntfy Thema fehlt');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (k.token) headers.Authorization = `Bearer ${k.token}`;
  const r = await httpAnfrage(`${k.server}/`, {
    methode: 'POST',
    headers,
    body: JSON.stringify({
      topic: k.thema,
      title: n.titel.slice(0, 200),
      message: n.text.slice(0, 3000),
      priority: Math.min(5, Math.max(1, Math.round(n.prioritaet))),
      tags: n.tags ?? [],
      ...(n.klickUrl ? { click: n.klickUrl } : {}),
    }),
    timeoutMs: 10000,
    abstandMs: 300,
  });
  if (r.status >= 400) throw new HubFehler(`ntfy antwortet mit HTTP ${r.status}`);
}
