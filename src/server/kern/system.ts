// Systemstatus des Pi: Temperatur, RAM, Speicher, Tailscale, Backup Alter.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';
import { join } from 'node:path';

export interface SystemStatus {
  temperaturC: number | null;
  ramGesamtMb: number;
  ramVerfuegbarMb: number;
  prozessRssMb: number;
  prozessHeapMb: number;
  speicherGesamtGb: number | null;
  speicherFreiGb: number | null;
  last: number[];
  kerne: number;
  laufzeitSek: number;
  prozessLaufzeitSek: number;
  tailscale: { installiert: boolean; verbunden: boolean | null; name?: string; ip?: string };
  backup: { letztes: string | null; alterStunden: number | null; anzahl: number };
  drosselung: string | null;
  /** Gedeutete Drosselung, null ausserhalb des Pi */
  strom: Stromzustand | null;
  node: string;
}

export interface Stromzustand {
  unterspannung: boolean;
  gedrosselt: boolean;
  frequenzBegrenzt: boolean;
  temperaturGrenze: boolean;
  /** Seit dem letzten Neustart mindestens einmal aufgetreten */
  unterspannungSeitStart: boolean;
  gedrosseltSeitStart: boolean;
}

/** Deutet den Wert von vcgencmd get_throttled (Bits 0 bis 3 jetzt, 16 bis 19 seit Start) */
export function drosselungDeuten(hex: string | null): Stromzustand | null {
  if (!hex || !/^0x[0-9a-f]+$/i.test(hex)) return null;
  const n = Number.parseInt(hex, 16);
  const bit = (i: number) => (n & (1 << i)) !== 0;
  return {
    unterspannung: bit(0),
    frequenzBegrenzt: bit(1),
    gedrosselt: bit(2),
    temperaturGrenze: bit(3),
    unterspannungSeitStart: bit(16),
    gedrosseltSeitStart: bit(18),
  };
}

/** Kurzer Text für Kachel und Systemseite */
export function stromText(z: Stromzustand | null): string {
  if (!z) return 'unbekannt';
  if (z.unterspannung) return 'Unterspannung';
  if (z.gedrosselt || z.frequenzBegrenzt) return 'gedrosselt';
  if (z.unterspannungSeitStart) return 'Unterspannung seit Start';
  if (z.gedrosseltSeitStart) return 'gedrosselt seit Start';
  return 'gut';
}

function lesen(pfad: string): string | null {
  try {
    return readFileSync(pfad, 'utf8').trim();
  } catch {
    return null;
  }
}

export function temperatur(): number | null {
  const roh = lesen('/sys/class/thermal/thermal_zone0/temp');
  return roh ? Math.round(Number(roh) / 100) / 10 : null;
}

export function ramVerfuegbarMb(): number {
  // MemAvailable ist genauer als freemem (Cache zählt als verfügbar)
  const info = lesen('/proc/meminfo');
  const m = info ? /MemAvailable:\s+(\d+)/.exec(info) : null;
  return Math.round(m ? Number(m[1]) / 1024 : freemem() / 1048576);
}

function ausfuehren(befehl: string, args: string[], timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(befehl, args, { timeout: timeoutMs, maxBuffer: 2_000_000 }, (err, stdout) =>
      resolve(err ? null : stdout),
    );
  });
}

let tailscaleCache: { zeit: number; wert: SystemStatus['tailscale'] } | null = null;

async function tailscaleStatus(): Promise<SystemStatus['tailscale']> {
  if (tailscaleCache && Date.now() - tailscaleCache.zeit < 60000) return tailscaleCache.wert;
  const installiert = existsSync('/usr/bin/tailscale') || existsSync('/usr/sbin/tailscale');
  let wert: SystemStatus['tailscale'] = { installiert, verbunden: null };
  if (installiert) {
    const out = await ausfuehren('tailscale', ['status', '--json']);
    if (out) {
      try {
        const d = JSON.parse(out) as {
          BackendState?: string;
          Self?: { DNSName?: string; TailscaleIPs?: string[] };
        };
        wert = {
          installiert,
          verbunden: d.BackendState === 'Running',
          name: d.Self?.DNSName?.replace(/\.$/, ''),
          ip: d.Self?.TailscaleIPs?.[0],
        };
      } catch {
        // unlesbar
      }
    }
  }
  tailscaleCache = { zeit: Date.now(), wert };
  return wert;
}

export function backupInfo(verzeichnis: string): SystemStatus['backup'] {
  const dir = join(verzeichnis, 'backups');
  if (!existsSync(dir)) return { letztes: null, alterStunden: null, anzahl: 0 };
  const dateien = readdirSync(dir)
    .filter((f) => f.startsWith('backup-'))
    .map((f) => ({ f, zeit: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.zeit - a.zeit);
  if (!dateien.length) return { letztes: null, alterStunden: null, anzahl: 0 };
  return {
    letztes: new Date(dateien[0].zeit).toISOString(),
    alterStunden: Math.round((Date.now() - dateien[0].zeit) / 360000) / 10,
    anzahl: dateien.length,
  };
}

async function drosselung(): Promise<string | null> {
  // vcgencmd gibt es nur auf dem Pi. throttled=0x0 heisst alles gut.
  const out = await ausfuehren('vcgencmd', ['get_throttled'], 2000);
  return out ? out.trim().replace('throttled=', '') : null;
}

export async function systemStatus(datenVerzeichnis: string): Promise<SystemStatus> {
  let speicherGesamtGb: number | null = null;
  let speicherFreiGb: number | null = null;
  try {
    const s = statfsSync(datenVerzeichnis);
    speicherGesamtGb = Math.round(((s.blocks * s.bsize) / 1e9) * 10) / 10;
    speicherFreiGb = Math.round(((s.bavail * s.bsize) / 1e9) * 10) / 10;
  } catch {
    // Verzeichnis fehlt
  }
  const mem = process.memoryUsage();
  const drossel = await drosselung();
  return {
    temperaturC: temperatur(),
    ramGesamtMb: Math.round(totalmem() / 1048576),
    ramVerfuegbarMb: ramVerfuegbarMb(),
    prozessRssMb: Math.round(mem.rss / 1048576),
    prozessHeapMb: Math.round(mem.heapUsed / 1048576),
    speicherGesamtGb,
    speicherFreiGb,
    last: loadavg().map((l) => Math.round(l * 100) / 100),
    kerne: cpus().length,
    laufzeitSek: Math.round(uptime()),
    prozessLaufzeitSek: Math.round(process.uptime()),
    tailscale: await tailscaleStatus(),
    backup: backupInfo(datenVerzeichnis),
    drosselung: drossel,
    strom: drosselungDeuten(drossel),
    node: process.version,
  };
}
