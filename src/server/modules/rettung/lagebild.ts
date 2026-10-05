// Lagebild: Ereignisse aus Heli Flügen, Alertswiss, Unwetterwarnungen und Erdbeben auf einer Zeitleiste.
import { heliFarbe } from '../../geteilt/heli.ts';
import type { Alert, Erdbeben, Warnung } from './quellen.ts';

export interface LageEreignis {
  id: string;
  art: 'start' | 'landung' | 'alert' | 'warnung' | 'erdbeben';
  zeit: number;
  bis: number | null;
  titel: string;
  text: string;
  lat: number | null;
  lon: number | null;
  farbe: string;
  link: string | null;
}

export interface LageFlug {
  id: string;
  hex: string;
  organisation: string;
  kennzeichen: string | null;
  von: string | null;
  nach: string | null;
  start: number;
  ende: number | null;
  punkte: [number, number, number][];
}

export function lageEreignisse(e: {
  von: number;
  bis: number;
  fluege: LageFlug[];
  alerts: (Alert & { mitte: [number, number] | null })[];
  warnungen: Warnung[];
  erdbeben: Erdbeben[];
}): LageEreignis[] {
  const drin = (t: number) => t >= e.von && t <= e.bis;
  const aus: LageEreignis[] = [];
  for (const f of e.fluege) {
    const name = f.kennzeichen ?? f.hex;
    const link = `/heli?hex=${encodeURIComponent(f.hex)}`;
    const erster = f.punkte[0];
    const letzter = f.punkte[f.punkte.length - 1];
    if (drin(f.start))
      aus.push({
        id: `start-${f.id}`,
        art: 'start',
        zeit: f.start,
        bis: f.ende,
        titel: `${name} startet`,
        text: [f.organisation, f.von].filter(Boolean).join(', '),
        lat: erster?.[0] ?? null,
        lon: erster?.[1] ?? null,
        farbe: heliFarbe(f.organisation),
        link,
      });
    if (f.ende !== null && f.ende > f.start && drin(f.ende))
      aus.push({
        id: `landung-${f.id}`,
        art: 'landung',
        zeit: f.ende,
        bis: null,
        titel: `${name} landet`,
        text: [f.organisation, f.nach].filter(Boolean).join(', '),
        lat: letzter?.[0] ?? null,
        lon: letzter?.[1] ?? null,
        farbe: heliFarbe(f.organisation),
        link,
      });
  }
  for (const a of e.alerts) {
    const t = new Date(a.gesendet).getTime();
    if (a.test || !drin(t)) continue;
    aus.push({
      id: `alert-${a.id}`,
      art: 'alert',
      zeit: t,
      bis: null,
      titel: a.titel,
      text: a.herausgeber,
      lat: a.mitte?.[0] ?? null,
      lon: a.mitte?.[1] ?? null,
      farbe: a.schwere === 'severe' || a.schwere === 'extreme' ? '#f87171' : '#fbbf24',
      link: a.link,
    });
  }
  for (const w of e.warnungen) {
    const t = w.beginn ? new Date(w.beginn).getTime() : Number.NaN;
    const ende = w.ende ? new Date(w.ende).getTime() : null;
    // Warnungen, die schon vor dem Fenster begonnen haben und noch gelten, an den Anfang setzen
    const zeit = Number.isFinite(t) ? Math.max(t, e.von) : Number.NaN;
    if (!Number.isFinite(zeit) || zeit > e.bis || (ende !== null && ende < e.von)) continue;
    aus.push({
      id: `warnung-${w.id}`,
      art: 'warnung',
      zeit,
      bis: ende,
      titel: `Stufe ${w.stufe}: ${w.ereignis}`,
      text: w.gebiet,
      lat: null,
      lon: null,
      farbe: w.farbe || '#fbbf24',
      link: null,
    });
  }
  for (const b of e.erdbeben) {
    const t = new Date(b.zeit).getTime();
    if (!drin(t)) continue;
    aus.push({
      id: `erdbeben-${b.id}`,
      art: 'erdbeben',
      zeit: t,
      bis: null,
      titel: `Erdbeben M${b.magnitude}`,
      text: b.ort,
      lat: b.lat,
      lon: b.lon,
      farbe: '#a78bfa',
      link: null,
    });
  }
  return aus.sort((a, b) => a.zeit - b.zeit);
}
