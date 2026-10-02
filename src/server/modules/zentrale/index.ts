// Zentrale: Systemstatus, Schnellnotizen, Morgenbriefing und Timeline Rahmen.
import { tabelle } from '../../daten/schema.ts';
import type { ModulDef } from '../../kern/modul.ts';
import { systemStatus } from '../../kern/system.ts';
import type { Ampel, Kachel } from '../../geteilt/typen.ts';

export const NOTIZEN = tabelle({
  name: 'notizen',
  modul: 'zentrale',
  label: 'Schnellnotizen',
  bearbeitbar: true,
  anzeige: 'text',
  suche: ['text'],
  spalten: [
    { name: 'text', typ: 'text', label: 'Notiz', pflicht: true, lang: true },
    {
      name: 'bezug_typ',
      typ: 'text',
      label: 'Bezug',
      optionen: ['allgemein', 'ort', 'kunde', 'einsatz', 'dreh'],
      standard: 'allgemein',
    },
    { name: 'bezug_id', typ: 'text', label: 'Bezug id', intern: true },
    { name: 'bezug_name', typ: 'text', label: 'Bezug Name' },
    { name: 'angeheftet', typ: 'bool', label: 'Angeheftet', standard: false },
  ],
  indizes: [['bezug_typ', 'bezug_id']],
});

export const zentrale: ModulDef = {
  id: 'zentrale',
  name: 'Zentrale',
  beschreibung: 'Systemstatus, Notizen, Briefing und Timeline',
  symbol: 'zentrale',
  reihenfolge: 0,
  pflicht: true,
  tabellen: [NOTIZEN],
  regeln: [
    {
      id: 'temperatur',
      name: 'Pi zu heiss',
      beschreibung: 'Meldet, wenn die CPU Temperatur die Schwelle überschreitet',
      schwelle: 75,
      schwelleLabel: '°C',
      prioritaet: 4,
      cooldownMin: 180,
    },
    {
      id: 'speicher',
      name: 'Speicher knapp',
      beschreibung: 'Meldet, wenn auf der SD Karte weniger Platz frei ist als die Schwelle',
      schwelle: 2,
      schwelleLabel: 'GB frei',
      prioritaet: 3,
      cooldownMin: 720,
    },
  ],
  erstellen(ctx) {
    return {
      jobs: [
        {
          id: 'systemwache',
          name: 'Systemwerte prüfen',
          intervallSek: 300,
          startVerzoegerungSek: 30,
          lauf: async () => {
            const s = await systemStatus(ctx.konfig.datenVerzeichnis);
            // Auffälligkeiten: Systemwerte melden
            await ctx.metrik({
              id: 'zentrale.ram',
              name: 'RAM des Hubs',
              einheit: 'MB',
              richtung: 'hoch',
              minAbweichung: 40,
              minDauerMin: 30,
            })(s.prozessRssMb);
            await ctx.metrik({
              id: 'zentrale.temperatur',
              name: 'CPU Temperatur',
              einheit: '°C',
              richtung: 'hoch',
              minAbweichung: 8,
            })(s.temperaturC);
            if (s.temperaturC !== null) {
              await ctx.alarm.melden({
                regel: 'zentrale.temperatur',
                titel: 'Pi Hub: Temperatur hoch',
                text: `CPU Temperatur ${s.temperaturC} °C`,
                wert: s.temperaturC,
                schluessel: 'temperatur',
              });
            }
            if (s.speicherFreiGb !== null) {
              await ctx.alarm.melden({
                regel: 'zentrale.speicher',
                titel: 'Pi Hub: Speicher knapp',
                text: `Nur noch ${s.speicherFreiGb} GB frei`,
                wert: s.speicherFreiGb,
                richtung: 'unter',
                schluessel: 'speicher',
              });
            }
            return `${s.temperaturC ?? '?'} °C, ${s.ramVerfuegbarMb} MB RAM frei`;
          },
        },
      ],
      kachel: async (): Promise<Kachel> => {
        const s = await systemStatus(ctx.konfig.datenVerzeichnis);
        let status: Ampel = 'ok';
        if ((s.temperaturC ?? 0) > 70 || s.prozessRssMb > 280 || (s.speicherFreiGb ?? 99) < 3)
          status = 'warnung';
        if ((s.temperaturC ?? 0) > 80 || s.ramVerfuegbarMb < 80) status = 'ausfall';
        return {
          status,
          titel: 'System',
          wert: s.temperaturC !== null ? `${s.temperaturC}` : `${s.prozessRssMb}`,
          einheit: s.temperaturC !== null ? '°C' : 'MB',
          unter: s.temperaturC !== null ? 'CPU Temperatur' : 'RAM des Hubs',
          zeilen: [
            { text: 'RAM Hub', wert: `${s.prozessRssMb} MB` },
            { text: 'RAM frei', wert: `${s.ramVerfuegbarMb} MB` },
            { text: 'Speicher frei', wert: s.speicherFreiGb !== null ? `${s.speicherFreiGb} GB` : '?' },
            {
              text: 'Tailscale',
              wert: !s.tailscale.installiert
                ? 'nicht installiert'
                : s.tailscale.verbunden
                  ? 'verbunden'
                  : 'getrennt',
              status: s.tailscale.verbunden ? 'ok' : 'warnung',
            },
            {
              text: 'Backup',
              wert: s.backup.alterStunden === null ? 'keins' : `vor ${Math.round(s.backup.alterStunden)} h`,
              status: s.backup.alterStunden !== null && s.backup.alterStunden < 30 ? 'ok' : 'warnung',
            },
          ],
        };
      },
    };
  },
};
