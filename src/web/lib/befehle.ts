// Einträge und Suche der Befehlspalette (Ctrl K). Ohne Svelte, damit testbar.

export interface Befehl {
  id: string;
  titel: string;
  /** Zweite Zeile, z.B. Modul oder Ort */
  text?: string;
  gruppe: string;
  symbol: string;
  /** Ziel innerhalb des Hubs */
  link?: string;
  /** Statt Link: Aktion im Browser, z.B. Kiosk */
  aktion?: string;
  /** Zusätzliche Suchwörter */
  woerter?: string;
}

/** Tabs der Module, damit die Palette direkt in einen Tab springen kann. Ein Test hält die Liste aktuell. */
export const MODUL_TABS: Record<string, string[]> = {
  abhaengigkeiten: ['Funde', 'Projekte'],
  abrufe: ['Quellen'],
  aenderungen: ['Änderungen', 'Seiten'],
  auffaelligkeiten: ['Messwerte'],
  content: ['Kalender', 'Checklisten', 'Alle Beiträge'],
  dienste: ['Übersicht', 'Dienste verwalten'],
  drehwetter: ['Drehs'],
  drohne: ['Planung', 'Sonne', 'Orte', 'Kundendrehs', 'Logbuch', 'Akkus und Wartung', 'Dokumente'],
  events: ['Übersicht', 'Neu', 'Vorlagen', 'Alle Daten'],
  parken: ['Übersicht'],
  rettung: ['Lage', 'Chronik', 'Einsätze', 'Rega Statistik', 'Toolbox', 'Kennzeichen', 'Webcams'],
  scont: ['Übersicht', 'Zeit', 'Berichte', 'Seiten', 'Kunden', 'Domains', 'Kosten'],
  selbstheilung: ['Übersicht'],
  sicherheit: ['Übersicht'],
  swissunihockey: ['Einsätze', 'Checkliste Vorlage'],
  teams: ['Teams', 'Einstellungen'],
  unihockey: ['Teams', 'Einstellungen'],
  updates: ['Übersicht'],
  veranstaltungen: ['Anlässe', 'Quellen'],
};

export const SEITEN: Befehl[] = [
  {
    id: 's:/',
    titel: 'Start',
    gruppe: 'Seiten',
    symbol: 'zentrale',
    link: '/',
    woerter: 'startseite briefing home',
  },
  {
    id: 's:/karte',
    titel: 'Karte',
    gruppe: 'Seiten',
    symbol: 'karte',
    link: '/karte',
    woerter: 'ebenen map',
  },
  {
    id: 's:/timeline',
    titel: 'Timeline',
    gruppe: 'Seiten',
    symbol: 'timeline',
    link: '/timeline',
    woerter: 'termine kalender fristen',
  },
  {
    id: 's:/lagebild',
    titel: 'Lagebild',
    text: 'Rettung im Vollbild',
    gruppe: 'Seiten',
    symbol: 'heli',
    link: '/lagebild',
    woerter: 'rega helikopter live',
  },
  {
    id: 's:/alarme',
    titel: 'Alarmzentrale',
    gruppe: 'Seiten',
    symbol: 'alarm',
    link: '/alarme',
    woerter: 'push ntfy regeln ruhezeiten',
  },
  { id: 's:/notizen', titel: 'Notizen', gruppe: 'Seiten', symbol: 'notiz', link: '/notizen' },
  {
    id: 's:/hub-status',
    titel: 'Status',
    text: 'Module und Datenquellen',
    gruppe: 'Seiten',
    symbol: 'status',
    link: '/hub-status',
    woerter: 'quellen ausfall',
  },
  {
    id: 's:/system',
    titel: 'System',
    text: 'Temperatur, RAM, Backup',
    gruppe: 'Seiten',
    symbol: 'system',
    link: '/system',
    woerter: 'pi speicher tailscale',
  },
  {
    id: 's:/einrichtung',
    titel: 'Einrichtung',
    gruppe: 'Seiten',
    symbol: 'einstellungen',
    link: '/einrichtung',
    woerter: 'einstellungen setup',
  },
];

export const AKTIONEN: Befehl[] = [
  {
    id: 'a:kiosk',
    titel: 'Kiosk Modus',
    text: 'Vollbild ohne Navigation, Esc beendet',
    gruppe: 'Aktionen',
    symbol: 'kiosk',
    aktion: 'kiosk',
  },
  {
    id: 'a:fokus',
    titel: 'Fokusmodus umschalten',
    text: 'Nur was Aufmerksamkeit braucht',
    gruppe: 'Aktionen',
    symbol: 'fokus',
    aktion: 'fokus',
  },
  {
    id: 'a:lagebild',
    titel: 'Lagebild als Kiosk öffnen',
    gruppe: 'Aktionen',
    symbol: 'heli',
    link: '/lagebild?kiosk=1',
    woerter: 'rega bildschirm',
  },
  { id: 'a:abmelden', titel: 'Abmelden', gruppe: 'Aktionen', symbol: 'abmelden', aktion: 'abmelden' },
];

export function modulBefehle(
  module: { id: string; name: string; symbol: string; aktiv: boolean }[],
): Befehl[] {
  return module.flatMap((m) => {
    const haupt: Befehl = {
      id: `m:${m.id}`,
      titel: m.name,
      text: m.aktiv ? 'Modul' : 'Modul, ausgeschaltet',
      gruppe: 'Module',
      symbol: m.symbol,
      link: `/modul/${m.id}`,
    };
    const tabs = (MODUL_TABS[m.id] ?? []).slice(1).map(
      (t): Befehl => ({
        id: `t:${m.id}:${t}`,
        titel: t,
        text: m.name,
        gruppe: 'Tabs',
        symbol: m.symbol,
        link: `/modul/${m.id}#tab=${encodeURIComponent(t)}`,
        woerter: m.name,
      }),
    );
    return [haupt, ...tabs];
  });
}

/** Klein, ohne Akzente, ä bleibt als a gleich wie ae */
export function normalisieren(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Bewertung: 0 = kein Treffer. Jedes Wort der Eingabe muss vorkommen. Treffer am Anfang des Titels
 * oder eines Wortes zählen mehr, Module vor Tabs.
 */
export function bewerten(b: Befehl, eingabe: string): number {
  const q = normalisieren(eingabe);
  if (!q) return 1;
  const titel = normalisieren(b.titel);
  const alles = `${titel} ${normalisieren(b.text ?? '')} ${normalisieren(b.woerter ?? '')}`;
  let punkte = 0;
  for (const w of q.split(' ')) {
    if (!alles.includes(w)) return 0;
    if (titel.startsWith(w)) punkte += 10;
    else if (titel.includes(` ${w}`)) punkte += 6;
    else if (titel.includes(w)) punkte += 4;
    else punkte += 1;
  }
  if (titel === q) punkte += 20;
  const rang: Record<string, number> = { Module: 3, Seiten: 3, Helikopter: 2, Tabs: 1, Aktionen: 1 };
  return punkte + (rang[b.gruppe] ?? 0);
}

export function filtern(befehle: Befehl[], eingabe: string, max = 30): Befehl[] {
  return befehle
    .map((b, i) => ({ b, p: bewerten(b, eingabe), i }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .slice(0, max)
    .map((x) => x.b);
}
