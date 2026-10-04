// Modul Rettung: Helikopter (ADS-B), Alertswiss, Unwetter, Erdbeben, Einsatzmeldungen, Rega Statistik und Kartenebenen.
import type { FastifyInstance } from 'fastify';
import type { Ampel, Ebene, GeoPunkt, Kachel, PunkteAntwort, SuchTreffer } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { GEOADMIN_NAMENSNENNUNG, WMS, WMTS } from '../../quellen/geoadmin.ts';
import { distanzKm, richtungText } from '../../quellen/geo.ts';
import { httpJson } from '../../quellen/http.ts';
import {
  demoAlerts,
  demoErdbeben,
  demoFluege,
  demoHelis,
  demoLawinen,
  demoMeldungen,
  demoOsm,
  demoWarnungen,
} from './demo.ts';
import {
  type AdsbFlugzeug,
  ADSB_NAMENSNENNUNG,
  adsbHolen,
  type Flug,
  FlugErkennung,
  flugStatistik,
  type HeliPosition,
  heliFiltern,
  platzBei,
  type Kennung,
} from './heli.ts';
import {
  type Alert,
  alertInRegion,
  alertswissHolen,
  type Erdbeben,
  erdbebenHolen,
  feedHolen,
  istErdbeben,
  kategorie,
  type Meldung,
  METEOALARM_URL,
  meteoalarmParsen,
  type OsmObjekt,
  opendatasoftMeldungen,
  overpassHolen,
  polygonMitte,
  SCHWERE_STUFE,
  STAPO_SG_URL,
  type Warnung,
  warnungFuerGebiete,
} from './quellen.ts';
import { RETTUNG_TABELLEN } from './tabellen.ts';

export interface Lawine {
  region: string;
  stufe: string;
  gueltigBis: string | null;
}

const LAWINEN_STUFE: Record<string, number> = { low: 1, moderate: 2, considerable: 3, high: 4, very_high: 5 };

export const STANDARD_KENNUNGEN: Kennung[] = [
  // Quelle: Flottenangaben Rega (AW109SP HB-ZRx, H145 HB-TIx). Bitte zuhause prüfen und ergänzen.
  { organisation: 'Rega', muster: 'HB-ZR*' },
  { organisation: 'Rega', muster: 'HB-TI*' },
];

export const rettung: ModulDef = {
  id: 'rettung',
  name: 'Rettung',
  beschreibung: 'Helikopter, Alertswiss, Warnungen, Erdbeben, Einsätze und Rega Statistik',
  symbol: 'rettung',
  reihenfolge: 20,
  tabellen: RETTUNG_TABELLEN,
  regeln: [
    {
      id: 'heli',
      name: 'Helikopter Aktivität in der Region',
      beschreibung:
        'Ein Helikopter aus der Kennzeichen Liste (mit Push) startet oder fliegt in die Region ein.',
      prioritaet: 3,
      cooldownMin: 20,
    },
    {
      id: 'alertswiss',
      name: 'Alertswiss Meldung in der Region',
      beschreibung:
        'Neue Meldung von Alertswiss, die die Region betrifft. Schwelle: Schwere (1 gering, 2 mittel, 3 gross, 4 extrem).',
      schwelle: 1,
      schwelleLabel: 'Schwere',
      prioritaet: 4,
      cooldownMin: 1440,
    },
    {
      id: 'unwetter',
      name: 'Unwetterwarnung',
      beschreibung:
        'Warnung von MeteoSchweiz (über MeteoAlarm) für ein gespeichertes Gebiet ab der Schwelle (3 = orange).',
      schwelle: 3,
      schwelleLabel: 'Stufe',
      prioritaet: 4,
      cooldownMin: 720,
    },
    {
      id: 'erdbeben',
      name: 'Erdbeben',
      beschreibung: 'Erdbeben in der Schweiz und Umgebung ab der Magnitude der Schwelle (SED).',
      schwelle: 3,
      schwelleLabel: 'Magnitude',
      prioritaet: 3,
      cooldownMin: 60,
    },
  ],
  erstellen: (ctx) => rettungLaufzeit(ctx),
};

function rettungLaufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  const region = { lat: konfig.region.lat, lon: konfig.region.lon, radiusKm: konfig.region.radiusKm };
  const erkennung = new FlugErkennung();
  let positionen: HeliPosition[] = [];
  let positionenStand: string | null = null;
  let positionenFehler: string | undefined;
  const bekannteAlerts = new Set<string>();
  const bekannteBeben = new Set<string>();
  const ersterLauf = { alerts: true, beben: true };
  let demoFluegeAngelegt: Promise<void> | null = null;

  const adsb = ctx.quelle<void, AdsbFlugzeug[]>({
    id: 'rettung.adsb',
    wichtig: true,
    name: 'ADS-B (adsb.lol)',
    modul: 'rettung',
    ttlSek: 20,
    abruf: () => adsbHolen(region.lat, region.lon, region.radiusKm),
    demo: () => demoHelis(ctx.jetzt().getTime(), region),
    namensnennung: ADSB_NAMENSNENNUNG,
    beschreibung: 'Nur Luftfahrzeuge mit eingeschaltetem Transponder sind sichtbar.',
  });
  const alertswiss = ctx.quelle<void, Alert[]>({
    id: 'rettung.alertswiss',
    wichtig: true,
    name: 'Alertswiss',
    modul: 'rettung',
    ttlSek: 120,
    abruf: () => alertswissHolen(),
    demo: () => demoAlerts(region),
    namensnennung: 'Alertswiss, Bundesamt für Bevölkerungsschutz',
  });
  const meteoalarm = ctx.quelle<void, Warnung[]>({
    id: 'rettung.unwetter',
    wichtig: true,
    name: 'Unwetterwarnungen (MeteoAlarm)',
    modul: 'rettung',
    ttlSek: 600,
    abruf: async () => meteoalarmParsen(await httpJson(METEOALARM_URL, { timeoutMs: 15000 })),
    demo: () => demoWarnungen(ctx.jetzt()),
    namensnennung: 'MeteoSchweiz über MeteoAlarm (EUMETNET)',
    ungetestet: true,
    beschreibung: 'Schweizer Feed war beim Bau leer, Format vom deutschen Feed geprüft.',
  });
  const sed = ctx.quelle<void, Erdbeben[]>({
    id: 'rettung.erdbeben',
    wichtig: true,
    name: 'Erdbeben (SED, ETH Zürich)',
    modul: 'rettung',
    ttlSek: 300,
    abruf: () => erdbebenHolen(),
    demo: () => demoErdbeben(ctx.jetzt()),
    namensnennung: 'Schweizerischer Erdbebendienst (SED) an der ETH Zürich',
  });
  const lawinen = ctx.quelle<void, Lawine[]>({
    id: 'rettung.lawinen',
    name: 'Lawinenbulletin (SLF)',
    modul: 'rettung',
    ttlSek: 1800,
    abruf: async () => {
      const d = await httpJson<{
        bulletins?: {
          validTime?: { endTime?: string };
          dangerRatings?: { mainValue?: string }[];
          regions?: { name?: string }[];
        }[];
      }>('https://aws.slf.ch/api/bulletin/caaml/de/json', { timeoutMs: 15000, maxBytes: 8_000_000 });
      return (d.bulletins ?? []).flatMap((b) => {
        const stufe =
          (b.dangerRatings ?? [])
            .map((r) => r.mainValue ?? '')
            .sort((x, y) => (LAWINEN_STUFE[y] ?? 0) - (LAWINEN_STUFE[x] ?? 0))[0] ?? '';
        return (b.regions ?? []).map((r) => ({
          region: r.name ?? '',
          stufe,
          gueltigBis: b.validTime?.endTime ?? null,
        }));
      });
    },
    demo: () => demoLawinen(ctx.jetzt()),
    namensnennung: 'WSL Institut für Schnee und Lawinenforschung SLF',
    ungetestet: true,
    beschreibung: 'Ausserhalb des Winters leer. Format nach CAAML v6, im Winter prüfen.',
  });
  const osm = ctx.quelle<string, OsmObjekt[]>({
    id: 'rettung.osm',
    name: 'OpenStreetMap (Overpass)',
    modul: 'rettung',
    ttlSek: 7 * 86400,
    abruf: (art) => overpassHolen(art, region),
    demo: (art) => demoOsm(art, region),
    namensnennung: '© OpenStreetMap Mitwirkende (ODbL)',
    ungetestet: true,
    beschreibung: 'Overpass war von der Entwicklungsumgebung nicht erreichbar.',
    testParameter: () => 'spital',
  });
  const meldungen = ctx.quelle<void, Meldung[]>({
    id: 'rettung.meldungen',
    name: 'Medienmitteilungen (Stadtpolizei St.Gallen und eigene Feeds)',
    modul: 'rettung',
    ttlSek: 900,
    abruf: async () => {
      const liste = opendatasoftMeldungen(
        await httpJson(STAPO_SG_URL, { timeoutMs: 15000 }),
        'Stadtpolizei St.Gallen',
      );
      for (const f of konfig.einsatzFeeds) {
        try {
          liste.push(...(await feedHolen(f.name, f.url)));
        } catch (e) {
          ctx.log.warn({ feed: f.name, fehler: String(e) }, 'Feed nicht lesbar');
        }
      }
      return liste;
    },
    demo: () => demoMeldungen(ctx.jetzt()),
    namensnennung: 'Stadt St.Gallen, Open Data (CC BY) und konfigurierte Feeds',
  });
  const gemeinde = ctx.quelle<string, string | null>({
    id: 'rettung.gemeinde',
    name: 'Gemeinde zu Koordinaten (geo.admin.ch)',
    modul: 'rettung',
    ttlSek: 30 * 86400,
    abruf: async (schluessel) => {
      const [lat, lon] = schluessel.split(',').map(Number);
      const jahr = new Date().getFullYear() - 1;
      const d = await httpJson<{ results: { attributes: { gemname?: string; kanton?: string } }[] }>(
        `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryPoint&geometry=${lon},${lat}&sr=4326&layers=all:ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill&tolerance=0&mapExtent=5,45,11,48&imageDisplay=500,500,96&returnGeometry=false&lang=de&timeInstant=${jahr}`,
        { timeoutMs: 10000 },
      );
      return d.results[0]?.attributes.gemname ?? null;
    },
    demo: () => null,
    namensnennung: GEOADMIN_NAMENSNENNUNG,
    testParameter: () => '47.41,9.04',
  });

  async function ortName(lat: number, lon: number): Promise<string | null> {
    const r = await gemeinde.hole(`${lat.toFixed(2)},${lon.toFixed(2)}`);
    if (r.daten) return r.daten;
    // Rückfall: nächster gespeicherter Ort mit Richtung
    const naechster = [...konfig.wetterOrte].sort(
      (a, b) => distanzKm(lat, lon, a.lat, a.lon) - distanzKm(lat, lon, b.lat, b.lon),
    )[0];
    if (!naechster) return null;
    const km = Math.round(distanzKm(naechster.lat, naechster.lon, lat, lon));
    const grad = (Math.atan2(lon - naechster.lon, lat - naechster.lat) * 180) / Math.PI;
    return km < 2 ? naechster.name : `${km} km ${richtungText(grad)} von ${naechster.name}`;
  }

  /** Spital oder Landeplatz an der Position, aus dem Cache der Kartenebenen (eine Woche) */
  async function platzName(lat: number | null, lon: number | null): Promise<string | null> {
    if (lat === null || lon === null) return null;
    const [spitaeler, landeplaetze] = await Promise.all([osm.hole('spital'), osm.hole('landeplatz')]);
    return platzBei(lat, lon, spitaeler.daten ?? [], landeplaetze.daten ?? []);
  }

  async function kennungen(): Promise<(Kennung & { push: boolean })[]> {
    const liste = await daten.liste<{ organisation: string; muster: string; push: boolean }>(
      'heli_kennungen',
      { limit: 200 },
    );
    if (!liste.length && !ctx.einstellungen.hole('rettung.kennungen_angelegt', false)) {
      await daten.einfuegen(
        'heli_kennungen',
        STANDARD_KENNUNGEN.map((k) => ({ ...k, push: true, notizen: 'Standard, bitte prüfen' })),
      );
      await ctx.einstellungen.setze('rettung.kennungen_angelegt', true);
      return STANDARD_KENNUNGEN.map((k) => ({ ...k, push: true }));
    }
    return liste;
  }

  async function flugSpeichern(f: Flug, startPlatz: string | null, endePlatz: string | null) {
    await daten.einfuegen('heli_fluege', [
      {
        hex: f.hex,
        kennzeichen: f.kennzeichen,
        typ: f.typ,
        organisation: f.organisation,
        start: new Date(f.start).toISOString(),
        start_art: f.startArt,
        start_lat: f.startLat,
        start_lon: f.startLon,
        start_ort: await ortName(f.startLat, f.startLon),
        ende: f.ende ? new Date(f.ende).toISOString() : null,
        ende_art: f.endeArt,
        ende_lat: f.endeLat,
        ende_lon: f.endeLon,
        ende_ort: f.endeLat !== null && f.endeLon !== null ? await ortName(f.endeLat, f.endeLon) : null,
        max_hoehe_ft: f.maxHoeheFt,
        spur: f.spur.map(([la, lo]) => [la, lo]),
        start_platz: startPlatz,
        ende_platz: endePlatz,
      },
    ]);
  }

  const helisMetrik = ctx.metrik({
    id: 'rettung.helis',
    name: 'Helikopter in der Luft',
    richtung: 'hoch',
    minAbweichung: 3,
    minDauerMin: 20,
  });

  async function heliRunde() {
    const r = await adsb.hole(undefined, true);
    positionenFehler = r.fehler;
    if (!r.daten) return 'keine Daten';
    const k = await kennungen();
    const jetzt = ctx.jetzt().getTime();
    positionen = heliFiltern(r.daten, k, konfig.heliAlle, region, jetzt);
    await helisMetrik(positionen.length);
    positionenStand = r.stand;
    const ereignisse = erkennung.aktualisieren(positionen, jetzt);
    for (const e of ereignisse) {
      const f = e.flug;
      const name = `${f.organisation ?? 'Helikopter'} ${f.kennzeichen ?? f.hex}`;
      const mitPush = !!f.organisation && k.some((x) => x.push && x.organisation === f.organisation);
      // Nur ein echter Start hat einen Startplatz, beim Erfassen ist der Heli schon unterwegs
      const startPlatz = f.startArt === 'start' ? await platzName(f.startLat, f.startLon) : null;
      if (e.art === 'landung' || e.art === 'signalverlust') {
        const endePlatz = await platzName(f.endeLat, f.endeLon);
        await flugSpeichern(f, startPlatz, endePlatz);
        const wo = endePlatz ? ` bei ${endePlatz}` : '';
        await ctx.aktivitaet(
          'rettung',
          `${name} ${e.art === 'landung' ? 'gelandet' : 'aus dem Empfang verschwunden'}${wo}`,
        );
        // Landung bei einem Spital ist meist ein Patiententransport: eigener Push
        if (mitPush && endePlatz) {
          await ctx.alarm.melden({
            regel: 'rettung.heli',
            titel: `${name} ${e.art === 'landung' ? 'gelandet' : 'wohl gelandet'}: ${endePlatz}`,
            text: `${e.art === 'landung' ? 'Gelandet' : 'Signal tief verloren, wahrscheinlich gelandet'} bei ${endePlatz}${startPlatz ? `, gestartet bei ${startPlatz}` : ''}. Flugdauer ${Math.max(1, Math.round(((f.ende ?? jetzt) - f.start) / 60000))} min. Nur Daten des Transponders, ohne Gewähr.`,
            schluessel: `heli-landung:${f.hex}`,
            tags: ['helicopter', 'hospital'],
            link: '/modul/rettung',
          });
        }
        continue;
      }
      const ort = await ortName(f.startLat, f.startLon);
      const wo = startPlatz ? `${startPlatz} (${ort ?? 'unbekannt'})` : (ort ?? 'unbekannt');
      await ctx.aktivitaet('rettung', `${name} ${e.art === 'start' ? 'gestartet' : 'erfasst'} bei ${wo}`);
      if (mitPush) {
        await ctx.alarm.melden({
          regel: 'rettung.heli',
          titel: `${name} ${e.art === 'start' ? 'gestartet' : 'in der Region'}`,
          text: `${e.art === 'start' ? 'Start' : 'Erfasst'} bei ${wo}${f.typ ? `, Typ ${f.typ}` : ''}. Nur Daten des Transponders, zeitnah aber ohne Gewähr.`,
          schluessel: `heli:${f.hex}`,
          tags: ['helicopter'],
          link: '/modul/rettung',
        });
      }
    }
    return positionen.length ? `${positionen.length} Helikopter` : undefined;
  }

  async function demoVorbereiten() {
    if (!konfig.demo) return;
    demoFluegeAngelegt ??= (async () => {
      if ((await daten.anzahl('heli_fluege')) > 0) return;
      await kennungen();
      await daten.einfuegen('heli_fluege', demoFluege(ctx.jetzt(), region));
      if ((await daten.anzahl('webcams')) === 0) {
        await daten.einfuegen('webcams', [
          { name: 'Demo Webcam Säntis Blick', lat: 47.3, lon: 9.25, bild_url: null, link: null },
        ]);
      }
    })();
    await demoFluegeAngelegt;
  }

  async function meldungenAktualisieren() {
    const r = await meldungen.hole();
    let neu = 0;
    for (const m of r.daten ?? []) {
      if (!m.link || (await daten.anzahl('einsatz_meldungen', { link: m.link }))) continue;
      await daten.einfuegen('einsatz_meldungen', [{ ...m, kategorie: kategorie(m) }]);
      neu++;
    }
    return neu;
  }

  async function alertsPruefen() {
    const r = await alertswiss.hole();
    for (const a of r.daten ?? []) {
      if (a.test || bekannteAlerts.has(a.id)) continue;
      bekannteAlerts.add(a.id);
      if (ersterLauf.alerts || !alertInRegion(a, region)) continue;
      await ctx.alarm.melden({
        regel: 'rettung.alertswiss',
        titel: `Alertswiss: ${a.titel}`,
        text: `${a.herausgeber}: ${a.text.slice(0, 400)}`,
        wert: SCHWERE_STUFE[a.schwere] ?? 1,
        schluessel: `alert:${a.id}`,
        prioritaet: a.schwere === 'extreme' || a.schwere === 'severe' ? 5 : undefined,
        tags: ['warning'],
      });
    }
    ersterLauf.alerts = false;
  }

  async function warnungenPruefen() {
    const r = await meteoalarm.hole();
    for (const w of (r.daten ?? []).filter((x) => warnungFuerGebiete(x, konfig.warnGebiete))) {
      await ctx.alarm.melden({
        regel: 'rettung.unwetter',
        titel: `Warnung Stufe ${w.stufe}: ${w.ereignis}`,
        text: `${w.gebiet}${w.beginn ? ` ab ${new Date(w.beginn).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. ${w.text.slice(0, 300)}`,
        wert: w.stufe,
        schluessel: `unwetter:${w.id}`,
        tags: ['cloud_with_lightning'],
      });
    }
  }

  async function bebenPruefen() {
    const r = await sed.hole();
    for (const e of (r.daten ?? []).filter(istErdbeben)) {
      if (bekannteBeben.has(e.id)) continue;
      bekannteBeben.add(e.id);
      if (ersterLauf.beben) continue;
      await ctx.alarm.melden({
        regel: 'rettung.erdbeben',
        titel: `Erdbeben M${e.magnitude} ${e.ort}`,
        text: `${new Date(e.zeit).toLocaleString('de-CH', { timeZone: 'Europe/Zurich' })}, Tiefe ${e.tiefeKm} km, ${Math.round(distanzKm(region.lat, region.lon, e.lat, e.lon))} km entfernt.`,
        wert: e.magnitude,
        schluessel: `beben:${e.id}`,
      });
    }
    ersterLauf.beben = false;
  }

  const jobs = [
    { id: 'heli', name: 'Helikopter verfolgen', intervallSek: 30, startVerzoegerungSek: 25, lauf: heliRunde },
    {
      id: 'lage',
      name: 'Alertswiss, Warnungen, Erdbeben',
      intervallSek: 180,
      startVerzoegerungSek: 40,
      lauf: async () => {
        await alertsPruefen();
        await warnungenPruefen();
        await bebenPruefen();
        return undefined;
      },
    },
    {
      id: 'meldungen',
      name: 'Medienmitteilungen abrufen',
      intervallSek: 900,
      startVerzoegerungSek: 60,
      lauf: async () => {
        await demoVorbereiten();
        const n = await meldungenAktualisieren();
        return n ? `${n} neue Meldungen` : undefined;
      },
    },
    {
      id: 'aufraeumen',
      name: 'Alte Einsatzmeldungen löschen',
      taeglich: '03:45',
      lauf: async () => {
        const grenze = new Date(ctx.jetzt().getTime() - 365 * 86400000).toISOString();
        const n = await daten.loescheWo('einsatz_meldungen', { zeit: { lt: grenze } });
        return `${n} gelöscht`;
      },
    },
  ];

  const ZEIT = (iso: string) =>
    new Date(iso).toLocaleString('de-CH', {
      timeZone: 'Europe/Zurich',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function routen(app: FastifyInstance) {
    app.get('/helis', async (): Promise<PunkteAntwort> => {
      if (!positionenStand) await heliRunde().catch(() => undefined);
      const punkte: GeoPunkt[] = positionen.map((p) => ({
        id: p.hex,
        lat: p.lat,
        lon: p.lon,
        titel: `${p.organisation ?? 'Helikopter'} ${p.kennzeichen ?? p.hex}`,
        text: [
          p.typ,
          p.rufzeichen,
          p.amBoden ? 'am Boden' : p.hoeheFt !== null ? `${p.hoeheFt} ft` : null,
          p.speedKn !== null ? `${Math.round(p.speedKn * 1.852)} km/h` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        symbol: 'heli',
        farbe: p.organisation === 'Rega' ? '#ff5d5d' : p.organisation ? '#fb923c' : '#94a3b8',
        richtung: p.kurs ?? undefined,
        zeit: new Date(p.zeit).toISOString(),
      }));
      return {
        punkte,
        stand: positionenStand,
        demo: konfig.demo,
        fehler: positionenFehler,
        hinweis: 'Nur Luftfahrzeuge mit eingeschaltetem Transponder sind sichtbar.',
      };
    });

    app.get<{ Querystring: { organisation?: string; tage?: string } }>('/statistik', async (req) => {
      await demoVorbereiten();
      const tage = Math.min(Number(req.query.tage) || 90, 730);
      const seit = new Date(ctx.jetzt().getTime() - tage * 86400000).toISOString();
      const filter: Record<string, unknown> = { start: { gte: seit } };
      if (req.query.organisation && req.query.organisation !== 'alle')
        filter.organisation = req.query.organisation;
      const fluege = await daten.liste<{
        start: string;
        start_lat: number | null;
        start_lon: number | null;
        ende_lat: number | null;
        ende_lon: number | null;
        start_ort: string | null;
        ende_ort: string | null;
        organisation: string | null;
        kennzeichen: string | null;
        ende: string | null;
      }>('heli_fluege', { filter, sortierung: '-start', limit: 5000 });
      const orte = new Map<string, number>();
      for (const f of fluege)
        for (const o of [f.start_ort, f.ende_ort]) if (o) orte.set(o, (orte.get(o) ?? 0) + 1);
      return {
        ...flugStatistik(fluege),
        orte: [...orte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
        letzte: fluege.slice(0, 25),
        laufend: erkennung.laufende().length,
        organisationen: [
          ...new Set(
            (await daten.liste<{ organisation: string }>('heli_kennungen', { limit: 200 })).map(
              (k) => k.organisation,
            ),
          ),
        ],
      };
    });

    app.get('/heatmap', async (): Promise<PunkteAntwort> => {
      await demoVorbereiten();
      const fluege = await daten.liste<{
        start: string;
        start_lat: number | null;
        start_lon: number | null;
        ende_lat: number | null;
        ende_lon: number | null;
      }>('heli_fluege', {
        filter: { organisation: 'Rega' },
        limit: 5000,
      });
      return {
        punkte: [],
        heat: flugStatistik(fluege).heat,
        stand: ctx.jetzt().toISOString(),
        demo: konfig.demo,
      };
    });

    app.get('/lage', async () => {
      await demoVorbereiten();
      const [a, w, e, l] = await Promise.all([
        alertswiss.hole(),
        meteoalarm.hole(),
        sed.hole(),
        lawinen.hole(),
      ]);
      return {
        alerts: (a.daten ?? [])
          .filter((x) => !x.test)
          .map((x) => ({ ...x, polygone: undefined, inRegion: alertInRegion(x, region) })),
        alertsStand: a.stand,
        warnungen: (w.daten ?? []).filter((x) => warnungFuerGebiete(x, konfig.warnGebiete)),
        warnungenAlle: (w.daten ?? []).length,
        warnGebiete: konfig.warnGebiete,
        erdbeben: (e.daten ?? [])
          .filter(istErdbeben)
          .slice(0, 30)
          .map((x) => ({ ...x, distanzKm: Math.round(distanzKm(region.lat, region.lon, x.lat, x.lon)) })),
        lawinen: l.daten ?? [],
        fehler: { alerts: a.fehler, warnungen: w.fehler, erdbeben: e.fehler, lawinen: l.fehler },
        demo: konfig.demo,
      };
    });

    app.get('/meldungen', async () => {
      await demoVorbereiten();
      if ((await daten.anzahl('einsatz_meldungen')) === 0) await meldungenAktualisieren();
      return {
        meldungen: await daten.liste('einsatz_meldungen', { sortierung: '-zeit', limit: 60 }),
        hinweis: 'Öffentliche Medienmitteilungen, erscheinen erst Stunden bis Tage nach dem Ereignis.',
        quellen: [
          'Stadtpolizei St.Gallen (daten.stadt.sg.ch, CC BY)',
          ...konfig.einsatzFeeds.map((f) => f.name),
        ],
      };
    });

    app.get('/alerts/punkte', async (): Promise<PunkteAntwort> => {
      const r = await alertswiss.hole();
      const punkte: GeoPunkt[] = (r.daten ?? [])
        .filter((a) => !a.test && a.polygone.length)
        .map((a) => {
          const [lat, lon] = polygonMitte(a.polygone[0]);
          return {
            id: a.id,
            lat,
            lon,
            titel: a.titel,
            text: `${a.herausgeber}\n${a.text.slice(0, 200)}`,
            symbol: 'warnung',
            farbe: a.schwere === 'severe' || a.schwere === 'extreme' ? '#f87171' : '#fbbf24',
            link: a.link ?? undefined,
          };
        });
      return { punkte, stand: r.stand, demo: r.demo, fehler: r.fehler };
    });

    app.get('/erdbeben/punkte', async (): Promise<PunkteAntwort> => {
      const r = await sed.hole();
      const punkte: GeoPunkt[] = (r.daten ?? []).filter(istErdbeben).map((e) => ({
        id: e.id,
        lat: e.lat,
        lon: e.lon,
        titel: `M${e.magnitude} ${e.ort}`,
        text: `Tiefe ${e.tiefeKm} km`,
        symbol: 'erdbeben',
        groesse: Math.round(18 + Math.max(0, e.magnitude) * 6),
        zeit: e.zeit,
      }));
      return { punkte, stand: r.stand, demo: r.demo, fehler: r.fehler };
    });

    app.get<{ Params: { art: string } }>('/osm/:art', async (req): Promise<PunkteAntwort> => {
      const art = req.params.art;
      if (!['spital', 'wache', 'landeplatz', 'defi'].includes(art))
        return { punkte: [], stand: null, demo: false, fehler: 'Unbekannt' };
      const r = await osm.hole(art);
      const punkte: GeoPunkt[] = (r.daten ?? []).map((o) => ({
        id: o.id,
        lat: o.lat,
        lon: o.lon,
        titel:
          o.name ||
          {
            spital: 'Spital',
            wache: 'Rettungswache',
            landeplatz: 'Helikopterlandeplatz',
            defi: 'Defibrillator',
          }[art]!,
        text: [
          o.tags['addr:street'],
          o.tags['addr:city'],
          o.tags.opening_hours ? `Offen: ${o.tags.opening_hours}` : null,
          o.tags['defibrillator:location'],
        ]
          .filter(Boolean)
          .join('\n'),
        symbol: art as GeoPunkt['symbol'],
      }));
      return { punkte, stand: r.stand, demo: r.demo, fehler: r.fehler };
    });

    app.get('/webcams/punkte', async (): Promise<PunkteAntwort> => {
      await demoVorbereiten();
      const liste = await daten.liste<{
        id: string;
        name: string;
        lat: number;
        lon: number;
        bild_url: string | null;
        link: string | null;
      }>('webcams', { limit: 200 });
      return {
        punkte: liste.map((w) => ({
          id: w.id,
          lat: w.lat,
          lon: w.lon,
          titel: w.name,
          symbol: 'webcam',
          bild: w.bild_url ?? undefined,
          link: w.link ?? undefined,
        })),
        stand: ctx.jetzt().toISOString(),
        demo: konfig.demo,
        hinweis: 'Eigene Liste im Modul Rettung, Tab Webcams',
      };
    });
  }

  function ebenen(): Ebene[] {
    const nv = (text: string) => text;
    return [
      {
        id: 'rettung.helis',
        name: 'Helikopter (ADS-B)',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/helis',
        aktualisierenSek: 20,
        namensnennung: ADSB_NAMENSNENNUNG,
        standardAn: true,
        hinweis: 'Nur Luftfahrzeuge mit eingeschaltetem Transponder sind sichtbar.',
      },
      {
        id: 'rettung.heatmap',
        name: 'Rega Einsätze (Heatmap)',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'heatmap',
        datenUrl: '/api/m/rettung/heatmap',
        namensnennung: ADSB_NAMENSNENNUNG,
        hinweis: 'Start und Landeorte der erfassten Flüge',
      },
      {
        id: 'rettung.spital',
        name: 'Spitäler mit Notfall',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/osm/spital',
        namensnennung: '© OpenStreetMap Mitwirkende',
      },
      {
        id: 'rettung.wache',
        name: 'Rettungswachen',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/osm/wache',
        namensnennung: '© OpenStreetMap Mitwirkende',
      },
      {
        id: 'rettung.landeplatz',
        name: 'Heli Landeplätze (OSM)',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/osm/landeplatz',
        namensnennung: '© OpenStreetMap Mitwirkende',
      },
      {
        id: 'rettung.spitallandeplaetze',
        name: 'Spitallandeplätze (BAZL)',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'wmts',
        url: WMTS('ch.bazl.spitallandeplaetze'),
        namensnennung: '© BAZL, swisstopo',
      },
      {
        id: 'rettung.gebirgslandeplaetze',
        name: 'Gebirgslandeplätze (BAZL)',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'wmts',
        url: WMTS('ch.bazl.gebirgslandeplaetze'),
        namensnennung: '© BAZL, swisstopo',
      },
      {
        id: 'rettung.defi',
        name: 'Defibrillatoren (OSM)',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/osm/defi',
        namensnennung: '© OpenStreetMap Mitwirkende',
        hinweis: 'Nur von Freiwilligen erfasste Geräte, unvollständig.',
      },
      {
        id: 'rettung.alertswiss',
        name: 'Alertswiss Meldungen',
        gruppe: 'Gefahren',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/alerts/punkte',
        aktualisierenSek: 300,
        namensnennung: 'Alertswiss',
        standardAn: true,
      },
      {
        id: 'rettung.erdbeben',
        name: 'Erdbeben (7 Tage)',
        gruppe: 'Gefahren',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/erdbeben/punkte',
        aktualisierenSek: 600,
        namensnennung: 'SED, ETH Zürich',
      },
      {
        id: 'rettung.hochwasser',
        name: 'Hochwasser Warnkarte',
        gruppe: 'Gefahren',
        modul: 'rettung',
        art: 'wms',
        url: WMS,
        wmsLayer: 'ch.bafu.hydroweb-warnkarte_national',
        deckkraft: 0.6,
        namensnennung: '© BAFU, swisstopo',
      },
      {
        id: 'rettung.pegel',
        name: 'Pegel und Gefahrenstufen',
        gruppe: 'Gefahren',
        modul: 'rettung',
        art: 'wms',
        url: WMS,
        wmsLayer: 'ch.bafu.hydroweb-messstationen_gefahren',
        namensnennung: '© BAFU, swisstopo',
      },
      {
        id: 'rettung.waldbrand',
        name: 'Waldbrandgefahr',
        gruppe: 'Gefahren',
        modul: 'rettung',
        art: 'wms',
        url: WMS,
        wmsLayer: 'ch.bafu.gefahren-waldbrand_warnung',
        deckkraft: 0.55,
        namensnennung: '© BAFU, Kantone, swisstopo',
      },
      {
        id: 'rettung.unwetter',
        name: 'Unwetterwarnungen',
        gruppe: 'Gefahren',
        modul: 'rettung',
        art: 'punkte',
        namensnennung: 'MeteoSchweiz',
        nichtVerfuegbar: nv(
          'MeteoAlarm liefert keine Geometrien. Warnungen stehen im Modul Rettung als Liste.',
        ),
      },
      {
        id: 'rettung.lawinen',
        name: 'Lawinengefahr',
        gruppe: 'Gefahren',
        modul: 'rettung',
        art: 'punkte',
        namensnennung: 'SLF',
        nichtVerfuegbar: nv('Lawinenbulletin als Liste im Modul Rettung (Karte im Winter prüfen).'),
      },
      {
        id: 'rettung.blitze',
        name: 'Blitze live',
        gruppe: 'Gefahren',
        modul: 'rettung',
        art: 'punkte',
        namensnennung: '',
        nichtVerfuegbar: nv(
          'Keine offene Quelle mit erlaubter Nutzung gefunden (Blitzortung.org verbietet die Weiterverwendung).',
        ),
      },
      {
        id: 'rettung.verkehr',
        name: 'Verkehrslage und Pässe',
        gruppe: 'Gefahren',
        modul: 'rettung',
        art: 'punkte',
        namensnennung: '',
        nichtVerfuegbar: nv('Nur mit Schlüssel von opentransportdata.swiss (DATEX II), noch nicht gebaut.'),
      },
      {
        id: 'rettung.webcams',
        name: 'Webcams',
        gruppe: 'Wetter',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/webcams/punkte',
        namensnennung: 'Betreiber der Webcams',
      },
    ];
  }

  async function kachel(): Promise<Kachel> {
    await demoVorbereiten();
    const [a, w] = await Promise.all([alertswiss.hole(), meteoalarm.hole()]);
    const alerts = (a.daten ?? []).filter((x) => !x.test && alertInRegion(x, region));
    const warnungen = (w.daten ?? []).filter(
      (x) => warnungFuerGebiete(x, konfig.warnGebiete) && x.stufe >= 2,
    );
    if (!positionenStand) await heliRunde().catch(() => undefined);
    const inDerLuft = positionen.filter((p) => !p.amBoden);
    const heute = await daten.anzahl('heli_fluege', {
      start: { gte: new Date(ctx.jetzt().getTime() - 86400000).toISOString() },
    });
    let status: Ampel = 'ok';
    if (alerts.length || warnungen.some((x) => x.stufe >= 3)) status = 'warnung';
    return {
      status,
      titel: 'Rettung',
      wert: String(inDerLuft.length),
      einheit: inDerLuft.length === 1 ? 'Heli in der Luft' : 'Helis in der Luft',
      unter: `${heute} Flüge in 24 h erfasst`,
      zeilen: [
        ...inDerLuft.slice(0, 2).map((p) => ({
          text: `${p.organisation ?? 'Heli'} ${p.kennzeichen ?? ''}`,
          wert: p.hoeheFt !== null ? `${p.hoeheFt} ft` : '',
          status: 'warnung' as Ampel,
        })),
        {
          text: 'Alertswiss Region',
          wert: String(alerts.length),
          status: (alerts.length ? 'warnung' : 'ok') as Ampel,
        },
        {
          text: 'Unwetterwarnungen',
          wert: warnungen.length ? `Stufe ${Math.max(...warnungen.map((x) => x.stufe))}` : 'keine',
          status: (warnungen.length ? 'warnung' : 'ok') as Ampel,
        },
      ],
      demo: konfig.demo,
    };
  }

  async function briefing() {
    await demoVorbereiten();
    const seit = new Date(ctx.jetzt().getTime() - 12 * 3600000).toISOString();
    const fluege = await daten.liste<{
      organisation: string | null;
      kennzeichen: string | null;
      start: string;
      start_ort: string | null;
    }>('heli_fluege', {
      filter: { start: { gte: seit } },
      sortierung: '-start',
      limit: 10,
    });
    const meld = await daten.liste<{ titel: string; zeit: string; kategorie: string }>('einsatz_meldungen', {
      filter: { zeit: { gte: new Date(ctx.jetzt().getTime() - 24 * 3600000).toISOString() } },
      sortierung: '-zeit',
      limit: 5,
    });
    const zeilen = [
      ...fluege.slice(0, 3).map((f) => ({
        text: `${f.organisation ?? 'Heli'} ${f.kennzeichen ?? ''} ${f.start_ort ? `bei ${f.start_ort}` : ''}`,
        wert: ZEIT(f.start),
      })),
      ...meld
        .filter((m) => m.kategorie !== 'Mitteilung')
        .slice(0, 3)
        .map((m) => ({ text: m.titel, wert: m.kategorie })),
    ];
    if (!zeilen.length) zeilen.push({ text: 'Ruhige Nacht, keine Flüge erfasst', wert: '' });
    return {
      modul: 'rettung',
      titel: 'Einsätze der Nacht',
      zeilen,
      status: 'neutral' as Ampel,
      reihenfolge: 40,
    };
  }

  async function suche(q: string): Promise<SuchTreffer[]> {
    const fluege = await daten.liste<{
      id: string;
      kennzeichen: string;
      start: string;
      organisation: string | null;
    }>('heli_fluege', {
      filter: { kennzeichen: { like: `%${q}%` } },
      sortierung: '-start',
      limit: 5,
    });
    return fluege.map((f) => ({
      modul: 'rettung',
      titel: `${f.organisation ?? 'Heli'} ${f.kennzeichen}`,
      text: `Flug ${ZEIT(f.start)}`,
      link: '/modul/rettung',
    }));
  }

  return { jobs, routen, ebenen, kachel, briefing, suche };
}
