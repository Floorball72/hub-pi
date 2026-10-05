// Modul Smart Home: Steckdosen und Lichter im lokalen Netz schalten, Zeitpläne (auch nach Sonnenuntergang),
// Szenen und Timer. Ersetzt die frühere Homebridge Steuerung. Marken laufen über austauschbare Adapter.
import type { FastifyInstance } from 'fastify';
import { tabelle } from '../../daten/schema.ts';
import type { Ampel, BriefingTeil, Kachel } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import {
  ADAPTER,
  ADAPTER_NAMEN,
  adapter,
  adresseOk,
  type Geraet,
  urlOk,
  virtuellerZustand,
  type Zustand,
} from './adapter.ts';
import { faellige, naechster, type Zeitplan } from './zeitplan.ts';

export const GERAETE = tabelle({
  name: 'smarthome_geraete',
  modul: 'smarthome',
  label: 'Smart Home Geräte',
  bearbeitbar: true,
  anzeige: 'name',
  suche: ['name', 'raum'],
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'raum', typ: 'text', label: 'Raum' },
    {
      name: 'typ',
      typ: 'text',
      label: 'Art',
      optionen: ['steckdose', 'licht', 'schalter', 'sonstiges'],
      standard: 'steckdose',
    },
    {
      name: 'adapter',
      typ: 'text',
      label: 'Adapter',
      optionen: [...ADAPTER],
      standard: 'virtuell',
      pflicht: true,
    },
    { name: 'adresse', typ: 'text', label: 'IP oder Hostname im Heimnetz' },
    {
      name: 'kanal',
      typ: 'int',
      label: 'Kanal (bei Mehrfach Geräten, sonst 0)',
      standard: 0,
      min: 0,
      max: 7,
    },
    { name: 'an_url', typ: 'text', label: 'HTTP: Adresse für an' },
    { name: 'aus_url', typ: 'text', label: 'HTTP: Adresse für aus' },
    { name: 'status_url', typ: 'text', label: 'HTTP: Adresse für den Status' },
    { name: 'status_feld', typ: 'text', label: 'HTTP: Feld im Status (z.B. ison)' },
    { name: 'favorit', typ: 'bool', label: 'Auf der Kachel zeigen', standard: true },
    { name: 'bestaetigen', typ: 'bool', label: 'Schalten nur mit Bestätigung', standard: false },
  ],
});

export const ZEITPLAENE = tabelle({
  name: 'smarthome_zeitplaene',
  modul: 'smarthome',
  label: 'Smart Home Zeitpläne',
  bearbeitbar: true,
  spalten: [
    { name: 'geraet_id', typ: 'text', label: 'Gerät', pflicht: true, verweis: 'smarthome_geraete' },
    { name: 'aktion', typ: 'text', label: 'Aktion', optionen: ['an', 'aus'], pflicht: true, standard: 'an' },
    {
      name: 'art',
      typ: 'text',
      label: 'Wann',
      optionen: ['uhrzeit', 'sonnenuntergang', 'sonnenaufgang'],
      pflicht: true,
      standard: 'uhrzeit',
    },
    { name: 'uhrzeit', typ: 'text', label: 'Uhrzeit (HH:MM)' },
    { name: 'versatz_min', typ: 'int', label: 'Versatz', einheit: 'min', standard: 0, min: -240, max: 240 },
    { name: 'tage', typ: 'text', label: 'Tage (z.B. Mo-Fr, Sa,So)', standard: 'Mo-So' },
    { name: 'aktiv', typ: 'bool', label: 'Aktiv', standard: true },
  ],
  indizes: [['geraet_id']],
});

export const SZENEN = tabelle({
  name: 'smarthome_szenen',
  modul: 'smarthome',
  label: 'Smart Home Szenen',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    /** { geraet_id: true | false } */
    { name: 'zustaende', typ: 'json', label: 'Zustände', intern: true },
  ],
});

interface GeraetZeile extends Geraet {
  raum: string | null;
  typ: string | null;
  favorit: boolean;
  bestaetigen: boolean;
}

interface Szene {
  id: string;
  name: string;
  zustaende: Record<string, boolean> | null;
}

export const smarthome: ModulDef = {
  id: 'smarthome',
  name: 'Smart Home',
  beschreibung: 'Steckdosen und Lichter schalten, Zeitpläne, Szenen und Timer',
  symbol: 'smarthome',
  reihenfolge: 15,
  tabellen: [GERAETE, ZEITPLAENE, SZENEN],
  regeln: [
    {
      id: 'fehler',
      name: 'Zeitplan nicht ausgeführt',
      beschreibung: 'Ein Gerät war beim Zeitplan nicht erreichbar',
      prioritaet: 3,
      cooldownMin: 120,
    },
  ],
  erstellen: (ctx) => smarthomeLaufzeit(ctx),
};

/** Demo Geräte, nur im Demo Modus angelegt */
const DEMO_GERAETE = [
  { name: 'Stehlampe', raum: 'Wohnzimmer', typ: 'licht', adapter: 'virtuell', favorit: true },
  { name: 'Lichterkette', raum: 'Balkon', typ: 'steckdose', adapter: 'virtuell', favorit: true },
  { name: 'Kaffeemaschine', raum: 'Küche', typ: 'steckdose', adapter: 'virtuell', favorit: true },
  { name: 'Drucker', raum: 'Büro', typ: 'steckdose', adapter: 'virtuell', favorit: false, bestaetigen: true },
];

function smarthomeLaufzeit(ctx: Kontext) {
  const { daten } = ctx;
  const timer = new Map<string, { bis: number; an: boolean; t: NodeJS.Timeout }>();
  let letzterLauf = ctx.jetzt();
  let bereit: Promise<void> | null = null;

  const status = ctx.quelle<Geraet, Zustand>({
    id: 'smarthome.status',
    name: 'Geräte im Heimnetz',
    modul: 'smarthome',
    ttlSek: 30,
    minSek: 15,
    abruf: (g) => adapter(g).status(g),
    demo: (g) => virtuellerZustand(g.id),
    nurMitEintrag: true,
    beschreibung: 'Fragt die Geräte direkt im lokalen Netz ab (Shelly, Tasmota, eigene HTTP Adressen)',
  });

  async function vorbereiten() {
    bereit ??= (async () => {
      if (!ctx.konfig.demo || ctx.einstellungen.hole('smarthome.demo_angelegt', false)) return;
      if ((await daten.anzahl('smarthome_geraete')) > 0) return;
      const [lampe, kette] = await daten.einfuegen<{ id: string }>('smarthome_geraete', DEMO_GERAETE);
      await daten.einfuegen('smarthome_zeitplaene', [
        {
          geraet_id: kette.id,
          aktion: 'an',
          art: 'sonnenuntergang',
          versatz_min: 15,
          tage: 'Mo-So',
          aktiv: true,
        },
        { geraet_id: kette.id, aktion: 'aus', art: 'uhrzeit', uhrzeit: '23:00', tage: 'Mo-So', aktiv: true },
        { geraet_id: lampe.id, aktion: 'an', art: 'uhrzeit', uhrzeit: '06:30', tage: 'Mo-Fr', aktiv: true },
      ]);
      await daten.einfuegen('smarthome_szenen', [
        { name: 'Feierabend', zustaende: { [lampe.id]: true, [kette.id]: true } },
        { name: 'Alles aus', zustaende: { [lampe.id]: false, [kette.id]: false } },
      ]);
      await ctx.einstellungen.setze('smarthome.demo_angelegt', true);
    })();
    await bereit;
  }

  const geraete = async () => {
    await vorbereiten();
    return daten.liste<GeraetZeile>('smarthome_geraete', { sortierung: 'raum,name', limit: 200 });
  };
  const plaene = () => daten.liste<Zeitplan>('smarthome_zeitplaene', { limit: 500 });
  const ort = () => ctx.konfig.wetterOrte[0] ?? { lat: 47.41, lon: 9.04 };

  async function mitZustand(g: GeraetZeile, frisch = false) {
    // Nur die Felder für den Abruf, damit der Cache Schlüssel stabil bleibt
    const { id, name, adapter: art, adresse, kanal, an_url, aus_url, status_url, status_feld } = g;
    const r = await status.hole(
      { id, name, adapter: art, adresse, kanal, an_url, aus_url, status_url, status_feld },
      frisch,
    );
    const t = timer.get(g.id);
    return {
      ...g,
      zustand: r.daten ?? { an: null, leistungW: null },
      fehler: r.fehler ?? null,
      timer: t ? { bis: new Date(t.bis).toISOString(), an: t.an } : null,
    };
  }

  async function schalten(g: GeraetZeile, an: boolean, grund: string) {
    // Im Demo Modus nie echte Geräte schalten
    const z = await adapter(ctx.konfig.demo ? { ...g, adapter: 'virtuell' } : g).schalten(g, an);
    status.cacheLeeren();
    await ctx.aktivitaet('smarthome', `${g.name} ${an ? 'an' : 'aus'} (${grund})`, 'aktion');
    return z;
  }

  async function uebersicht() {
    const [liste, p, szenen] = await Promise.all([
      geraete(),
      plaene(),
      daten.liste<Szene>('smarthome_szenen', { sortierung: 'name', limit: 50 }),
    ]);
    const jetzt = ctx.jetzt();
    const { lat, lon } = ort();
    return {
      geraete: await Promise.all(liste.map((g) => mitZustand(g))),
      plaene: p.map((x) => ({ ...x, naechster: naechster(x, jetzt, lat, lon)?.toISOString() ?? null })),
      szenen,
      adapter: ADAPTER.map((id) => ({ id, name: ADAPTER_NAMEN[id] })),
    };
  }

  async function holeGeraet(id: string) {
    return daten.hole<GeraetZeile>('smarthome_geraete', id);
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => uebersicht());

    app.post<{ Params: { id: string }; Body: { an?: boolean; minuten?: number; bestaetigt?: boolean } }>(
      '/geraet/:id/schalten',
      async (req, reply) => {
        const g = await holeGeraet(req.params.id);
        if (!g) return reply.code(404).send({ fehler: 'Gerät nicht gefunden' });
        const { an, minuten, bestaetigt } = req.body ?? {};
        if (typeof an !== 'boolean') return reply.code(400).send({ fehler: 'an fehlt' });
        if (g.bestaetigen && !bestaetigt) return reply.code(409).send({ fehler: 'Bestätigung nötig' });
        if (
          g.adapter === 'http' &&
          ![g.an_url, g.aus_url, g.status_url].filter(Boolean).every((u) => urlOk(u))
        )
          return reply.code(400).send({ fehler: 'Ungültige HTTP Adresse' });
        if (g.adapter !== 'http' && g.adapter !== 'virtuell' && !ctx.konfig.demo && !adresseOk(g.adresse))
          return reply.code(400).send({ fehler: 'IP oder Hostname fehlt' });
        try {
          await schalten(g, an, minuten ? `Timer ${minuten} min` : 'von Hand');
        } catch (e) {
          return reply
            .code(502)
            .send({ fehler: `Gerät nicht erreichbar: ${e instanceof Error ? e.message : e}` });
        }
        // Timer: nach Ablauf zurückschalten. Läuft nur im Speicher, ein Neustart bricht ihn ab.
        const alt = timer.get(g.id);
        if (alt) clearTimeout(alt.t);
        timer.delete(g.id);
        if (minuten && minuten > 0 && minuten <= 24 * 60) {
          const bis = Date.now() + minuten * 60000;
          const t = setTimeout(() => {
            timer.delete(g.id);
            schalten(g, !an, 'Timer abgelaufen').catch((e) =>
              ctx.log.warn({ err: e }, `Timer für ${g.name} nicht ausgeführt`),
            );
          }, minuten * 60000);
          t.unref();
          timer.set(g.id, { bis, an: !an, t });
        }
        return mitZustand(g, true);
      },
    );

    app.post<{ Params: { id: string } }>('/szene/:id', async (req, reply) => {
      const s = await daten.hole<Szene>('smarthome_szenen', req.params.id);
      if (!s) return reply.code(404).send({ fehler: 'Szene nicht gefunden' });
      const alle = await geraete();
      const ergebnisse = await Promise.all(
        Object.entries(s.zustaende ?? {}).map(async ([id, an]) => {
          const g = alle.find((x) => x.id === id);
          if (!g) return { id, ok: false, fehler: 'Gerät gelöscht' };
          try {
            await schalten(g, an, `Szene ${s.name}`);
            return { id, ok: true };
          } catch (e) {
            return { id, name: g.name, ok: false, fehler: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      return { ok: ergebnisse.every((e) => e.ok), ergebnisse };
    });

    // Aktuellen Zustand aller erreichbaren Geräte als neue Szene speichern
    app.post<{ Body: { name?: string } }>('/szene', async (req, reply) => {
      const name = String(req.body?.name ?? '')
        .trim()
        .slice(0, 60);
      if (!name) return reply.code(400).send({ fehler: 'Name fehlt' });
      const liste = await Promise.all((await geraete()).map((g) => mitZustand(g, true)));
      const zustaende = Object.fromEntries(
        liste.filter((g) => g.zustand.an !== null).map((g) => [g.id, g.zustand.an as boolean]),
      );
      const [neu] = await daten.einfuegen('smarthome_szenen', [{ name, zustaende }]);
      return neu;
    });
  }

  const jobs = [
    {
      id: 'zeitplaene',
      name: 'Zeitpläne ausführen',
      intervallSek: 60,
      startVerzoegerungSek: 20,
      lauf: async () => {
        const jetzt = ctx.jetzt();
        const von = letzterLauf;
        letzterLauf = jetzt;
        // Nach langem Unterbruch nichts nachholen, höchstens zehn Minuten
        const ab = new Date(Math.max(von.getTime(), jetzt.getTime() - 10 * 60000));
        const { lat, lon } = ort();
        const faellig = faellige(await plaene(), ab, jetzt, lat, lon);
        if (!faellig.length) return undefined;
        const alle = await geraete();
        const texte: string[] = [];
        for (const p of faellig) {
          const g = alle.find((x) => x.id === p.geraet_id);
          if (!g) continue;
          try {
            await schalten(g, p.aktion === 'an', 'Zeitplan');
            texte.push(`${g.name} ${p.aktion}`);
          } catch (e) {
            texte.push(`${g.name} Fehler`);
            await ctx.alarm.melden({
              regel: 'smarthome.fehler',
              titel: `Smart Home: ${g.name} nicht geschaltet`,
              text: `Zeitplan «${p.aktion}» nicht ausgeführt: ${e instanceof Error ? e.message : e}`,
              schluessel: `smarthome:${g.id}`,
              tags: ['electric_plug'],
            });
          }
        }
        return texte.join(', ');
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const u = await uebersicht();
    const an = u.geraete.filter((g) => g.zustand.an);
    const fehler = u.geraete.filter((g) => g.fehler);
    const leistung = u.geraete.reduce((s, g) => s + (g.zustand.leistungW ?? 0), 0);
    return {
      status: (fehler.length ? 'warnung' : 'ok') as Ampel,
      titel: 'Smart Home',
      wert: `${an.length}`,
      einheit: `von ${u.geraete.length} an`,
      unter: leistung ? `${Math.round(leistung)} W gerade` : '',
      zeilen: u.geraete
        .filter((g) => g.favorit)
        .slice(0, 5)
        .map((g) => ({
          text: g.name,
          wert: g.fehler ? 'nicht erreichbar' : g.zustand.an ? 'an' : g.zustand.an === false ? 'aus' : '?',
          status: (g.fehler ? 'warnung' : g.zustand.an ? 'ok' : 'neutral') as Ampel,
        })),
      demo: ctx.konfig.demo,
    };
  }

  // Im Abendbericht: was noch eingeschaltet ist
  async function abendbericht(): Promise<BriefingTeil | null> {
    const an = (await uebersicht()).geraete.filter((g) => g.zustand.an);
    if (!an.length) return null;
    return {
      modul: 'smarthome',
      titel: 'Noch eingeschaltet',
      zeilen: an.slice(0, 6).map((g) => ({ text: g.name, wert: g.raum ?? '' })),
      status: 'neutral',
      reihenfolge: 80,
    };
  }

  return { routen, jobs, kachel, abendbericht };
}
