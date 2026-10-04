// Zentrale Konfiguration aus .env und Umgebung. Geheimnisse werden nie geloggt.
import { resolve } from 'node:path';
import { envLesen } from './kern/env-datei.ts';

export interface Ort {
  name: string;
  lat: number;
  lon: number;
}

export interface Feed {
  name: string;
  url: string;
}

export interface Konfig {
  envPfad: string;
  port: number;
  host: string;
  demo: boolean;
  treiber: 'lokal' | 'supabase';
  datenVerzeichnis: string;
  sessionSecret: string;
  adminBenutzer: string;
  adminPasswortHash: string;
  einrichtungAbgeschlossen: boolean;
  erlaubteNetze: string[];
  supabase: { url: string; anonKey: string; serviceKey: string; dbUrl: string; erlaubteEmails: string[] };
  ntfy: { server: string; thema: string; token: string; adresse: string };
  wetterOrte: Ort[];
  oevHaltestellen: string[];
  icalUrl: string;
  region: { name: string; lat: number; lon: number; radiusKm: number };
  einsatzFeeds: Feed[];
  warnGebiete: string[];
  heliAlle: boolean;
  heliTypen: string[];
  pagespeedKey: string;
  hibpKey: string;
  githubToken: string;
  sportsdbKey: string;
  update: { repo: string; zweig: string };
  suhLogin: { benutzer: string; passwort: string };
}

/** Schlüssel, deren Werte nie ausgegeben werden dürfen. */
export const GEHEIME_SCHLUESSEL = [
  'SESSION_SECRET',
  'ADMIN_PASSWORT_HASH',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'NTFY_TOKEN',
  'NTFY_THEMA',
  'ICAL_URL',
  'PAGESPEED_API_KEY',
  'HIBP_API_KEY',
  'GITHUB_TOKEN',
  'SUH_LOGIN_BENUTZER',
  'SUH_LOGIN_PASSWORT',
];

function liste(wert: string | undefined, trenner = ','): string[] {
  return (wert ?? '')
    .split(trenner)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function orteParsen(wert: string | undefined): Ort[] {
  return liste(wert, ';')
    .map((teil) => {
      const [name, lat, lon] = teil.split('|').map((s) => s.trim());
      return { name, lat: Number(lat), lon: Number(lon) };
    })
    .filter((o) => o.name && Number.isFinite(o.lat) && Number.isFinite(o.lon));
}

export function feedsParsen(wert: string | undefined): Feed[] {
  return liste(wert, ';')
    .map((teil) => {
      const i = teil.indexOf('|');
      return i < 0
        ? { name: teil, url: teil }
        : { name: teil.slice(0, i).trim(), url: teil.slice(i + 1).trim() };
    })
    .filter((f) => /^https?:\/\//.test(f.url));
}

function zahl(wert: string | undefined, standard: number): number {
  const n = Number(wert);
  return wert && Number.isFinite(n) ? n : standard;
}

export function konfigLaden(ueberschreiben: Record<string, string> = {}): Konfig {
  const envPfad = resolve(process.env.PIHUB_ENV ?? '.env');
  // Reihenfolge: .env Datei, dann Prozessumgebung, dann Überschreibungen (für Tests)
  const e: Record<string, string | undefined> = { ...envLesen(envPfad), ...process.env, ...ueberschreiben };
  const demo = e.DEMO_MODUS === 'true';
  return {
    envPfad,
    port: zahl(e.PORT, 8080),
    host: e.HOST || '0.0.0.0',
    demo,
    treiber: e.DATEN_TREIBER === 'supabase' ? 'supabase' : 'lokal',
    datenVerzeichnis: resolve(e.DATEN_VERZEICHNIS || 'data'),
    sessionSecret: e.SESSION_SECRET ?? '',
    adminBenutzer: e.ADMIN_BENUTZER || 'jerome',
    adminPasswortHash: e.ADMIN_PASSWORT_HASH ?? '',
    einrichtungAbgeschlossen: e.EINRICHTUNG_ABGESCHLOSSEN === 'true',
    erlaubteNetze: liste(e.ERLAUBTE_NETZE),
    supabase: {
      url: (e.SUPABASE_URL ?? '').replace(/\/+$/, ''),
      anonKey: e.SUPABASE_ANON_KEY ?? '',
      serviceKey: e.SUPABASE_SERVICE_ROLE_KEY ?? '',
      dbUrl: e.SUPABASE_DB_URL ?? '',
      erlaubteEmails: liste(e.ERLAUBTE_EMAILS).map((m) => m.toLowerCase()),
    },
    ntfy: {
      server: (e.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, ''),
      thema: e.NTFY_THEMA ?? '',
      token: e.NTFY_TOKEN ?? '',
      // Adresse des Hubs (z.B. https://hub-pi.tailXXXX.ts.net), damit ein Tipp auf den Push die Seite öffnet
      adresse: (e.HUB_ADRESSE ?? '').replace(/\/+$/, ''),
    },
    wetterOrte: orteParsen(e.WETTER_ORTE ?? 'Kirchberg SG|47.41079|9.04110;St. Gallen|47.42358|9.38851'),
    oevHaltestellen: liste(e.OEV_HALTESTELLEN ?? 'Kirchberg SG, Post;St. Gallen', ';'),
    icalUrl: e.ICAL_URL ?? '',
    region: {
      name: e.REGION_NAME || 'Ostschweiz',
      lat: zahl(e.REGION_LAT, 47.41),
      lon: zahl(e.REGION_LON, 9.2),
      radiusKm: zahl(e.REGION_RADIUS_KM, 40),
    },
    einsatzFeeds: feedsParsen(e.EINSATZ_FEEDS),
    warnGebiete: liste(e.WARN_GEBIETE ?? 'St. Gallen;Appenzell;Thurgau;Toggenburg', ';'),
    heliAlle: e.HELI_ALLE !== 'false',
    heliTypen: (e.HELI_TYPEN ?? 'A109,EC45,A169,AS50,EC30,EC35,B429,LAMA')
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean),
    pagespeedKey: e.PAGESPEED_API_KEY ?? '',
    hibpKey: e.HIBP_API_KEY ?? '',
    githubToken: e.GITHUB_TOKEN ?? '',
    sportsdbKey: e.THESPORTSDB_KEY || '123',
    update: { repo: e.UPDATE_REPO || 'Floorball72/hub-pi', zweig: e.UPDATE_BRANCH || 'main' },
    suhLogin: { benutzer: e.SUH_LOGIN_BENUTZER ?? '', passwort: e.SUH_LOGIN_PASSWORT ?? '' },
  };
}

/** Liste aller geheimen Werte der aktuellen Konfiguration (für das Schwärzen in Logs). */
export function geheimeWerte(k: Konfig): string[] {
  return [
    k.sessionSecret,
    k.adminPasswortHash,
    k.supabase.anonKey,
    k.supabase.serviceKey,
    k.supabase.dbUrl,
    k.ntfy.token,
    k.icalUrl,
    k.pagespeedKey,
    k.hibpKey,
    k.githubToken,
    k.suhLogin.benutzer,
    k.suhLogin.passwort,
  ].filter((w) => w && w.length >= 4);
}
