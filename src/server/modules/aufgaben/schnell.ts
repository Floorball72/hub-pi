// Schnellerfassung: eine Zeile wie «Rechnung zahlen morgen 18:00 #scont !» wird zu einer Aufgabe.
import { plusTage, type Rhythmus, wochentag } from './wiederholung.ts';

export interface Erfasst {
  titel: string;
  faellig: string | null;
  uhrzeit: string | null;
  liste: string | null;
  prioritaet: 'normal' | 'hoch';
  rhythmus: Rhythmus;
}

const WOCHENTAGE: Record<string, number> = {
  so: 0,
  sonntag: 0,
  mo: 1,
  montag: 1,
  di: 2,
  dienstag: 2,
  mi: 3,
  mittwoch: 3,
  do: 4,
  donnerstag: 4,
  fr: 5,
  freitag: 5,
  sa: 6,
  samstag: 6,
};

const RHYTHMUS_WORTE: [RegExp, Rhythmus][] = [
  [/\b(täglich|taeglich|jeden tag)\b/i, 'taeglich'],
  [/\b(alle (2|zwei) wochen|zweiwöchentlich)\b/i, 'zweiwoechentlich'],
  [/\b(wöchentlich|woechentlich|jede woche)\b/i, 'woechentlich'],
  [/\b(monatlich|jeden monat)\b/i, 'monatlich'],
  [/\b(jährlich|jaehrlich|jedes jahr)\b/i, 'jaehrlich'],
];

export function schnellErfassen(eingabe: string, heute: string): Erfasst {
  let t = ` ${eingabe.trim()} `;
  const weg = (re: RegExp) => {
    t = t.replace(re, ' ');
  };
  let faellig: string | null = null;
  let uhrzeit: string | null = null;
  let liste: string | null = null;
  let prioritaet: 'normal' | 'hoch' = 'normal';
  let rhythmus: Rhythmus = 'einmalig';

  // #liste
  const l = t.match(/\s#([\p{L}\d_-]{1,30})(?=\s)/u);
  if (l) {
    liste = l[1];
    weg(new RegExp(`\\s#${l[1]}(?=\\s)`, 'u'));
  }
  // ! oder !! am Wort Ende für hohe Priorität
  if (/\s!{1,3}(?=\s)/.test(t)) {
    prioritaet = 'hoch';
    weg(/\s!{1,3}(?=\s)/);
  }
  for (const [re, r] of RHYTHMUS_WORTE) {
    if (re.test(t)) {
      rhythmus = r;
      weg(re);
      break;
    }
  }
  // Uhrzeit: «um 14:00», «14:00», «14.30 Uhr»
  const u = t.match(/\s(?:um\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*uhr)?(?=\s)/i);
  if (u) {
    uhrzeit = `${u[1].padStart(2, '0')}:${u[2]}`;
    weg(/\s(?:um\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*uhr)?(?=\s)/i);
  }
  // Datum: heute, morgen, übermorgen
  const rel = t.match(/\s(heute|morgen|übermorgen|uebermorgen)(?=\s)/i);
  if (rel) {
    const w = rel[1].toLowerCase();
    faellig = plusTage(heute, w === 'heute' ? 0 : w === 'morgen' ? 1 : 2);
    weg(new RegExp(`\\s${rel[1]}(?=\\s)`, 'i'));
  }
  // Datum: 12.10. oder 12.10.2026 oder 12.10.26
  const d = t.match(/\s(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?=\s)/);
  if (!faellig && d) {
    const tag = Number(d[1]);
    const monat = Number(d[2]);
    if (tag >= 1 && tag <= 31 && monat >= 1 && monat <= 12) {
      let jahr = d[3] ? Number(d[3]) : Number(heute.slice(0, 4));
      if (jahr < 100) jahr += 2000;
      let kandidat = `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
      // Ohne Jahr: liegt das Datum schon zurück, ist das nächste Jahr gemeint
      if (!d[3] && kandidat < heute) kandidat = `${jahr + 1}${kandidat.slice(4)}`;
      faellig = kandidat;
      weg(/\s(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?=\s)/);
    }
  }
  // Wochentag: «am Freitag», «fr»: nächster solcher Tag, heute zählt nicht. «so» nur ausgeschrieben, sonst trifft es das Wort «so».
  if (!faellig) {
    const w = t.match(
      /\s(?:am\s+|bis\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa)(?=\s)/i,
    );
    if (w) {
      const ziel = WOCHENTAGE[w[1].toLowerCase()];
      const diff = (ziel - wochentag(heute) + 7) % 7 || 7;
      faellig = plusTage(heute, diff);
      weg(new RegExp(`\\s(?:am\\s+|bis\\s+)?${w[1]}(?=\\s)`, 'i'));
    }
  }
  // Uhrzeit ohne Datum heisst heute
  if (uhrzeit && !faellig) faellig = heute;
  // Wiederholung ohne Datum startet heute
  if (rhythmus !== 'einmalig' && !faellig) faellig = heute;
  const titel = t.replace(/\s+/g, ' ').trim() || eingabe.trim();
  return { titel: titel.slice(0, 200), faellig, uhrzeit, liste, prioritaet, rhythmus };
}
