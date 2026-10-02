// Login: Supabase Auth (E-Mail und Passwort) oder lokaler Admin mit scrypt Hash als Rückfall.
// Sitzungen sind signierte Cookies (HMAC), ohne Speicher auf dem Server.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Konfig } from '../konfig.ts';
import { httpAnfrage } from '../quellen/http.ts';

const SCRYPT = { N: 16384, r: 8, p: 1, laenge: 32 };
export const SITZUNG_COOKIE = 'pihub_sitzung';
export const SITZUNG_TAGE = 30;

export function passwortHash(passwort: string): string {
  const salz = randomBytes(16);
  const hash = scryptSync(passwort, salz, SCRYPT.laenge, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salz.toString('base64url')}$${hash.toString('base64url')}`;
}

export function passwortPruefen(passwort: string, gespeichert: string): boolean {
  const teile = gespeichert.split('$');
  if (teile.length !== 6 || teile[0] !== 'scrypt') return false;
  const [, N, r, p, salz, hash] = teile;
  const soll = Buffer.from(hash, 'base64url');
  const ist = scryptSync(passwort, Buffer.from(salz, 'base64url'), soll.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return ist.length === soll.length && timingSafeEqual(ist, soll);
}

export interface Sitzung {
  benutzer: string;
  art: 'lokal' | 'supabase' | 'demo';
  ablauf: number;
}

function signieren(daten: string, geheimnis: string) {
  return createHmac('sha256', geheimnis).update(daten).digest('base64url');
}

export function sitzungErstellen(s: Omit<Sitzung, 'ablauf'>, geheimnis: string, jetzt = Date.now()): string {
  const inhalt = Buffer.from(JSON.stringify({ ...s, ablauf: jetzt + SITZUNG_TAGE * 86400000 })).toString(
    'base64url',
  );
  return `v1.${inhalt}.${signieren(inhalt, geheimnis)}`;
}

export function sitzungLesen(
  token: string | undefined,
  geheimnis: string,
  jetzt = Date.now(),
): Sitzung | null {
  if (!token) return null;
  const [v, inhalt, sig] = token.split('.');
  if (v !== 'v1' || !inhalt || !sig) return null;
  const soll = Buffer.from(signieren(inhalt, geheimnis));
  const ist = Buffer.from(sig);
  if (soll.length !== ist.length || !timingSafeEqual(soll, ist)) return null;
  try {
    const s = JSON.parse(Buffer.from(inhalt, 'base64url').toString()) as Sitzung;
    return s.ablauf > jetzt ? s : null;
  } catch {
    return null;
  }
}

/** Einfache Bremse gegen Passwort Raten: höchstens 5 Fehlversuche in 10 Minuten pro Adresse. */
export class LoginBremse {
  private versuche = new Map<string, number[]>();
  gesperrt(ip: string, jetzt = Date.now()): boolean {
    const liste = (this.versuche.get(ip) ?? []).filter((t) => jetzt - t < 600000);
    this.versuche.set(ip, liste);
    return liste.length >= 5;
  }
  fehlversuch(ip: string, jetzt = Date.now()) {
    this.versuche.set(ip, [...(this.versuche.get(ip) ?? []), jetzt]);
    if (this.versuche.size > 1000) this.versuche.clear();
  }
  erfolg(ip: string) {
    this.versuche.delete(ip);
  }
}

export type LoginErgebnis = { ok: true; sitzung: Omit<Sitzung, 'ablauf'> } | { ok: false; grund: string };

export async function anmelden(k: Konfig, benutzer: string, passwort: string): Promise<LoginErgebnis> {
  benutzer = benutzer.trim();
  if (!benutzer || !passwort || passwort.length > 200 || benutzer.length > 200)
    return { ok: false, grund: 'Angaben fehlen' };

  // Lokaler Admin (funktioniert auch, wenn Supabase nicht erreichbar ist)
  if (benutzer.toLowerCase() === k.adminBenutzer.toLowerCase()) {
    if (k.adminPasswortHash && passwortPruefen(passwort, k.adminPasswortHash)) {
      return { ok: true, sitzung: { benutzer: k.adminBenutzer, art: 'lokal' } };
    }
    // Demo ohne gesetztes Passwort: Passwort «demo»
    if (k.demo && !k.adminPasswortHash && passwort === 'demo') {
      return { ok: true, sitzung: { benutzer: k.adminBenutzer, art: 'demo' } };
    }
    return { ok: false, grund: 'Benutzer oder Passwort falsch' };
  }

  // Supabase Auth mit E-Mail
  if (benutzer.includes('@') && k.supabase.url && k.supabase.anonKey) {
    if (!k.supabase.erlaubteEmails.includes(benutzer.toLowerCase())) {
      return { ok: false, grund: 'Benutzer oder Passwort falsch' };
    }
    try {
      const r = await httpAnfrage(`${k.supabase.url}/auth/v1/token?grant_type=password`, {
        methode: 'POST',
        headers: { apikey: k.supabase.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: benutzer, password: passwort }),
        timeoutMs: 8000,
        abstandMs: 0,
      });
      if (r.status === 200) {
        const d = JSON.parse(r.text) as { user?: { email?: string } };
        if (d.user?.email?.toLowerCase() === benutzer.toLowerCase()) {
          return { ok: true, sitzung: { benutzer: d.user.email, art: 'supabase' } };
        }
      }
      return { ok: false, grund: 'Benutzer oder Passwort falsch' };
    } catch {
      return { ok: false, grund: 'Supabase nicht erreichbar, bitte lokalen Login verwenden' };
    }
  }
  return { ok: false, grund: 'Benutzer oder Passwort falsch' };
}
