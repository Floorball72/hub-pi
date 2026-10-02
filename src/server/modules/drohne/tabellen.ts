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
    {
      name: 'sonnen_alarm',
      typ: 'bool',
      label: 'Push bei schönem Sonnenauf oder untergang',
      standard: false,
    },
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
    { name: 'dauer_min', typ: 'int', label: 'Dauer', einheit: 'min', standard: 120, min: 15, max: 1440 },
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
  sonnen_alarm: boolean | null;
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

export const FLUEGE = tabelle({
  name: 'drohnen_fluege',
  modul: 'drohne',
  label: 'Flug Logbuch',
  bearbeitbar: true,
  anzeige: 'zweck',
  suche: ['zweck', 'notizen'],
  spalten: [
    { name: 'datum', typ: 'zeit', label: 'Start', pflicht: true },
    { name: 'dauer_min', typ: 'real', label: 'Flugdauer', einheit: 'min', pflicht: true, min: 0, max: 600 },
    { name: 'drohne', typ: 'text', label: 'Drohne' },
    { name: 'ort_id', typ: 'text', label: 'Ort', verweis: 'drohnen_orte' },
    { name: 'dreh_id', typ: 'text', label: 'Kundendreh', verweis: 'drehs' },
    { name: 'akku_id', typ: 'text', label: 'Akku', verweis: 'akkus' },
    {
      name: 'kategorie',
      typ: 'text',
      label: 'Kategorie',
      optionen: ['offen A1', 'offen A2', 'offen A3', 'speziell', 'Übung'],
      standard: 'offen A1',
    },
    { name: 'max_hoehe_m', typ: 'int', label: 'Max. Höhe', einheit: 'm', min: 0, max: 1000 },
    { name: 'zweck', typ: 'text', label: 'Zweck' },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
  ],
  indizes: [['datum']],
});

export const AKKUS = tabelle({
  name: 'akkus',
  modul: 'drohne',
  label: 'Akkus',
  bearbeitbar: true,
  anzeige: 'name',
  spalten: [
    { name: 'name', typ: 'text', label: 'Bezeichnung', pflicht: true },
    { name: 'drohne', typ: 'text', label: 'Drohne' },
    { name: 'kaufdatum', typ: 'datum', label: 'Kaufdatum' },
    { name: 'zyklen_start', typ: 'int', label: 'Zyklen vor dem Logbuch', standard: 0, min: 0 },
    { name: 'zyklen_max', typ: 'int', label: 'Empfohlene max. Zyklen (Hersteller)', min: 1 },
    {
      name: 'status',
      typ: 'text',
      label: 'Status',
      optionen: ['in Betrieb', 'beobachten', 'ausgemustert'],
      standard: 'in Betrieb',
    },
    { name: 'notizen', typ: 'text', label: 'Notizen' },
  ],
});

export const WARTUNG = tabelle({
  name: 'wartung',
  modul: 'drohne',
  label: 'Wartungslog',
  bearbeitbar: true,
  anzeige: 'arbeit',
  spalten: [
    { name: 'datum', typ: 'datum', label: 'Datum', pflicht: true },
    { name: 'gegenstand', typ: 'text', label: 'Gerät', pflicht: true },
    { name: 'arbeit', typ: 'text', label: 'Arbeit', pflicht: true },
    { name: 'naechste', typ: 'datum', label: 'Nächste Wartung' },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
  ],
});

export const DOKUMENTE = tabelle({
  name: 'drohnen_dokumente',
  modul: 'drohne',
  label: 'Dokumente und Fristen',
  bearbeitbar: true,
  anzeige: 'titel',
  suche: ['titel'],
  spalten: [
    { name: 'titel', typ: 'text', label: 'Titel', pflicht: true },
    {
      name: 'art',
      typ: 'text',
      label: 'Art',
      optionen: ['Versicherung', 'Registrierung', 'Ausweis', 'Weiterbildung', 'Bewilligung', 'Andere'],
      standard: 'Andere',
    },
    { name: 'nummer', typ: 'text', label: 'Nummer (optional)' },
    { name: 'ablauf', typ: 'datum', label: 'Gültig bis' },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
  ],
});

export const SONNEN_BEWERTUNGEN = tabelle({
  name: 'sonnen_bewertungen',
  modul: 'drohne',
  label: 'Bewertungen Sonnenauf und untergang',
  spalten: [
    { name: 'ort_id', typ: 'text' },
    { name: 'datum', typ: 'datum' },
    { name: 'ereignis', typ: 'text' },
    { name: 'score', typ: 'int' },
    { name: 'faktoren', typ: 'json' },
    { name: 'bewertung', typ: 'int' },
  ],
  indizes: [['ort_id', 'datum']],
});
