// Modul Fahrzeug: Tankbuch mit Verbrauch, Service nach Datum oder Kilometern, MFK, Reifenwechsel und Vignette.
// Der Kilometerstand wird aus den Einträgen geschätzt, damit Service Termine auch ohne tägliche Eingabe stimmen.
import type { FastifyInstance } from 'fastify';
import { tabelle } from '../../daten/schema.ts';
import type { BriefingTeil, Kachel, KachelZeile, SuchTreffer, TimelineEintrag } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { lokalDatum } from '../../kern/zeit.ts';
import { plusMonate, plusTage, tageZwischen } from '../aufgaben/wiederholung.ts';
import { kmHeute, kmProTag, reifen, type Tankung, service, verbrauch, vignette } from './rechnen.ts';

const ARTEN = ['Service', 'Reparatur', 'MFK', 'Reifenwechsel', 'Pflege', 'Andere'];

export const FAHRZEUGE = tabelle({
  name: 'fahrzeuge',
  modul: 'fahrzeug',
  label: 'Fahrzeuge',
  bearbeitbar: true,
  anzeige: 'name',
  suche: ['name', 'kennzeichen', 'modell'],
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'kennzeichen', typ: 'text', label: 'Kennzeichen' },
    { name: 'modell', typ: 'text', label: 'Marke und Modell' },
    {
      name: 'treibstoff',
      typ: 'text',
      label: 'Antrieb',
      optionen: ['Benzin', 'Diesel', 'Hybrid', 'Elektro'],
      standard: 'Benzin',
    },
    { name: 'km_stand', typ: 'int', label: 'Kilometerstand', einheit: 'km', min: 0 },
    { name: 'km_stand_am', typ: 'datum', label: 'Kilometerstand vom' },
    { name: 'mfk_faellig', typ: 'datum', label: 'Nächste MFK' },
    { name: 'service_monate', typ: 'int', label: 'Service alle', einheit: 'Monate', standard: 12, min: 0 },
    { name: 'service_km', typ: 'int', label: 'Service alle', einheit: 'km', standard: 15000, min: 0 },
    { name: 'letzter_service_datum', typ: 'datum', label: 'Letzter Service' },
    { name: 'letzter_service_km', typ: 'int', label: 'Letzter Service bei', einheit: 'km', min: 0 },
    {
      name: 'reifen_montiert',
      typ: 'text',
      label: 'Montierte Reifen',
      optionen: ['Sommer', 'Winter', 'Ganzjahr'],
    },
    { name: 'vignette_jahr', typ: 'int', label: 'Vignette für Jahr', min: 2000, max: 2100 },
    { name: 'aktiv', typ: 'bool', label: 'Aktiv', standard: true },
    { name: 'notiz', typ: 'text', label: 'Notiz', lang: true },
  ],
});

export const TANKUNGEN = tabelle({
  name: 'tankungen',
  modul: 'fahrzeug',
  label: 'Tankungen',
  bearbeitbar: true,
  anzeige: 'datum',
  spalten: [
    { name: 'fahrzeug_id', typ: 'text', label: 'Fahrzeug', pflicht: true },
    { name: 'datum', typ: 'datum', label: 'Datum', pflicht: true },
    { name: 'km', typ: 'int', label: 'Kilometerstand', einheit: 'km', pflicht: true, min: 0 },
    { name: 'liter', typ: 'real', label: 'Menge', einheit: 'l', pflicht: true, min: 0 },
    { name: 'betrag', typ: 'real', label: 'Betrag', einheit: 'CHF', min: 0 },
    { name: 'voll', typ: 'bool', label: 'Vollgetankt', standard: true },
    { name: 'notiz', typ: 'text', label: 'Notiz' },
  ],
  indizes: [['fahrzeug_id', 'datum']],
});

export const FAHRZEUG_EINTRAEGE = tabelle({
  name: 'fahrzeug_eintraege',
  modul: 'fahrzeug',
  label: 'Service und Reparaturen',
  bearbeitbar: true,
  anzeige: 'art',
  suche: ['notiz'],
  spalten: [
    { name: 'fahrzeug_id', typ: 'text', label: 'Fahrzeug', pflicht: true },
    { name: 'datum', typ: 'datum', label: 'Datum', pflicht: true },
    { name: 'art', typ: 'text', label: 'Art', optionen: ARTEN, standard: 'Service' },
    { name: 'km', typ: 'int', label: 'Kilometerstand', einheit: 'km', min: 0 },
    { name: 'kosten', typ: 'real', label: 'Kosten', einheit: 'CHF', min: 0 },
    { name: 'notiz', typ: 'text', label: 'Was wurde gemacht', lang: true },
  ],
  indizes: [['fahrzeug_id', 'datum']],
});

interface Fahrzeug {
  id: string;
  name: string;
  kennzeichen: string | null;
  modell: string | null;
  treibstoff: string | null;
  km_stand: number | null;
  km_stand_am: string | null;
  mfk_faellig: string | null;
  service_monate: number | null;
  service_km: number | null;
  letzter_service_datum: string | null;
  letzter_service_km: number | null;
  reifen_montiert: string | null;
  vignette_jahr: number | null;
  aktiv: boolean;
  notiz: string | null;
}
type TankZeile = Tankung & { id: string; fahrzeug_id: string; notiz: string | null };
interface Eintrag {
  id: string;
  fahrzeug_id: string;
  datum: string;
  art: string;
  km: number | null;
  kosten: number | null;
  notiz: string | null;
}

export const fahrzeug: ModulDef = {
  id: 'fahrzeug',
  name: 'Fahrzeug',
  beschreibung: 'Tankbuch mit Verbrauch, Service, MFK, Reifenwechsel und Vignette',
  symbol: 'fahrzeug',
  reihenfolge: 15,
  tabellen: [FAHRZEUGE, TANKUNGEN, FAHRZEUG_EINTRAEGE],
  regeln: [
    {
      id: 'termin',
      name: 'MFK und Service',
      beschreibung: 'MFK 60, 30 und 7 Tage vorher, Service 30 und 7 Tage vorher und am Tag selbst',
      prioritaet: 3,
      cooldownMin: 600,
    },
    {
      id: 'saison',
      name: 'Reifen und Vignette',
      beschreibung: 'Reifenwechsel ab 15. Oktober und 15. April, Vignette ab 1. Dezember, danach wöchentlich',
      prioritaet: 2,
      cooldownMin: 600,
    },
  ],
  erstellen: (ctx) => fahrzeugLaufzeit(ctx),
};

/** Ein Jahr Demo Tankungen: etwa alle zwei Wochen, ab und zu nur teilweise getankt */
function demoTankungen(h: string, km0: number) {
  const liste: Tankung[] = [];
  let km = km0;
  let d = plusMonate(h, -12);
  let i = 0;
  while (d < h) {
    const strecke = 520 + ((i * 137) % 260);
    km += strecke;
    const voll = i % 6 !== 4;
    const l100 =
      6.4 + ((i * 53) % 17) / 10 + (Number(d.slice(5, 7)) <= 2 || Number(d.slice(5, 7)) >= 12 ? 0.6 : 0);
    const liter = Math.round(strecke * (l100 / 100) * (voll ? 1 : 0.6) * 100) / 100;
    const preis = 1.82 + ((i * 7) % 12) / 100;
    liste.push({ datum: d, km, liter, betrag: Math.round(liter * preis * 100) / 100, voll });
    d = plusTage(d, 12 + ((i * 5) % 6));
    i++;
  }
  return liste;
}

function fahrzeugLaufzeit(ctx: Kontext) {
  const { daten } = ctx;
  const heute = () => lokalDatum(ctx.jetzt());
  let bereit: Promise<void> | null = null;

  async function vorbereiten() {
    bereit ??= (async () => {
      if (!ctx.konfig.demo || ctx.einstellungen.hole('fahrzeug.demo_angelegt', false)) return;
      if ((await daten.anzahl('fahrzeuge')) > 0) return;
      const h = heute();
      const tank = demoTankungen(h, 61200);
      const letzterKm = tank[tank.length - 1]?.km ?? 61200;
      const [auto] = await daten.einfuegen<{ id: string }>('fahrzeuge', [
        {
          name: 'Auto',
          kennzeichen: 'SG 123 456',
          modell: 'Skoda Octavia Combi',
          treibstoff: 'Benzin',
          mfk_faellig: plusTage(h, 45),
          service_monate: 12,
          service_km: 15000,
          letzter_service_datum: plusMonate(h, -10),
          letzter_service_km: letzterKm - 14400,
          reifen_montiert: 'Sommer',
          vignette_jahr: Number(h.slice(0, 4)),
          aktiv: true,
        },
      ]);
      await daten.einfuegen(
        'tankungen',
        tank.map((t) => ({ fahrzeug_id: auto.id, ...t })),
      );
      await daten.einfuegen('fahrzeug_eintraege', [
        {
          fahrzeug_id: auto.id,
          datum: plusMonate(h, -10),
          art: 'Service',
          km: letzterKm - 14400,
          kosten: 485,
          notiz: 'Jahresservice mit Ölwechsel',
        },
        {
          fahrzeug_id: auto.id,
          datum: plusMonate(h, -6),
          art: 'Reifenwechsel',
          kosten: 80,
          notiz: 'Sommerreifen montiert',
        },
        {
          fahrzeug_id: auto.id,
          datum: plusMonate(h, -3),
          art: 'Reparatur',
          kosten: 340,
          notiz: 'Bremsbeläge vorne',
        },
      ]);
      await ctx.einstellungen.setze('fahrzeug.demo_angelegt', true);
    })();
    await bereit;
  }

  const runden = (n: number, s = 2) => Math.round(n * 10 ** s) / 10 ** s;

  async function auswerten(f: Fahrzeug, h: string) {
    const tank = await daten.liste<TankZeile>('tankungen', {
      filter: { fahrzeug_id: f.id },
      sortierung: 'datum',
      limit: 2000,
    });
    const eintraege = await daten.liste<Eintrag>('fahrzeug_eintraege', {
      filter: { fahrzeug_id: f.id },
      sortierung: '-datum',
      limit: 500,
    });
    // Alle bekannten Kilometerstände: Tankungen, Einträge und der von Hand erfasste Stand
    const staende = [
      ...tank.map((t) => ({ datum: t.datum, km: t.km })),
      ...eintraege.filter((e) => e.km != null).map((e) => ({ datum: e.datum, km: e.km as number })),
      ...(f.km_stand != null && f.km_stand_am ? [{ datum: f.km_stand_am, km: f.km_stand }] : []),
    ].sort((a, b) => a.datum.localeCompare(b.datum) || a.km - b.km);
    const letzter = staende[staende.length - 1] ?? null;
    const proTag = kmProTag(staende, h);
    const jetzt = kmHeute(letzter, proTag, h);
    const v = verbrauch(tank);
    const s = service(
      f.letzter_service_datum,
      f.letzter_service_km,
      f.service_monate,
      f.service_km,
      jetzt,
      proTag,
      h,
    );
    const r = reifen(f.reifen_montiert, h);
    const vig = vignette(f.vignette_jahr, h);
    // Kosten der letzten zwölf Monate pro Monat
    const start = `${plusMonate(h, -11).slice(0, 7)}-01`;
    const kosten = Array.from({ length: 12 }, (_, i) => {
      const von = plusMonate(start, i);
      const bis = plusTage(plusMonate(start, i + 1), -1);
      const treib = tank
        .filter((t) => t.datum >= von && t.datum <= bis)
        .reduce((x, t) => x + (t.betrag ?? 0), 0);
      const unterhalt = eintraege
        .filter((e) => e.datum >= von && e.datum <= bis)
        .reduce((x, e) => x + (e.kosten ?? 0), 0);
      return { monat: von.slice(0, 7), treibstoff: runden(treib), unterhalt: runden(unterhalt) };
    });
    const summe12 = kosten.reduce((x, k) => x + k.treibstoff + k.unterhalt, 0);
    const km12 = proTag ? proTag * 365 : null;
    return {
      ...f,
      kmJetzt: jetzt,
      kmGeschaetzt: !!letzter && letzter.datum !== h && !!proTag,
      kmProJahr: km12 ? Math.round(km12) : null,
      verbrauch: { ...v, abschnitte: v.abschnitte.slice(-24) },
      service: s,
      reifen: r,
      vignette: vig,
      mfkTage: f.mfk_faellig ? tageZwischen(h, f.mfk_faellig) : null,
      kosten,
      kosten12: runden(summe12),
      chfProKm: km12 && summe12 ? runden(summe12 / km12, 2) : null,
      tankungen: tank.slice(-30).reverse(),
      eintraege: eintraege.slice(0, 30),
    };
  }
  type Ausgewertet = Awaited<ReturnType<typeof auswerten>>;

  async function alle(): Promise<Ausgewertet[]> {
    await vorbereiten();
    const h = heute();
    const liste = await daten.liste<Fahrzeug>('fahrzeuge', { sortierung: 'name', limit: 20 });
    return Promise.all(liste.map((f) => auswerten(f, h)));
  }

  async function routen(app: FastifyInstance) {
    app.addHook('onRequest', async () => vorbereiten());
    app.get('/uebersicht', async () => ({ heute: heute(), fahrzeuge: await alle() }));

    app.post<{
      Body: {
        fahrzeug_id?: string;
        datum?: string;
        km?: number;
        liter?: number;
        betrag?: number | null;
        voll?: boolean;
      };
    }>('/tanken', async (req, reply) => {
      const b = req.body ?? {};
      const f = b.fahrzeug_id ? await daten.hole<Fahrzeug>('fahrzeuge', b.fahrzeug_id) : null;
      if (!f) return reply.code(404).send({ fehler: 'Fahrzeug nicht gefunden' });
      const km = Math.round(Number(b.km));
      const liter = Number(b.liter);
      const datum = b.datum || heute();
      if (!Number.isFinite(km) || km <= 0 || !Number.isFinite(liter) || liter <= 0 || liter > 500)
        return reply.code(400).send({ fehler: 'Kilometerstand und Menge prüfen' });
      // Der Kilometerstand muss zwischen der vorherigen und der nächsten Tankung liegen
      const vorher = await daten.liste<TankZeile>('tankungen', {
        filter: { fahrzeug_id: f.id, datum: { lte: datum } },
        sortierung: '-datum',
        limit: 1,
      });
      const nachher = await daten.liste<TankZeile>('tankungen', {
        filter: { fahrzeug_id: f.id, datum: { gt: datum } },
        sortierung: 'datum',
        limit: 1,
      });
      if ((vorher[0] && km < vorher[0].km) || (nachher[0] && km > nachher[0].km))
        return reply.code(400).send({
          fehler: `Kilometerstand passt nicht zu den anderen Tankungen${vorher[0] ? `, zuletzt ${vorher[0].km} km` : ''}`,
        });
      const betrag = b.betrag == null || Number.isNaN(Number(b.betrag)) ? null : Number(b.betrag);
      const [neu] = await daten.einfuegen<{ id: string }>('tankungen', [
        { fahrzeug_id: f.id, datum, km, liter, betrag, voll: b.voll !== false },
      ]);
      ctx.aktivitaet('fahrzeug', `Getankt: ${liter} l bei ${km} km`, 'aktion');
      return { id: neu.id };
    });

    app.post<{
      Params: { id: string };
      Body: {
        art?: string;
        datum?: string;
        km?: number | null;
        kosten?: number | null;
        notiz?: string;
        reifen?: string;
      };
    }>('/fahrzeug/:id/eintrag', async (req, reply) => {
      const f = await daten.hole<Fahrzeug>('fahrzeuge', req.params.id);
      if (!f) return reply.code(404).send({ fehler: 'Fahrzeug nicht gefunden' });
      const b = req.body ?? {};
      const art = ARTEN.includes(b.art ?? '') ? (b.art as string) : 'Andere';
      const datum = b.datum || heute();
      const km = b.km == null || Number.isNaN(Number(b.km)) ? null : Math.round(Number(b.km));
      const kosten = b.kosten == null || Number.isNaN(Number(b.kosten)) ? null : Number(b.kosten);
      const notiz = (b.notiz ?? '').trim().slice(0, 500) || null;
      await daten.einfuegen('fahrzeug_eintraege', [{ fahrzeug_id: f.id, datum, art, km, kosten, notiz }]);
      // Ein Service setzt die Zähler zurück, ein Reifenwechsel merkt sich den montierten Satz
      const aenderung: Record<string, unknown> = {};
      if (art === 'Service') {
        aenderung.letzter_service_datum = datum;
        if (km != null) aenderung.letzter_service_km = km;
      }
      if (art === 'Reifenwechsel')
        aenderung.reifen_montiert = ['Sommer', 'Winter', 'Ganzjahr'].includes(b.reifen ?? '')
          ? b.reifen
          : reifen(f.reifen_montiert, heute()).soll;
      if (Object.keys(aenderung).length) await daten.aendern('fahrzeuge', f.id, aenderung);
      ctx.aktivitaet('fahrzeug', `${f.name}: ${art} eingetragen`, 'aktion');
      return { ok: true, ...aenderung };
    });

    app.post<{ Params: { id: string }; Body: { jahr?: number } }>(
      '/fahrzeug/:id/vignette',
      async (req, reply) => {
        const f = await daten.hole<Fahrzeug>('fahrzeuge', req.params.id);
        if (!f) return reply.code(404).send({ fehler: 'Fahrzeug nicht gefunden' });
        const jahr = Number(req.body?.jahr) || vignette(f.vignette_jahr, heute()).fuer;
        await daten.aendern('fahrzeuge', f.id, { vignette_jahr: jahr });
        ctx.aktivitaet('fahrzeug', `${f.name}: Vignette ${jahr} eingetragen`, 'aktion');
        return { vignette_jahr: jahr };
      },
    );
  }

  const jobs = [
    {
      id: 'pruefen',
      name: 'MFK, Service, Reifen und Vignette prüfen',
      taeglich: '08:30',
      startVerzoegerungSek: 120,
      lauf: async () => {
        const h = heute();
        const md = h.slice(5);
        let gemeldet = 0;
        for (const f of await alle()) {
          if (!f.aktiv) continue;
          const melde = async (
            regel: string,
            titel: string,
            text: string,
            schluessel: string,
            tag: string,
          ) => {
            await ctx.alarm.melden({
              regel: `fahrzeug.${regel}`,
              titel,
              text,
              schluessel: `${f.id}:${schluessel}`,
              tags: [tag],
              link: '/modul/fahrzeug',
            });
            gemeldet++;
          };
          if (f.mfk_faellig && f.mfkTage != null && [60, 30, 7].includes(f.mfkTage))
            await melde(
              'termin',
              `MFK ${f.name} in ${f.mfkTage} Tagen`,
              `Aufgebot für den ${f.mfk_faellig}. Vorher Licht, Reifen und Bremsen prüfen lassen.`,
              `mfk:${f.mfk_faellig}:${f.mfkTage}`,
              'clipboard',
            );
          const st = f.service.tage;
          if (f.service.faellig && st != null && ([30, 7, 0].includes(st) || (st < 0 && -st % 14 === 0)))
            await melde(
              'termin',
              st > 0 ? `Service ${f.name} in ${st} Tagen` : `Service ${f.name} fällig`,
              f.service.km != null
                ? `Fällig bei ${f.service.km.toLocaleString('de-CH')} km oder am ${f.service.datum ?? 'Stichtag'}, je nachdem was zuerst kommt. Stand etwa ${f.kmJetzt?.toLocaleString('de-CH') ?? '?'} km.`
                : `Fällig am ${f.service.faellig}.`,
              `service:${f.service.faellig}:${st}`,
              'wrench',
            );
          // Reifen: am Stichtag und danach wöchentlich, solange der falsche Satz montiert ist
          const stichtag =
            md >= '10-15' || md < '04-15'
              ? `${md >= '10-15' ? h.slice(0, 4) : Number(h.slice(0, 4)) - 1}-10-15`
              : `${h.slice(0, 4)}-04-15`;
          const seit = tageZwischen(stichtag, h);
          if (f.reifen.wechseln && seit % 7 === 0)
            await melde(
              'saison',
              `${f.reifen.soll}reifen montieren: ${f.name}`,
              f.reifen.soll === 'Winter'
                ? 'Faustregel von O bis O: ab Oktober Winterreifen. Termin in der Garage abmachen.'
                : 'Ab Mitte April wieder Sommerreifen.',
              `reifen:${stichtag}:${seit}`,
              'snowflake',
            );
          const vig = f.vignette;
          if (
            vig.kaufen &&
            (md === '12-01' ||
              md === '01-20' ||
              (!vig.gueltig && md >= '02-01' && tageZwischen(`${h.slice(0, 4)}-02-01`, h) % 7 === 0))
          )
            await melde(
              'saison',
              vig.gueltig ? `Vignette ${vig.fuer} kaufen: ${f.name}` : `Keine gültige Vignette: ${f.name}`,
              vig.gueltig
                ? `Die Vignette ${vig.fuer} gilt ab 1. Dezember, die alte noch bis 31. Januar.`
                : 'Ohne Vignette keine Autobahn. Die E Vignette gibt es online bei via.admin.ch.',
              `vignette:${vig.fuer}:${h}`,
              'ticket',
            );
        }
        return gemeldet ? `${gemeldet} Meldungen` : undefined;
      },
    },
  ];

  const tageText = (t: number) => (t === 0 ? 'heute' : t < 0 ? 'fällig' : `in ${t} Tagen`);

  function hinweise(f: Ausgewertet): KachelZeile[] {
    const z: KachelZeile[] = [];
    if (f.mfkTage != null && f.mfkTage <= 60)
      z.push({ text: 'MFK', wert: tageText(f.mfkTage), status: f.mfkTage <= 14 ? 'warnung' : 'neutral' });
    if (f.service.tage != null && f.service.tage <= 30)
      z.push({
        text: 'Service',
        wert: tageText(f.service.tage),
        status: f.service.tage <= 7 ? 'warnung' : 'neutral',
      });
    if (f.reifen.wechseln)
      z.push({ text: `${f.reifen.soll}reifen montieren`, wert: 'jetzt', status: 'warnung' });
    else if (f.reifen_montiert && f.reifen_montiert !== 'Ganzjahr') {
      const t = tageZwischen(lokalDatum(ctx.jetzt()), f.reifen.ab);
      if (t <= 21)
        z.push({
          text: 'Reifenwechsel',
          wert: `ab ${t === 0 ? 'heute' : `in ${t} Tagen`}`,
          status: 'neutral',
        });
    }
    if (f.vignette.kaufen)
      z.push({
        text: `Vignette ${f.vignette.fuer}`,
        wert: f.vignette.gueltig ? 'kaufen' : 'fehlt',
        status: f.vignette.gueltig ? 'neutral' : 'warnung',
      });
    return z;
  }

  async function kachel(): Promise<Kachel> {
    const liste = (await alle()).filter((f) => f.aktiv);
    const f = liste[0];
    if (!f)
      return {
        status: 'neutral',
        titel: 'Fahrzeug',
        wert: '0',
        einheit: 'Fahrzeuge',
        unter: 'Noch kein Fahrzeug erfasst',
        demo: ctx.konfig.demo,
      };
    const zeilen = liste.flatMap((x) =>
      hinweise(x).map((z) => (liste.length > 1 ? { ...z, text: `${x.name}: ${z.text}` } : z)),
    );
    return {
      status: zeilen.some((z) => z.status === 'warnung') ? 'warnung' : 'ok',
      titel: liste.length > 1 ? 'Fahrzeuge' : f.name,
      wert:
        f.verbrauch.mittel != null
          ? f.verbrauch.mittel.toFixed(1)
          : (f.kmJetzt?.toLocaleString('de-CH') ?? '0'),
      einheit: f.verbrauch.mittel != null ? (f.treibstoff === 'Elektro' ? 'kWh/100 km' : 'l/100 km') : 'km',
      unter:
        f.verbrauch.mittel != null && f.kmJetzt != null
          ? `etwa ${f.kmJetzt.toLocaleString('de-CH')} km`
          : (f.modell ?? 'Noch keine Tankungen'),
      zeilen: zeilen.slice(0, 4),
      demo: ctx.konfig.demo,
    };
  }

  async function briefing(): Promise<BriefingTeil | null> {
    const zeilen = (await alle())
      .filter((f) => f.aktiv)
      .flatMap((f) =>
        hinweise(f)
          .filter((z) => z.status === 'warnung')
          .map((z) => ({ ...z, text: `${f.name}: ${z.text}` })),
      );
    if (!zeilen.length) return null;
    return {
      modul: 'fahrzeug',
      titel: 'Fahrzeug',
      zeilen: zeilen.slice(0, 4),
      status: 'warnung',
      reihenfolge: 29,
    };
  }

  async function suche(q: string): Promise<SuchTreffer[]> {
    const muster = { like: `%${q}%` };
    const [f, e] = await Promise.all([
      daten.liste<Fahrzeug>('fahrzeuge', { filter: { name: muster }, limit: 5 }),
      daten.liste<Eintrag>('fahrzeug_eintraege', { filter: { notiz: muster }, limit: 6 }),
    ]);
    return [
      ...f.map((x) => ({
        modul: 'fahrzeug',
        titel: x.name,
        text: [x.modell, x.kennzeichen].filter(Boolean).join(', '),
        link: '/modul/fahrzeug',
      })),
      ...e.map((x) => ({
        modul: 'fahrzeug',
        titel: `${x.art} ${x.datum}`,
        text: x.notiz ?? '',
        link: '/modul/fahrzeug#tab=Service',
      })),
    ];
  }

  async function timeline(von: Date, bis: Date): Promise<TimelineEintrag[]> {
    const v = lokalDatum(von);
    const b = lokalDatum(bis);
    const out: TimelineEintrag[] = [];
    for (const f of await alle()) {
      if (!f.aktiv) continue;
      if (f.mfk_faellig && f.mfk_faellig >= v && f.mfk_faellig <= b)
        out.push({
          id: `mfk-${f.id}`,
          modul: 'fahrzeug',
          art: 'MFK',
          titel: `MFK ${f.name}`,
          start: f.mfk_faellig,
          ganztags: true,
          link: '/modul/fahrzeug',
          status: 'warnung',
        });
      const s = f.service.faellig;
      if (s && s >= v && s <= b)
        out.push({
          id: `service-${f.id}-${s}`,
          modul: 'fahrzeug',
          art: 'Service',
          titel: `Service ${f.name}${f.service.kmDatum === s ? ' (geschätzt nach Kilometern)' : ''}`,
          start: s,
          ganztags: true,
          link: '/modul/fahrzeug',
          status: 'neutral',
        });
    }
    return out;
  }

  return { routen, jobs, kachel, briefing, suche, timeline };
}
