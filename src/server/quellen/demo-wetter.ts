// Demo Wetter: plausible, reproduzierbare Verläufe für den Demo Modus.
import type { KpWert } from './kp.ts';
import type { Stunde, Tag, Vorhersage } from './openmeteo.ts';
import { sonnenstand, sonnenZeiten } from './sonne.ts';

function welle(t: number, periodeH: number, phase = 0) {
  return Math.sin((t / 3600000 / periodeH) * 2 * Math.PI + phase);
}

export function demoVorhersage(lat: number, lon: number, jetzt = new Date()): Vorhersage {
  const start = new Date(jetzt);
  start.setUTCHours(0, 0, 0, 0);
  const stunden: Stunde[] = [];
  for (let i = 0; i < 7 * 24; i++) {
    const t = start.getTime() + i * 3600000;
    const tagHoehe = sonnenstand(new Date(t), lat, lon).hoehe;
    const tag = tagHoehe > -0.833;
    const temp = Math.round((12 + 6 * welle(t, 24, -2) + 2 * welle(t, 90, 1) - (lat - 47) * 3) * 10) / 10;
    const wolkenHoch = Math.max(0, Math.min(100, Math.round(50 + 50 * welle(t, 31, 0.7))));
    const wolkenMittel = Math.max(0, Math.min(100, Math.round(30 + 45 * welle(t, 43, 2))));
    const wolkenTief = Math.max(0, Math.min(100, Math.round(20 + 40 * welle(t, 57, 4))));
    const regnet = wolkenTief > 50 && wolkenMittel > 60;
    const wind10 = Math.round(Math.max(2, 9 + 7 * welle(t, 37, 1)) * 10) / 10;
    stunden.push({
      t,
      temp,
      regen: regnet ? Math.round((0.3 + Math.abs(welle(t, 5)) * 1.5) * 10) / 10 : 0,
      regenWahrsch: regnet ? 70 : Math.round(Math.max(0, 25 * welle(t, 29))),
      code: regnet ? 61 : wolkenTief > 60 ? 3 : wolkenMittel > 40 ? 2 : 1,
      wind10,
      wind80: Math.round(wind10 * 1.6 * 10) / 10,
      wind120: Math.round(wind10 * 1.85 * 10) / 10,
      boeen: Math.round(wind10 * 1.9 * 10) / 10,
      richtung: Math.round(240 + 60 * welle(t, 50)),
      wolken: Math.max(wolkenTief, wolkenMittel, wolkenHoch),
      wolkenTief,
      wolkenMittel,
      wolkenHoch,
      sicht: regnet ? 8000 : 30000 + Math.round(15000 * welle(t, 33)),
      feuchte: Math.round(70 + 20 * welle(t, 24, 1)),
      tag,
    });
  }
  const tage: Tag[] = [];
  for (let d = 0; d < 7; d++) {
    const s = stunden.slice(d * 24, d * 24 + 24);
    const mittag = new Date(start.getTime() + d * 86400000 + 11 * 3600000);
    const z = sonnenZeiten(mittag, lat, lon);
    tage.push({
      datum: mittag.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }),
      code: s.some((x) => (x.regen ?? 0) > 0) ? 61 : 2,
      tmax: Math.max(...s.map((x) => x.temp ?? 0)),
      tmin: Math.min(...s.map((x) => x.temp ?? 0)),
      regen: Math.round(s.reduce((a, x) => a + (x.regen ?? 0), 0) * 10) / 10,
      regenWahrsch: Math.max(...s.map((x) => x.regenWahrsch ?? 0)),
      sonnenaufgang: z.aufgang?.getTime() ?? null,
      sonnenuntergang: z.untergang?.getTime() ?? null,
      boeenMax: Math.max(...s.map((x) => x.boeen ?? 0)),
    });
  }
  const jetztStunde =
    stunden.find((s) => s.t <= jetzt.getTime() && s.t + 3600000 > jetzt.getTime()) ?? stunden[0];
  return {
    lat,
    lon,
    hoehe: 600,
    aktuell: {
      t: jetzt.getTime(),
      temp: jetztStunde.temp,
      gefuehlt: (jetztStunde.temp ?? 0) - 1,
      code: jetztStunde.code,
      wind: jetztStunde.wind10,
      boeen: jetztStunde.boeen,
      richtung: jetztStunde.richtung,
      regen: jetztStunde.regen,
      feuchte: jetztStunde.feuchte,
      tag: jetztStunde.tag,
    },
    stunden,
    tage,
  };
}

export function demoKp(jetzt = new Date()): KpWert[] {
  const werte: KpWert[] = [];
  const start = new Date(jetzt);
  start.setUTCHours(0, 0, 0, 0);
  for (let i = -8; i < 24; i++) {
    const t = new Date(start.getTime() + i * 3 * 3600000);
    werte.push({
      zeit: t.toISOString(),
      kp: Math.round((2.3 + 1.3 * Math.sin(i / 3)) * 100) / 100,
      beobachtet: t <= jetzt,
    });
  }
  return werte;
}
