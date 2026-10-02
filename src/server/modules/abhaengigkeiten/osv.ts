// Auswertung von Lockfiles und der OSV Datenbank (osv.dev). Reine Funktionen plus Abruf.
import { httpJson } from '../../quellen/http.ts';

export interface Paket {
  name: string;
  version: string;
  /** direkt in package.json oder nur indirekt */
  direkt: boolean;
}

/** Liest package-lock.json (Version 1, 2 oder 3). Ohne Lockfile: Versionen aus package.json (ungenau). */
export function paketeLesen(
  packageJson: string | null,
  lock: string | null,
): { pakete: Paket[]; genau: boolean } {
  const pj = packageJson
    ? (JSON.parse(packageJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      })
    : {};
  const direkteNamen = new Set([
    ...Object.keys(pj.dependencies ?? {}),
    ...Object.keys(pj.devDependencies ?? {}),
  ]);
  if (lock) {
    const l = JSON.parse(lock) as {
      packages?: Record<string, { version?: string; link?: boolean }>;
      dependencies?: Record<string, { version?: string; dependencies?: Record<string, unknown> }>;
    };
    const aus = new Map<string, Paket>();
    if (l.packages) {
      for (const [pfad, info] of Object.entries(l.packages)) {
        if (!pfad || info.link || !info.version) continue;
        const name = pfad.slice(pfad.lastIndexOf('node_modules/') + 'node_modules/'.length);
        aus.set(`${name}@${info.version}`, {
          name,
          version: info.version,
          direkt: direkteNamen.has(name) && pfad === `node_modules/${name}`,
        });
      }
    } else if (l.dependencies) {
      const lauf = (
        deps: Record<string, { version?: string; dependencies?: Record<string, unknown> }>,
        tiefe: number,
      ) => {
        for (const [name, info] of Object.entries(deps)) {
          if (info.version && /^\d/.test(info.version))
            aus.set(`${name}@${info.version}`, {
              name,
              version: info.version,
              direkt: tiefe === 0 && direkteNamen.has(name),
            });
          if (info.dependencies) lauf(info.dependencies as typeof deps, tiefe + 1);
        }
      };
      lauf(l.dependencies, 0);
    }
    return { pakete: [...aus.values()], genau: true };
  }
  const pakete: Paket[] = [];
  for (const [name, bereich] of Object.entries({ ...pj.dependencies, ...pj.devDependencies })) {
    const v = /(\d+\.\d+\.\d+)/.exec(bereich)?.[1];
    if (v) pakete.push({ name, version: v, direkt: true });
  }
  return { pakete, genau: false };
}

/** Vergleich von Versionen x.y.z (Vorabversionen zählen als kleiner) */
export function versionVergleich(a: string, b: string): number {
  const teile = (v: string) => {
    const [haupt, vor] = v.replace(/^v/, '').split('-');
    return { n: haupt.split('.').map((x) => Number.parseInt(x, 10) || 0), vor: vor ?? null };
  };
  const x = teile(a);
  const y = teile(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) - (y.n[i] ?? 0);
  if (x.vor && !y.vor) return -1;
  if (!x.vor && y.vor) return 1;
  return 0;
}

export type Schwere = 'kritisch' | 'hoch' | 'mittel' | 'niedrig' | 'unbekannt';

export interface Vuln {
  id: string;
  summary?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { type?: string; events?: Record<string, string>[] }[];
  }[];
}

export function schwereLesen(v: Vuln): Schwere {
  switch ((v.database_specific?.severity ?? '').toUpperCase()) {
    case 'CRITICAL':
      return 'kritisch';
    case 'HIGH':
      return 'hoch';
    case 'MODERATE':
    case 'MEDIUM':
      return 'mittel';
    case 'LOW':
      return 'niedrig';
    default:
      return 'unbekannt';
  }
}

/** Kleinste behobene Version, die grösser ist als die installierte */
export function behobenIn(v: Vuln, paket: string, installiert: string): string | null {
  const kandidaten: string[] = [];
  for (const a of v.affected ?? []) {
    if (a.package?.name !== paket) continue;
    for (const r of a.ranges ?? [])
      for (const e of r.events ?? [])
        if (e.fixed && versionVergleich(e.fixed, installiert) > 0) kandidaten.push(e.fixed);
  }
  kandidaten.sort(versionVergleich);
  return kandidaten[0] ?? null;
}

export const SCHWERE_RANG: Record<Schwere, number> = {
  kritisch: 4,
  hoch: 3,
  mittel: 2,
  niedrig: 1,
  unbekannt: 0,
};

/** Fragt osv.dev in Blöcken ab. Gibt je Paket die IDs der Schwachstellen zurück. */
export async function osvAbfragen(pakete: Paket[]): Promise<Map<string, string[]>> {
  const aus = new Map<string, string[]>();
  for (let i = 0; i < pakete.length; i += 500) {
    const block = pakete.slice(i, i + 500);
    const r = await httpJson<{ results?: { vulns?: { id: string }[] }[] }>(
      'https://api.osv.dev/v1/querybatch',
      {
        methode: 'POST',
        body: JSON.stringify({
          queries: block.map((p) => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })),
        }),
        headers: { 'content-type': 'application/json' },
        timeoutMs: 30000,
        maxBytes: 5_000_000,
      },
    );
    (r.results ?? []).forEach((res, j) => {
      const ids = (res.vulns ?? []).map((v) => v.id);
      if (ids.length) aus.set(`${block[j].name}@${block[j].version}`, ids);
    });
  }
  return aus;
}

export function vulnHolen(id: string): Promise<Vuln> {
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(id)) throw new Error('Ungültige ID');
  return httpJson<Vuln>(`https://api.osv.dev/v1/vulns/${id}`, { timeoutMs: 15000, maxBytes: 2_000_000 });
}
