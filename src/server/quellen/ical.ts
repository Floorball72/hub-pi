// Schlanker iCal Parser (RFC 5545) für Kalender Abos, ohne Zusatzpakete.
// Unterstützt: Zeilenumbruch Faltung, TZID (Zeitzone über Intl), ganztägige Termine, UTC Zeiten,
// einfache Wiederholungen (RRULE FREQ DAILY/WEEKLY/MONTHLY/YEARLY mit INTERVAL, COUNT, UNTIL, BYDAY bei WEEKLY) und EXDATE.

export interface Termin {
  uid: string;
  titel: string;
  beschreibung: string;
  ort: string;
  start: string;
  ende: string | null;
  ganztags: boolean;
  status?: string;
}

interface Eigenschaft {
  name: string;
  params: Record<string, string>;
  wert: string;
}

function entfalten(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function eigenschaftLesen(zeile: string): Eigenschaft | null {
  // Doppelpunkt ausserhalb von Anführungszeichen trennt Name/Parameter vom Wert
  let inQuote = false;
  let i = 0;
  for (; i < zeile.length; i++) {
    const c = zeile[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= zeile.length) return null;
  const [name, ...paramTeile] = zeile.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of paramTeile) {
    const j = p.indexOf('=');
    if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, wert: zeile.slice(i + 1) };
}

export function textEntschluesseln(t: string): string {
  return t.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/** Versatz einer Zeitzone zu UTC in Minuten zu einem Zeitpunkt */
function versatzMinuten(zone: string, utcMs: number): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const t: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(utcMs))) if (p.type !== 'literal') t[p.type] = Number(p.value);
  return (Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - utcMs) / 60000;
}

function zoneGueltig(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Liest DTSTART/DTEND Werte. Gibt ISO Zeit und Ganztags Kennzeichen zurück. */
export function zeitLesen(
  e: Eigenschaft,
  standardZone = 'Europe/Zurich',
): { iso: string; ganztags: boolean } | null {
  const w = e.wert.trim();
  const datum = /^(\d{4})(\d{2})(\d{2})$/.exec(w);
  if (datum || e.params.VALUE === 'DATE') {
    const m = datum ?? /^(\d{4})(\d{2})(\d{2})/.exec(w);
    if (!m) return null;
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, ganztags: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(w);
  if (!m) return null;
  const [, j, mo, t, h, mi, s, z] = m;
  const alsUtc = Date.UTC(+j, +mo - 1, +t, +h, +mi, +s);
  if (z) return { iso: new Date(alsUtc).toISOString(), ganztags: false };
  const zone = e.params.TZID && zoneGueltig(e.params.TZID) ? e.params.TZID : standardZone;
  let utc = alsUtc - versatzMinuten(zone, alsUtc) * 60000;
  utc = alsUtc - versatzMinuten(zone, utc) * 60000;
  return { iso: new Date(utc).toISOString(), ganztags: false };
}

interface RohTermin {
  props: Eigenschaft[];
}

function wiederholungen(
  start: string,
  ganztags: boolean,
  rrule: string,
  ausnahmen: Set<string>,
  bis: Date,
): string[] {
  const regel: Record<string, string> = {};
  for (const teil of rrule.split(';')) {
    const [k, v] = teil.split('=');
    if (k && v) regel[k.toUpperCase()] = v;
  }
  const freq = regel.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return [start];
  const intervall = Math.max(1, Number(regel.INTERVAL ?? 1));
  const anzahl = regel.COUNT ? Number(regel.COUNT) : Number.POSITIVE_INFINITY;
  let ende = bis;
  if (regel.UNTIL) {
    const u = zeitLesen({ name: 'UNTIL', params: {}, wert: regel.UNTIL });
    if (u)
      ende = new Date(Math.min(bis.getTime(), new Date(u.ganztags ? `${u.iso}T23:59:59Z` : u.iso).getTime()));
  }
  const tage = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const byday =
    freq === 'WEEKLY' && regel.BYDAY ? regel.BYDAY.split(',').map((d) => tage.indexOf(d.slice(-2))) : null;
  const basis = new Date(ganztags ? `${start}T00:00:00Z` : start);
  const aus: string[] = [];
  let n = 0;
  for (let i = 0; i < 2000 && n < anzahl; i++) {
    const kandidaten: Date[] = [];
    const d = new Date(basis);
    if (freq === 'DAILY') d.setUTCDate(d.getUTCDate() + i * intervall);
    if (freq === 'WEEKLY') d.setUTCDate(d.getUTCDate() + i * 7 * intervall);
    if (freq === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + i * intervall);
    if (freq === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + i * intervall);
    if (byday) {
      const wochenStart = new Date(d);
      wochenStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
      for (const tag of byday.sort()) {
        const k = new Date(wochenStart);
        k.setUTCDate(wochenStart.getUTCDate() + tag);
        if (k >= basis) kandidaten.push(k);
      }
    } else kandidaten.push(d);
    if (kandidaten.length && kandidaten[0] > ende) break;
    for (const k of kandidaten) {
      if (k > ende || n >= anzahl) break;
      n++;
      const iso = ganztags ? k.toISOString().slice(0, 10) : k.toISOString();
      if (!ausnahmen.has(iso)) aus.push(iso);
    }
  }
  return aus;
}

export function icalParsen(text: string, bis = new Date(Date.now() + 400 * 86400000)): Termin[] {
  const termine: Termin[] = [];
  let aktuell: RohTermin | null = null;
  let tiefe = 0;
  for (const zeile of entfalten(text)) {
    if (!zeile.trim()) continue;
    if (zeile === 'BEGIN:VEVENT') {
      aktuell = { props: [] };
      tiefe = 0;
      continue;
    }
    if (!aktuell) continue;
    if (zeile.startsWith('BEGIN:')) tiefe++;
    else if (zeile.startsWith('END:') && zeile !== 'END:VEVENT') tiefe--;
    else if (zeile === 'END:VEVENT') {
      termine.push(...terminBauen(aktuell, bis));
      aktuell = null;
    } else if (tiefe === 0) {
      const e = eigenschaftLesen(zeile);
      if (e) aktuell.props.push(e);
    }
  }
  return termine;
}

function terminBauen(r: RohTermin, bis: Date): Termin[] {
  const p = (name: string) => r.props.find((e) => e.name === name);
  const s = p('DTSTART');
  const start = s ? zeitLesen(s) : null;
  if (!start) return [];
  const e = p('DTEND');
  const ende = e ? zeitLesen(e) : null;
  const basis: Termin = {
    uid: p('UID')?.wert ?? '',
    titel: textEntschluesseln(p('SUMMARY')?.wert ?? ''),
    beschreibung: textEntschluesseln(p('DESCRIPTION')?.wert ?? ''),
    ort: textEntschluesseln(p('LOCATION')?.wert ?? ''),
    start: start.iso,
    ende: ende?.iso ?? null,
    ganztags: start.ganztags,
    status: p('STATUS')?.wert,
  };
  const rrule = p('RRULE');
  if (!rrule) return [basis];
  const ausnahmen = new Set<string>();
  for (const ex of r.props.filter((x) => x.name === 'EXDATE')) {
    for (const w of ex.wert.split(',')) {
      const z = zeitLesen({ ...ex, wert: w });
      if (z) ausnahmen.add(z.iso);
    }
  }
  const dauer = ende ? new Date(ende.iso).getTime() - new Date(start.iso).getTime() : 0;
  return wiederholungen(start.iso, start.ganztags, rrule.wert, ausnahmen, bis).map((iso, i) => ({
    ...basis,
    uid: `${basis.uid}#${i}`,
    start: iso,
    ende: ende
      ? start.ganztags
        ? new Date(new Date(iso).getTime() + dauer).toISOString().slice(0, 10)
        : new Date(new Date(iso).getTime() + dauer).toISOString()
      : null,
  }));
}
