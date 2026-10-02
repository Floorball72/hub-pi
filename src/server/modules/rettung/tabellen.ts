// Tabellen des Moduls Rettung.
import { tabelle } from '../../daten/schema.ts';

export const HELI_KENNUNGEN = tabelle({
  name: 'heli_kennungen',
  modul: 'rettung',
  label: 'Helikopter Kennzeichen',
  bearbeitbar: true,
  anzeige: 'muster',
  spalten: [
    { name: 'organisation', typ: 'text', label: 'Organisation', pflicht: true },
    { name: 'muster', typ: 'text', label: 'Kennzeichen oder Präfix mit * (z.B. HB-ZR*)', pflicht: true },
    { name: 'push', typ: 'bool', label: 'Push bei Aktivität', standard: true },
    { name: 'notizen', typ: 'text', label: 'Notizen' },
  ],
});

export const HELI_FLUEGE = tabelle({
  name: 'heli_fluege',
  modul: 'rettung',
  label: 'Erfasste Helikopterflüge',
  spalten: [
    { name: 'hex', typ: 'text' },
    { name: 'kennzeichen', typ: 'text' },
    { name: 'typ', typ: 'text' },
    { name: 'organisation', typ: 'text' },
    { name: 'start', typ: 'zeit' },
    { name: 'start_art', typ: 'text' },
    { name: 'start_lat', typ: 'real' },
    { name: 'start_lon', typ: 'real' },
    { name: 'start_ort', typ: 'text' },
    { name: 'ende', typ: 'zeit' },
    { name: 'ende_art', typ: 'text' },
    { name: 'ende_lat', typ: 'real' },
    { name: 'ende_lon', typ: 'real' },
    { name: 'ende_ort', typ: 'text' },
    { name: 'max_hoehe_ft', typ: 'int' },
    { name: 'spur', typ: 'json' },
  ],
  indizes: [['start'], ['organisation', 'start']],
});

export const MELDUNGEN = tabelle({
  name: 'einsatz_meldungen',
  modul: 'rettung',
  label: 'Einsatzmeldungen',
  suche: ['titel'],
  anzeige: 'titel',
  spalten: [
    { name: 'quelle', typ: 'text' },
    { name: 'titel', typ: 'text' },
    { name: 'link', typ: 'text' },
    { name: 'zeit', typ: 'zeit' },
    { name: 'kategorie', typ: 'text' },
    { name: 'text', typ: 'text' },
  ],
  indizes: [['zeit'], ['link']],
});

export const WEBCAMS = tabelle({
  name: 'webcams',
  modul: 'rettung',
  label: 'Webcams',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'lat', typ: 'real', label: 'Breite', pflicht: true },
    { name: 'lon', typ: 'real', label: 'Länge', pflicht: true },
    { name: 'bild_url', typ: 'text', label: 'Bild Adresse (https, öffentlich)' },
    { name: 'link', typ: 'text', label: 'Seite der Webcam' },
  ],
});

export const RETTUNG_TABELLEN = [HELI_KENNUNGEN, HELI_FLUEGE, MELDUNGEN, WEBCAMS];
