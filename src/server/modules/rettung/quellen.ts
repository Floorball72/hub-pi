// Öffentliche Quellen für das Modul Rettung: Alertswiss, MeteoAlarm, SED Erdbeben, OpenStreetMap,
// Medienmitteilungen (RSS oder Opendatasoft). Alle tolerant gegen fehlende Felder.
import { distanzKm, imPolygon } from '../../quellen/geo.ts';
import { httpJson, httpText } from '../../quellen/http.ts';
import { robotsErlaubt } from '../../quellen/robots.ts';
import { type FeedEintrag, feedParsen, htmlZuText } from '../../quellen/rss.ts';
import { HubFehler } from '../../kern/fehler.ts';

export interface Region {
  lat: number;
  lon: number;
  radiusKm: number;
}

// Alertswiss

export interface Alert {
  id: string;
  titel: string;
  text: string;
  ereignis: string;
  schwere: string;
  herausgeber: string;
  gesendet: string;
  landesweit: boolean;
  entwarnung: boolean;
  test: boolean;
  polygone: [number, number][][];
  link: string | null;
}

export const ALERTSWISS_URL =
  'https://www.alert.swiss/content/alertswiss-internet/de/home/_jcr_content/polyalert.alertswiss_alerts.actual.json';

type AlertRoh = Record<string, unknown> & {
  identifier?: string;
  title?: { title?: string };
  description?: { description?: string };
  areas?: { polygons?: { coordinates?: [string, string][] }[] }[];
};

export function alertswissParsen(d: { alerts?: AlertRoh[] }): Alert[] {
  return (d.alerts ?? []).map((a) => ({
    id: String(a.identifier ?? ''),
    titel: a.title?.title ?? '',
    text: htmlZuText(String(a.description?.description ?? '').replace(/❘/g, '\n')),
    ereignis: String(a.event ?? ''),
    schwere: String(a.severity ?? ''),
    herausgeber: String(a.publisherName ?? ''),
    gesendet: String(a.sent ?? ''),
    landesweit: a.nationWide === true,
    entwarnung: a.allClear === true,
    test: a.testAlert === true || a.technicalTestAlert === true,
    polygone: (a.areas ?? []).flatMap((ar) =>
      (ar.polygons ?? []).map((p) =>
        (p.coordinates ?? []).map(([la, lo]) => [Number(la), Number(lo)] as [number, number]),
      ),
    ),
    link:
      typeof a.link === 'string' && a.link
        ? a.link.startsWith('http')
          ? a.link
          : `https://${a.link}`
        : null,
  }));
}

/** Betrifft die Meldung die Region? Landesweit, Mittelpunkt im Gebiet oder ein Eckpunkt im Radius */
export function alertInRegion(a: Alert, r: Region): boolean {
  if (a.landesweit) return true;
  return a.polygone.some(
    (p) => imPolygon(r.lat, r.lon, p) || p.some(([la, lo]) => distanzKm(r.lat, r.lon, la, lo) <= r.radiusKm),
  );
}

export function polygonMitte(p: [number, number][]): [number, number] {
  const la = p.reduce((s, x) => s + x[0], 0) / p.length;
  const lo = p.reduce((s, x) => s + x[1], 0) / p.length;
  return [la, lo];
}

export const SCHWERE_STUFE: Record<string, number> = { minor: 1, moderate: 2, severe: 3, extreme: 4 };

export async function alertswissHolen(): Promise<Alert[]> {
  return alertswissParsen(await httpJson(ALERTSWISS_URL, { timeoutMs: 15000, maxBytes: 10_000_000 }));
}

// MeteoAlarm (Unwetterwarnungen, Schweiz von MeteoSchweiz geliefert)

export interface Warnung {
  id: string;
  ereignis: string;
  gebiet: string;
  stufe: number;
  farbe: string;
  art: string;
  beginn: string | null;
  ende: string | null;
  text: string;
  sprache: string;
}

type MaRoh = {
  warnings?: {
    uuid?: string;
    alert?: {
      identifier?: string;
      info?: {
        language?: string;
        event?: string;
        onset?: string;
        effective?: string;
        expires?: string;
        description?: string;
        area?: { areaDesc?: string }[];
        parameter?: { valueName?: string; value?: string }[];
      }[];
    };
  }[];
};

export const METEOALARM_URL = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-switzerland';

/** Pro Warnung die deutsche Fassung, sonst die erste. Stufe aus awareness_level («3; orange; Severe»). */
export function meteoalarmParsen(d: MaRoh): Warnung[] {
  const aus: Warnung[] = [];
  for (const w of d.warnings ?? []) {
    const infos = w.alert?.info ?? [];
    const info = infos.find((i) => i.language?.startsWith('de')) ?? infos[0];
    if (!info) continue;
    const param = (n: string) => info.parameter?.find((p) => p.valueName === n)?.value ?? '';
    const [stufeText, farbe] = param('awareness_level')
      .split(';')
      .map((s) => s.trim());
    const art = param('awareness_type').split(';')[1]?.trim() ?? '';
    for (const a of info.area ?? [{ areaDesc: '' }]) {
      aus.push({
        id: `${w.uuid ?? w.alert?.identifier}:${a.areaDesc}`,
        ereignis: info.event ?? '',
        gebiet: a.areaDesc ?? '',
        stufe: Number(stufeText) || 0,
        farbe: farbe ?? '',
        art,
        beginn: info.onset ?? info.effective ?? null,
        ende: info.expires ?? null,
        text: info.description ?? '',
        sprache: info.language ?? '',
      });
    }
  }
  return aus;
}

export function warnungFuerGebiete(w: Warnung, gebiete: string[]): boolean {
  if (!gebiete.length) return true;
  const g = w.gebiet.toLowerCase();
  return gebiete.some((x) => g.includes(x.toLowerCase()));
}

// Erdbeben (Schweizerischer Erdbebendienst SED, FDSN Schnittstelle)

export interface Erdbeben {
  id: string;
  zeit: string;
  lat: number;
  lon: number;
  tiefeKm: number;
  magnitude: number;
  ort: string;
  typ: string;
}

export function sedUrl(tage = 7, minMag = 0): string {
  const start = new Date(Date.now() - tage * 86400000).toISOString().slice(0, 19);
  return `https://eida.ethz.ch/fdsnws/event/1/query?format=text&starttime=${start}&minlatitude=45.4&maxlatitude=48.2&minlongitude=5.4&maxlongitude=11.0&minmagnitude=${minMag}&limit=300&orderby=time`;
}

export function sedParsen(text: string): Erdbeben[] {
  const zeilen = text.split(/\r?\n/).filter((z) => z && !z.startsWith('#'));
  return zeilen
    .map((z) => z.split('|'))
    .filter((t) => t.length >= 13)
    .map((t) => ({
      id: t[0],
      zeit: `${t[1]}${t[1].endsWith('Z') ? '' : 'Z'}`,
      lat: Number(t[2]),
      lon: Number(t[3]),
      tiefeKm: Math.round(Number(t[4]) * 10) / 10,
      magnitude: Math.round(Number(t[10]) * 10) / 10,
      ort: t[12] ?? '',
      typ: t[13] ?? 'earthquake',
    }))
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.magnitude));
}

export function istErdbeben(e: Erdbeben): boolean {
  // Sprengungen (quarry blast) und Erdrutsche (landslide) sind keine Erdbeben
  return !e.typ || /earthquake/i.test(e.typ);
}

export async function erdbebenHolen(): Promise<Erdbeben[]> {
  return sedParsen(await httpText(sedUrl(), { timeoutMs: 15000 }));
}

// OpenStreetMap über Overpass (Spitäler, Rettungswachen, Heli Landeplätze, Defibrillatoren)

export interface OsmObjekt {
  id: string;
  lat: number;
  lon: number;
  name: string;
  tags: Record<string, string>;
}

export const OSM_ABFRAGEN: Record<string, string> = {
  spital: 'nwr["amenity"="hospital"]["emergency"="yes"]',
  wache: 'nwr["emergency"="ambulance_station"]',
  // Auch Heliports, dort sind die Basen der Rega und anderer Betreiber erfasst
  landeplatz: 'nwr["aeroway"~"^(helipad|heliport)$"]',
  defi: 'nwr["emergency"="defibrillator"]',
};

export function overpassAbfrage(art: string, r: Region): string {
  // «spital.ch»: ganze Schweiz statt Region (für die Erkennung von Landungen)
  const schweiz = art.endsWith('.ch');
  const filter = OSM_ABFRAGEN[schweiz ? art.slice(0, -3) : art];
  if (!filter) throw new HubFehler('Unbekannte Abfrage');
  if (schweiz) {
    return `[out:json][timeout:90];area["ISO3166-1"="CH"][admin_level=2]->.ch;${filter}(area.ch);out center tags 5000;`;
  }
  const radiusM = Math.round(r.radiusKm * 1000);
  return `[out:json][timeout:25];${filter}(around:${radiusM},${r.lat},${r.lon});out center tags 500;`;
}

type OverpassRoh = {
  elements?: {
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
  }[];
};

export function overpassParsen(d: OverpassRoh): OsmObjekt[] {
  return (d.elements ?? [])
    .map((e) => ({
      id: `${e.type}/${e.id}`,
      lat: e.lat ?? e.center?.lat ?? Number.NaN,
      lon: e.lon ?? e.center?.lon ?? Number.NaN,
      name: e.tags?.name ?? e.tags?.operator ?? '',
      tags: e.tags ?? {},
    }))
    .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon));
}

export async function overpassHolen(art: string, r: Region): Promise<OsmObjekt[]> {
  const abfrage = overpassAbfrage(art, r);
  // Overpass erlaubt schonende Nutzung, darum langer Cache (eine Woche) und Abstand zwischen Abfragen
  const d = await httpJson<OverpassRoh>(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(abfrage)}`,
    {
      timeoutMs: art.endsWith('.ch') ? 100000 : 40000,
      abstandMs: 10000,
    },
  );
  return overpassParsen(d);
}

// Medienmitteilungen

export interface Meldung {
  quelle: string;
  titel: string;
  link: string;
  zeit: string | null;
  text: string;
}

/** Opendatasoft Datensatz der Stadt St.Gallen (CC BY): Medienmitteilungen der Stadtpolizei */
export const STAPO_SG_URL =
  'https://daten.stadt.sg.ch/api/explore/v2.1/catalog/datasets/newsfeed-stadtpolizei-stgallen-medienmitteilungen/records?limit=30&order_by=published%20desc';

export function opendatasoftMeldungen(d: { results?: Record<string, unknown>[] }, quelle: string): Meldung[] {
  return (d.results ?? []).map((r) => ({
    quelle,
    titel: htmlZuText(String(r.title ?? '')),
    link: String(r.link ?? ''),
    zeit: r.published ? new Date(String(r.published)).toISOString() : null,
    text: htmlZuText(String(r.description ?? '')).slice(0, 800),
  }));
}

export async function feedHolen(name: string, url: string): Promise<Meldung[]> {
  if (!(await robotsErlaubt(url))) throw new HubFehler(`${name}: robots.txt verbietet den Abruf`);
  const eintraege: FeedEintrag[] = feedParsen(await httpText(url, { timeoutMs: 15000 }));
  return eintraege.map((e) => ({ quelle: name, ...e }));
}

/** Grobe Einordnung über Stichworte, damit Einsätze von anderen Mitteilungen getrennt werden */
const EINSATZ_WOERTER: [string, RegExp][] = [
  ['Verkehrsunfall', /unfall|kollision|zusammenstoss|selbstunfall|auffahr/i],
  ['Brand', /brand|feuer|rauch|flammen/i],
  ['Rettung', /rettung|verletzt|bergung|vermisst|suche nach|reanimation|ambulanz|rega/i],
  ['Kriminalität', /festnahme|festgenommen|einbruch|diebstahl|raub|betrug|tätlich|verhaftet|angriff/i],
  ['Polizeieinsatz', /polizeieinsatz|einsatz der polizei|sperrung|evakuier/i],
];

export function kategorie(m: { titel: string; text: string }): string {
  const t = `${m.titel} ${m.text.slice(0, 300)}`;
  return EINSATZ_WOERTER.find(([, re]) => re.test(t))?.[0] ?? 'Mitteilung';
}

// Webcams von foto-webcam.eu: Metadaten aller Kameras, die Bilder lädt der Browser direkt

export interface Webcam {
  id: string;
  name: string;
  titel: string;
  lat: number;
  lon: number;
  hoehe: number | null;
  /** Blickrichtung in Grad */
  richtung: number | null;
  bild: string;
  bildGross: string;
  link: string | null;
  /** Zeit des aktuellen Bildes in ms */
  zeit: number | null;
  /** Abstand der Bilder in Sekunden */
  takt: number | null;
  land: string | null;
  quelle: string;
}

export const FOTOWEBCAM_URL = 'https://www.foto-webcam.eu/webcam/include/metadata.php';

interface FotoWebcamRoh {
  id?: string;
  name?: string;
  title?: string;
  offline?: boolean;
  hidden?: boolean;
  imgurl?: string;
  link?: string;
  modtime?: number;
  country?: string;
  latitude?: number;
  longitude?: number;
  elevation?: number;
  direction?: number;
  captureInterval?: number;
}

export function fotoWebcamParsen(d: { cams?: FotoWebcamRoh[] }): Webcam[] {
  const aus: Webcam[] = [];
  for (const c of d.cams ?? []) {
    if (!c.id || c.offline || c.hidden || !c.imgurl?.startsWith('https://')) continue;
    if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') continue;
    aus.push({
      id: `fw-${c.id}`,
      name: c.name ?? c.id,
      titel: c.title ?? c.name ?? c.id,
      lat: c.latitude,
      lon: c.longitude,
      hoehe: c.elevation ?? null,
      richtung: c.direction ?? null,
      bild: c.imgurl,
      bildGross: c.imgurl.replace(/\/400\.jpg$/, '/1200.jpg'),
      link: c.link ?? null,
      zeit: c.modtime ? c.modtime * 1000 : null,
      takt: c.captureInterval ?? null,
      land: c.country ?? null,
      quelle: 'foto-webcam.eu',
    });
  }
  return aus;
}

/** Kameras in der Schweiz oder nahe der Region, die nächsten zuerst */
export function webcamsAuswaehlen(cams: Webcam[], r: Region, maxKm = 120): (Webcam & { km: number })[] {
  return cams
    .map((c) => ({ ...c, km: Math.round(distanzKm(r.lat, r.lon, c.lat, c.lon)) }))
    .filter((c) => c.land === 'ch' || c.km <= maxKm)
    .sort((a, b) => a.km - b.km);
}

export async function fotoWebcamsHolen(r: Region): Promise<(Webcam & { km: number })[]> {
  // Nur die Auswahl bleibt im Cache, nicht alle Kameras der Alpen
  return webcamsAuswaehlen(fotoWebcamParsen(await httpJson(FOTOWEBCAM_URL, { timeoutMs: 20000 })), r);
}
