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
  { id: 'alltag', name: 'Alltag', module: ['wetter', 'mobilitaet', 'parken', 'veranstaltungen'] },
  { id: 'rettung', name: 'Rettung', module: ['rettung'] },
  {
    id: 'scont',
    name: 'scont',
    module: ['scont', 'aenderungen', 'sicherheit', 'abhaengigkeiten', 'dienste'],
  },
  { id: 'drohne', name: 'Drohne und Content', module: ['drohne', 'drehwetter', 'content', 'events'] },
  { id: 'sport', name: 'Sport', module: ['swissunihockey', 'unihockey', 'teams'] },
  { id: 'hub', name: 'Hub', module: ['auffaelligkeiten', 'abrufe', 'selbstheilung', 'updates'] },
];

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
  const gruppen: NavGruppe[] = GRUPPEN.map((g) => ({
    id: g.id,
    name: g.name,
    seiten: g.module.flatMap((id) => {
      const m = nachId.get(id);
      return m ? [seite(m)] : [];
    }),
  }));
  const rest = module.filter((m) => m.id !== 'zentrale' && !zugeordnet.has(m.id)).map(seite);
  if (rest.length) gruppen.splice(gruppen.length - 1, 0, { id: 'weitere', name: 'Weitere', seiten: rest });
  const hub = gruppen.find((g) => g.id === 'hub');
  if (hub) hub.seiten = [...HUB_SEITEN, ...hub.seiten, EINRICHTUNG];
  return gruppen.filter((g) => g.seiten.length);
}
