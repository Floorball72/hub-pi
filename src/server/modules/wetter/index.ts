// Modul Wetter: Vorhersage für die gespeicherten Orte, KP Index und Regenradar.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler } from '../../daten/schema.ts';
import type { Ampel, Ebene, GeoPunkt, Kachel, PunkteAntwort } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { demoKp, demoVorhersage } from '../../quellen/demo-wetter.ts';
import { httpJson } from '../../quellen/http.ts';
import { type KpWert, kpHolen, kpZusammenfassen } from '../../quellen/kp.ts';
import {
  OPENMETEO_NAMENSNENNUNG,
  type Vorhersage,
  vorhersageHolen,
  wetterText,
} from '../../quellen/openmeteo.ts';
import { mond, sonnenZeiten } from '../../quellen/sonne.ts';

interface RadarIndex {
  host: string;
  pfad: string;
  zeit: number;
}

export function koordinatenPruefen(lat: unknown, lon: unknown): { lat: number; lon: number } {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180)
    throw new EingabeFehler('Ungültige Koordinaten');
  return { lat: Math.round(a * 10000) / 10000, lon: Math.round(b * 10000) / 10000 };
}

export const wetter: ModulDef = {
  id: 'wetter',
  name: 'Wetter',
  beschreibung: 'Vorhersage, Sonne und Mond, KP Index und Regenradar',
  symbol: 'wetter',
  reihenfolge: 5,
  erstellen: (ctx) => wetterLaufzeit(ctx),
};

function wetterLaufzeit(ctx: Kontext) {
  const { konfig } = ctx;
  const vorhersage = ctx.quelle<{ lat: number; lon: number }, Vorhersage>({
    id: 'wetter.openmeteo',
    name: 'Open-Meteo Vorhersage',
    modul: 'wetter',
    ttlSek: 30 * 60,
    abruf: (p) => vorhersageHolen(p.lat, p.lon),
    demo: (p) => demoVorhersage(p.lat, p.lon, ctx.jetzt()),
    namensnennung: OPENMETEO_NAMENSNENNUNG,
    testParameter: () => ({ lat: 47.4108, lon: 9.0411 }),
  });
  const kp = ctx.quelle<void, KpWert[]>({
    id: 'wetter.kp',
    name: 'KP Index (NOAA SWPC)',
    modul: 'wetter',
    ttlSek: 3 * 3600,
    abruf: () => kpHolen(),
    demo: () => demoKp(ctx.jetzt()),
    namensnennung: 'NOAA Space Weather Prediction Center',
  });
  const radar = ctx.quelle<void, RadarIndex | null>({
    id: 'wetter.radar',
    name: 'Regenradar (RainViewer)',
    modul: 'wetter',
    ttlSek: 10 * 60,
    abruf: async () => {
      const d = await httpJson<{ host: string; radar: { past: { time: number; path: string }[] } }>(
        'https://api.rainviewer.com/public/weather-maps.json',
        { timeoutMs: 10000 },
      );
      const letzte = d.radar.past[d.radar.past.length - 1];
      return letzte ? { host: d.host, pfad: letzte.path, zeit: letzte.time * 1000 } : null;
    },
    demo: () => null,
    namensnennung: 'Radar: RainViewer.com',
  });
  let radarStand: RadarIndex | null = null;

  async function orteMitWetter() {
    return Promise.all(
      konfig.wetterOrte.map(async (o) => {
        const r = await vorhersage.hole({ lat: o.lat, lon: o.lon });
        return { ort: o, vorhersage: r.daten, demo: r.demo, fehler: r.fehler, stand: r.stand };
      }),
    );
  }

  async function routen(app: FastifyInstance) {
    app.get('/orte', async () => {
      const k = await kp.hole();
      return {
        orte: await orteMitWetter(),
        kp: k.daten ? kpZusammenfassen(k.daten, ctx.jetzt()) : null,
        kpWerte: k.daten ?? [],
      };
    });
    app.get<{ Querystring: { lat: string; lon: string } }>('/ort', async (req) => {
      const { lat, lon } = koordinatenPruefen(req.query.lat, req.query.lon);
      const r = await vorhersage.hole({ lat, lon });
      return { vorhersage: r.daten, demo: r.demo, fehler: r.fehler, stand: r.stand };
    });
    app.get<{ Querystring: { lat: string; lon: string; datum?: string } }>('/sonne', async (req) => {
      const { lat, lon } = koordinatenPruefen(req.query.lat, req.query.lon);
      const datum =
        req.query.datum && /^\d{4}-\d{2}-\d{2}$/.test(req.query.datum)
          ? new Date(`${req.query.datum}T11:00:00Z`)
          : ctx.jetzt();
      return { zeiten: sonnenZeiten(datum, lat, lon), mond: mond(datum) };
    });
    app.get('/punkte', async (): Promise<PunkteAntwort> => {
      const orte = await orteMitWetter();
      const punkte: GeoPunkt[] = orte
        .filter((o) => o.vorhersage?.aktuell)
        .map((o) => ({
          id: `wetter-${o.ort.name}`,
          lat: o.ort.lat,
          lon: o.ort.lon,
          titel: `${o.ort.name}: ${o.vorhersage!.aktuell!.temp ?? '–'} °C`,
          text: `${wetterText(o.vorhersage!.aktuell!.code)}, Wind ${o.vorhersage!.aktuell!.wind ?? '–'} km/h`,
          symbol: 'ort',
        }));
      return { punkte, stand: orte[0]?.stand ?? null, demo: orte[0]?.demo ?? false };
    });
  }

  function ebenen(): Ebene[] {
    return [
      {
        id: 'wetter.radar',
        name: 'Regenradar',
        gruppe: 'Wetter',
        modul: 'wetter',
        art: 'xyz',
        url: radarStand ? `${radarStand.host}${radarStand.pfad}/256/{z}/{x}/{y}/2/1_1.png` : undefined,
        deckkraft: 0.7,
        maxZoom: 7,
        namensnennung: 'Radar: RainViewer.com',
        nichtVerfuegbar: radarStand ? undefined : konfig.demo ? 'Im Demo Modus aus' : 'Radar wird geladen',
        hinweis: radarStand
          ? `Stand ${new Date(radarStand.zeit).toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })}`
          : undefined,
      },
      {
        id: 'wetter.orte',
        name: 'Wetter an meinen Orten',
        gruppe: 'Wetter',
        modul: 'wetter',
        art: 'punkte',
        datenUrl: '/api/m/wetter/punkte',
        aktualisierenSek: 1800,
        namensnennung: OPENMETEO_NAMENSNENNUNG,
        standardAn: true,
      },
    ];
  }

  const jobs = [
    {
      id: 'aktualisieren',
      name: 'Wetter und Radar aktualisieren',
      intervallSek: 10 * 60,
      startVerzoegerungSek: 15,
      lauf: async () => {
        const r = await radar.hole();
        radarStand = r.daten ?? radarStand;
        await orteMitWetter();
        return undefined;
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const orte = await orteMitWetter();
    const erster = orte[0];
    const v = erster?.vorhersage;
    if (!v?.aktuell) return { status: 'ausfall', titel: 'Wetter', hinweis: erster?.fehler ?? 'Keine Daten' };
    const heute = v.tage[0];
    return {
      status: 'ok',
      titel: `Wetter ${erster.ort.name}`,
      wert: `${Math.round(v.aktuell.temp ?? 0)}`,
      einheit: '°C',
      unter: `${wetterText(v.aktuell.code)} · ${heute ? `${Math.round(heute.tmin ?? 0)} bis ${Math.round(heute.tmax ?? 0)} °C` : ''}`,
      zeilen: [
        { text: 'Regen heute', wert: heute ? `${heute.regenWahrsch ?? 0} % · ${heute.regen ?? 0} mm` : '–' },
        { text: 'Wind / Böen', wert: `${v.aktuell.wind ?? '–'} / ${v.aktuell.boeen ?? '–'} km/h` },
        ...orte.slice(1, 3).map((o) => ({
          text: o.ort.name,
          wert: o.vorhersage?.aktuell
            ? `${Math.round(o.vorhersage.aktuell.temp ?? 0)} °C, ${wetterText(o.vorhersage.aktuell.code)}`
            : '–',
        })),
      ],
      demo: erster.demo,
    };
  }

  async function briefing() {
    const orte = await orteMitWetter();
    const zeilen = orte
      .filter((o) => o.vorhersage?.tage[0])
      .map((o) => {
        const t = o.vorhersage!.tage[0];
        const status: Ampel = (t.regenWahrsch ?? 0) > 60 || (t.boeenMax ?? 0) > 60 ? 'warnung' : 'ok';
        return {
          text: `${o.ort.name}: ${wetterText(t.code)}, Regen ${t.regenWahrsch ?? 0} %`,
          wert: `${Math.round(t.tmin ?? 0)} bis ${Math.round(t.tmax ?? 0)} °C`,
          status,
        };
      });
    return { modul: 'wetter', titel: 'Wetter heute', zeilen, status: 'ok' as Ampel, reihenfolge: 10 };
  }

  return { routen, ebenen, jobs, kachel, briefing };
}
