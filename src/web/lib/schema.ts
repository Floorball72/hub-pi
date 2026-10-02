// Schema der bearbeitbaren Tabellen (einmal geladen).
import type { TabellenInfo } from '../../server/geteilt/typen.ts';
import { api } from './api.ts';

let cache: Promise<TabellenInfo[]> | null = null;

export function schemaLaden(): Promise<TabellenInfo[]> {
  cache ??= api.get<TabellenInfo[]>('/api/schema').catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

export async function tabellenInfo(name: string): Promise<TabellenInfo> {
  const t = (await schemaLaden()).find((x) => x.name === name);
  if (!t) throw new Error(`Tabelle ${name} nicht verfügbar`);
  return t;
}
