// Demo Spielplan und Rangliste (erfundene Gegner).
import type { Rangliste, Spiel } from '../../quellen/swissunihockey.ts';

const GEGNER = [
  'UHC Demo Nord',
  'Floorball Demo',
  'UH Beispiel',
  'Unihockey Muster',
  'UHC Test Ost',
  'Demo Tigers',
];

export function demoTeamSpiele(team: string, jetzt: Date): { titel: string; spiele: Spiel[] } {
  const name = team.replace(/\s*\(.*\)$/, '');
  const spiele: Spiel[] = [];
  for (let i = -4; i < 6; i++) {
    const d = new Date(jetzt.getTime() + (i * 7 + 1) * 86400000);
    d.setUTCHours(14 + (i % 2), 0, 0, 0);
    const heim = i % 2 === 0;
    const gegner = GEGNER[(i + 6) % GEGNER.length];
    const vorbei = d.getTime() < jetzt.getTime();
    spiele.push({
      id: `demo-${name}-${i}`,
      zeit: d.toISOString(),
      datumText: d.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' }),
      zeitText: d.toLocaleTimeString('de-CH', {
        timeZone: 'Europe/Zurich',
        hour: '2-digit',
        minute: '2-digit',
      }),
      heim: heim ? name : gegner,
      gast: heim ? gegner : name,
      resultat: vorbei ? `${(i * 7 + 11) % 9}:${(i * 5 + 13) % 8}` : null,
      zusatz: null,
      ort: heim ? 'Sporthalle Demo' : 'Halle Gegner (Demo)',
      lat: null,
      lon: null,
      status: null,
      beendet: vorbei,
      liga: null,
    });
  }
  return { titel: `Spielübersicht ${name} (Demo)`, spiele };
}

export function demoRangliste(team: string): Rangliste {
  const name = team.replace(/\s*\(.*\)$/, '');
  const teams = [...GEGNER.slice(0, 3), name, ...GEGNER.slice(3)];
  return {
    titel: 'Rangliste (Demo)',
    zeilen: teams.map((t, i) => ({
      rang: i + 1,
      team: t,
      spiele: 6,
      punkte: 16 - i * 2,
      tore: `${30 - i * 3}:${12 + i * 2}`,
      hervorgehoben: t === name,
    })),
  };
}
