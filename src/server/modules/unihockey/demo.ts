// Demo Spielplan und Rangliste (erfundene Gegner).
import type { Rangliste, Spiel, SpielEreignis, SpielEreignisse } from '../../quellen/swissunihockey.ts';

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
    const andere = GEGNER.filter((g) => g !== name);
    const gegner = andere[(i + 6) % andere.length];
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
      resultat: vorbei ? `${(((i * 7 + 11) % 9) + 9) % 9}:${(((i * 5 + 13) % 8) + 8) % 8}` : null,
      zusatz: null,
      ort: heim ? 'Sporthalle Demo' : 'Halle Gegner (Demo)',
      lat: null,
      lon: null,
      status: null,
      beendet: vorbei,
      liga: null,
      eigen: heim ? 'heim' : 'gast',
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
      teamId: `demo-${i}`,
    })),
  };
}

// Erfundene Kürzel, keine echten Personen
const DEMO_NAMEN = ['A. Muster', 'B. Beispiel', 'C. Demo', 'D. Test', 'E. Probe', 'F. Vorlage', 'G. Entwurf'];

/** Spielereignisse passend zum Resultat, gleichbleibend pro Spiel */
export function demoSpielEreignisse(
  spielId: string,
  heim: string,
  gast: string,
  resultat: string | null,
): SpielEreignisse {
  const m = resultat ? /^(\d+):(\d+)/.exec(resultat) : null;
  let h = m ? Number(m[1]) : 0;
  let g = m ? Number(m[2]) : 0;
  let saat = [...spielId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const zufall = () => {
    saat = (Math.imul(saat, 1103515245) + 12345) >>> 0;
    return saat / 2 ** 32;
  };
  // Die ersten Namen treffen öfter
  const name = () => DEMO_NAMEN[Math.floor(zufall() ** 1.8 * DEMO_NAMEN.length)];
  const ereignisse: SpielEreignis[] = [];
  const n = h + g;
  let stand = [0, 0];
  for (let i = 0; i < n; i++) {
    const heimTor = h > 0 && (g === 0 || zufall() < h / (h + g));
    if (heimTor) h--;
    else g--;
    stand = heimTor ? [stand[0] + 1, stand[1]] : [stand[0], stand[1] + 1];
    const minute = Math.floor(((i + zufall()) / n) * 60);
    const schuetze = name();
    const assist = zufall() < 0.7 ? name() : null;
    ereignisse.push({
      zeit: `${String(minute).padStart(2, '0')}:${String(Math.floor(zufall() * 60)).padStart(2, '0')}`,
      typ: 'tor',
      text: `Torschütze ${stand[0]}:${stand[1]}`,
      seite: heimTor ? 'heim' : 'gast',
      spieler: schuetze,
      assist: assist !== schuetze ? assist : null,
      minuten: null,
    });
  }
  if (zufall() < 0.6)
    ereignisse.push({
      zeit: '31:12',
      typ: 'strafe',
      text: "2'-Strafe (Stockschlag)",
      seite: zufall() < 0.5 ? 'heim' : 'gast',
      spieler: name(),
      assist: null,
      minuten: 2,
    });
  ereignisse.sort((a, b) => a.zeit.localeCompare(b.zeit));
  return { heim, gast, ereignisse };
}
