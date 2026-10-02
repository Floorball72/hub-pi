// Tabellen des Moduls Drohne.
import { tabelle } from '../../daten/schema.ts';

export const DROHNEN_ORTE = tabelle({
  name: 'drohnen_orte',
  modul: 'drohne',
  label: 'Drohnen Orte',
  bearbeitbar: true,
  anzeige: 'name',
  suche: ['name', 'notizen'],
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'lat', typ: 'real', label: 'Breite', pflicht: true, min: 45, max: 48.5 },
    { name: 'lon', typ: 'real', label: 'Länge', pflicht: true, min: 5.5, max: 11 },
    {
      name: 'status',
      typ: 'text',
      label: 'Status',
      optionen: ['Idee', 'geplant', 'gedreht'],
      standard: 'Idee',
    },
    { name: 'shortlist', typ: 'bool', label: 'Shortlist', standard: false },
    { name: 'dreh_id', typ: 'text', label: 'Kundendreh', verweis: 'drehs' },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
    { name: 'wetterfenster_alarm', typ: 'bool', label: 'Push bei passendem Wetterfenster', standard: false },
    { name: 'flughoehe_m', typ: 'int', label: 'Flughöhe', einheit: 'm', standard: 120, min: 0, max: 500 },
    { name: 'wind_max_kmh', typ: 'real', label: 'Wind max. auf Flughöhe', einheit: 'km/h', standard: 30 },
    { name: 'boeen_max_kmh', typ: 'real', label: 'Böen max.', einheit: 'km/h', standard: 40 },
    {
      name: 'niederschlag_max_mm',
      typ: 'real',
      label: 'Niederschlag max. pro Stunde',
      einheit: 'mm',
      standard: 0.1,
    },
    { name: 'sicht_min_m', typ: 'real', label: 'Sicht min.', einheit: 'm', standard: 5000 },
    { name: 'temp_min', typ: 'real', label: 'Temperatur min.', einheit: '°C', standard: -5 },
    { name: 'temp_max', typ: 'real', label: 'Temperatur max.', einheit: '°C', standard: 35 },
    { name: 'kp_max', typ: 'real', label: 'KP Index max.', standard: 5 },
  ],
});

export const DREHS = tabelle({
  name: 'drehs',
  modul: 'drohne',
  label: 'Kundendrehs',
  bearbeitbar: true,
  anzeige: 'titel',
  suche: ['titel', 'notizen', 'drehbuch'],
  spalten: [
    { name: 'titel', typ: 'text', label: 'Titel', pflicht: true },
    { name: 'kunde_id', typ: 'text', label: 'Kunde', verweis: 'kunden' },
    { name: 'ort_id', typ: 'text', label: 'Ort', verweis: 'drohnen_orte' },
    { name: 'termin', typ: 'zeit', label: 'Drehtermin' },
    {
      name: 'status',
      typ: 'text',
      label: 'Lieferstatus',
      optionen: ['Anfrage', 'Dreh', 'Schnitt', 'Lieferung', 'abgeschlossen'],
      standard: 'Anfrage',
    },
    { name: 'frist', typ: 'datum', label: 'Lieferfrist' },
    { name: 'drehbuch', typ: 'text', label: 'Drehbuch', lang: true },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
  ],
  indizes: [['termin']],
});

export interface DrohnenOrt {
  id: string;
  name: string;
  lat: number;
  lon: number;
  status: string;
  shortlist: boolean;
  dreh_id: string | null;
  notizen: string | null;
  wetterfenster_alarm: boolean;
  flughoehe_m: number | null;
  wind_max_kmh: number | null;
  boeen_max_kmh: number | null;
  niederschlag_max_mm: number | null;
  sicht_min_m: number | null;
  temp_min: number | null;
  temp_max: number | null;
  kp_max: number | null;
}

export interface Dreh {
  id: string;
  titel: string;
  kunde_id: string | null;
  ort_id: string | null;
  termin: string | null;
  status: string;
  frist: string | null;
  drehbuch: string | null;
  notizen: string | null;
}
