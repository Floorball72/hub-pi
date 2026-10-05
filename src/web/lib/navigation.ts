// Überkategorien der Seitenleiste. Module ohne Zuordnung landen unter «Weitere».
import type { ModulInfo } from '../../server/geteilt/typen.ts';

export interface NavSeite {
  pfad: string;
  name: string;
  symbol: string;
  aus?: boolean;
}

export interface NavGruppe {
  id: string;
  name: string;
  seiten: NavSeite[];
}

const GRUPPEN: { id: string; name: string; module: string[] }[] = [
  { id: 'rettung', name: 'Rettung', module: ['rettung'] },
  { id: 'alltag', name: 'Alltag', module: ['aufgaben', 'smarthome', 'wetter', 'mobilitaet', 'parken'] },
  { id: 'sport', name: 'Sport', module: ['swissunihockey', 'unihockey', 'analyse', 'teams'] },
  { id: 'drohne', name: 'Drohne', module: ['drohne'] },
  { id: 'hub', name: 'Hub', module: ['auffaelligkeiten', 'abrufe', 'selbstheilung', 'updates'] },
  // Selten gebraucht, standardmässig zugeklappt
  {
    id: 'selten',
    name: 'Wenig genutzt',
    module: [
      'scont',
      'aenderungen',
      'sicherheit',
      'abhaengigkeiten',
      'dienste',
      'drehwetter',
      'content',
      'events',
      'veranstaltungen',
    ],
  },
];

/** Gruppen, die beim ersten Besuch zugeklappt sind */
export const STANDARD_ZU = ['selten', 'aus'];

const HUB_SEITEN: NavSeite[] = [
  { pfad: '/alarme', name: 'Alarmzentrale', symbol: 'alarm' },
  { pfad: '/notizen', name: 'Notizen', symbol: 'notiz' },
  { pfad: '/hub-status', name: 'Status', symbol: 'status' },
  { pfad: '/system', name: 'System', symbol: 'system' },
];
const EINRICHTUNG: NavSeite = { pfad: '/einrichtung', name: 'Einrichtung', symbol: 'einstellungen' };

function seite(m: ModulInfo): NavSeite {
  return { pfad: `/modul/${m.id}`, name: m.name, symbol: m.symbol, aus: !m.aktiv };
}

export function gruppieren(module: ModulInfo[]): NavGruppe[] {
  const zugeordnet = new Set(GRUPPEN.flatMap((g) => g.module));
  const nachId = new Map(module.map((m) => [m.id, m]));
  // Ausgeschaltete Module wandern in eine eigene Gruppe ganz unten
  const aus = module.filter((m) => m.id !== 'zentrale' && !m.aktiv).map(seite);
  const gruppen: NavGruppe[] = GRUPPEN.map((g) => ({
    id: g.id,
    name: g.name,
    seiten: g.module.flatMap((id) => {
      const m = nachId.get(id);
      return m?.aktiv ? [seite(m)] : [];
    }),
  }));
  const rest = module.filter((m) => m.id !== 'zentrale' && m.aktiv && !zugeordnet.has(m.id)).map(seite);
  // Neue Module ohne Zuordnung vor «Hub»
  const hubIndex = gruppen.findIndex((g) => g.id === 'hub');
  if (rest.length) gruppen.splice(hubIndex, 0, { id: 'weitere', name: 'Weitere', seiten: rest });
  const hub = gruppen.find((g) => g.id === 'hub');
  if (hub) hub.seiten = [...HUB_SEITEN, ...hub.seiten, EINRICHTUNG];
  if (aus.length) gruppen.push({ id: 'aus', name: 'Ausgeschaltet', seiten: aus });
  return gruppen.filter((g) => g.seiten.length);
}
