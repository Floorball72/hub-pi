// API Client: alle Anfragen ans Backend. Schreibende Anfragen tragen den CSRF Header.
import { navigieren } from './router.svelte.ts';

export class ApiFehler extends Error {
  status: number;
  constructor(meldung: string, status: number) {
    super(meldung);
    this.status = status;
  }
}

async function anfrage<T>(methode: string, pfad: string, body?: unknown): Promise<T> {
  const r = await fetch(pfad, {
    method: methode,
    credentials: 'same-origin',
    headers: {
      'x-pihub': '1',
      // Hintergrund Aktualisierungen zählen nicht als Nutzung (Abrufplaner)
      ...(document.hidden ? { 'x-pihub-sichtbar': '0' } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && !pfad.startsWith('/api/login')) {
    navigieren(`/login?weiter=${encodeURIComponent(location.pathname + location.search)}`);
    throw new ApiFehler('Bitte anmelden', 401);
  }
  const text = await r.text();
  let daten: unknown = null;
  try {
    daten = text ? JSON.parse(text) : null;
  } catch {
    daten = { fehler: text };
  }
  if (!r.ok) throw new ApiFehler((daten as { fehler?: string })?.fehler ?? `Fehler ${r.status}`, r.status);
  return daten as T;
}

export const api = {
  get: <T>(pfad: string) => anfrage<T>('GET', pfad),
  post: <T>(pfad: string, body: unknown = {}) => anfrage<T>('POST', pfad, body),
  put: <T>(pfad: string, body: unknown) => anfrage<T>('PUT', pfad, body),
  del: <T>(pfad: string) => anfrage<T>('DELETE', pfad),
};

export function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
