// Spielberichte nach Spielende: Torfolge, Skorer und ein Textentwurf aus den öffentlichen Spieldaten.
// Der Entwurf ist nur ein Vorschlag zum Kopieren. Das Modul postet nichts.
import type { Spiel, SpielEreignisse } from '../../quellen/swissunihockey.ts';
import { type Skorer, skorer } from '../unihockey/gegner.ts';

export interface Tor {
  zeit: string;
  seite: 'heim' | 'gast';
  stand: string;
  spieler: string | null;
  assist: string | null;
}

export interface SpielBericht {
  id: string;
  liga: string | null;
  heim: string;
  gast: string;
  resultat: string | null;
  zusatz: string | null;
  tore: Tor[];
  skorerHeim: Skorer[];
  skorerGast: Skorer[];
  /** Tor, das den Sieg entschieden hat */
  siegtreffer: Tor | null;
  /** Grösster Rückstand des Siegers während des Spiels */
  rueckstandSieger: number;
  /** Ereignisse fehlen (Quelle nicht erreichbar oder keine Daten) */
  ohneEreignisse: boolean;
}

function zahlen(resultat: string | null): [number, number] | null {
  const m = resultat ? /^(\d+)\s*:\s*(\d+)/.exec(resultat) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function spielBericht(s: Spiel, e: SpielEreignisse | null): SpielBericht {
  const tore: Tor[] = [];
  let h = 0;
  let g = 0;
  for (const x of e?.ereignisse ?? []) {
    if (x.typ !== 'tor' || (x.seite !== 'heim' && x.seite !== 'gast')) continue;
    if (x.seite === 'heim') h++;
    else g++;
    tore.push({ zeit: x.zeit, seite: x.seite, stand: `${h}:${g}`, spieler: x.spieler, assist: x.assist });
  }
  const r = zahlen(s.resultat);
  let siegtreffer: Tor | null = null;
  let rueckstandSieger = 0;
  if (r && r[0] !== r[1]) {
    const sieger = r[0] > r[1] ? 'heim' : 'gast';
    const verlierTore = sieger === 'heim' ? r[1] : r[0];
    let a = 0;
    let b = 0;
    for (const t of tore) {
      if (t.seite === 'heim') a++;
      else b++;
      const [fuer, gegen] = sieger === 'heim' ? [a, b] : [b, a];
      rueckstandSieger = Math.max(rueckstandSieger, gegen - fuer);
      if (!siegtreffer && t.seite === sieger && fuer === verlierTore + 1) siegtreffer = t;
    }
  }
  const mit = e ? [e] : [];
  return {
    id: s.id,
    liga: s.liga,
    heim: s.heim,
    gast: s.gast,
    resultat: s.resultat,
    zusatz: s.zusatz,
    tore,
    skorerHeim: skorer(mit.map((x) => ({ ereignisse: x, seite: 'heim' as const }))),
    skorerGast: skorer(mit.map((x) => ({ ereignisse: x, seite: 'gast' as const }))),
    siegtreffer,
    rueckstandSieger,
    ohneEreignisse: !e || !tore.length,
  };
}

const mehrzahl = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;
const minute = (zeit: string) => {
  const m = /^(\d+):/.exec(zeit);
  return m ? `${Number(m[1]) + 1}. Minute` : null;
};

/** Torschützen einer Seite, z.B. «A. Muster 2, B. Beispiel» */
export function torschuetzen(liste: Skorer[]): string {
  return liste
    .filter((s) => s.tore > 0)
    .sort((a, b) => b.tore - a.tore || a.name.localeCompare(b.name))
    .map((s) => (s.tore > 1 ? `${s.name} ${s.tore}` : s.name))
    .join(', ');
}

/** Eine Zeile pro Spiel, für den Resultatpost und die Push Meldung */
export function resultatZeile(b: SpielBericht): string {
  const zusatz = b.zusatz ? ` ${b.zusatz}` : '';
  return `${b.heim} gegen ${b.gast} ${b.resultat ?? 'offen'}${zusatz}`;
}

/** Sachlicher Absatz zu einem Spiel, nur aus den Daten, nichts dazu erfunden */
export function berichtAbsatz(b: SpielBericht): string {
  const r = zahlen(b.resultat);
  if (!r) return `${b.heim} gegen ${b.gast}: noch kein Resultat.`;
  // Ein Tor nach der 60. Minute heisst Verlängerung, sofern die Quelle keinen Zusatz liefert
  const verlaengerung = b.tore.some((t) => /^(\d+):/.exec(t.zeit) && Number(t.zeit.split(':')[0]) >= 60);
  const zusatz = b.zusatz ? ` ${b.zusatz}` : verlaengerung ? ' nach Verlängerung' : '';
  const saetze: string[] = [];
  if (r[0] > r[1]) saetze.push(`${b.heim} gewinnt zu Hause gegen ${b.gast} mit ${r[0]}:${r[1]}${zusatz}.`);
  else if (r[1] > r[0]) saetze.push(`${b.gast} gewinnt auswärts bei ${b.heim} mit ${r[1]}:${r[0]}${zusatz}.`);
  else saetze.push(`${b.heim} und ${b.gast} trennen sich ${r[0]}:${r[1]}${zusatz}.`);
  const sieger = r[0] > r[1] ? b.heim : r[1] > r[0] ? b.gast : null;
  if (sieger && b.rueckstandSieger > 0)
    saetze.push(
      `${sieger} lag zwischenzeitlich mit ${mehrzahl(b.rueckstandSieger, 'Tor', 'Toren')} im Rückstand und drehte das Spiel.`,
    );
  if (b.siegtreffer?.spieler) {
    const min = minute(b.siegtreffer.zeit);
    saetze.push(
      `Den entscheidenden Treffer zum ${b.siegtreffer.stand} erzielte ${b.siegtreffer.spieler}${min ? ` in der ${min}` : ''}.`,
    );
  }
  for (const [team, liste] of [
    [b.heim, b.skorerHeim],
    [b.gast, b.skorerGast],
  ] as const) {
    // Nur nennen, wenn der Beste allein vorne liegt
    const [top, zweiter] = liste;
    if (top && top.punkte >= 2 && (!zweiter || zweiter.punkte < top.punkte))
      saetze.push(
        `Bester Skorer bei ${team} war ${top.name} mit ${[top.tore ? mehrzahl(top.tore, 'Tor', 'Toren') : null, top.assists ? mehrzahl(top.assists, 'Assist', 'Assists') : null].filter(Boolean).join(' und ')}.`,
      );
  }
  const th = torschuetzen(b.skorerHeim);
  const tg = torschuetzen(b.skorerGast);
  if (th || tg) saetze.push(`Tore ${b.heim}: ${th || 'keine'}. Tore ${b.gast}: ${tg || 'keine'}.`);
  return saetze.join(' ');
}

/** Entwurf für den Einsatz: Resultatliste und Absätze pro Spiel, nach Liga gruppiert */
export function entwurf(berichte: SpielBericht[]): { resultate: string; bericht: string } {
  const ligen = [...new Set(berichte.map((b) => b.liga ?? ''))];
  const gruppiert = (f: (b: SpielBericht) => string, trenner: string) =>
    ligen
      .map((l) => {
        const teile = berichte.filter((b) => (b.liga ?? '') === l).map(f);
        return l ? `${l}\n${teile.join(trenner)}` : teile.join(trenner);
      })
      .join('\n\n');
  return { resultate: gruppiert(resultatZeile, '\n'), bericht: gruppiert(berichtAbsatz, '\n\n') };
}

/** Kurzer Push Text: Resultat und Torschützen pro Spiel */
export function pushText(berichte: SpielBericht[], max = 900): string {
  const zeilen = berichte.map((b) => {
    const ts = [torschuetzen(b.skorerHeim), torschuetzen(b.skorerGast)].filter(Boolean);
    return `${resultatZeile(b)}${ts.length ? `\nTore: ${ts.join(' / ')}` : ''}`;
  });
  const text = zeilen.join('\n');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
