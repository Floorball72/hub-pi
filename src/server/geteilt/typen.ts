// Typen, die Backend und Frontend gemeinsam nutzen. Nur Typen, kein Laufzeitcode.

export type Ampel = 'ok' | 'warnung' | 'ausfall' | 'neutral';

export interface KachelZeile {
  text: string;
  wert?: string;
  status?: Ampel;
}

export interface Kachel {
  status: Ampel;
  titel?: string;
  /** Grosse Zahl oder kurzer Wert */
  wert?: string;
  einheit?: string;
  unter?: string;
  zeilen?: KachelZeile[];
  demo?: boolean;
  hinweis?: string;
}

export interface ModulInfo {
  id: string;
  name: string;
  beschreibung: string;
  symbol: string;
  aktiv: boolean;
  pflicht: boolean;
  reihenfolge: number;
}

export type EbenenArt = 'wmts' | 'wms' | 'xyz' | 'punkte' | 'heatmap';

export interface Ebene {
  id: string;
  name: string;
  gruppe: string;
  modul: string;
  art: EbenenArt;
  /** Kachel URL (wmts/xyz) oder WMS Basis URL */
  url?: string;
  wmsLayer?: string;
  /** API Pfad für Punkte */
  datenUrl?: string;
  aktualisierenSek?: number;
  deckkraft?: number;
  namensnennung: string;
  standardAn?: boolean;
  hinweis?: string;
  /** Ebene kann nicht angezeigt werden (z.B. keine offene Quelle) */
  nichtVerfuegbar?: string;
  maxZoom?: number;
}

export type Symbol =
  | 'heli'
  | 'blitz'
  | 'webcam'
  | 'ort'
  | 'drohne'
  | 'spital'
  | 'wache'
  | 'landeplatz'
  | 'defi'
  | 'erdbeben'
  | 'warnung'
  | 'einsatz'
  | 'halt'
  | 'parken'
  | 'basis';

export interface GeoPunkt {
  id: string;
  lat: number;
  lon: number;
  titel: string;
  text?: string;
  symbol: Symbol;
  farbe?: string;
  /** Kurs in Grad (Heli) */
  richtung?: number;
  groesse?: number;
  zeit?: string;
  link?: string;
  bild?: string;
}

export interface PunkteAntwort {
  punkte: GeoPunkt[];
  stand: string | null;
  demo: boolean;
  fehler?: string;
  hinweis?: string;
  /** Für Heatmaps: [lat, lon, gewicht] */
  heat?: [number, number, number][];
  /** Linien, z.B. Flugspuren */
  linien?: GeoLinie[];
}

export interface GeoLinie {
  id: string;
  titel: string;
  text?: string;
  farbe?: string;
  /** Gestrichelt, z.B. für laufende Flüge */
  gestrichelt?: boolean;
  punkte: [number, number][];
}

export interface TimelineEintrag {
  id: string;
  modul: string;
  art: string;
  titel: string;
  start: string;
  ende?: string;
  ganztags?: boolean;
  status?: Ampel;
  text?: string;
  link?: string;
}

export interface SuchTreffer {
  modul: string;
  titel: string;
  text?: string;
  link: string;
}

export interface BriefingTeil {
  modul: string;
  titel: string;
  zeilen: KachelZeile[];
  status: Ampel;
  reihenfolge: number;
}

export interface SpaltenInfo {
  name: string;
  typ: string;
  label: string;
  pflicht?: boolean;
  optionen?: string[];
  verweis?: string;
  lang?: boolean;
  einheit?: string;
  min?: number;
  max?: number;
}

export interface TabellenInfo {
  name: string;
  label: string;
  modul: string;
  anzeige?: string;
  spalten: SpaltenInfo[];
}

export interface AlarmRegel {
  id: string;
  modul: string;
  name: string;
  beschreibung: string;
  aktiv: boolean;
  prioritaet: number;
  schwelle: number | null;
  schwelle_label: string | null;
  ruhe_von: string | null;
  ruhe_bis: string | null;
  nachts: boolean;
  cooldown_min: number;
}

export interface QuellenStatusInfo {
  id: string;
  name: string;
  modul: string;
  zustand: string;
  letzterErfolg: string | null;
  letzterFehler: string | null;
  fehlerText: string | null;
  latenzMs: number | null;
  ungetestet: boolean;
  namensnennung?: string;
  beschreibung?: string;
}
