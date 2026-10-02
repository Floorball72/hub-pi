// Lesen und Schreiben der .env Datei, ohne Kommentare oder Reihenfolge zu verlieren.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function parseEnv(text: string): Record<string, string> {
  const werte: Record<string, string> = {};
  for (const zeile of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(zeile);
    if (!m) continue;
    let wert = m[2];
    if ((wert.startsWith('"') && wert.endsWith('"')) || (wert.startsWith("'") && wert.endsWith("'"))) {
      wert = wert.slice(1, -1);
    }
    werte[m[1]] = wert;
  }
  return werte;
}

function maskieren(wert: string): string {
  // Werte mit Leerzeichen, # oder Anführungszeichen werden in doppelte Anführungszeichen gesetzt
  if (/[\s#"'$`\\]/.test(wert)) return `"${wert.replace(/["\\$`]/g, '')}"`;
  return wert;
}

/** Setzt Werte in einer .env Datei. Bestehende Zeilen werden ersetzt, neue angehängt. */
export function envSchreiben(pfad: string, neu: Record<string, string>): void {
  const text = existsSync(pfad) ? readFileSync(pfad, 'utf8') : '';
  const offen = new Map(Object.entries(neu));
  const zeilen = text.split(/\r?\n/).map((zeile) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(zeile);
    if (m && offen.has(m[1])) {
      const wert = offen.get(m[1])!;
      offen.delete(m[1]);
      return `${m[1]}=${maskieren(wert)}`;
    }
    return zeile;
  });
  while (zeilen.length && zeilen[zeilen.length - 1] === '') zeilen.pop();
  for (const [k, v] of offen) zeilen.push(`${k}=${maskieren(v)}`);
  // Direkt schreiben: der Dienst darf nur die Datei selbst ändern, nicht den Ordner (systemd Härtung)
  writeFileSync(pfad, `${zeilen.join('\n')}\n`, { mode: 0o600 });
}

export function envLesen(pfad: string): Record<string, string> {
  return existsSync(pfad) ? parseEnv(readFileSync(pfad, 'utf8')) : {};
}
