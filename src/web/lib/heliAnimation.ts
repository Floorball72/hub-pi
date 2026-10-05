// Bewegte Helis auf der Karte: gleiten zwischen den Abrufen, drehen in Flugrichtung,
// Schild mit Kennzeichen und Höhe, Spur, die hinter dem Heli ausblendet.
import type * as Leaflet from 'leaflet';
import { basisAusPlatz, heliFarbe } from '../../server/geteilt/heli.ts';

export interface AnimHeli {
  id: string;
  lat: number;
  lon: number;
  kurs: number | null;
  kmh: number | null;
  /** Zeit der Position in ms */
  zeit: number;
  amBoden: boolean;
  farbe: string;
  schild: string;
  /** Bisherige Spur als [lat, lon], älteste zuerst */
  spur: [number, number][];
  /** Rega Basis, von der der Heli gestartet ist: gestrichelte Linie zur Basis */
  basis?: [number, number] | null;
  link?: string;
}

/** Heli ohne aktuelles Signal, aus /api/m/rettung/live (abgestellt) */
export interface AbgestellterHeli {
  hex: string;
  organisation: string;
  kennzeichen: string | null;
  lat: number;
  lon: number;
  zeit: number;
  art: 'landung' | 'signalverlust' | 'laufend';
  platz: string | null;
  anBasis: boolean;
  vermutet?: boolean;
}

interface Zustand {
  daten: AnimHeli;
  lat: number;
  lon: number;
  winkel: number;
  marker: Leaflet.Marker;
  schild: string;
  spur: Leaflet.Polyline[];
  kopf: Leaflet.Polyline;
  basisLinie: Leaflet.Polyline | null;
}

// Heli von oben, Nase nach Norden. Der Rotor dreht sich in der Luft.
const SVG = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
<circle cx="12" cy="9" r="8" stroke-opacity=".28"/>
<path d="M12 13.5v8M9.5 21.5h5" stroke-width="1.8"/>
<ellipse cx="12" cy="9.5" rx="2.7" ry="4.4" fill="currentColor" stroke="none"/>
<g class="rotor"><path d="M5.5 3.5l13 11M18.5 3.5l-13 11" stroke-opacity=".85"/></g>
</svg>`;

/** Weg in km bei Kurs und Tempo, als Verschiebung in Grad */
function verschieben(lat: number, lon: number, kurs: number, km: number): [number, number] {
  const r = (kurs * Math.PI) / 180;
  return [
    lat + (km * Math.cos(r)) / 111.32,
    lon + (km * Math.sin(r)) / (111.32 * Math.cos((lat * Math.PI) / 180)),
  ];
}

function winkelNaeher(von: number, nach: number, anteil: number): number {
  const d = ((((nach - von) % 360) + 540) % 360) - 180;
  return von + d * anteil;
}

export class HeliAnimation {
  private L: typeof Leaflet;
  private gruppe: Leaflet.LayerGroup;
  private helis = new Map<string, Zustand>();
  private parkGruppe: Leaflet.LayerGroup;
  private geparkt = new Map<string, { marker: Leaflet.Marker; schluessel: string }>();
  private rahmen = 0;
  private letzte = 0;
  /** Bei true gelten die Positionen genau (Wiedergabe), sonst wird geschätzt und geglättet */
  direkt = false;
  onklick: ((h: AnimHeli) => void) | null = null;

  constructor(L: typeof Leaflet, karte: Leaflet.Map) {
    this.L = L;
    this.parkGruppe = L.layerGroup().addTo(karte);
    this.gruppe = L.layerGroup().addTo(karte);
    this.rahmen = requestAnimationFrame((t) => this.schritt(t));
  }

  setzen(liste: AnimHeli[]) {
    const ids = new Set(liste.map((h) => h.id));
    for (const [id, z] of this.helis) {
      if (ids.has(id)) continue;
      this.entfernen(z);
      this.helis.delete(id);
    }
    for (const h of liste) {
      const z = this.helis.get(h.id);
      if (!z) {
        this.helis.set(h.id, this.anlegen(h));
        continue;
      }
      const spurNeu =
        z.daten.spur.length !== h.spur.length || z.daten.spur.at(-1)?.[0] !== h.spur.at(-1)?.[0];
      z.daten = h;
      if (this.direkt) {
        z.lat = h.lat;
        z.lon = h.lon;
        if (h.kurs !== null) z.winkel = h.kurs;
      }
      if (spurNeu) this.spurZeichnen(z);
      if (z.schild !== h.schild) {
        z.schild = h.schild;
        z.marker.setTooltipContent(h.schild);
      }
      z.marker.getElement()?.classList.toggle('boden', h.amBoden);
      if (this.direkt) this.zeichnen(z);
    }
  }

  stop() {
    cancelAnimationFrame(this.rahmen);
    for (const z of this.helis.values()) this.entfernen(z);
    this.helis.clear();
    this.gruppe.remove();
    this.parkGruppe.remove();
    this.geparkt.clear();
  }

  /** Helis ohne Signal am letzten bekannten Ort: stehend, grau oder gelb umrandet, ohne Rotor */
  abgestellt(liste: AbgestellterHeli[]) {
    const L = this.L;
    const ids = new Set(liste.map((h) => h.hex));
    for (const [id, g] of this.geparkt) {
      if (ids.has(id)) continue;
      g.marker.remove();
      this.geparkt.delete(id);
    }
    // Mehrere Helis am gleichen Ort: Schilder untereinander
    const proOrt = new Map<string, number>();
    for (const h of liste) {
      const ort = `${h.lat.toFixed(3)},${h.lon.toFixed(3)}`;
      const n = proOrt.get(ort) ?? 0;
      proOrt.set(ort, n + 1);
      const schild = abgestelltSchild(h);
      const schluessel = `${h.lat},${h.lon},${schild},${n},${h.anBasis}`;
      const alt = this.geparkt.get(h.hex);
      if (alt?.schluessel === schluessel) continue;
      alt?.marker.remove();
      const farbe = heliFarbe(h.organisation);
      const icon = L.divIcon({
        className: 'heli-anim',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        html: `<div class="heli-oben geparkt${h.anBasis ? ' basis' : ''}" style="--farbe:${farbe}">${SVG}</div>`,
      });
      const marker = L.marker([h.lat, h.lon], { icon, title: abgestelltTitel(h), zIndexOffset: 500 })
        .bindTooltip(schild, {
          permanent: true,
          direction: 'right',
          offset: [14, n * 20],
          className: `heli-schild geparkt${h.anBasis ? ' basis' : ''}`,
        })
        .addTo(this.parkGruppe);
      marker.on('click', () =>
        this.onklick?.({
          id: h.hex,
          lat: h.lat,
          lon: h.lon,
          kurs: null,
          kmh: null,
          zeit: h.zeit,
          amBoden: true,
          farbe,
          schild,
          spur: [],
          link: `/heli?hex=${encodeURIComponent(h.hex)}`,
        }),
      );
      this.geparkt.set(h.hex, { marker, schluessel });
    }
  }

  private anlegen(h: AnimHeli): Zustand {
    const L = this.L;
    const icon = L.divIcon({
      className: 'heli-anim',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      html: `<div class="heli-oben${h.amBoden ? ' boden' : ''}" style="--farbe:${h.farbe}">${SVG}</div>`,
    });
    const marker = L.marker([h.lat, h.lon], { icon, title: h.schild, zIndexOffset: 1000 })
      .bindTooltip(h.schild, {
        permanent: true,
        direction: 'right',
        offset: [16, 0],
        className: 'heli-schild',
      })
      .addTo(this.gruppe);
    marker.on('click', () => this.onklick?.(this.helis.get(h.id)?.daten ?? h));
    const kopf = L.polyline([], { color: h.farbe, weight: 3.5, opacity: 0.9, interactive: false }).addTo(
      this.gruppe,
    );
    const z: Zustand = {
      daten: h,
      lat: h.lat,
      lon: h.lon,
      winkel: h.kurs ?? 0,
      marker,
      schild: h.schild,
      spur: [],
      kopf,
      basisLinie: null,
    };
    this.spurZeichnen(z);
    this.zeichnen(z);
    return z;
  }

  private entfernen(z: Zustand) {
    z.marker.remove();
    z.kopf.remove();
    z.basisLinie?.remove();
    for (const s of z.spur) s.remove();
  }

  /** Spur als Abschnitte mit steigender Deckkraft, damit sie hinter dem Heli ausblendet */
  private spurZeichnen(z: Zustand) {
    const p = z.daten.spur;
    const n = Math.max(0, p.length - 1);
    while (z.spur.length > n) z.spur.pop()?.remove();
    for (let i = 0; i < n; i++) {
      const a = (i + 1) / n;
      const stil = { color: z.daten.farbe, weight: 1.5 + a * 2, opacity: 0.05 + a ** 1.6 * 0.75 };
      let s = z.spur[i];
      if (!s) {
        s = this.L.polyline([], { ...stil, interactive: false, lineCap: 'round' }).addTo(this.gruppe);
        z.spur.push(s);
      } else s.setStyle(stil);
      s.setLatLngs([p[i], p[i + 1]]);
    }
    z.kopf.setStyle({ color: z.daten.farbe });
  }

  private schritt(t: number) {
    this.rahmen = requestAnimationFrame((x) => this.schritt(x));
    // Höchstens 30 Bilder pro Sekunde, spart Akku auf Tablets
    if (t - this.letzte < 33) return;
    const dt = Math.min(1, (t - this.letzte) / 1000);
    this.letzte = t;
    if (this.direkt) return;
    const jetzt = Date.now();
    for (const z of this.helis.values()) {
      const h = z.daten;
      let ziel: [number, number] = [h.lat, h.lon];
      // Koppelnavigation ab dem letzten Fix, höchstens 60 Sekunden weit
      if (!h.amBoden && h.kurs !== null && h.kmh) {
        const sek = Math.min(60, Math.max(0, (jetzt - h.zeit) / 1000));
        ziel = verschieben(h.lat, h.lon, h.kurs, (h.kmh * sek) / 3600);
      }
      // Weich zum Ziel, neue Fixes werden in rund einer Sekunde eingeholt
      const k = Math.min(1, dt * 2.5);
      z.lat += (ziel[0] - z.lat) * k;
      z.lon += (ziel[1] - z.lon) * k;
      if (h.kurs !== null) z.winkel = winkelNaeher(z.winkel, h.kurs, Math.min(1, dt * 3));
      this.zeichnen(z);
    }
  }

  private zeichnen(z: Zustand) {
    const h = z.daten;
    z.marker.setLatLng([z.lat, z.lon]);
    const svg = z.marker.getElement()?.querySelector('svg');
    if (svg) svg.style.transform = `rotate(${z.winkel}deg)`;
    const letzter = h.spur.at(-1);
    z.kopf.setLatLngs(letzter && !h.amBoden ? [letzter, [z.lat, z.lon]] : []);
    if (h.basis && !h.amBoden) {
      z.basisLinie ??= this.L.polyline([], {
        color: h.farbe,
        weight: 1.5,
        opacity: 0.55,
        dashArray: '2 7',
        interactive: false,
      }).addTo(this.gruppe);
      z.basisLinie.setLatLngs([h.basis, [z.lat, z.lon]]);
    } else if (z.basisLinie) {
      z.basisLinie.remove();
      z.basisLinie = null;
    }
  }
}

/** Heli aus /api/m/rettung/live, nur die Felder, die der Animator braucht */
export interface LiveHeliPos {
  hex: string;
  organisation: string;
  kennzeichen: string | null;
  amBoden: boolean;
  hoeheFt: number | null;
  kmh: number | null;
  startPlatz: string | null;
  lat: number;
  lon: number;
  kurs: number | null;
  zeit: number;
  spur: [number, number][];
}

/** Live Helis für den Animator, mit Linie zur Rega Basis, wenn mitBasis */
export function liveAnim(helis: LiveHeliPos[], mitBasis = true): AnimHeli[] {
  return helis.map((h) => {
    const b = mitBasis ? basisAusPlatz(h.startPlatz) : null;
    return {
      id: h.hex,
      lat: h.lat,
      lon: h.lon,
      kurs: h.kurs,
      kmh: h.kmh,
      zeit: h.zeit,
      amBoden: h.amBoden,
      farbe: heliFarbe(h.organisation),
      schild: `${h.kennzeichen ?? h.hex} · ${h.amBoden ? 'Boden' : h.hoeheFt !== null ? `${h.hoeheFt} ft` : 'Luft'}`,
      spur: h.spur,
      basis: b ? [b.lat, b.lon] : null,
      link: `/heli?hex=${encodeURIComponent(h.hex)}`,
    };
  });
}

function zeitKurz(ms: number): string {
  const d = new Date(ms);
  const uhr = d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return uhr;
  return `${d.toLocaleDateString('de-CH', { weekday: 'short' })} ${uhr}`;
}

/** Ort ohne Zusatz: «Rega Basis Untervaz» wird «Basis Untervaz» */
export function abgestelltOrt(h: AbgestellterHeli): string {
  return (h.platz ?? '').replace(/^Rega /, '');
}

function abgestelltSchild(h: AbgestellterHeli): string {
  const kz = h.kennzeichen ?? h.hex;
  if (h.anBasis) return `${kz} · ${h.vermutet ? 'vermutlich ' : ''}${abgestelltOrt(h)}`;
  return `${kz} · ${zeitKurz(h.zeit)}${h.platz ? ` ${abgestelltOrt(h)}` : ''}`;
}

export function abgestelltTitel(h: AbgestellterHeli): string {
  if (h.vermutet)
    return `${h.kennzeichen ?? h.hex}: Zuletzt gesehen ${zeitKurz(h.zeit)} ausserhalb der Basis. Rückflug nicht empfangen, vermutlich zurück an der ${abgestelltOrt(h)}.`;
  const was =
    h.art === 'landung'
      ? 'Gelandet'
      : h.art === 'laufend'
        ? 'Signal verloren, Flug offen'
        : 'Signal tief verloren';
  return `${h.kennzeichen ?? h.hex}: ${was} ${zeitKurz(h.zeit)}${h.platz ? `, ${abgestelltOrt(h)}` : ''}. Letzter bekannter Standort, kein aktuelles Signal.`;
}
