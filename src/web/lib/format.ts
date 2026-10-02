// Formatierung für die Schweiz.
const ZONE = 'Europe/Zurich';

export function zeit(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('de-CH', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' });
}

export function datum(iso: string | null | undefined, mitJahr = false): string {
  if (!iso) return '';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('de-CH', {
    timeZone: ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(mitJahr ? { year: 'numeric' } : {}),
  });
}

export function datumZeit(iso: string | null | undefined): string {
  if (!iso) return '';
  return `${datum(iso)} ${zeit(iso)}`;
}

export function relativ(iso: string | null | undefined, jetzt = Date.now()): string {
  if (!iso) return 'nie';
  const s = Math.round((jetzt - new Date(iso).getTime()) / 1000);
  const zukunft = s < 0;
  const a = Math.abs(s);
  let t: string;
  if (a < 60) t = `${a} s`;
  else if (a < 3600) t = `${Math.round(a / 60)} min`;
  else if (a < 86400 * 2) t = `${Math.round(a / 3600)} h`;
  else t = `${Math.round(a / 86400)} Tagen`;
  return zukunft ? `in ${t}` : `vor ${t}`;
}

export function zahl(n: number | null | undefined, stellen = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return n.toLocaleString('de-CH', { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
}

export function chf(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  return `CHF ${n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function heuteIso(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: ZONE });
}
