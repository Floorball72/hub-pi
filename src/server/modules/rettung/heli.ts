// Helikopter über ADS-B (adsb.lol, ODbL). Sichtbar sind nur Luftfahrzeuge, die selbst einen Transponder senden.
// Erkennung von Start und Landung aus aufeinanderfolgenden Positionen.
import { distanzKm } from '../../quellen/geo.ts';
import { httpJson } from '../../quellen/http.ts';
import { lokal, vonLokal } from '../../kern/zeit.ts';
import { basisAusPlatz, basisName, endeBasis } from '../../geteilt/heli.ts';

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
      if (!a.luft && luft) {
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
      if (gesehen.has(hex) || jetzt - a.letzte.zeit < VERLUST_MS) continue;
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
}

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

/**
 * Letzter bekannter Standort pro Heli, der gerade kein Signal sendet. Laufende Flüge ohne Position
 * zählen mit dem letzten Spurpunkt. Ein Ende an einer Rega Basis wird auf die Basis gesetzt.
 * Flüge, die den Empfangsbereich hoch verlassen haben, sagen nichts über den Standort und fallen weg.
 */
export function letzteStandorte(
  fluege: FlugEnde[],
  laufende: Flug[],
  aktuell: Set<string>,
  ortVon?: (lat: number, lon: number) => string | null,
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
