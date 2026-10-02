// Fastify Server: Sicherheit (Netz, Login, CSRF), Kern Routen, Modul Routen und Auslieferung des Frontends.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, normalize, resolve } from 'node:path';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { backupErstellen, backupListe, backupVerzeichnis } from './kern/backup.ts';
import { aktionenRouten } from './kern/aktionen.ts';
import {
  anmelden,
  LoginBremse,
  SITZUNG_COOKIE,
  SITZUNG_TAGE,
  type Sitzung,
  sitzungErstellen,
  sitzungLesen,
} from './kern/auth.ts';
import { crudRouten } from './kern/crud.ts';
import { einrichtungRouten } from './kern/einrichtung.ts';
import { fehlerText, HubFehler } from './kern/fehler.ts';
import { Hub } from './kern/hub.ts';
import { kernRouten } from './kern/routen.ts';
import { erlaubteAdresse } from './kern/netz.ts';
import type { Konfig } from './konfig.ts';
import { geheimeWerte } from './konfig.ts';
import { schwaerzen } from './kern/aktivitaet.ts';
import type { ModulDef } from './kern/modul.ts';
import type { Daten } from './daten/index.ts';

declare module 'fastify' {
  interface FastifyRequest {
    sitzung: Sitzung | null;
  }
  interface FastifyContextConfig {
    /** Route ohne Login (öffentliche Statusseite) */
    oeffentlich?: boolean;
  }
}

const VERSION = '0.1.0';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function cookieLesen(req: FastifyRequest, name: string): string | undefined {
  const roh = req.headers.cookie;
  if (!roh) return undefined;
  for (const teil of roh.split(';')) {
    const i = teil.indexOf('=');
    if (i > 0 && teil.slice(0, i).trim() === name) return decodeURIComponent(teil.slice(i + 1).trim());
  }
  return undefined;
}

function cookieSetzen(reply: FastifyReply, wert: string, maxAlterSek: number, sicher: boolean) {
  reply.header(
    'Set-Cookie',
    `${SITZUNG_COOKIE}=${encodeURIComponent(wert)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAlterSek}${sicher ? '; Secure' : ''}`,
  );
}

export interface AppOptionen {
  konfig: Konfig;
  module?: ModulDef[];
  daten?: Daten;
  jetzt?: () => Date;
  webVerzeichnis?: string;
  logger?: boolean;
}

export async function appErstellen(o: AppOptionen): Promise<{ app: FastifyInstance; hub: Hub }> {
  const k = o.konfig;
  const geheim = geheimeWerte(k);
  const app = Fastify({
    logger:
      o.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-pihub"]'],
            hooks: {
              logMethod(args, method) {
                // Geheimnisse nie im Log
                const sauber = args.map((a) => (typeof a === 'string' ? schwaerzen(a, geheim) : a));
                method.apply(this, sauber as Parameters<typeof method>);
              },
            },
          },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1_000_000,
    trustProxy: '127.0.0.1',
  });

  if (!k.sessionSecret) {
    k.sessionSecret = randomBytes(32).toString('hex');
    app.log.warn('SESSION_SECRET fehlt: Sitzungen gelten nur bis zum nächsten Neustart');
  }

  const hub = new Hub(k, app.log, o.module, o.daten, o.jetzt);
  const bremse = new LoginBremse();
  app.decorateRequest('sitzung', null);

  // 1. Nur lokales Netz und Tailscale
  app.addHook('onRequest', async (req, reply) => {
    const ip = req.socket.remoteAddress ?? '';
    if (!erlaubteAdresse(ip, k.erlaubteNetze)) {
      return reply.code(403).type('text/plain').send('Zugriff nur aus dem lokalen Netz oder über Tailscale');
    }
  });

  // 2. Login und CSRF Schutz
  app.addHook('preHandler', async (req, reply) => {
    req.sitzung = sitzungLesen(cookieLesen(req, SITZUNG_COOKIE), k.sessionSecret);
    const pfad = req.url.split('?')[0];
    if (!pfad.startsWith('/api/')) return;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-pihub'] !== '1') {
      return reply.code(403).send({ fehler: 'Anfrage abgelehnt (CSRF Schutz)' });
    }
    if (req.routeOptions.config?.oeffentlich) return;
    if (['/api/login', '/api/logout', '/api/sitzung', '/api/gesundheit'].includes(pfad)) return;
    if (pfad.startsWith('/api/einrichtung') && !k.einrichtungAbgeschlossen) return;
    if (!req.sitzung) return reply.code(401).send({ fehler: 'Bitte anmelden' });
    // Nutzung für den Abrufplaner (nur echte Seitenaufrufe, nicht automatische Aktualisierungen im Hintergrund)
    if (req.headers['x-pihub-sichtbar'] !== '0') hub.planer.nutzung();
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    );
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    const status =
      (err as { status?: number; statusCode?: number }).status ??
      (err as { statusCode?: number }).statusCode ??
      500;
    if (status >= 500)
      req.log.error({ err: schwaerzen(fehlerText(err), geheim), url: req.url.split('?')[0] }, 'Fehler');
    // Interne Fehler nie im Detail ausgeben
    const meldung = status < 500 || err instanceof HubFehler ? fehlerText(err) : 'Interner Fehler';
    reply.code(status).send({ fehler: schwaerzen(meldung, geheim) });
  });

  // Login
  // Release Name (Ordner) für den Gesundheitscheck beim Deploy: antwortet wirklich die neue Version?
  const release = basename(process.cwd());
  app.get('/api/gesundheit', async () => ({ ok: true, version: VERSION, release }));
  app.get('/api/sitzung', async (req) => ({
    angemeldet: !!req.sitzung,
    benutzer: req.sitzung?.benutzer ?? null,
    demo: k.demo,
    einrichtungOffen: !k.einrichtungAbgeschlossen,
    treiber: k.treiber,
  }));
  app.post<{ Body: { benutzer?: string; passwort?: string } }>('/api/login', async (req, reply) => {
    // Hinter tailscale serve kommt die echte Adresse im X-Forwarded-For Header (trustProxy 127.0.0.1)
    const ip = req.ip ?? '?';
    if (bremse.gesperrt(ip))
      return reply.code(429).send({ fehler: 'Zu viele Versuche. Bitte 10 Minuten warten.' });
    const r = await anmelden(k, String(req.body?.benutzer ?? ''), String(req.body?.passwort ?? ''));
    if (!r.ok) {
      bremse.fehlversuch(ip);
      await hub.aktivitaet('kern', `Fehlgeschlagener Login von ${ip}`, 'warnung');
      return reply.code(401).send({ fehler: r.grund });
    }
    bremse.erfolg(ip);
    const sicher = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    cookieSetzen(reply, sitzungErstellen(r.sitzung, k.sessionSecret), SITZUNG_TAGE * 86400, sicher);
    await hub.aktivitaet('kern', `Login ${r.sitzung.benutzer} (${r.sitzung.art})`, 'info');
    return { ok: true, benutzer: r.sitzung.benutzer };
  });
  app.post('/api/logout', async (_req, reply) => {
    cookieSetzen(reply, '', 0, false);
    return { ok: true };
  });

  await hub.starten();
  kernRouten(app, hub);
  crudRouten(app, hub);
  aktionenRouten(app, hub, { backupErstellen, backupListe, backupVerzeichnis });
  einrichtungRouten(app, hub);

  // Modul Routen unter /api/m/<id>, ausgeschaltete Module antworten mit 503
  for (const [id, m] of hub.module) {
    if (!m.laufzeit.routen) continue;
    await app.register(
      async (scope) => {
        scope.addHook('preHandler', async (_req, reply) => {
          if (!hub.modulAktiv(id)) return reply.code(503).send({ fehler: 'Modul ausgeschaltet' });
        });
        await m.laufzeit.routen!(scope);
      },
      { prefix: `/api/m/${id}` },
    );
  }

  // Öffentliche Routen der Module (ohne Login), z.B. /status. Ausgeschaltete Module antworten mit 404.
  for (const [id, m] of hub.module) {
    if (!m.laufzeit.oeffentlicheRouten) continue;
    await app.register(async (scope) => {
      scope.addHook('onRequest', async (_req, reply) => {
        if (!hub.modulAktiv(id)) return reply.code(404).type('text/plain').send('Nicht gefunden');
      });
      await m.laufzeit.oeffentlicheRouten!(scope);
    });
  }

  statischAusliefern(app, o.webVerzeichnis ?? resolve('dist/web'));
  return { app, hub };
}

function statischAusliefern(app: FastifyInstance, wurzel: string) {
  const index = join(wurzel, 'index.html');
  app.get('/*', async (req, reply) => {
    const pfad = decodeURIComponent(req.url.split('?')[0]);
    if (pfad.startsWith('/api/')) return reply.code(404).send({ fehler: 'Nicht gefunden' });
    const datei = normalize(join(wurzel, pfad));
    if (datei.startsWith(wurzel) && existsSync(datei) && statSync(datei).isFile()) {
      const typ = MIME[extname(datei)] ?? 'application/octet-stream';
      // Dateien mit Hash im Namen dürfen lange gecacht werden
      reply.header(
        'Cache-Control',
        pfad.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
      return reply.type(typ).send(readFileSync(datei));
    }
    if (!existsSync(index))
      return reply.code(503).type('text/plain').send('Frontend nicht gebaut. Bitte npm run build ausführen.');
    reply.header('Cache-Control', 'no-cache');
    return reply.type(MIME['.html']).send(readFileSync(index));
  });
}
