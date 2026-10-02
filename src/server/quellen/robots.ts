// robots.txt beachten: vor dem Abruf öffentlicher Webquellen prüfen, ob der Pfad erlaubt ist.
import { httpAnfrage } from './http.ts';

interface Regeln {
  erlaubt: string[];
  verboten: string[];
  zeit: number;
}

const cache = new Map<string, Regeln>();

/** Wertet robots.txt für unseren User-Agent (oder *) aus. Längste passende Regel gewinnt. */
export function robotsAuswerten(text: string, agent = 'pihub'): { erlaubt: string[]; verboten: string[] } {
  const gruppen: { agents: string[]; erlaubt: string[]; verboten: string[] }[] = [];
  let aktuell: (typeof gruppen)[number] | null = null;
  let letzteWarAgent = false;
  for (const roh of text.split(/\r?\n/)) {
    const zeile = roh.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(zeile);
    if (!m) continue;
    const feld = m[1].toLowerCase();
    const wert = m[2].trim();
    if (feld === 'user-agent') {
      if (!aktuell || !letzteWarAgent) {
        aktuell = { agents: [], erlaubt: [], verboten: [] };
        gruppen.push(aktuell);
      }
      aktuell.agents.push(wert.toLowerCase());
      letzteWarAgent = true;
      continue;
    }
    letzteWarAgent = false;
    if (!aktuell) continue;
    if (feld === 'allow' && wert) aktuell.erlaubt.push(wert);
    if (feld === 'disallow' && wert) aktuell.verboten.push(wert);
  }
  const eigene = gruppen.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  const passend = eigene.length ? eigene : gruppen.filter((g) => g.agents.includes('*'));
  return { erlaubt: passend.flatMap((g) => g.erlaubt), verboten: passend.flatMap((g) => g.verboten) };
}

function passt(muster: string, pfad: string): number {
  // Unterstützt * und $ wie Google
  const re = new RegExp(
    `^${muster
      .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\\\$$/, '$')}`,
  );
  return re.test(pfad) ? muster.length : -1;
}

export function pfadErlaubt(r: { erlaubt: string[]; verboten: string[] }, pfad: string): boolean {
  const a = Math.max(-1, ...r.erlaubt.map((m) => passt(m, pfad)));
  const v = Math.max(-1, ...r.verboten.map((m) => passt(m, pfad)));
  return v < 0 || a >= v;
}

export async function robotsErlaubt(url: string): Promise<boolean> {
  const u = new URL(url);
  let r = cache.get(u.origin);
  if (!r || Date.now() - r.zeit > 24 * 3600000) {
    try {
      const a = await httpAnfrage(`${u.origin}/robots.txt`, { timeoutMs: 8000 });
      // Keine robots.txt (404) heisst: alles erlaubt. Serverfehler: vorsichtig sein.
      const regeln =
        a.status === 200
          ? robotsAuswerten(a.text)
          : a.status >= 500
            ? { erlaubt: [], verboten: ['/'] }
            : { erlaubt: [], verboten: [] };
      r = { ...regeln, zeit: Date.now() };
    } catch {
      r = { erlaubt: [], verboten: ['/'], zeit: Date.now() - 23 * 3600000 };
    }
    cache.set(u.origin, r);
  }
  return pfadErlaubt(r, u.pathname + u.search);
}
