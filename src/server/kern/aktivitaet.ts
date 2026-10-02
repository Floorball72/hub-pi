// Aktivitätslog: was der Hub wann getan hat.
import { tabelle } from '../daten/schema.ts';

export const AKTIVITAET_TABELLE = tabelle({
  name: 'aktivitaet',
  modul: 'kern',
  label: 'Aktivitätslog',
  spalten: [
    { name: 'modul', typ: 'text' },
    { name: 'art', typ: 'text' },
    { name: 'text', typ: 'text' },
  ],
  indizes: [['erstellt']],
});

/** Entfernt Geheimnisse aus Texten, bevor sie gespeichert oder geloggt werden. */
export function schwaerzen(text: string, geheim: string[] = []): string {
  let t = text;
  for (const g of geheim) if (g) t = t.split(g).join('***');
  // URLs mit Zugangsdaten (user:pass@host) und Tokens in Query Strings
  t = t.replace(/(\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@');
  t = t.replace(/([?&](?:key|token|apikey|api_key|secret|password|passwort)=)[^&\s]+/gi, '$1***');
  return t;
}
