// Zentrale: Systemstatus, Schnellnotizen, Morgenbriefing und Timeline Rahmen.
import { tabelle } from '../../daten/schema.ts';
import type { ModulDef } from '../../kern/modul.ts';
import { stromText, systemStatus } from '../../kern/system.ts';
import { lokal, lokalZeit, type Rueckblick, tageZurueck } from '../../kern/zeit.ts';
import type { Ampel, BriefingTeil, Kachel } from '../../geteilt/typen.ts';

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
    {
      id: 'unterspannung',
      name: 'Unterspannung am Pi',
      beschreibung: 'Meldet, wenn das Netzteil zu wenig Spannung liefert und der Pi sich drosselt',
      prioritaet: 3,
      cooldownMin: 720,
    },
    {
      id: 'tagesrueckblick',
      name: 'Tagesrückblick am Abend',
      beschreibung: 'Um 20 Uhr eine Meldung mit Heli Einsätzen, Ausfällen und Terminen von morgen',
      prioritaet: 2,
      cooldownMin: 600,
    },
    {
      id: 'wochenrueckblick',
      name: 'Wochenrückblick am Sonntag',
      beschreibung:
        'Sonntags um 20 Uhr statt des Tagesrückblicks: Heli Woche, Ausfälle der Kundenseiten, die nächsten sieben Tage',
      prioritaet: 2,
      cooldownMin: 3 * 24 * 60,
    },
  ],
  erstellen(ctx) {
    // Teil der Zentrale im Rückblick: was morgen oder in den nächsten sieben Tagen ansteht
    async function abendbericht(zeitraum: Rueckblick): Promise<BriefingTeil> {
      const woche = zeitraum === 'woche';
      const morgen = tageZurueck(ctx.jetzt(), -1);
      const danach = tageZurueck(ctx.jetzt(), woche ? -8 : -2);
      const termine = (await ctx.kern.timeline(morgen, danach)).filter(
        (t) => new Date(t.start) >= morgen && new Date(t.start) < danach,
      );
      const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
      const wann = (t: { start: string; ganztags?: boolean }) => {
        const zeit = t.ganztags ? 'ganztags' : lokalZeit(new Date(t.start));
        return woche ? `${TAGE[lokal(new Date(t.start)).wochentag]} ${zeit}` : zeit;
      };
      return {
        modul: 'zentrale',
        titel: woche ? 'Nächste Woche' : 'Morgen',
        zeilen: termine.length
          ? termine.slice(0, woche ? 8 : 6).map((t) => ({ text: t.titel, wert: wann(t) }))
          : [{ text: 'Keine Termine', wert: '' }],
        status: 'neutral',
        reihenfolge: 90,
      };
    }

    async function rueckblickSenden(zeitraum: Rueckblick) {
      const woche = zeitraum === 'woche';
      const teile = await ctx.kern.abendbericht(zeitraum);
      const text = teile
        .map(
          (t) => `${t.titel}: ${t.zeilen.map((z) => (z.wert ? `${z.text} (${z.wert})` : z.text)).join(', ')}`,
        )
        .join('\n')
        .slice(0, 900);
      const e = await ctx.alarm.melden({
        regel: woche ? 'zentrale.wochenrueckblick' : 'zentrale.tagesrueckblick',
        titel: woche ? 'Pi Hub: Wochenrückblick' : 'Pi Hub: Tagesrückblick',
        text: text || (woche ? 'Nichts Besonderes diese Woche' : 'Nichts Besonderes heute'),
        schluessel: woche ? 'wochenrueckblick' : 'tagesrueckblick',
        tags: [woche ? 'calendar' : 'crescent_moon'],
      });
      return { grund: e.grund, meldung: `${woche ? 'Woche' : 'Tag'}, ${teile.length} Teile, ${e.status}` };
    }

    return {
      abendbericht,
      jobs: [
        {
          id: 'tagesrueckblick',
          name: 'Tages oder Wochenrückblick senden',
          taeglich: '20:00',
          lauf: async () => {
            // Sonntags der Wochenrückblick, ausser seine Regel ist ausgeschaltet
            if (lokal(ctx.jetzt()).wochentag === 0) {
              const w = await rueckblickSenden('woche');
              if (w.grund !== 'Regel ausgeschaltet') return w.meldung;
            }
            return (await rueckblickSenden('tag')).meldung;
          },
        },
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
            if (s.strom?.unterspannung) {
              await ctx.alarm.melden({
                regel: 'zentrale.unterspannung',
                titel: 'Pi Hub: Unterspannung',
                text: `Das Netzteil liefert zu wenig Spannung${s.strom.gedrosselt ? ', der Pi drosselt sich' : ''}. Netzteil oder Kabel prüfen.`,
                schluessel: 'unterspannung',
                tags: ['zap'],
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
        if (s.strom?.unterspannung) status = 'warnung';
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
            ...(s.strom
              ? [
                  {
                    text: 'Strom',
                    wert: stromText(s.strom),
                    status: (s.strom.unterspannung
                      ? 'warnung'
                      : s.strom.unterspannungSeitStart
                        ? 'neutral'
                        : 'ok') as Ampel,
                  },
                ]
              : []),
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
