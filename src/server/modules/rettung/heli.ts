// Helikopter über ADS-B (adsb.lol, ODbL). Sichtbar sind nur Luftfahrzeuge, die selbst einen Transponder senden.
// Erkennung von Start und Landung aus aufeinanderfolgenden Positionen.
import { distanzKm } from '../../quellen/geo.ts';
import { httpJson } from '../../quellen/http.ts';
import { lokal, vonLokal } from '../../kern/zeit.ts';
import { basisAusPlatz, basisName, endeBasis, REGA_BASEN } from '../../geteilt/heli.ts';

export const ADSB_NAMENSNENNUNG = 'ADS-B Daten: adsb.lol (ODbL)';

export interface AdsbFlugzeug {
  hex: string;
  r?: string;
  t?: string;
  flight?: string;
  category?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  seen?: number;
  seen_pos?: number;
}

export interface Kennung {
  organisation: string;
  muster: string;
}

export interface HeliPosition {
  hex: string;
  kennzeichen: string | null;
  typ: string | null;
  rufzeichen: string | null;
  organisation: string | null;
  lat: number;
  lon: number;
  hoeheFt: number | null;
  amBoden: boolean;
  speedKn: number | null;
  kurs: number | null;
  zeit: number;
}

export function adsbUrl(lat: number, lon: number, radiusKm: number): string {
  const nm = Math.min(250, Math.max(1, Math.round(radiusKm / 1.852)));
  return `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${nm}`;
}

export async function adsbHolen(lat: number, lon: number, radiusKm: number): Promise<AdsbFlugzeug[]> {
  const d = await httpJson<{ ac?: AdsbFlugzeug[] }>(adsbUrl(lat, lon, radiusKm), {
    timeoutMs: 12000,
    abstandMs: 5000,
  });
  return d.ac ?? [];
}

/** Alle Flugzeuge bestimmter Typen weltweit in einer Abfrage (ICAO Typen, z.B. EC45 für H145) */
export async function adsbTypHolen(typen: string[]): Promise<AdsbFlugzeug[]> {
  const d = await httpJson<{ ac?: AdsbFlugzeug[] }>(
    `https://api.adsb.lol/v2/type/${typen.map(encodeURIComponent).join(',')}`,
    { timeoutMs: 12000, abstandMs: 5000 },
  );
  return d.ac ?? [];
}

/** Bestimmte Flugzeuge nach ICAO Adresse in einer Abfrage, für die schnelle Live Karte */
export async function adsbHexHolen(hexe: string[]): Promise<AdsbFlugzeug[]> {
  if (!hexe.length) return [];
  const d = await httpJson<{ ac?: AdsbFlugzeug[] }>(
    `https://api.adsb.lol/v2/hex/${hexe.map(encodeURIComponent).join(',')}`,
    { timeoutMs: 6000, abstandMs: 3000 },
  );
  return d.ac ?? [];
}

/**
 * Neuere Fixes aus der schnellen Abfrage auf die bekannten Positionen anwenden. Organisation und
 * Kennzeichen bleiben aus der normalen Runde, nur Ort, Höhe, Tempo, Kurs und Zeit werden ersetzt.
 */
export function positionenAuffrischen(
  alt: HeliPosition[],
  neu: AdsbFlugzeug[],
  jetzt: number,
): HeliPosition[] {
  const proHex = new Map(neu.map((a) => [a.hex, a]));
  return alt.map((p) => {
    const a = proHex.get(p.hex);
    if (!a || typeof a.lat !== 'number' || typeof a.lon !== 'number') return p;
    const f = position(a as AdsbFlugzeug & { lat: number; lon: number }, p.organisation, jetzt);
    if (f.zeit <= p.zeit) return p;
    return {
      ...p,
      lat: f.lat,
      lon: f.lon,
      hoeheFt: f.hoeheFt,
      amBoden: f.amBoden,
      speedKn: f.speedKn,
      kurs: f.kurs,
      zeit: f.zeit,
    };
  });
}

/** Grober Rahmen um die Schweiz (mit etwas Grenzgebiet) */
export const SCHWEIZ = { sued: 45.8, nord: 47.85, west: 5.9, ost: 10.55 };

export function inSchweiz(lat: number, lon: number): boolean {
  return lat >= SCHWEIZ.sued && lat <= SCHWEIZ.nord && lon >= SCHWEIZ.west && lon <= SCHWEIZ.ost;
}

/** Muster: genaues Kennzeichen oder Präfix mit * am Ende (z.B. HB-ZR*) */
export function musterPasst(kennzeichen: string | null | undefined, muster: string): boolean {
  if (!kennzeichen) return false;
  const k = kennzeichen.toUpperCase().trim();
  const m = muster.toUpperCase().trim();
  return m.endsWith('*') ? k.startsWith(m.slice(0, -1)) : k === m;
}

export function organisationFinden(
  kennzeichen: string | null | undefined,
  kennungen: Kennung[],
): string | null {
  return kennungen.find((k) => musterPasst(kennzeichen, k.muster))?.organisation ?? null;
}

/** ADS-B Kategorie A7 = Drehflügler */
export function istHelikopter(a: AdsbFlugzeug): boolean {
  return a.category === 'A7';
}

function position(
  a: AdsbFlugzeug & { lat: number; lon: number },
  organisation: string | null,
  jetzt: number,
) {
  const amBoden = a.alt_baro === 'ground';
  return {
    hex: a.hex,
    kennzeichen: a.r ?? null,
    typ: a.t ?? null,
    rufzeichen: a.flight?.trim() || null,
    organisation,
    lat: a.lat,
    lon: a.lon,
    hoeheFt: typeof a.alt_baro === 'number' ? a.alt_baro : amBoden ? 0 : null,
    amBoden,
    speedKn: a.gs ?? null,
    kurs: a.track ?? null,
    zeit: jetzt - Math.round((a.seen_pos ?? a.seen ?? 0) * 1000),
  };
}

export function heliFiltern(
  flugzeuge: AdsbFlugzeug[],
  kennungen: Kennung[],
  alleHelikopter: boolean,
  region: { lat: number; lon: number; radiusKm: number },
  jetzt: number,
): HeliPosition[] {
  const aus: HeliPosition[] = [];
  for (const a of flugzeuge) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
    if (distanzKm(region.lat, region.lon, a.lat, a.lon) > region.radiusKm) continue;
    const organisation = organisationFinden(a.r, kennungen);
    if (!organisation && !(alleHelikopter && istHelikopter(a))) continue;
    aus.push(position(a as AdsbFlugzeug & { lat: number; lon: number }, organisation, jetzt));
  }
  return aus;
}

/** Helikopter aus der Kennzeichen Liste in der ganzen Schweiz (aus der Abfrage nach Typ) */
export function schweizFiltern(
  flugzeuge: AdsbFlugzeug[],
  kennungen: Kennung[],
  jetzt: number,
): HeliPosition[] {
  const aus: HeliPosition[] = [];
  for (const a of flugzeuge) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || !inSchweiz(a.lat, a.lon)) continue;
    const organisation = organisationFinden(a.r, kennungen);
    if (organisation)
      aus.push(position(a as AdsbFlugzeug & { lat: number; lon: number }, organisation, jetzt));
  }
  return aus;
}

/** Positionen zusammenführen, die erste Liste hat Vorrang */
export function positionenVereinen(...listen: HeliPosition[][]): HeliPosition[] {
  const nachHex = new Map<string, HeliPosition>();
  for (const liste of listen) for (const p of liste) if (!nachHex.has(p.hex)) nachHex.set(p.hex, p);
  return [...nachHex.values()];
}

export interface Flug {
  hex: string;
  kennzeichen: string | null;
  typ: string | null;
  organisation: string | null;
  start: number;
  startArt: 'start' | 'erfasst';
  startLat: number;
  startLon: number;
  ende: number | null;
  endeArt: 'landung' | 'signalverlust' | 'verlassen' | null;
  endeLat: number | null;
  endeLon: number | null;
  maxHoeheFt: number | null;
  spur: [number, number, number][];
}

export interface FlugEreignis {
  art: 'start' | 'erfasst' | 'landung' | 'signalverlust';
  flug: Flug;
}

const IN_DER_LUFT_KN = 25;
const VERLUST_MS = 3 * 60000;
/** So lange bleibt ein Flug offen, wenn das Signal weg ist, danach gilt er als tief verschwunden */
export const WARTEN_MS = 30000;
/** Kürzere Lücken gelten immer als Störung, nie als Landung */
const LUECKE_MS = 3 * 60000;
/** Bis zu dieser Lücke kann ein Flug wieder zusammengesetzt werden, wenn der Heli durchgeflogen ist */
const ZUSAMMEN_MS = 12 * 60000;

/**
 * Taucht ein Heli nach einer Lücke in der Luft wieder auf: Ist er in der Zwischenzeit weit genug
 * gekommen (im Schnitt mindestens 60 km/h), ist er durchgeflogen. Sonst war er wohl am Boden.
 */
export function durchgeflogen(
  vonLat: number,
  vonLon: number,
  nachLat: number,
  nachLon: number,
  lueckeMs: number,
): boolean {
  if (lueckeMs <= LUECKE_MS) return true;
  if (lueckeMs > ZUSAMMEN_MS) return false;
  return distanzKm(vonLat, vonLon, nachLat, nachLon) / (lueckeMs / 3600000) >= 60;
}

function inDerLuft(p: HeliPosition): boolean {
  return !p.amBoden && (p.speedKn ?? 0) >= IN_DER_LUFT_KN;
}

/** Verfolgt Helikopter über mehrere Abrufe und meldet Start, Landung und Signalverlust. */
export class FlugErkennung {
  private aktiv = new Map<string, { flug: Flug | null; letzte: HeliPosition; luft: boolean }>();

  laufende(): Flug[] {
    return [...this.aktiv.values()].map((a) => a.flug).filter((f): f is Flug => !!f);
  }

  aktualisieren(positionen: HeliPosition[], jetzt: number): FlugEreignis[] {
    const ereignisse: FlugEreignis[] = [];
    const gesehen = new Set<string>();
    for (const p of positionen) {
      gesehen.add(p.hex);
      const luft = inDerLuft(p);
      const a = this.aktiv.get(p.hex);
      if (!a) {
        const flug = luft ? this.neuerFlug(p, 'erfasst') : null;
        this.aktiv.set(p.hex, { flug, letzte: p, luft });
        if (flug) ereignisse.push({ art: 'erfasst', flug });
        continue;
      }
      // Wieder in der Luft nach einer Lücke, aber nicht durchgeflogen: tief verschwunden, also wohl gelandet
      if (
        a.flug &&
        a.luft &&
        luft &&
        (a.letzte.hoeheFt ?? 99999) < 4500 &&
        !durchgeflogen(a.letzte.lat, a.letzte.lon, p.lat, p.lon, p.zeit - a.letzte.zeit)
      ) {
        this.beenden(a.flug, a.letzte, 'signalverlust', a.letzte.zeit);
        ereignisse.push({ art: 'signalverlust', flug: a.flug });
        a.flug = this.neuerFlug(p, 'erfasst');
        ereignisse.push({ art: 'erfasst', flug: a.flug });
      } else if (!a.luft && luft) {
        a.flug = this.neuerFlug(p, 'start');
        ereignisse.push({ art: 'start', flug: a.flug });
      } else if (a.luft && !luft && a.flug) {
        this.beenden(a.flug, p, 'landung', p.zeit);
        ereignisse.push({ art: 'landung', flug: a.flug });
        a.flug = null;
      } else if (a.flug) {
        const letzterPunkt = a.flug.spur[a.flug.spur.length - 1];
        if (!letzterPunkt || p.zeit - letzterPunkt[2] >= 30000) {
          a.flug.spur.push([round5(p.lat), round5(p.lon), p.zeit]);
          if (a.flug.spur.length > 300) a.flug.spur.splice(1, 1);
        }
        if (p.hoeheFt !== null) a.flug.maxHoeheFt = Math.max(a.flug.maxHoeheFt ?? 0, p.hoeheFt);
      }
      a.letzte = p;
      a.luft = luft;
    }
    for (const [hex, a] of this.aktiv) {
      if (gesehen.has(hex) || jetzt - a.letzte.zeit < (a.flug ? WARTEN_MS : VERLUST_MS)) continue;
      if (a.flug) {
        // Niedrig verschwunden: wahrscheinlich gelandet (Funkschatten). Sonst Region verlassen.
        const tief = (a.letzte.hoeheFt ?? 99999) < 4500;
        this.beenden(a.flug, a.letzte, tief ? 'signalverlust' : 'verlassen', a.letzte.zeit);
        if (tief) ereignisse.push({ art: 'signalverlust', flug: a.flug });
      }
      this.aktiv.delete(hex);
    }
    return ereignisse;
  }

  private neuerFlug(p: HeliPosition, art: 'start' | 'erfasst'): Flug {
    return {
      hex: p.hex,
      kennzeichen: p.kennzeichen,
      typ: p.typ,
      organisation: p.organisation,
      start: p.zeit,
      startArt: art,
      startLat: p.lat,
      startLon: p.lon,
      ende: null,
      endeArt: null,
      endeLat: null,
      endeLon: null,
      maxHoeheFt: p.hoeheFt,
      spur: [[round5(p.lat), round5(p.lon), p.zeit]],
    };
  }

  private beenden(f: Flug, p: HeliPosition, art: Flug['endeArt'], zeit: number) {
    f.ende = zeit;
    f.endeArt = art;
    f.endeLat = p.lat;
    f.endeLon = p.lon;
    f.spur.push([round5(p.lat), round5(p.lon), zeit]);
  }
}

export interface Platz {
  name: string;
  lat: number;
  lon: number;
}

/**
 * Spital oder Landeplatz an einer Position (aus OpenStreetMap). Spitäler zählen bis 600 m,
 * weil der Landeplatz oft auf dem Dach eines Nebengebäudes liegt, Landeplätze bis 300 m.
 * Unbenannte Landeplätze bei einem Spital tragen den Namen des Spitals.
 */
export function platzBei(lat: number, lon: number, spitaeler: Platz[], landeplaetze: Platz[]): string | null {
  const naechster = (liste: Platz[], maxKm: number) =>
    liste
      .map((p) => ({ p, km: distanzKm(lat, lon, p.lat, p.lon) }))
      .filter((x) => x.km <= maxKm)
      .sort((a, b) => a.km - b.km)[0]?.p ?? null;
  const spital = naechster(
    spitaeler.filter((s) => s.name),
    0.6,
  );
  if (spital) return spital.name;
  const platz = naechster(landeplaetze, 0.3);
  if (!platz) return null;
  return platz.name || 'Helikopterlandeplatz';
}

function round5(n: number) {
  return Math.round(n * 100000) / 100000;
}

/** Statistik aus erfassten Flügen: nach Stunde, Wochentag und als Raster für die Heatmap */
export function flugStatistik(
  fluege: {
    start: string;
    start_lat: number | null;
    start_lon: number | null;
    ende_lat: number | null;
    ende_lon: number | null;
  }[],
  raster = 0.02,
) {
  const proStunde = Array(24).fill(0) as number[];
  const proWochentag = Array(7).fill(0) as number[];
  const heat = new Map<string, number>();
  const fmt = new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const tage = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  for (const f of fluege) {
    const teile = Object.fromEntries(fmt.formatToParts(new Date(f.start)).map((p) => [p.type, p.value]));
    proStunde[Number(teile.hour)]++;
    const tag = tage.indexOf(String(teile.weekday).replace('.', ''));
    if (tag >= 0) proWochentag[tag]++;
    for (const [la, lo] of [
      [f.start_lat, f.start_lon],
      [f.ende_lat, f.ende_lon],
    ]) {
      if (la === null || lo === null) continue;
      const k = `${(Math.round(la / raster) * raster).toFixed(3)},${(Math.round(lo / raster) * raster).toFixed(3)}`;
      heat.set(k, (heat.get(k) ?? 0) + 1);
    }
  }
  return {
    anzahl: fluege.length,
    proStunde,
    proWochentag,
    heat: [...heat.entries()].map(([k, n]) => {
      const [la, lo] = k.split(',').map(Number);
      return [la, lo, n] as [number, number, number];
    }),
  };
}

/**
 * Zeitfenster für den Rückblick: vormittags die Nacht ab 20 Uhr des Vortags, danach der laufende Tag.
 * Zeiten in Europe/Zurich.
 */
export function rueckblickFenster(jetzt: Date): { von: Date; titel: string } {
  const l = lokal(jetzt);
  if (l.stunde < 12) {
    const gestern = lokal(new Date(vonLokal(l.jahr, l.monat, l.tag, 12).getTime() - 86400000));
    return { von: vonLokal(gestern.jahr, gestern.monat, gestern.tag, 20), titel: 'Seit gestern 20 Uhr' };
  }
  return { von: vonLokal(l.jahr, l.monat, l.tag), titel: 'Heute' };
}

/**
 * Heatmap Raster aus Flügen: Start und Landung zählen doppelt, jede überflogene Zelle einmal pro Flug,
 * damit kreisende Helis eine Stelle nicht überbewerten.
 */
export function heatRaster(
  fluege: {
    start_lat: number | null;
    start_lon: number | null;
    ende_lat: number | null;
    ende_lon: number | null;
    spur?: [number, number][] | null;
  }[],
  raster = 0.02,
): [number, number, number][] {
  const heat = new Map<string, number>();
  const zelle = (la: number, lo: number) =>
    `${(Math.round(la / raster) * raster).toFixed(3)},${(Math.round(lo / raster) * raster).toFixed(3)}`;
  for (const f of fluege) {
    const zellen = new Map<string, number>();
    for (const p of Array.isArray(f.spur) ? f.spur : []) {
      if (typeof p[0] === 'number' && typeof p[1] === 'number') zellen.set(zelle(p[0], p[1]), 1);
    }
    for (const [la, lo] of [
      [f.start_lat, f.start_lon],
      [f.ende_lat, f.ende_lon],
    ]) {
      if (la !== null && lo !== null) zellen.set(zelle(la, lo), 2);
    }
    for (const [k, w] of zellen) heat.set(k, (heat.get(k) ?? 0) + w);
  }
  return [...heat.entries()].map(([k, n]) => {
    const [la, lo] = k.split(',').map(Number);
    return [la, lo, n];
  });
}

/**
 * Punkte eines gespeicherten Flugs mit Zeit in ms für die Wiedergabe. Neuere Spuren tragen als drittes
 * Element die Sekunden seit dem Start. Ältere Spuren ohne Zeit werden gleichmässig zwischen Start und Ende verteilt.
 */
export function wiedergabePunkte(
  spur: unknown,
  startMs: number,
  endeMs: number,
): { punkte: [number, number, number][]; geschaetzt: boolean } {
  const liste = (Array.isArray(spur) ? spur : []).filter(
    (p): p is number[] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number',
  );
  if (!liste.length) return { punkte: [], geschaetzt: false };
  const mitZeit = liste.every((p) => typeof p[2] === 'number');
  if (mitZeit) return { punkte: liste.map((p) => [p[0], p[1], startMs + p[2] * 1000]), geschaetzt: false };
  const schritt = liste.length > 1 ? (endeMs - startMs) / (liste.length - 1) : 0;
  return {
    punkte: liste.map((p, i) => [p[0], p[1], Math.round(startMs + i * schritt)]),
    geschaetzt: true,
  };
}

export type Tageszeit = 'alle' | 'morgen' | 'tag' | 'abend' | 'nacht';
const TAGESZEITEN: Record<Exclude<Tageszeit, 'alle'>, [number, number]> = {
  morgen: [6, 10],
  tag: [10, 17],
  abend: [17, 22],
  nacht: [22, 6],
};

/** Passt der Start (Schweizer Zeit) zu Tageszeit und Wochentag (alle, werktag, wochenende)? */
export function startPasst(
  start: string,
  tageszeit: Tageszeit,
  tage: 'alle' | 'werktag' | 'wochenende',
): boolean {
  const l = lokal(new Date(start));
  if (tageszeit !== 'alle') {
    const [von, bis] = TAGESZEITEN[tageszeit];
    if (von < bis ? l.stunde < von || l.stunde >= bis : l.stunde < von && l.stunde >= bis) return false;
  }
  // wochentag: 0 = Sonntag, 6 = Samstag
  const wochenende = l.wochentag === 0 || l.wochentag === 6;
  if (tage === 'werktag' && wochenende) return false;
  if (tage === 'wochenende' && !wochenende) return false;
  return true;
}

/** Heli ohne aktuelles Signal: wo er zuletzt gesehen wurde (Basis, Einsatzort, Spital) */
export interface Abgestellt {
  hex: string;
  organisation: string;
  kennzeichen: string | null;
  lat: number;
  lon: number;
  /** Zeit des letzten Signals in ms */
  zeit: number;
  /** landung: am Boden gesehen, signalverlust: tief verschwunden, laufend: Flug offen, Signal weg */
  art: 'landung' | 'signalverlust' | 'laufend';
  platz: string | null;
  anBasis: boolean;
  /** Nicht gesehen, sondern angenommen: lange ausserhalb gelandet, Rückflug ohne Empfang */
  vermutet?: boolean;
}

/**
 * Nach so vielen Minuten ohne Signal ausserhalb einer Basis gilt ein Heli als zurückgeflogen.
 * Rückflüge laufen oft tief durch Täler, der Empfänger sieht sie nicht.
 */
export const ABGESTELLT_MAX_MIN = 120;

export interface FlugEnde {
  hex: string;
  organisation: string | null;
  kennzeichen: string | null;
  ende: string | null;
  ende_art: string | null;
  ende_lat: number | null;
  ende_lon: number | null;
  ende_platz: string | null;
  ende_ort: string | null;
}

/** Häufigste Rega Basis, an der ein Heli in den gespeicherten Flügen gelandet ist */
function heimBasis(fluege: FlugEnde[], hex: string) {
  const zaehler = new Map<string, number>();
  for (const f of fluege) {
    const b = f.hex === hex ? basisAusPlatz(f.ende_platz) : null;
    if (b) zaehler.set(b.id, (zaehler.get(b.id) ?? 0) + 1);
  }
  const id = [...zaehler].sort((a, b) => b[1] - a[1])[0]?.[0];
  return id ? (REGA_BASEN.find((b) => b.id === id) ?? null) : null;
}

/**
 * Letzter bekannter Standort pro Heli, der gerade kein Signal sendet. Laufende Flüge ohne Position
 * zählen mit dem letzten Spurpunkt. Ein Ende an einer Rega Basis wird auf die Basis gesetzt.
 * Flüge, die den Empfangsbereich hoch verlassen haben, sagen nichts über den Standort und fallen weg.
 * Mit jetzt: Wer länger als ABGESTELLT_MAX_MIN ausserhalb einer Basis steht, ist vermutlich zurück.
 * Rega Helis kommen dann vermutet an ihre Heimbasis, andere fallen weg.
 */
export function letzteStandorte(
  fluege: FlugEnde[],
  laufende: Flug[],
  aktuell: Set<string>,
  ortVon?: (lat: number, lon: number) => string | null,
  jetzt?: number,
): Abgestellt[] {
  const aus = new Map<string, Abgestellt>();
  for (const f of laufende) {
    const l = f.spur.at(-1);
    if (aktuell.has(f.hex) || !f.organisation || !l) continue;
    aus.set(f.hex, {
      hex: f.hex,
      organisation: f.organisation,
      kennzeichen: f.kennzeichen,
      lat: l[0],
      lon: l[1],
      zeit: l[2],
      art: 'laufend',
      platz: ortVon?.(l[0], l[1]) ?? null,
      anBasis: false,
    });
  }
  const erledigt = new Set(aus.keys());
  const neueste = [...fluege].sort((a, b) => (b.ende ?? '').localeCompare(a.ende ?? ''));
  for (const f of neueste) {
    if (aktuell.has(f.hex) || erledigt.has(f.hex) || !f.organisation || !f.ende) continue;
    // Pro Heli zählt nur der letzte Flug, auch wenn er hoch verschwunden ist
    erledigt.add(f.hex);
    if (f.ende_lat === null || f.ende_lon === null) continue;
    if (f.ende_art !== 'landung' && f.ende_art !== 'signalverlust') continue;
    const art = f.ende_art;
    const basis = basisAusPlatz(f.ende_platz) ?? endeBasis(f.organisation, art, f.ende_lat, f.ende_lon);
    aus.set(f.hex, {
      hex: f.hex,
      organisation: f.organisation,
      kennzeichen: f.kennzeichen,
      lat: basis?.lat ?? f.ende_lat,
      lon: basis?.lon ?? f.ende_lon,
      zeit: new Date(f.ende).getTime(),
      art,
      platz: basis ? basisName(basis) : (f.ende_platz ?? f.ende_ort),
      anBasis: !!basis,
    });
  }
  if (jetzt !== undefined) {
    for (const [hex, a] of aus) {
      if (a.anBasis || jetzt - a.zeit <= ABGESTELLT_MAX_MIN * 60000) continue;
      const heim = a.organisation === 'Rega' ? heimBasis(fluege, hex) : null;
      if (!heim) {
        aus.delete(hex);
        continue;
      }
      aus.set(hex, {
        ...a,
        lat: heim.lat,
        lon: heim.lon,
        platz: basisName(heim),
        anBasis: true,
        vermutet: true,
      });
    }
  }
  return [...aus.values()].sort((a, b) => b.zeit - a.zeit);
}

/** Art eines Landeorts: Rega Basis, Spital, anderer Landeplatz oder Einsatzort ohne bekannten Platz */
export function ortArt(platz: string | null | undefined): 'basis' | 'spital' | 'landeplatz' | 'einsatzort' {
  if (basisAusPlatz(platz)) return 'basis';
  if (!platz) return 'einsatzort';
  return /spital|klinik|hospital|ospedale|h[oô]pital|notfall|universit/i.test(platz)
    ? 'spital'
    : 'landeplatz';
}

/**
 * Landung eines Rega Helis in der Region ausserhalb einer Basis, meist ein Einsatzort.
 * Nur echte Landungen (am Boden gesehen), kein Signalverlust, und nur ohne bekannten Platz:
 * Landungen bei Spitälern meldet schon die Regel für Heli Aktivität.
 */
export function einsatzLandung(
  organisation: string | null,
  art: string,
  platz: string | null,
  lat: number | null,
  lon: number | null,
  region: { lat: number; lon: number; radiusKm: number },
): boolean {
  if (organisation !== 'Rega' || art !== 'landung' || platz || lat === null || lon === null) return false;
  return distanzKm(region.lat, region.lon, lat, lon) <= region.radiusKm;
}

/** Gespeicherter Flug, wie ihn die Einsatz Chronik braucht */
export interface ChronikFlug {
  id: string;
  hex: string;
  organisation: string | null;
  kennzeichen: string | null;
  start: string;
  start_platz: string | null;
  start_ort: string | null;
  start_lat: number | null;
  start_lon: number | null;
  ende: string | null;
  ende_art: string | null;
  ende_platz: string | null;
  ende_ort: string | null;
  ende_lat: number | null;
  ende_lon: number | null;
  spur?: unknown;
}

export interface Etappe {
  id: string;
  von: string | null;
  nach: string | null;
  art: ReturnType<typeof ortArt> | 'weg';
  start: string;
  ende: string | null;
  minuten: number | null;
  lat: number | null;
  lon: number | null;
  signalverlust: boolean;
  spur: [number, number][];
}

export interface Einsatz {
  id: string;
  hex: string;
  organisation: string | null;
  kennzeichen: string | null;
  basis: string | null;
  start: string;
  ende: string | null;
  zurueck: boolean;
  art: 'einsatzort' | 'verlegung' | 'spital' | 'unklar';
  einsatzort: { name: string; lat: number; lon: number; gemeinde: string | null } | null;
  spitaeler: string[];
  flugMin: number;
  dauerMin: number | null;
  etappen: Etappe[];
}

/** Spur auf höchstens n Punkte ausdünnen, erster und letzter bleiben */
export function ausduennen(spur: unknown, n = 40): [number, number][] {
  if (!Array.isArray(spur)) return [];
  const p = spur.filter((x) => Array.isArray(x) && typeof x[0] === 'number' && typeof x[1] === 'number');
  if (p.length <= n) return p.map((x) => [x[0], x[1]]);
  const aus: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = p[Math.round((i * (p.length - 1)) / (n - 1))];
    aus.push([x[0], x[1]]);
  }
  return aus;
}

const minZwischen = (a: string, b: string | null) =>
  b ? Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null;

/**
 * Flüge eines Helis zu Einsätzen zusammensetzen: Ein Einsatz beginnt an der Basis (oder nach
 * einer Pause von mehr als 4 Stunden) und endet mit der Landung an einer Basis. Dazwischen liegen
 * Landungen am Einsatzort oder bei Spitälern. Abgeleitet aus Transponderdaten, ohne Gewähr.
 */
export function einsaetzeBilden(fluege: ChronikFlug[], pauseMin = 240): Einsatz[] {
  const proHeli = new Map<string, ChronikFlug[]>();
  for (const f of fluege) {
    const l = proHeli.get(f.hex) ?? [];
    l.push(f);
    proHeli.set(f.hex, l);
  }
  const aus: Einsatz[] = [];
  for (const roh of proHeli.values()) {
    const liste = lueckenSchliessen(roh);
    let aktuell: ChronikFlug[] = [];
    const abschliessen = () => {
      if (aktuell.length) aus.push(einsatzAus(aktuell));
      aktuell = [];
    };
    for (const f of liste) {
      const vorher = aktuell.at(-1);
      if (vorher) {
        const pause = vorher.ende
          ? (new Date(f.start).getTime() - new Date(vorher.ende).getTime()) / 60000
          : 0;
        if (!vorher.ende || pause > pauseMin || vorher.ende_art === 'verlassen') abschliessen();
      }
      aktuell.push(f);
      if (f.ende && f.ende_art !== 'verlassen' && ortArt(f.ende_platz) === 'basis') abschliessen();
    }
    abschliessen();
  }
  return aus.sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * Flüge, die nur wegen einer kurzen Lücke im Empfang geteilt wurden, wieder zu einem Flug
 * zusammensetzen: Ende mit Signalverlust, danach in der Luft erfasst und durchgeflogen.
 */
export function lueckenSchliessen(fluege: ChronikFlug[]): ChronikFlug[] {
  const sortiert = [...fluege].sort((a, b) => a.start.localeCompare(b.start));
  const aus: ChronikFlug[] = [];
  for (const f of sortiert) {
    const v = aus.at(-1);
    if (
      v?.ende &&
      v.ende_art === 'signalverlust' &&
      !f.start_platz &&
      v.ende_lat !== null &&
      v.ende_lon !== null &&
      f.start_lat !== null &&
      f.start_lon !== null &&
      durchgeflogen(
        v.ende_lat,
        v.ende_lon,
        f.start_lat,
        f.start_lon,
        new Date(f.start).getTime() - new Date(v.ende).getTime(),
      )
    ) {
      aus[aus.length - 1] = {
        ...v,
        ende: f.ende,
        ende_art: f.ende_art,
        ende_platz: f.ende_platz,
        ende_ort: f.ende_ort,
        ende_lat: f.ende_lat,
        ende_lon: f.ende_lon,
        spur: [...(Array.isArray(v.spur) ? v.spur : []), ...(Array.isArray(f.spur) ? f.spur : [])],
      };
      continue;
    }
    aus.push(f);
  }
  return aus;
}

function einsatzAus(fl: ChronikFlug[]): Einsatz {
  const erster = fl[0];
  const letzter = fl[fl.length - 1];
  const etappen: Etappe[] = fl.map((f) => ({
    id: f.id,
    von: f.start_platz ?? f.start_ort,
    nach: f.ende_art === 'verlassen' ? null : (f.ende_platz ?? f.ende_ort),
    art: f.ende_art === 'verlassen' ? 'weg' : ortArt(f.ende_platz),
    start: f.start,
    ende: f.ende,
    minuten: minZwischen(f.start, f.ende),
    lat: f.ende_lat,
    lon: f.ende_lon,
    signalverlust: f.ende_art === 'signalverlust',
    spur: ausduennen(f.spur),
  }));
  const ort = etappen.find((e) => e.art === 'einsatzort' || e.art === 'landeplatz');
  const spitaeler = etappen.filter((e) => e.art === 'spital' && e.nach).map((e) => e.nach!);
  const zurueck = !!letzter.ende && etappen.at(-1)?.art === 'basis';
  const startBasis = ortArt(erster.start_platz) === 'basis' ? erster.start_platz : null;
  return {
    id: erster.id,
    hex: erster.hex,
    organisation: erster.organisation,
    kennzeichen: fl.find((f) => f.kennzeichen)?.kennzeichen ?? null,
    basis: startBasis ?? (zurueck ? etappen.at(-1)!.nach : null),
    start: erster.start,
    ende: letzter.ende,
    zurueck,
    art: ort ? 'einsatzort' : spitaeler.length >= 2 ? 'verlegung' : spitaeler.length ? 'spital' : 'unklar',
    einsatzort:
      ort && ort.lat !== null && ort.lon !== null
        ? {
            name: ort.nach ?? 'Unbekannter Ort',
            lat: ort.lat,
            lon: ort.lon,
            gemeinde: fl.find((f) => f.id === ort.id)?.ende_ort ?? null,
          }
        : null,
    spitaeler,
    // Überlappende Flüge in den Rohdaten: Flugzeit nie länger als die Dauer
    flugMin: Math.min(
      etappen.reduce((s, e) => s + (e.minuten ?? 0), 0),
      minZwischen(erster.start, letzter.ende) ?? Number.POSITIVE_INFINITY,
    ),
    dauerMin: minZwischen(erster.start, letzter.ende),
    etappen,
  };
}

/**
 * Auswertung der Einsätze: pro Basis Anzahl, Flugzeit und typische Dauer, Spitäler nach
 * Häufigkeit, Einsatzorte für die Karte und Vergleich der letzten 7 Tage mit der Woche davor.
 */
export function einsatzStatistik(einsaetze: Einsatz[], jetzt: number) {
  const basen = new Map<string, { anzahl: number; flugMin: number; dauern: number[] }>();
  const spitaeler = new Map<string, number>();
  const gemeinden = new Map<string, number>();
  for (const e of einsaetze) {
    const g = e.einsatzort?.gemeinde;
    if (g) gemeinden.set(g, (gemeinden.get(g) ?? 0) + 1);
    const b = e.basis ?? 'Unbekannte Basis';
    const x = basen.get(b) ?? { anzahl: 0, flugMin: 0, dauern: [] };
    x.anzahl++;
    x.flugMin += e.flugMin;
    if (e.dauerMin !== null && e.zurueck) x.dauern.push(e.dauerMin);
    basen.set(b, x);
    for (const s of new Set(e.spitaeler)) spitaeler.set(s, (spitaeler.get(s) ?? 0) + 1);
  }
  const median = (w: number[]) => {
    if (!w.length) return null;
    const s = [...w].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const woche = 7 * 86400000;
  const zaehle = (von: number, bis: number) =>
    einsaetze.filter((e) => {
      const t = new Date(e.start).getTime();
      return t >= von && t < bis;
    });
  const diese = zaehle(jetzt - woche, jetzt + 1);
  const vorher = zaehle(jetzt - 2 * woche, jetzt - woche);
  const arten = (l: Einsatz[]) => ({
    einsaetze: l.length,
    mitEinsatzort: l.filter((e) => e.art === 'einsatzort').length,
    flugMin: l.reduce((s, e) => s + e.flugMin, 0),
  });
  return {
    anzahl: einsaetze.length,
    proBasis: [...basen.entries()]
      .map(([basis, x]) => ({ basis, anzahl: x.anzahl, flugMin: x.flugMin, dauerMin: median(x.dauern) }))
      .sort((a, b) => b.anzahl - a.anzahl),
    spitaeler: [...spitaeler.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    gemeinden: [...gemeinden.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    orte: einsaetze
      .filter((e) => e.einsatzort)
      .slice(0, 400)
      .map((e) => ({ ...e.einsatzort!, basis: e.basis, start: e.start, kennzeichen: e.kennzeichen })),
    woche: { diese: arten(diese), vorher: arten(vorher) },
  };
}

/** Heatmap nur aus den vermuteten Einsatzorten, ohne Basen, Spitäler und Flugspuren */
export function einsatzortHeat(einsaetze: Einsatz[]): [number, number, number][] {
  return heatRaster(
    einsaetze
      .filter((e) => e.einsatzort)
      .map((e) => ({
        start_lat: null,
        start_lon: null,
        ende_lat: e.einsatzort!.lat,
        ende_lon: e.einsatzort!.lon,
      })),
  );
}

/** Letzte Landung an jeder Rega Basis (Schlüssel: Basis id) aus den gespeicherten Flügen */
export function letzteRueckkehr(
  fluege: FlugEnde[],
): Map<string, { zeit: string; kennzeichen: string | null }> {
  const aus = new Map<string, { zeit: string; kennzeichen: string | null }>();
  for (const f of fluege) {
    if (!f.ende || f.ende_art === 'verlassen') continue;
    const b = basisAusPlatz(f.ende_platz);
    if (!b) continue;
    const alt = aus.get(b.id);
    if (!alt || f.ende > alt.zeit) aus.set(b.id, { zeit: f.ende, kennzeichen: f.kennzeichen });
  }
  return aus;
}
