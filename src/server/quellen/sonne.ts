// Sonnen und Mondberechnung (Sonnenstand, Auf und Untergang, Goldene und Blaue Stunde, Mondphase).
// Sonne: NOAA Solar Calculator (nach Meeus), geprüft gegen PyEphem und Open-Meteo (Abweichung unter 1 Minute).
// Mond: Näherung nach Vladimir Agafonkin, SunCalc (BSD 2 Lizenz), https://aa.quae.nl/en/reken/hemelpositie.html
const PI = Math.PI;
const rad = PI / 180;
const TAG_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397;

const zuJulian = (d: Date) => d.valueOf() / TAG_MS - 0.5 + J1970;
const zuTagen = (d: Date) => zuJulian(d) - J2000;

const rektaszension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const deklination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const mittlereAnomalie = (d: number) => rad * (357.5291 + 0.98560028 * d);
function ekliptischeLaenge(M: number) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + PI;
}
function sonnenKoordinaten(d: number) {
  const L = ekliptischeLaenge(mittlereAnomalie(d));
  return { dec: deklination(L, 0), ra: rektaszension(L, 0) };
}

export interface SonnenStand {
  /** Höhe über dem Horizont in Grad (ohne Refraktion) */
  hoehe: number;
  /** Azimut in Grad ab Norden im Uhrzeigersinn */
  azimut: number;
}

// Sonne nach dem Algorithmus des NOAA Solar Calculator (Jean Meeus, Astronomical Algorithms).
// Genauigkeit etwa eine Minute für Auf und Untergang in mittleren Breiten.
function sonnenParameter(t: Date) {
  const jd = zuJulian(t);
  const T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const ex = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const dek = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps * rad) / 2) ** 2;
  const zeitgleichung =
    (4 / rad) *
    (y * Math.sin(2 * L0 * rad) -
      2 * ex * Math.sin(M * rad) +
      4 * ex * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
      0.5 * y * y * Math.sin(4 * L0 * rad) -
      1.25 * ex * ex * Math.sin(2 * M * rad));
  return { dek, zeitgleichung };
}

export function sonnenstand(datum: Date, lat: number, lon: number): SonnenStand {
  const { dek, zeitgleichung } = sonnenParameter(datum);
  const minutenUtc = datum.getUTCHours() * 60 + datum.getUTCMinutes() + datum.getUTCSeconds() / 60;
  const wahreSonnenzeit = (((minutenUtc + zeitgleichung + 4 * lon) % 1440) + 1440) % 1440;
  const H = (wahreSonnenzeit / 4 - 180) * rad;
  const phi = lat * rad;
  const hoehe = Math.asin(Math.sin(phi) * Math.sin(dek) + Math.cos(phi) * Math.cos(dek) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dek) * Math.cos(phi));
  return { hoehe: hoehe / rad, azimut: (((az / rad + 180) % 360) + 360) % 360 };
}

export interface SonnenZeiten {
  aufgang: Date | null;
  untergang: Date | null;
  mittag: Date;
  /** Goldene Stunde: Sonne zwischen +6 und -4 Grad */
  goldMorgen: [Date | null, Date | null];
  goldAbend: [Date | null, Date | null];
  /** Blaue Stunde: Sonne zwischen -4 und -6 Grad */
  blauMorgen: [Date | null, Date | null];
  blauAbend: [Date | null, Date | null];
}

function utcTagesbeginn(d: Date) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Zeitpunkt, an dem die Sonne die Höhe «winkel» erreicht (morgens oder abends), zwei Iterationen */
function ereignis(tag0: number, lat: number, lon: number, winkel: number, abends: boolean): Date | null {
  let t = tag0 + (720 - 4 * lon) * 60000;
  for (let i = 0; i < 3; i++) {
    const { dek, zeitgleichung } = sonnenParameter(new Date(t));
    const phi = lat * rad;
    const cosH = (Math.sin(winkel * rad) - Math.sin(phi) * Math.sin(dek)) / (Math.cos(phi) * Math.cos(dek));
    if (cosH < -1 || cosH > 1) return null;
    const H = Math.acos(cosH) / rad;
    const mittagMin = 720 - 4 * lon - zeitgleichung;
    t = tag0 + (mittagMin + (abends ? 4 * H : -4 * H)) * 60000;
  }
  return new Date(t);
}

/** Zeiten für den Kalendertag (UTC Datum von «datum», am besten Mittag lokal übergeben). */
export function sonnenZeiten(datum: Date, lat: number, lon: number): SonnenZeiten {
  const tag0 = utcTagesbeginn(datum);
  const { zeitgleichung } = sonnenParameter(new Date(tag0 + 12 * 3600000));
  const paar = (w: number): [Date | null, Date | null] => [
    ereignis(tag0, lat, lon, w, false),
    ereignis(tag0, lat, lon, w, true),
  ];
  const [auf, unter] = paar(-0.833);
  const [g6m, g6a] = paar(6);
  const [g4m, g4a] = paar(-4);
  const [b6m, b6a] = paar(-6);
  return {
    aufgang: auf,
    untergang: unter,
    mittag: new Date(tag0 + (720 - 4 * lon - zeitgleichung) * 60000),
    goldMorgen: [g4m, g6m],
    goldAbend: [g6a, g4a],
    blauMorgen: [b6m, g4m],
    blauAbend: [g4a, b6a],
  };
}

function mondKoordinaten(d: number) {
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M);
  const b = rad * 5.128 * Math.sin(F);
  return { ra: rektaszension(l, b), dec: deklination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

export interface MondInfo {
  /** beleuchteter Anteil 0 bis 1 */
  beleuchtet: number;
  /** Phase 0 bis 1: 0 Neumond, 0.25 erstes Viertel, 0.5 Vollmond, 0.75 letztes Viertel */
  phase: number;
  name: string;
}

export function mond(datum: Date): MondInfo {
  const d = zuTagen(datum);
  const s = sonnenKoordinaten(d);
  const m = mondKoordinaten(d);
  const sdist = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  );
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const winkel = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  const phase = 0.5 + (0.5 * inc * (winkel < 0 ? -1 : 1)) / PI;
  return { beleuchtet: (1 + Math.cos(inc)) / 2, phase, name: mondName(phase) };
}

export function mondName(p: number): string {
  if (p < 0.03 || p > 0.97) return 'Neumond';
  if (p < 0.22) return 'zunehmende Sichel';
  if (p < 0.28) return 'erstes Viertel';
  if (p < 0.47) return 'zunehmender Mond';
  if (p < 0.53) return 'Vollmond';
  if (p < 0.72) return 'abnehmender Mond';
  if (p < 0.78) return 'letztes Viertel';
  return 'abnehmende Sichel';
}
