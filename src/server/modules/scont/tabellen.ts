// Tabellen des Moduls scont.
import { tabelle } from '../../daten/schema.ts';

export const KUNDEN = tabelle({
  name: 'kunden',
  modul: 'scont',
  label: 'Kunden',
  bearbeitbar: true,
  anzeige: 'name',
  suche: ['name'],
  spalten: [
    { name: 'name', typ: 'text', label: 'Firma oder Projekt', pflicht: true },
    {
      name: 'status',
      typ: 'text',
      label: 'Status',
      optionen: ['aktiv', 'pausiert', 'beendet'],
      standard: 'aktiv',
    },
    { name: 'stundensatz', typ: 'real', label: 'Stundensatz', einheit: 'CHF', min: 0 },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
  ],
});

export const DOMAINS = tabelle({
  name: 'domains',
  modul: 'scont',
  label: 'Domains',
  bearbeitbar: true,
  anzeige: 'name',
  suche: ['name'],
  spalten: [
    { name: 'name', typ: 'text', label: 'Domain', pflicht: true },
    { name: 'kunde_id', typ: 'text', label: 'Kunde', verweis: 'kunden' },
    { name: 'registrar', typ: 'text', label: 'Registrar' },
    { name: 'ablauf', typ: 'datum', label: 'Ablaufdatum' },
    { name: 'kosten_jahr', typ: 'real', label: 'Kosten pro Jahr', einheit: 'CHF', min: 0 },
    { name: 'eigene', typ: 'bool', label: 'Eigene Domain', standard: false },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
  ],
});

export const KOSTEN = tabelle({
  name: 'kosten',
  modul: 'scont',
  label: 'Kosten und Abos',
  bearbeitbar: true,
  anzeige: 'bezeichnung',
  suche: ['bezeichnung', 'anbieter'],
  spalten: [
    { name: 'bezeichnung', typ: 'text', label: 'Bezeichnung', pflicht: true },
    {
      name: 'art',
      typ: 'text',
      label: 'Art',
      optionen: ['Domain', 'Hosting', 'Abo', 'Lizenz', 'Andere'],
      standard: 'Abo',
    },
    { name: 'anbieter', typ: 'text', label: 'Anbieter' },
    { name: 'kunde_id', typ: 'text', label: 'Kunde', verweis: 'kunden' },
    { name: 'betrag', typ: 'real', label: 'Betrag', einheit: 'CHF', pflicht: true, min: 0 },
    {
      name: 'intervall',
      typ: 'text',
      label: 'Intervall',
      optionen: ['monatlich', 'jährlich', 'einmalig'],
      standard: 'jährlich',
    },
    { name: 'naechste_zahlung', typ: 'datum', label: 'Nächste Zahlung oder Ablauf' },
    { name: 'weiterverrechnet', typ: 'bool', label: 'An Kunde weiterverrechnet', standard: false },
    { name: 'notizen', typ: 'text', label: 'Notizen', lang: true },
  ],
});

export const SEITEN = tabelle({
  name: 'seiten',
  modul: 'scont',
  label: 'Überwachte Seiten',
  bearbeitbar: true,
  anzeige: 'name',
  suche: ['name', 'url'],
  spalten: [
    { name: 'name', typ: 'text', label: 'Name', pflicht: true },
    { name: 'url', typ: 'text', label: 'Adresse (https://…)', pflicht: true },
    { name: 'kunde_id', typ: 'text', label: 'Kunde', verweis: 'kunden' },
    { name: 'aktiv', typ: 'bool', label: 'Überwachen', standard: true },
    {
      name: 'intervall_min',
      typ: 'int',
      label: 'Prüfintervall',
      einheit: 'min',
      standard: 5,
      min: 1,
      max: 1440,
    },
    { name: 'erwarteter_text', typ: 'text', label: 'Erwarteter Text (optional)' },
    { name: 'oeffentlich', typ: 'bool', label: 'Auf öffentlicher Statusseite', standard: false },
    { name: 'oeffentlicher_name', typ: 'text', label: 'Name auf der Statusseite' },
  ],
});

export const PRUEFUNGEN = tabelle({
  name: 'pruefungen',
  modul: 'scont',
  label: 'Prüfungen (Rohdaten)',
  puffer: true,
  spalten: [
    { name: 'seite_id', typ: 'text' },
    { name: 'ok', typ: 'bool' },
    { name: 'status', typ: 'int' },
    { name: 'ms', typ: 'int' },
    { name: 'fehler', typ: 'text' },
  ],
  indizes: [['seite_id', 'erstellt'], ['erstellt']],
});

export const PRUEFUNGEN_STUNDEN = tabelle({
  name: 'pruefungen_stunden',
  modul: 'scont',
  label: 'Prüfungen pro Stunde',
  spalten: [
    { name: 'zeit', typ: 'zeit' },
    { name: 'seite_id', typ: 'text' },
    { name: 'anzahl', typ: 'int' },
    { name: 'ok', typ: 'real' },
    { name: 'ms', typ: 'real' },
    { name: 'ms_max', typ: 'real' },
  ],
  indizes: [['seite_id', 'zeit']],
});

export const VORFAELLE = tabelle({
  name: 'vorfaelle',
  modul: 'scont',
  label: 'Ausfälle',
  spalten: [
    { name: 'seite_id', typ: 'text' },
    { name: 'start', typ: 'zeit' },
    { name: 'ende', typ: 'zeit' },
    { name: 'grund', typ: 'text' },
  ],
  indizes: [['seite_id', 'start']],
});

export const SSL = tabelle({
  name: 'ssl_status',
  modul: 'scont',
  label: 'SSL Zertifikate',
  spalten: [
    { name: 'seite_id', typ: 'text' },
    { name: 'gueltig_bis', typ: 'zeit' },
    { name: 'aussteller', typ: 'text' },
    { name: 'fehler', typ: 'text' },
  ],
  indizes: [['seite_id']],
});

export const PAGESPEED = tabelle({
  name: 'pagespeed',
  modul: 'scont',
  label: 'PageSpeed',
  spalten: [
    { name: 'seite_id', typ: 'text' },
    { name: 'strategie', typ: 'text' },
    { name: 'performance', typ: 'int' },
    { name: 'barrierefreiheit', typ: 'int' },
    { name: 'best_practices', typ: 'int' },
    { name: 'seo', typ: 'int' },
    { name: 'lcp_ms', typ: 'int' },
    { name: 'cls', typ: 'real' },
    { name: 'tbt_ms', typ: 'int' },
  ],
  indizes: [['seite_id', 'erstellt']],
});

export const QUALITAET = tabelle({
  name: 'qualitaet',
  modul: 'scont',
  label: 'Qualitätscheck',
  spalten: [
    { name: 'seite_id', typ: 'text' },
    { name: 'punkte', typ: 'int' },
    { name: 'note', typ: 'text' },
    { name: 'ergebnis', typ: 'json' },
  ],
  indizes: [['seite_id', 'erstellt']],
});

export const SCONT_TABELLEN = [
  KUNDEN,
  DOMAINS,
  KOSTEN,
  SEITEN,
  PRUEFUNGEN,
  PRUEFUNGEN_STUNDEN,
  VORFAELLE,
  SSL,
  PAGESPEED,
  QUALITAET,
];

export interface Seite {
  id: string;
  name: string;
  url: string;
  kunde_id: string | null;
  aktiv: boolean;
  intervall_min: number;
  erwarteter_text: string | null;
  oeffentlich: boolean;
  oeffentlicher_name: string | null;
}

export interface Pruefung {
  id: string;
  erstellt: string;
  seite_id: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  fehler: string | null;
}
