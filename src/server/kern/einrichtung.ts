// Einrichtungsassistent: fragt Zugangsdaten und Orte ab, prüft jede Eingabe und schreibt die .env.
// Erreichbar nur aus dem lokalen Netz oder über Tailscale. Nach Abschluss nur noch mit Login.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { datenbankTesten, migrationenAnwenden } from '../daten/migration.ts';
import { EingabeFehler } from '../daten/schema.ts';
import { feedsParsen } from '../konfig.ts';
import { httpAnfrage, httpJson, httpText } from '../quellen/http.ts';
import { icalParsen } from '../quellen/ical.ts';
import { robotsErlaubt } from '../quellen/robots.ts';
import { passwortHash } from './auth.ts';
import { envLesen, envSchreiben } from './env-datei.ts';
import { fehlerText } from './fehler.ts';
import type { Hub } from './hub.ts';
import { ntfySenden } from './ntfy.ts';

type Werte = Record<string, string>;
export interface Pruefung {
  ok: boolean;
  meldung: string;
  daten?: unknown;
}

const OFFENE_FELDER = [
  'DATEN_TREIBER',
  'SUPABASE_URL',
  'ERLAUBTE_EMAILS',
  'NTFY_SERVER',
  'WETTER_ORTE',
  'OEV_HALTESTELLEN',
  'REGION_NAME',
  'REGION_LAT',
  'REGION_LON',
  'REGION_RADIUS_KM',
  'EINSATZ_FEEDS',
  'THESPORTSDB_KEY',
  'UPDATE_REPO',
  'UPDATE_BRANCH',
  'ADMIN_BENUTZER',
];
const GEHEIME_FELDER = [
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'NTFY_THEMA',
  'NTFY_TOKEN',
  'ICAL_URL',
  'PAGESPEED_API_KEY',
  'HIBP_API_KEY',
  'GITHUB_TOKEN',
  'SUH_LOGIN_BENUTZER',
  'SUH_LOGIN_PASSWORT',
  'ADMIN_PASSWORT_HASH',
];

export interface GeoTreffer {
  name: string;
  lat: number;
  lon: number;
}

/** Ortssuche über geo.admin.ch (Gazetteer und Gemeinden). */
export async function ortSuchen(name: string): Promise<GeoTreffer | null> {
  const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&limit=5&sr=4326&searchText=${encodeURIComponent(name)}`;
  const d = await httpJson<{
    results: { attrs: { label: string; lat: number; lon: number; origin: string } }[];
  }>(url, { timeoutMs: 8000 });
  const r = d.results.find((x) => ['gg25', 'gazetteer', 'zipcode'].includes(x.attrs.origin)) ?? d.results[0];
  if (!r) return null;
  return {
    name,
    lat: Math.round(r.attrs.lat * 100000) / 100000,
    lon: Math.round(r.attrs.lon * 100000) / 100000,
  };
}

export async function pruefen(art: string, w: Werte): Promise<Pruefung> {
  try {
    switch (art) {
      case 'supabase': {
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(w.SUPABASE_URL ?? '')) {
          return { ok: false, meldung: 'Supabase URL im Format https://<projekt>.supabase.co' };
        }
        const r = await httpAnfrage(`${w.SUPABASE_URL}/auth/v1/settings`, {
          headers: { apikey: w.SUPABASE_ANON_KEY ?? '' },
          timeoutMs: 8000,
        });
        if (r.status !== 200)
          return { ok: false, meldung: `Supabase antwortet mit HTTP ${r.status}. Anon Key prüfen.` };
        const s = JSON.parse(r.text) as { disable_signup?: boolean };
        const db = await datenbankTesten(w.SUPABASE_DB_URL ?? '');
        const warnung =
          s.disable_signup === false
            ? ' Achtung: Registrierungen sind offen. In Supabase unter Authentication, Sign In / Providers deaktivieren.'
            : '';
        return { ok: true, meldung: `Verbunden (${db}).${warnung}` };
      }
      case 'ntfy': {
        if (!/^[A-Za-z0-9_-]{6,64}$/.test(w.NTFY_THEMA ?? ''))
          return { ok: false, meldung: 'Thema: 6 bis 64 Zeichen, nur Buchstaben, Zahlen, - und _' };
        await ntfySenden(
          {
            server: (w.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, ''),
            thema: w.NTFY_THEMA,
            token: w.NTFY_TOKEN ?? '',
          },
          {
            titel: 'Pi Hub Einrichtung',
            text: 'Wenn du das liest, funktioniert Push.',
            prioritaet: 3,
            tags: ['tada'],
          },
        );
        return { ok: true, meldung: 'Testnachricht gesendet. Ist sie auf dem Handy angekommen?' };
      }
      case 'orte': {
        const namen = (w.ORTE_NAMEN ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
        if (!namen.length || namen.length > 10) return { ok: false, meldung: '1 bis 10 Orte angeben' };
        const orte: GeoTreffer[] = [];
        for (const n of namen) {
          const t = await ortSuchen(n);
          if (!t) return { ok: false, meldung: `Ort nicht gefunden: ${n}` };
          orte.push(t);
        }
        return {
          ok: true,
          meldung: orte.map((o) => `${o.name} (${o.lat}, ${o.lon})`).join(', '),
          daten: orte,
        };
      }
      case 'oev': {
        const namen = (w.OEV_HALTESTELLEN ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
        const gefunden: string[] = [];
        for (const n of namen) {
          const d = await httpJson<{ stations: { name: string; id: string | null }[] }>(
            `https://transport.opendata.ch/v1/locations?type=station&query=${encodeURIComponent(n)}`,
            { timeoutMs: 8000 },
          );
          const s =
            d.stations.find((x) => x.id && x.name.toLowerCase() === n.toLowerCase()) ??
            d.stations.find((x) => x.id);
          if (!s) return { ok: false, meldung: `Haltestelle nicht gefunden: ${n}` };
          gefunden.push(s.name);
        }
        return { ok: true, meldung: `Gefunden: ${gefunden.join(', ')}`, daten: gefunden };
      }
      case 'ical': {
        if (!/^https:\/\//.test(w.ICAL_URL ?? ''))
          return { ok: false, meldung: 'Die iCal Adresse beginnt mit https://' };
        const text = await httpText(w.ICAL_URL, { timeoutMs: 15000, maxBytes: 10_000_000 });
        if (!text.includes('BEGIN:VCALENDAR')) return { ok: false, meldung: 'Keine iCal Datei' };
        const termine = icalParsen(text);
        const suh = termine.filter((t) => /^swiss unihockey\s*\|/i.test(t.titel)).length;
        return {
          ok: true,
          meldung: `${termine.length} Termine gelesen, davon ${suh} swiss unihockey Einsätze`,
        };
      }
      case 'region': {
        const t = await ortSuchen(w.REGION_NAME ?? '');
        if (!t)
          return {
            ok: false,
            meldung: 'Region nicht gefunden. Einen Ort als Mittelpunkt angeben, z.B. Wil SG.',
          };
        const radius = Number(w.REGION_RADIUS_KM || 40);
        if (!(radius >= 5 && radius <= 200)) return { ok: false, meldung: 'Radius zwischen 5 und 200 km' };
        return { ok: true, meldung: `Mittelpunkt ${t.lat}, ${t.lon}, Radius ${radius} km`, daten: t };
      }
      case 'feeds': {
        const feeds = feedsParsen(w.EINSATZ_FEEDS);
        if (!feeds.length) return { ok: true, meldung: 'Keine Feeds angegeben (optional)' };
        const meldungen: string[] = [];
        for (const f of feeds) {
          if (!(await robotsErlaubt(f.url)))
            return { ok: false, meldung: `${f.name}: robots.txt verbietet den Abruf` };
          const text = await httpText(f.url, { timeoutMs: 10000 });
          if (!/<rss|<feed|<rdf/i.test(text))
            return { ok: false, meldung: `${f.name}: kein RSS oder Atom Feed` };
          meldungen.push(`${f.name} ok`);
        }
        return { ok: true, meldung: meldungen.join(', ') };
      }
      default:
        return { ok: false, meldung: 'Unbekannte Prüfung' };
    }
  } catch (e) {
    return { ok: false, meldung: fehlerText(e).slice(0, 200) };
  }
}

export function einrichtungRouten(app: FastifyInstance, hub: Hub) {
  app.get('/api/einrichtung', async () => {
    const env = envLesen(hub.konfig.envPfad);
    const offen: Werte = {};
    for (const f of OFFENE_FELDER) offen[f] = env[f] ?? '';
    const gesetzt: Record<string, boolean> = {};
    for (const f of GEHEIME_FELDER) gesetzt[f] = !!env[f];
    return {
      abgeschlossen: hub.konfig.einrichtungAbgeschlossen,
      werte: offen,
      gesetzt,
      envPfad: hub.konfig.envPfad,
    };
  });

  app.post<{ Body: { art: string; werte: Werte } }>('/api/einrichtung/pruefen', async (req) => {
    const env = envLesen(hub.konfig.envPfad);
    // Leere geheime Felder: gespeicherten Wert verwenden
    const w: Werte = {
      ...env,
      ...Object.fromEntries(Object.entries(req.body?.werte ?? {}).filter(([, v]) => v !== '')),
    };
    return pruefen(String(req.body?.art ?? ''), w);
  });

  app.post<{ Body: { werte: Werte; passwort?: string; bestaetigt?: boolean } }>(
    '/api/einrichtung/speichern',
    async (req) => {
      if (req.body?.bestaetigt !== true) throw new EingabeFehler('Bestätigung fehlt');
      const env = envLesen(hub.konfig.envPfad);
      const eingabe = req.body.werte ?? {};
      const neu: Werte = {};
      for (const f of [...OFFENE_FELDER, ...GEHEIME_FELDER]) {
        const v = eingabe[f];
        if (typeof v !== 'string') continue;
        if (v.length > 2000 || /[\r\n]/.test(v)) throw new EingabeFehler(`${f}: ungültiger Wert`);
        // Geheime Felder nur überschreiben, wenn etwas eingegeben wurde
        if (GEHEIME_FELDER.includes(f) && v === '') continue;
        neu[f] = v.trim();
      }
      const passwort = req.body.passwort ?? '';
      if (passwort) {
        if (passwort.length < 10) throw new EingabeFehler('Passwort: mindestens 10 Zeichen');
        neu.ADMIN_PASSWORT_HASH = passwortHash(passwort);
      } else if (!env.ADMIN_PASSWORT_HASH) {
        throw new EingabeFehler('Bitte ein Passwort für den lokalen Login festlegen');
      }
      if (!env.SESSION_SECRET) neu.SESSION_SECRET = randomBytes(32).toString('hex');
      const alles = { ...env, ...neu };

      const meldungen: string[] = [];
      if (alles.DATEN_TREIBER === 'supabase') {
        const p = await pruefen('supabase', alles);
        if (!p.ok) throw new EingabeFehler(`Supabase: ${p.meldung}`);
        const m = await migrationenAnwenden(alles.SUPABASE_DB_URL, resolve('supabase/migrations'));
        meldungen.push(
          `${m.angewendet.length} Migrationen angewendet, ${m.uebersprungen.length} bereits vorhanden`,
        );
      }
      neu.EINRICHTUNG_ABGESCHLOSSEN = 'true';
      neu.DEMO_MODUS = 'false';
      envSchreiben(hub.konfig.envPfad, neu);
      await hub.aktivitaet('kern', `Einrichtung gespeichert. ${meldungen.join('. ')}`, 'aktion');
      // Neustart, damit die neue Konfiguration gilt (systemd startet den Dienst neu)
      setTimeout(() => process.exit(0), 1000).unref();
      return { ok: true, meldungen, hinweis: 'Gespeichert. Der Hub startet neu.' };
    },
  );
}
