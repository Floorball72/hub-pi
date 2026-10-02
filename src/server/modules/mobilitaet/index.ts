// Modul Mobilität: ÖV Abfahrten von Wohnort und Arbeit.
import type { FastifyInstance } from 'fastify';
import type { Ampel, Kachel } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { type Abfahrtstafel, abfahrtenHolen, demoAbfahrten, OEV_NAMENSNENNUNG } from './oev.ts';

export const mobilitaet: ModulDef = {
  id: 'mobilitaet',
  name: 'Mobilität',
  beschreibung: 'ÖV Abfahrten',
  symbol: 'zug',
  reihenfolge: 40,
  erstellen: (ctx) => mobilitaetLaufzeit(ctx),
};

function mobilitaetLaufzeit(ctx: Kontext) {
  const { konfig } = ctx;
  const oev = ctx.quelle<string, Abfahrtstafel>({
    id: 'mobilitaet.oev',
    name: 'ÖV Abfahrten (transport.opendata.ch)',
    modul: 'mobilitaet',
    ttlSek: 60,
    abruf: (h) => abfahrtenHolen(h),
    demo: (h) => demoAbfahrten(h, ctx.jetzt()),
    namensnennung: OEV_NAMENSNENNUNG,
    testParameter: () => 'St. Gallen',
  });

  async function tafeln() {
    return Promise.all(
      konfig.oevHaltestellen.map(async (h) => {
        const r = await oev.hole(h);
        return { haltestelle: h, tafel: r.daten, fehler: r.fehler, demo: r.demo, stand: r.stand };
      }),
    );
  }

  async function routen(app: FastifyInstance) {
    app.get('/abfahrten', async () => ({ tafeln: await tafeln() }));
  }

  async function kachel(): Promise<Kachel> {
    const t = await tafeln();
    const erste = t[0];
    const naechste =
      erste?.tafel?.abfahrten.filter((a) => new Date(a.zeit).getTime() > ctx.jetzt().getTime()) ?? [];
    if (!erste?.tafel)
      return { status: 'ausfall', titel: 'ÖV', hinweis: erste?.fehler ?? 'Keine Haltestelle konfiguriert' };
    const min = (iso: string) =>
      Math.max(0, Math.round((new Date(iso).getTime() - ctx.jetzt().getTime()) / 60000));
    return {
      status: 'ok',
      titel: `ÖV ${erste.tafel.haltestelle}`,
      wert: naechste[0] ? `${min(naechste[0].zeit)}` : '–',
      einheit: 'min',
      unter: naechste[0] ? `${naechste[0].linie} nach ${naechste[0].ziel}` : 'keine Abfahrt',
      zeilen: [
        ...naechste.slice(1, 3).map((a) => ({
          text: `${a.linie} ${a.ziel}`,
          wert: `${min(a.zeit)} min${a.verspaetungMin ? ` +${a.verspaetungMin}` : ''}`,
          status: (a.verspaetungMin && a.verspaetungMin >= 3 ? 'warnung' : 'neutral') as Ampel,
        })),
        ...t.slice(1, 2).map((x) => {
          const a = x.tafel?.abfahrten.find((y) => new Date(y.zeit).getTime() > ctx.jetzt().getTime());
          return {
            text: `${x.haltestelle}: ${a ? `${a.linie} ${a.ziel}` : '–'}`,
            wert: a ? `${min(a.zeit)} min` : '',
          };
        }),
      ],
      demo: erste.demo,
    };
  }

  return { routen, kachel };
}
