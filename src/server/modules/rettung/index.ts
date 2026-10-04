// Modul Rettung: Helikopter (ADS-B), Alertswiss, Unwetter, Erdbeben, Einsatzmeldungen, Rega Statistik und Kartenebenen.
import type { FastifyInstance } from 'fastify';
import type {
  Ampel,
  Ebene,
  GeoLinie,
  GeoPunkt,
  Kachel,
  PunkteAntwort,
  SuchTreffer,
} from '../../geteilt/typen.ts';
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
  demoWebcams,
} from './demo.ts';
import {
  type AdsbFlugzeug,
  ADSB_NAMENSNENNUNG,
  adsbHolen,
  adsbTypHolen,
  type Flug,
  FlugErkennung,
  flugStatistik,
  type HeliPosition,
  heliFiltern,
  platzBei,
  heatRaster,
  type FlugEnde,
  einsatzLandung,
  letzteStandorte,
  ortArt,
  positionenVereinen,
  rueckblickFenster,
  schweizFiltern,
  startPasst,
  wiedergabePunkte,
  type Tageszeit,
  type Kennung,
} from './heli.ts';
import {
  type Alert,
  alertInRegion,
  alertswissHolen,
  type Erdbeben,
  erdbebenHolen,
  feedHolen,
  fotoWebcamsHolen,
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
  type Webcam,
} from './quellen.ts';
import { RETTUNG_TABELLEN } from './tabellen.ts';
import { basisName, endeBasis, heliFarbe, REGA_BASEN, startBasis } from '../../geteilt/heli.ts';

export interface Lawine {
  region: string;
  stufe: string;
  gueltigBis: string | null;
}

/**
 * Air Zermatt und Air Glaciers haben keine gemeinsame Kennzeichen Reihe, darum einzeln.
 * Quelle: öffentliche Register und Flottenberichte (helis.com, HeliHub, BEA), Stand 2026, mit Push.
 * Flotten ändern sich: im Tab Kennzeichen prüfen und ergänzen. Polizei Helis sind nicht hinterlegt.
 */
const WEITERE_BETREIBER: (Kennung & { push: boolean })[] = [
  ...['HB-ZSU', 'HB-ZPB', 'HB-ZUO', 'HB-ZEF', 'HB-ZCX', 'HB-ZVS', 'HB-XII'].map((muster) => ({
    organisation: 'Air Zermatt',
    muster,
    push: true,
  })),
  ...['HB-ZAN', 'HB-ZNR', 'HB-ZHY', 'HB-XVB'].map((muster) => ({
    organisation: 'Air Glaciers',
    muster,
    push: true,
  })),
];

const LAWINEN_STUFE: Record<string, number> = { low: 1, moderate: 2, considerable: 3, high: 4, very_high: 5 };

export const STANDARD_KENNUNGEN: (Kennung & { push: boolean })[] = [
  // Quelle: Flottenangaben Rega (AW109SP HB-ZRx, H145 HB-TIx). Bitte zuhause prüfen und ergänzen.
  { organisation: 'Rega', muster: 'HB-ZR*', push: true },
  { organisation: 'Rega', muster: 'HB-TI*', push: true },
  ...WEITERE_BETREIBER,
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
      name: 'Helikopter Aktivität',
      beschreibung:
        'Ein Helikopter aus der Kennzeichen Liste (mit Push) startet irgendwo in der Schweiz oder landet bei einem Spital. Andere Helikopter nur in der Region.',
      prioritaet: 3,
      cooldownMin: 20,
    },
    {
      id: 'landung',
      name: 'Rega Landung beim Einsatzort',
      beschreibung:
        'Ein Rega Helikopter landet in der Region ausserhalb einer Basis und ohne bekannten Landeplatz, meist an einem Einsatzort. Keine Meldungen in der Nacht.',
      prioritaet: 3,
      cooldownMin: 15,
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
  /** Startplatz laufender Flüge (hex), für die Liste «In der Luft» */
  const startPlaetze = new Map<string, string>();
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
  // Organisationen wie die Rega in der ganzen Schweiz: eine Abfrage nach Typ ist viel kleiner als
  // ein grosser Radius (rund 20 KB weltweit statt 170 KB für die ganze Schweiz)
  const adsbSchweiz = ctx.quelle<void, AdsbFlugzeug[]>({
    id: 'rettung.adsb.schweiz',
    wichtig: true,
    name: 'ADS-B Schweiz nach Typ (adsb.lol)',
    modul: 'rettung',
    ttlSek: 30,
    abruf: () => adsbTypHolen(konfig.heliTypen),
    demo: () => [],
    namensnennung: ADSB_NAMENSNENNUNG,
    beschreibung: `Typen ${konfig.heliTypen.join(', ')}, gefiltert auf die Kennzeichen Liste und die Schweiz.`,
  });
  const fotoWebcams = ctx.quelle<void, (Webcam & { km: number })[]>({
    id: 'rettung.webcams.fotowebcam',
    name: 'Webcams (foto-webcam.eu)',
    modul: 'rettung',
    ttlSek: 3600,
    abruf: () => fotoWebcamsHolen(region),
    demo: () => demoWebcams(ctx.jetzt(), region),
    namensnennung: 'Bilder: foto-webcam.eu und die Betreiber der Kameras',
    beschreibung:
      'Liste der Kameras in der Schweiz und bis 120 km um die Region. Die Bilder lädt der Browser direkt.',
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
    demo: (art) => demoOsm(art.replace(/\.ch$/, ''), region),
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

  /** Spital oder Landeplatz an der Position, ganze Schweiz (Cache eine Woche), sonst aus der Region */
  async function platzName(lat: number | null, lon: number | null): Promise<string | null> {
    if (lat === null || lon === null) return null;
    const [spitaeler, landeplaetze] = await Promise.all([osm.hole('spital.ch'), osm.hole('landeplatz.ch')]);
    const s = spitaeler.daten ?? (await osm.hole('spital')).daten ?? [];
    const l = landeplaetze.daten ?? (await osm.hole('landeplatz')).daten ?? [];
    return platzBei(lat, lon, s, l);
  }

  async function kennungen(): Promise<(Kennung & { push: boolean })[]> {
    const liste = await daten.liste<{ organisation: string; muster: string; push: boolean }>(
      'heli_kennungen',
      { limit: 200 },
    );
    // Einmalig Push für alle erfassten Helis einschalten (Wunsch Jerome), später im Tab Kennzeichen änderbar
    if (liste.length && !ctx.einstellungen.hole('rettung.push_alle', false)) {
      for (const k of liste as ({ id: string } & (typeof liste)[number])[]) {
        if (!k.push) {
          await daten.aendern('heli_kennungen', k.id, { push: true });
          k.push = true;
        }
      }
      await ctx.einstellungen.setze('rettung.push_alle', true);
    }
    if (!liste.length && !ctx.einstellungen.hole('rettung.kennungen_angelegt', false)) {
      await daten.einfuegen(
        'heli_kennungen',
        STANDARD_KENNUNGEN.map((k) => ({ ...k, notizen: 'Standard, bitte prüfen' })),
      );
      await ctx.einstellungen.setze('rettung.kennungen_angelegt', true);
      await ctx.einstellungen.setze('rettung.betreiber_angelegt', true);
      await ctx.einstellungen.setze('rettung.push_alle', true);
      return STANDARD_KENNUNGEN;
    }
    // Bestehende Listen einmal um Air Zermatt und Air Glaciers ergänzen, gelöschte bleiben gelöscht
    if (!ctx.einstellungen.hole('rettung.betreiber_angelegt', false)) {
      const vorhanden = new Set(liste.map((k) => k.muster.toUpperCase()));
      const neu = WEITERE_BETREIBER.filter((k) => !vorhanden.has(k.muster));
      if (neu.length) {
        await daten.einfuegen(
          'heli_kennungen',
          neu.map((k) => ({ ...k, notizen: 'Standard, bitte prüfen' })),
        );
      }
      await ctx.einstellungen.setze('rettung.betreiber_angelegt', true);
      return [...liste, ...neu];
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
        // Zeit als Sekunden seit dem Start, für die Wiedergabe
        spur: f.spur.map(([la, lo, t]) => [la, lo, Math.round((t - f.start) / 1000)]),
        start_platz: startPlatz,
        ende_platz: endePlatz,
      },
    ]);
    letzteFluege = null;
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
    const regional = heliFiltern(r.daten, k, konfig.heliAlle, region, jetzt);
    // Fällt die Abfrage nach Typ aus, läuft die Region allein weiter
    const ch = konfig.heliTypen.length ? await adsbSchweiz.hole(undefined, true) : null;
    positionen = positionenVereinen(regional, ch?.daten ? schweizFiltern(ch.daten, k, jetzt) : []);
    await helisMetrik(positionen.length);
    positionenStand = r.stand;
    const ereignisse = erkennung.aktualisieren(positionen, jetzt);
    for (const e of ereignisse) {
      const f = e.flug;
      const name = `${f.organisation ?? 'Helikopter'} ${f.kennzeichen ?? f.hex}`;
      const mitPush = !!f.organisation && k.some((x) => x.push && x.organisation === f.organisation);
      // Rega Basis in der Nähe zählt als Start, auch beim ersten Empfang in der Luft (ADS-B Lücke am Boden).
      // Sonst hat nur ein echter Start einen Startplatz, beim Erfassen ist der Heli schon unterwegs.
      const sb = startBasis(f.organisation, f.startArt, f.startLat, f.startLon);
      const startPlatz = sb
        ? basisName(sb)
        : f.startArt === 'start'
          ? await platzName(f.startLat, f.startLon)
          : null;
      if (e.art === 'landung' || e.art === 'signalverlust') {
        startPlaetze.delete(f.hex);
        const eb =
          f.endeLat !== null && f.endeLon !== null
            ? endeBasis(f.organisation, e.art, f.endeLat, f.endeLon)
            : null;
        const endePlatz = eb ? basisName(eb) : await platzName(f.endeLat, f.endeLon);
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
            link: `/heli?hex=${encodeURIComponent(f.hex)}`,
          });
        } else if (einsatzLandung(f.organisation, e.art, endePlatz, f.endeLat, f.endeLon, region)) {
          const ort = await ortName(f.endeLat!, f.endeLon!);
          await ctx.alarm.melden({
            regel: 'rettung.landung',
            titel: `${name} gelandet${ort ? ` bei ${ort}` : ''}`,
            text: `Landung ausserhalb einer Basis, wahrscheinlich beim Einsatzort${startPlatz ? `. Gestartet bei ${startPlatz}` : ''}. Flugdauer ${Math.max(1, Math.round(((f.ende ?? jetzt) - f.start) / 60000))} min. Nur Daten des Transponders, ohne Gewähr.`,
            schluessel: `rega-landung:${f.hex}`,
            tags: ['helicopter', 'round_pushpin'],
            link: `/heli?hex=${encodeURIComponent(f.hex)}`,
          });
        }
        continue;
      }
      if (startPlatz) startPlaetze.set(f.hex, startPlatz);
      const ort = await ortName(f.startLat, f.startLon);
      const wo = startPlatz ? `${startPlatz} (${ort ?? 'unbekannt'})` : (ort ?? 'unbekannt');
      await ctx.aktivitaet('rettung', `${name} ${e.art === 'start' ? 'gestartet' : 'erfasst'} bei ${wo}`);
      if (mitPush) {
        await ctx.alarm.melden({
          regel: 'rettung.heli',
          titel: `${name} ${e.art === 'start' ? 'gestartet' : 'in der Luft'}`,
          text: `${e.art === 'start' ? 'Start' : 'Erfasst'} bei ${wo}${f.typ ? `, Typ ${f.typ}` : ''}. Nur Daten des Transponders, zeitnah aber ohne Gewähr.`,
          schluessel: `heli:${f.hex}`,
          tags: ['helicopter'],
          link: `/heli?hex=${encodeURIComponent(f.hex)}`,
        });
      }
    }
    return positionen.length ? `${positionen.length} Helikopter` : undefined;
  }

  interface RueckblickFlug {
    id: string;
    hex: string;
    organisation: string;
    kennzeichen: string | null;
    start: string;
    ende: string | null;
    von: string | null;
    nach: string | null;
    laufend: boolean;
  }

  async function rueckblick(): Promise<{ titel: string; von: string; fluege: RueckblickFlug[] }> {
    const f = rueckblickFenster(ctx.jetzt());
    const gespeichert = await daten.liste<{
      id: string;
      hex: string;
      organisation: string | null;
      kennzeichen: string | null;
      start: string;
      ende: string | null;
      start_ort: string | null;
      start_platz: string | null;
      ende_ort: string | null;
      ende_platz: string | null;
    }>('heli_fluege', { filter: { start: { gte: f.von.toISOString() } }, sortierung: 'start', limit: 300 });
    const fluege: RueckblickFlug[] = gespeichert
      .filter((x) => x.organisation)
      .map((x) => ({
        id: x.id,
        hex: x.hex,
        organisation: x.organisation!,
        kennzeichen: x.kennzeichen,
        start: x.start,
        ende: x.ende,
        von: x.start_platz ?? x.start_ort,
        nach: x.ende_platz ?? x.ende_ort,
        laufend: false,
      }));
    for (const l of erkennung.laufende()) {
      if (!l.organisation) continue;
      fluege.push({
        id: `live-${l.hex}`,
        hex: l.hex,
        organisation: l.organisation,
        kennzeichen: l.kennzeichen,
        start: new Date(Math.max(l.start, f.von.getTime())).toISOString(),
        ende: null,
        von: startPlaetze.get(l.hex) ?? null,
        nach: null,
        laufend: true,
      });
    }
    return { titel: f.titel, von: f.von.toISOString(), fluege };
  }

  interface BasisStatus {
    id: string;
    name: string;
    lat: number;
    lon: number;
    status: 'unterwegs' | 'zuhause' | 'unbekannt';
    unterwegs: { hex: string; kennzeichen: string | null; lat: number; lon: number }[];
    zuHause: string[];
    heute: number;
  }

  async function basenStatus(): Promise<BasisStatus[]> {
    const von = rueckblickFenster(ctx.jetzt()).von.toISOString();
    const heute = await daten.liste<{ start_platz: string | null }>('heli_fluege', {
      filter: { start: { gte: von }, organisation: 'Rega' },
      limit: 1000,
    });
    const laufende = erkennung.laufende();
    return REGA_BASEN.map((b) => {
      const name = basisName(b);
      const unterwegs = laufende
        .filter((f) => startPlaetze.get(f.hex) === name)
        .map((f) => {
          const p = positionen.find((x) => x.hex === f.hex);
          const letzter = f.spur[f.spur.length - 1];
          return {
            hex: f.hex,
            kennzeichen: f.kennzeichen,
            lat: p?.lat ?? letzter[0],
            lon: p?.lon ?? letzter[1],
          };
        });
      const zuHause = positionen
        .filter(
          (p) =>
            p.organisation === 'Rega' &&
            (p.amBoden || (p.speedKn ?? 0) < 25) &&
            distanzKm(p.lat, p.lon, b.lat, b.lon) <= 2,
        )
        .map((p) => p.kennzeichen ?? p.hex);
      return {
        id: b.id,
        name,
        lat: b.lat,
        lon: b.lon,
        status: unterwegs.length ? 'unterwegs' : zuHause.length ? 'zuhause' : 'unbekannt',
        unterwegs,
        zuHause,
        heute:
          heute.filter((f) => f.start_platz === name).length +
          laufende.filter((f) => startPlaetze.get(f.hex) === name && f.start >= new Date(von).getTime())
            .length,
      };
    });
  }

  // Letzte Flüge pro Heli, eine Minute im Speicher, damit /live die Datenbank nicht alle 20 s abfragt
  let letzteFluege: { zeit: number; liste: FlugEnde[] } | null = null;
  async function abgestellteHelis(aktuell: Set<string>) {
    await demoVorbereiten();
    const jetzt = ctx.jetzt().getTime();
    if (!letzteFluege || jetzt - letzteFluege.zeit > 60000) {
      const liste = await daten
        .liste<FlugEnde>('heli_fluege', {
          filter: { ende: { gte: new Date(jetzt - 7 * 86400000).toISOString() } },
          sortierung: '-ende',
          limit: 300,
        })
        .catch(() => letzteFluege?.liste ?? []);
      letzteFluege = { zeit: jetzt, liste };
    }
    return letzteStandorte(letzteFluege.liste, erkennung.laufende(), aktuell);
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

  const UHRZEIT = (iso: string) =>
    new Date(iso).toLocaleTimeString('de-CH', {
      timeZone: 'Europe/Zurich',
      hour: '2-digit',
      minute: '2-digit',
    });
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
        farbe: heliFarbe(p.organisation),
        richtung: p.kurs ?? undefined,
        zeit: new Date(p.zeit).toISOString(),
        link: p.organisation ? `/heli?hex=${encodeURIComponent(p.hex)}` : undefined,
      }));
      // Spur des laufenden Flugs, damit Richtung und Weg sichtbar sind
      const linien: GeoLinie[] = erkennung
        .laufende()
        .filter((f) => f.spur.length > 1)
        .map((f) => ({
          id: `spur-${f.hex}`,
          titel: `${f.organisation ?? 'Helikopter'} ${f.kennzeichen ?? f.hex}`,
          text: `In der Luft seit ${ZEIT(new Date(f.start).toISOString())}`,
          farbe: heliFarbe(f.organisation),
          gestrichelt: true,
          punkte: f.spur.map(([la, lo]) => [la, lo]),
        }));
      return {
        punkte,
        linien,
        stand: positionenStand,
        demo: konfig.demo,
        fehler: positionenFehler,
        hinweis: 'Nur Luftfahrzeuge mit eingeschaltetem Transponder sind sichtbar.',
      };
    });

    // Rega Basen mit Status: Heli zu Hause, unterwegs (Linie zur Basis) oder keine Daten
    app.get('/basen', async (): Promise<PunkteAntwort & { basen: BasisStatus[] }> => {
      await demoVorbereiten();
      if (!positionenStand) await heliRunde().catch(() => undefined);
      const basen = await basenStatus();
      const punkte: GeoPunkt[] = basen.map((b) => ({
        id: `basis-${b.id}`,
        lat: b.lat,
        lon: b.lon,
        titel: b.name,
        text: [
          b.status === 'unterwegs'
            ? `Unterwegs: ${b.unterwegs.map((u) => u.kennzeichen ?? u.hex).join(', ')}`
            : b.status === 'zuhause'
              ? `Heli an der Basis: ${b.zuHause.join(', ')}`
              : 'Kein Heli erfasst (am Boden oft kein Empfang)',
          `Heute ${b.heute} ${b.heute === 1 ? 'Start' : 'Starts'}`,
        ].join(' · '),
        symbol: 'basis',
        farbe: b.status === 'unterwegs' ? '#ff5d5d' : b.status === 'zuhause' ? '#34d399' : '#94a3b8',
        groesse: b.status === 'unterwegs' ? 32 : 26,
      }));
      const linien: GeoLinie[] = basen.flatMap((b) =>
        b.unterwegs.map((u) => ({
          id: `basis-${b.id}-${u.hex}`,
          titel: `${b.name} zu ${u.kennzeichen ?? u.hex}`,
          text: 'Luftlinie von der Basis zum Heli',
          farbe: '#ff5d5d',
          gestrichelt: true,
          punkte: [
            [b.lat, b.lon],
            [u.lat, u.lon],
          ] as [number, number][],
        })),
      );
      return {
        punkte,
        linien,
        basen,
        stand: positionenStand,
        demo: konfig.demo,
        hinweis: 'Koordinaten der Basen aus OpenStreetMap. Status nur aus ADS-B, am Boden oft ohne Empfang.',
      };
    });

    // Helikopter aus der Kennzeichen Liste, die jetzt erfasst sind (ganze Schweiz)
    app.get('/live', async () => {
      if (!positionenStand) await heliRunde().catch(() => undefined);
      const fluege = new Map(erkennung.laufende().map((f) => [f.hex, f]));
      // Gemeinde höchstens 2 s abwarten, die Abfrage läuft weiter und füllt den Cache
      const ortKurz = (lat: number, lon: number) =>
        Promise.race([
          ortName(lat, lon).catch(() => null),
          new Promise<null>((ok) => setTimeout(() => ok(null), 2000)),
        ]);
      const helis = await Promise.all(
        positionen
          .filter((p) => p.organisation)
          .map(async (p) => {
            const f = fluege.get(p.hex);
            return {
              hex: p.hex,
              organisation: p.organisation,
              kennzeichen: p.kennzeichen,
              typ: p.typ,
              amBoden: p.amBoden,
              hoeheFt: p.hoeheFt,
              kmh: p.speedKn !== null ? Math.round(p.speedKn * 1.852) : null,
              ort: await ortKurz(p.lat, p.lon),
              seit: f ? new Date(f.start).toISOString() : null,
              gestartet: f?.startArt === 'start',
              startPlatz: startPlaetze.get(p.hex) ?? null,
              lat: p.lat,
              lon: p.lon,
              kurs: p.kurs,
              zeit: p.zeit,
              // Letzte Punkte des laufenden Flugs für die Spur auf der Karte
              spur: f ? f.spur.slice(-40).map(([la, lo]) => [la, lo] as [number, number]) : [],
            };
          }),
      );
      helis.sort(
        (a, b) =>
          Number(a.amBoden) - Number(b.amBoden) ||
          Number(b.organisation === 'Rega') - Number(a.organisation === 'Rega') ||
          (a.kennzeichen ?? '').localeCompare(b.kennzeichen ?? ''),
      );
      const abgestellt = await abgestellteHelis(new Set(helis.map((h) => h.hex)));
      return { helis, abgestellt, stand: positionenStand, fehler: positionenFehler };
    });

    // Wiedergabe: alle Flüge der Helis aus der Liste der letzten Stunden mit Zeit pro Punkt
    app.get<{ Querystring: { stunden?: string } }>('/wiedergabe', async (req) => {
      await demoVorbereiten();
      const stunden = Math.min(72, Math.max(1, Number(req.query.stunden) || 24));
      const jetzt = ctx.jetzt().getTime();
      const von = jetzt - stunden * 3600000;
      const gespeichert = await daten.liste<{
        id: string;
        hex: string;
        organisation: string | null;
        kennzeichen: string | null;
        start: string;
        ende: string | null;
        start_platz: string | null;
        start_ort: string | null;
        ende_platz: string | null;
        ende_ort: string | null;
        spur: unknown;
      }>('heli_fluege', {
        filter: { start: { gte: new Date(von - 6 * 3600000).toISOString() } },
        sortierung: 'start',
        limit: 400,
      });
      const fluege = gespeichert
        .filter((f) => f.organisation && (f.ende ? new Date(f.ende).getTime() : jetzt) >= von)
        .map((f) => {
          const s = new Date(f.start).getTime();
          const e = f.ende ? new Date(f.ende).getTime() : s;
          return {
            id: f.id,
            hex: f.hex,
            organisation: f.organisation!,
            kennzeichen: f.kennzeichen,
            von: f.start_platz ?? f.start_ort,
            nach: f.ende_platz ?? f.ende_ort,
            start: s,
            ende: e,
            ...wiedergabePunkte(f.spur, s, e),
          };
        });
      for (const l of erkennung.laufende()) {
        if (!l.organisation) continue;
        fluege.push({
          id: `live-${l.hex}`,
          hex: l.hex,
          organisation: l.organisation,
          kennzeichen: l.kennzeichen,
          von: startPlaetze.get(l.hex) ?? null,
          nach: null,
          start: l.start,
          ende: jetzt,
          punkte: l.spur.map(([la, lo, t]) => [la, lo, t] as [number, number, number]),
          geschaetzt: false,
        });
      }
      return { von, bis: jetzt, fluege: fluege.filter((f) => f.punkte.length), demo: konfig.demo };
    });

    // Ein Heli im Detail: Position, laufender Flug, Flüge der letzten 30 Tage
    // Rückblick: alle Flüge der Helis aus der Kennzeichen Liste seit gestern Abend oder seit Mitternacht
    app.get('/rueckblick', async () => {
      await demoVorbereiten();
      if (!positionenStand) await heliRunde().catch(() => undefined);
      return { ...(await rueckblick()), stand: positionenStand, demo: konfig.demo };
    });

    app.get<{ Params: { hex: string } }>('/heli/:hex', async (req, rep) => {
      const hex = req.params.hex.toLowerCase();
      if (!/^[0-9a-z~]{1,12}$/.test(hex)) return rep.code(400).send({ fehler: 'Ungültige Kennung' });
      await demoVorbereiten();
      if (!positionenStand) await heliRunde().catch(() => undefined);
      const p = positionen.find((x) => x.hex === hex) ?? null;
      const laufend = erkennung.laufende().find((f) => f.hex === hex) ?? null;
      const seit = new Date(ctx.jetzt().getTime() - 30 * 86400000).toISOString();
      const fluege = await daten.liste<{
        id: string;
        kennzeichen: string | null;
        typ: string | null;
        organisation: string | null;
        start: string;
        start_art: string | null;
        start_ort: string | null;
        start_platz: string | null;
        ende: string | null;
        ende_art: string | null;
        ende_ort: string | null;
        ende_platz: string | null;
        max_hoehe_ft: number | null;
        spur: [number, number][] | null;
      }>('heli_fluege', { filter: { hex, start: { gte: seit } }, sortierung: '-start', limit: 300 });
      const neuester = fluege[0];
      // Wo der Heli ohne Signal zuletzt stand, und wo er in den letzten 7 Tagen gelandet ist
      const zuletzt = p
        ? null
        : ((await abgestellteHelis(new Set(positionen.map((x) => x.hex)))).find((a) => a.hex === hex) ??
          null);
      const grenze7 = ctx.jetzt().getTime() - 7 * 86400000;
      const aufenthalte = fluege
        .map((f, i) => ({
          f,
          bis: i > 0 ? fluege[i - 1].start : laufend ? new Date(laufend.start).toISOString() : null,
        }))
        .filter(({ f }) => f.ende && new Date(f.ende).getTime() >= grenze7)
        .map(({ f, bis }) => ({
          ankunft: f.ende!,
          bis,
          art: ortArt(f.ende_platz),
          platz: f.ende_platz,
          ort: f.ende_ort,
          signalverlust: f.ende_art === 'signalverlust',
          verlassen: f.ende_art === 'verlassen',
        }));
      const dauern = fluege
        .filter((f) => f.ende)
        .map((f) => (new Date(f.ende!).getTime() - new Date(f.start).getTime()) / 60000)
        .sort((a, b) => a - b);
      const zaehlen = (werte: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const w of werte) if (w) m.set(w, (m.get(w) ?? 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      };
      // Spuren nur für die letzten 24 Stunden und den letzten Flug mitschicken, ältere braucht die Karte nicht
      const grenze = ctx.jetzt().getTime() - 86400000;
      return {
        hex,
        organisation: p?.organisation ?? laufend?.organisation ?? neuester?.organisation ?? null,
        kennzeichen: p?.kennzeichen ?? laufend?.kennzeichen ?? neuester?.kennzeichen ?? null,
        typ: p?.typ ?? laufend?.typ ?? neuester?.typ ?? null,
        position: p
          ? {
              lat: p.lat,
              lon: p.lon,
              amBoden: p.amBoden,
              hoeheFt: p.hoeheFt,
              kmh: p.speedKn !== null ? Math.round(p.speedKn * 1.852) : null,
              kurs: p.kurs,
              zeit: new Date(p.zeit).toISOString(),
              ort: await Promise.race([
                ortName(p.lat, p.lon).catch(() => null),
                new Promise<null>((ok) => setTimeout(() => ok(null), 2000)),
              ]),
            }
          : null,
        laufend: laufend
          ? {
              start: new Date(laufend.start).toISOString(),
              gestartet: laufend.startArt === 'start',
              startPlatz: startPlaetze.get(hex) ?? null,
              maxHoeheFt: laufend.maxHoeheFt,
              spur: laufend.spur.map(([la, lo]) => [la, lo] as [number, number]),
            }
          : null,
        zuletzt,
        aufenthalte,
        anzahl30: fluege.length,
        heute: fluege.filter((f) => new Date(f.start).getTime() >= grenze).length,
        dauerMin: dauern.length ? Math.round(dauern[Math.floor(dauern.length / 2)]) : null,
        ziele: zaehlen(fluege.map((f) => f.ende_platz)),
        startplaetze: zaehlen(fluege.map((f) => f.start_platz)),
        fluege: fluege.slice(0, 50).map(({ spur, ...f }, i) => ({
          ...f,
          spur:
            (i === 0 || new Date(f.start).getTime() >= grenze) && Array.isArray(spur)
              ? spur.map(([la, lo]) => [la, lo] as [number, number])
              : null,
        })),
        stand: positionenStand,
        demo: konfig.demo,
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
        start_platz: string | null;
        ende_platz: string | null;
      }>('heli_fluege', { filter, sortierung: '-start', limit: 5000 });
      const zaehlen = (werte: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const w of werte) if (w) m.set(w, (m.get(w) ?? 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      };
      const orte = new Map<string, number>();
      for (const f of fluege)
        for (const o of [f.start_ort, f.ende_ort]) if (o) orte.set(o, (orte.get(o) ?? 0) + 1);
      return {
        ...flugStatistik(fluege),
        orte: [...orte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
        ziele: zaehlen(fluege.map((f) => f.ende_platz)),
        startplaetze: zaehlen(fluege.map((f) => f.start_platz)),
        dauerMin: (() => {
          const d = fluege
            .filter((f) => f.ende)
            .map((f) => (new Date(f.ende!).getTime() - new Date(f.start).getTime()) / 60000)
            .sort((a, b) => a - b);
          return d.length ? Math.round(d[Math.floor(d.length / 2)]) : null;
        })(),
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

    app.get('/spuren', async (): Promise<PunkteAntwort> => {
      await demoVorbereiten();
      const seit = new Date(ctx.jetzt().getTime() - 7 * 86400000).toISOString();
      const fluege = await daten.liste<{
        id: string;
        start: string;
        ende: string | null;
        organisation: string | null;
        kennzeichen: string | null;
        start_ort: string | null;
        ende_ort: string | null;
        start_platz: string | null;
        ende_platz: string | null;
        spur: [number, number][] | null;
      }>('heli_fluege', { filter: { start: { gte: seit } }, sortierung: '-start', limit: 200 });
      const farbe = heliFarbe;
      const linien: GeoLinie[] = fluege.map((f) => ({
        id: f.id,
        titel: `${f.organisation ?? 'Helikopter'} ${f.kennzeichen ?? ''}`.trim(),
        text: `${f.start_platz ?? f.start_ort ?? '?'} nach ${f.ende_platz ?? f.ende_ort ?? '?'}
${ZEIT(f.start)}${f.ende ? `, ${Math.max(1, Math.round((new Date(f.ende).getTime() - new Date(f.start).getTime()) / 60000))} min` : ''}`,
        farbe: farbe(f.organisation),
        punkte: Array.isArray(f.spur) ? f.spur : [],
      }));
      for (const f of erkennung.laufende()) {
        linien.push({
          id: `live-${f.hex}`,
          titel: `${f.organisation ?? 'Helikopter'} ${f.kennzeichen ?? f.hex} (in der Luft)`,
          text: `Seit ${ZEIT(new Date(f.start).toISOString())}`,
          farbe: farbe(f.organisation),
          gestrichelt: true,
          punkte: f.spur.map(([la, lo]) => [la, lo]),
        });
      }
      return {
        punkte: [],
        linien,
        stand: ctx.jetzt().toISOString(),
        demo: konfig.demo,
        hinweis: 'Flüge der letzten 7 Tage, gestrichelt: gerade in der Luft',
      };
    });

    // Heatmap aus Start, Landung und Flugspuren. Ohne Parameter: Rega, ein Jahr (Kartenebene)
    app.get<{
      Querystring: {
        organisation?: string;
        tage?: string;
        tageszeit?: string;
        wochentage?: string;
        basis?: string;
      };
    }>('/heatmap', async (req): Promise<PunkteAntwort> => {
      await demoVorbereiten();
      const q = req.query;
      const tage = Math.min(Number(q.tage) || 365, 730);
      const tageszeit = (
        ['morgen', 'tag', 'abend', 'nacht'].includes(q.tageszeit ?? '') ? q.tageszeit : 'alle'
      ) as Tageszeit;
      const wochentage = q.wochentage === 'werktag' || q.wochentage === 'wochenende' ? q.wochentage : 'alle';
      const filter: Record<string, unknown> = {
        start: { gte: new Date(ctx.jetzt().getTime() - tage * 86400000).toISOString() },
      };
      const organisation = q.organisation ?? 'Rega';
      if (organisation !== 'alle') filter.organisation = organisation;
      if (q.basis) filter.start_platz = q.basis.slice(0, 120);
      const fluege = (
        await daten.liste<{
          start: string;
          start_lat: number | null;
          start_lon: number | null;
          ende_lat: number | null;
          ende_lon: number | null;
          spur: [number, number][] | null;
        }>('heli_fluege', { filter, sortierung: '-start', limit: 3000 })
      ).filter((f) => startPasst(f.start, tageszeit, wochentage));
      return {
        punkte: [],
        heat: heatRaster(fluege),
        stand: ctx.jetzt().toISOString(),
        demo: konfig.demo,
        hinweis: `${fluege.length} Flüge, Start, Landung und Flugspuren`,
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
      // Defis gibt es zu viele für eine Abfrage der ganzen Schweiz, sie bleiben regional
      let r = await osm.hole(art === 'defi' ? art : `${art}.ch`);
      if (!r.daten?.length && art !== 'defi') r = await osm.hole(art);
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

    // Eigene Webcams und die von foto-webcam.eu, die nächsten zuerst
    async function alleWebcams() {
      await demoVorbereiten();
      const [eigene, fw] = await Promise.all([
        daten.liste<{
          id: string;
          name: string;
          lat: number;
          lon: number;
          bild_url: string | null;
          link: string | null;
        }>('webcams', { limit: 200 }),
        fotoWebcams.hole(),
      ]);
      const cams: (Webcam & { km: number })[] = [
        ...eigene
          .filter((w) => w.bild_url)
          .map((w) => ({
            id: w.id,
            name: w.name,
            titel: w.name,
            lat: w.lat,
            lon: w.lon,
            hoehe: null,
            richtung: null,
            bild: w.bild_url!,
            bildGross: w.bild_url!,
            link: w.link,
            zeit: null,
            takt: null,
            land: null,
            quelle: 'Eigene',
            km: Math.round(distanzKm(region.lat, region.lon, w.lat, w.lon)),
          })),
        ...(fw.daten ?? []),
      ].sort((a, b) => a.km - b.km);
      return { cams, eigene, fw };
    }

    app.get('/webcams', async () => {
      const { cams, fw } = await alleWebcams();
      return {
        cams,
        stand: fw.stand,
        demo: fw.demo,
        fehler: fw.fehler,
        namensnennung: 'Bilder: foto-webcam.eu und die Betreiber der Kameras',
      };
    });

    app.get('/webcams/punkte', async (): Promise<PunkteAntwort> => {
      const { cams, eigene, fw } = await alleWebcams();
      return {
        punkte: [
          // Eigene ohne Bild erscheinen trotzdem auf der Karte
          ...eigene
            .filter((w) => !w.bild_url)
            .map((w) => ({
              id: w.id,
              lat: w.lat,
              lon: w.lon,
              titel: w.name,
              symbol: 'webcam' as const,
              link: w.link ?? undefined,
            })),
          ...cams.map((c) => ({
            id: c.id,
            lat: c.lat,
            lon: c.lon,
            titel: c.name,
            text: [c.titel !== c.name ? c.titel : '', c.hoehe ? `${c.hoehe} m ü. M.` : '', c.quelle]
              .filter(Boolean)
              .join(' · '),
            symbol: 'webcam' as const,
            bild: c.bild,
            link: c.link ?? undefined,
            zeit: c.zeit ? new Date(c.zeit).toISOString() : undefined,
          })),
        ],
        stand: fw.stand ?? ctx.jetzt().toISOString(),
        demo: konfig.demo,
        fehler: fw.fehler,
        hinweis: 'foto-webcam.eu und eigene Liste im Modul Rettung, Tab Webcams',
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
        id: 'rettung.basen',
        name: 'Rega Basen',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/basen',
        aktualisierenSek: 30,
        namensnennung: 'Basen: rega.ch, Koordinaten: © OpenStreetMap',
        standardAn: true,
        hinweis: 'Status nur aus ADS-B. Am Boden ist oft kein Empfang, dann steht keine Daten.',
      },
      {
        id: 'rettung.spuren',
        name: 'Heli Flugspuren (7 Tage)',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'punkte',
        datenUrl: '/api/m/rettung/spuren',
        aktualisierenSek: 60,
        namensnennung: ADSB_NAMENSNENNUNG,
        hinweis: 'Aus selbst erfassten ADS-B Daten, nicht vollständig',
      },
      {
        id: 'rettung.heatmap',
        name: 'Rega Einsätze (Heatmap)',
        gruppe: 'Rettung',
        modul: 'rettung',
        art: 'heatmap',
        datenUrl: '/api/m/rettung/heatmap',
        namensnennung: ADSB_NAMENSNENNUNG,
        hinweis: 'Start, Landung und Flugspuren der letzten 12 Monate',
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
        namensnennung: 'foto-webcam.eu und Betreiber der Webcams',
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
    const rb = await rueckblick();
    const fluege = rb.fluege.filter((f) => !f.laufend).reverse();
    const meld = await daten.liste<{ titel: string; zeit: string; kategorie: string }>('einsatz_meldungen', {
      filter: { zeit: { gte: new Date(ctx.jetzt().getTime() - 24 * 3600000).toISOString() } },
      sortierung: '-zeit',
      limit: 5,
    });
    const zeilen = [
      ...(fluege.length
        ? [
            {
              text: `${rb.titel}: ${fluege.length} ${fluege.length === 1 ? 'Heli Flug' : 'Heli Flüge'}`,
              wert: '',
            },
          ]
        : []),
      ...fluege.slice(0, 4).map((f) => ({
        text: `${f.organisation} ${f.kennzeichen ?? ''}: ${f.von ?? '?'} nach ${f.nach ?? '?'}`,
        wert: UHRZEIT(f.start),
      })),
      ...meld
        .filter((m) => m.kategorie !== 'Mitteilung')
        .slice(0, 3)
        .map((m) => ({ text: m.titel, wert: m.kategorie })),
    ];
    if (!zeilen.length)
      zeilen.push({
        text: `Ruhig: keine Heli Flüge ${rb.titel === 'Heute' ? 'heute' : 'seit gestern 20 Uhr'}`,
        wert: '',
      });
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
