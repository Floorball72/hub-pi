// Prüft, ob eine Anfrage aus dem lokalen Netz oder über Tailscale kommt.
import { isIPv4, isIPv6 } from 'node:net';

const STANDARD_NETZE = [
  '127.0.0.0/8', // lokal
  '10.0.0.0/8', // privat
  '172.16.0.0/12', // privat
  '192.168.0.0/16', // privat
  '100.64.0.0/10', // Tailscale (CGNAT Bereich)
  '169.254.0.0/16', // link local
  '::1/128',
  'fc00::/7', // ULA, enthält Tailscale fd7a:115c:a1e0::/48
  'fe80::/10',
];

function v4ZuZahl(ip: string): number {
  return ip.split('.').reduce((n, teil) => (n << 8) + Number(teil), 0) >>> 0;
}

function v6ZuBigInt(ip: string): bigint {
  // eingebettete IPv4 am Ende (z.B. ::ffff:1.2.3.4) in zwei Gruppen umwandeln
  let text = ip;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const z = v4ZuZahl(v4[1]);
    text = text.slice(0, -v4[1].length) + `${(z >>> 16).toString(16)}:${(z & 0xffff).toString(16)}`;
  }
  const [kopf, rest] = text.split('::');
  const k = kopf ? kopf.split(':') : [];
  const r = rest ? rest.split(':') : [];
  const gruppen = rest !== undefined ? [...k, ...Array(8 - k.length - r.length).fill('0'), ...r] : k;
  return gruppen.reduce((n, g) => (n << 16n) + BigInt(Number.parseInt(g || '0', 16)), 0n);
}

export function imNetz(ipRoh: string, cidr: string): boolean {
  let ip = ipRoh.trim();
  if (ip.startsWith('::ffff:') && isIPv4(ip.slice(7))) ip = ip.slice(7);
  const [netz, laengeText] = cidr.split('/');
  if (isIPv4(ip) && isIPv4(netz)) {
    const laenge = Number(laengeText ?? 32);
    const maske = laenge === 0 ? 0 : (~0 << (32 - laenge)) >>> 0;
    return (v4ZuZahl(ip) & maske) === (v4ZuZahl(netz) & maske);
  }
  if (isIPv6(ip) && isIPv6(netz)) {
    const laenge = BigInt(laengeText ?? 128);
    const maske = laenge === 0n ? 0n : ((1n << 128n) - 1n) ^ ((1n << (128n - laenge)) - 1n);
    return (v6ZuBigInt(ip) & maske) === (v6ZuBigInt(netz) & maske);
  }
  return false;
}

export function erlaubteAdresse(ip: string, zusaetzlich: string[] = []): boolean {
  return [...STANDARD_NETZE, ...zusaetzlich].some((n) => {
    try {
      return imNetz(ip, n);
    } catch {
      return false;
    }
  });
}
