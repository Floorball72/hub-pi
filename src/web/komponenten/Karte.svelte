<script lang="ts">
  // Die eine Karten Komponente für alle Module. Ebenen kommen vom Backend, die Auswahl wird gespeichert.
  import type * as Leaflet from 'leaflet';
  import type { Ebene, GeoLinie, GeoPunkt, PunkteAntwort } from '../../server/geteilt/typen.ts';
  import { api } from '../lib/api.ts';
  import { relativ } from '../lib/format.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';
  import Icon from './Icon.svelte';

  let {
    hoehe = '420px',
    gruppen = null,
    zentrum = [46.9, 8.3] as [number, number],
    zoom = 8,
    punkte = [],
    onklick,
    kompakt = false,
    ebenenFest = null,
    linien = [],
    einpassen = false,
    heat = [],
    ebenenZusatz = [],
    bereit,
    basisStart,
    ohne = [],
  }: {
    hoehe?: string;
    /** Nur Ebenen dieser Gruppen anzeigen (null = alle) */
    gruppen?: string[] | null;
    zentrum?: [number, number];
    zoom?: number;
    /** Zusätzliche Punkte der Seite (z.B. Drohnen Orte) */
    punkte?: GeoPunkt[];
    onklick?: (lat: number, lon: number) => void;
    kompakt?: boolean;
    /** Genau diese Ebenen zeigen und einschalten, Auswahl wird nicht gespeichert */
    ebenenFest?: string[] | null;
    /** Zusätzliche Linien der Seite (z.B. Flugspuren eines Helis) */
    linien?: GeoLinie[];
    /** Ausschnitt einmal auf die Punkte und Linien der Seite setzen */
    einpassen?: boolean;
    /** Heatmap der Seite als [lat, lon, gewicht] */
    heat?: [number, number, number][];
    /** Zu ebenenFest zusätzlich wählbare Ebenen, am Anfang aus */
    ebenenZusatz?: string[];
    /** Wird einmal aufgerufen, wenn die Karte steht, für eigene Ebenen der Seite (z.B. bewegte Helis) */
    bereit?: (L: typeof Leaflet, karte: Leaflet.Map) => (() => void) | void;
    /** Diese Ebenen nicht anbieten (z.B. wenn die Seite die Helis selbst zeichnet) */
    ohne?: string[];
    /** Grundkarte für diese Seite, ohne die gespeicherte Wahl zu ändern */
    basisStart?: string;
  } = $props();

  const BASIS: { id: string; name: string; url: string; quelle: string; klasse: string; maxZoom: number; relief?: string }[] = [
    {
      id: 'nacht',
      name: 'Nacht Relief',
      url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg',
      quelle: '© swisstopo',
      klasse: 'karte-nacht',
      maxZoom: 19,
      relief: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.leichte-basiskarte_reliefschattierung/default/current/3857/{z}/{x}/{y}.png',
    },
    {
      id: 'dunkel',
      name: 'Dunkel',
      url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg',
      quelle: '© swisstopo',
      klasse: 'karte-dunkel',
      maxZoom: 19,
    },
    {
      id: 'farbe',
      name: 'Landeskarte',
      url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
      quelle: '© swisstopo',
      klasse: '',
      maxZoom: 19,
    },
    {
      id: 'luftbild',
      name: 'Luftbild',
      url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
      quelle: '© swisstopo',
      klasse: '',
      maxZoom: 20,
    },
    {
      id: 'osm',
      name: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      quelle: '© OpenStreetMap Mitwirkende',
      klasse: 'karte-dunkel',
      maxZoom: 19,
    },
  ];

  let element: HTMLDivElement;
  let L: typeof Leaflet;
  let karte: Leaflet.Map | null = null;
  let basisLayer: Leaflet.TileLayer | null = null;
  let reliefLayer: Leaflet.TileLayer | null = null;
  let ebenen = $state<Ebene[]>([]);
  let aktiv = $state<Set<string>>(new Set());
  let basis = $state(basisStart ?? lesen('karte.basis', 'dunkel'));
  let panelOffen = $state(false);
  let infos = $state<Record<string, { stand: string | null; demo: boolean; fehler?: string; hinweis?: string; anzahl: number }>>({});
  const layer = new Map<string, Leaflet.Layer>();
  const timer = new Map<string, ReturnType<typeof setInterval>>();
  let seitenPunkte: Leaflet.LayerGroup | null = null;

  const FARBEN: Record<string, string> = {
    heli: '#ff5d5d',
    blitz: '#facc15',
    webcam: '#7dd3fc',
    ort: '#4cc9f0',
    drohne: '#34d399',
    spital: '#f87171',
    wache: '#fb923c',
    landeplatz: '#c084fc',
    defi: '#22c55e',
    erdbeben: '#f97316',
    warnung: '#fbbf24',
    einsatz: '#f43f5e',
    halt: '#94a3b8',
    parken: '#38bdf8',
    basis: '#ff5d5d',
  };

  const SYMBOLE: Record<string, string> = {
    heli: '<path d="M2 7h20M12 7v3M6 13a6 3 0 0 1 12 0v1a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3zM18 13h4" />',
    blitz: '<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>',
    webcam: '<circle cx="12" cy="11" r="6"/><circle cx="12" cy="11" r="2" fill="currentColor"/><path d="M8 21h8"/>',
    ort: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
    drohne: '<path d="M5 6h4M15 6h4M7 6v3M17 6v3M9 11h6v4H9z"/>',
    spital: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" fill="currentColor" stroke="none"/>',
    wache: '<path d="M4 16h16M6 16V9h12v7M9 9V6h6v3"/>',
    landeplatz: '<circle cx="12" cy="12" r="8"/><path d="M9 8v8M15 8v8M9 12h6"/>',
    defi: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/><path d="M12 9l-2 3h4l-2 3" />',
    erdbeben: '<path d="M2 12h4l2-5 3 10 3-8 2 3h6"/>',
    warnung: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>',
    einsatz: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v6M12 16h.01"/>',
    halt: '<rect x="6" y="5" width="12" height="12" rx="2"/><path d="M9 21l3-4 3 4"/>',
    basis: '<path d="M3 11l9-7 9 7v9H3z"/><path d="M12 10v6M9 13h6"/>',
    parken: '<path d="M9 19V5h4.5a4 4 0 0 1 0 8H9" stroke-width="2.6"/>',
  };

  function symbolIcon(p: GeoPunkt): Leaflet.DivIcon {
    const farbe = p.farbe ?? FARBEN[p.symbol] ?? '#4cc9f0';
    const g = p.groesse ?? (p.symbol === 'heli' ? 34 : 26);
    const drehen = p.richtung !== undefined ? `transform: rotate(${p.richtung}deg)` : '';
    const puls = p.symbol === 'heli' || p.symbol === 'blitz' || p.symbol === 'einsatz' ? 'puls' : '';
    return L.divIcon({
      className: 'hub-marker',
      iconSize: [g, g],
      iconAnchor: [g / 2, g / 2],
      html: `<div class="hub-symbol ${puls}" style="--farbe:${farbe};width:${g}px;height:${g}px"><svg viewBox="0 0 24 24" width="${g * 0.62}" height="${g * 0.62}" style="${drehen}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SYMBOLE[p.symbol] ?? SYMBOLE.ort}</svg></div>`,
    });
  }

  function popupHtml(p: GeoPunkt): string {
    const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    let h = `<strong>${esc(p.titel)}</strong>`;
    if (p.text) h += `<div class="popup-text">${esc(p.text).replace(/\n/g, '<br>')}</div>`;
    if (p.zeit) h += `<div class="popup-zeit">${esc(relativ(p.zeit))}</div>`;
    if (p.bild && /^https:\/\//.test(p.bild)) h += `<img src="${esc(p.bild)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    if (p.link && /^(https:\/\/|\/)/.test(p.link)) h += `<div><a href="${esc(p.link)}" ${p.link.startsWith('/') ? '' : 'target="_blank" rel="noopener noreferrer"'}>Details</a></div>`;
    return h;
  }

  const sichtbareEbenen = $derived(
    (ebenenFest
      ? ebenen.filter((e) => ebenenFest!.includes(e.id) || ebenenZusatz.includes(e.id))
      : gruppen
        ? ebenen.filter((e) => gruppen!.includes(e.gruppe))
        : ebenen
    ).filter((e) => !ohne.includes(e.id)),
  );
  const gruppiert = $derived(
    Object.entries(
      sichtbareEbenen.reduce<Record<string, Ebene[]>>((acc, e) => {
        (acc[e.gruppe] ??= []).push(e);
        return acc;
      }, {}),
    ),
  );

  function heatZeichnen(werte: [number, number, number][], gruppe: Leaflet.LayerGroup) {
    // Wurzel dämpft einzelne Hotspots, damit auch seltene Orte sichtbar bleiben
    const max = Math.sqrt(Math.max(1, ...werte.map((h) => h[2])));
    for (const [lat, lon, w] of werte) {
      const a = Math.sqrt(w) / max;
      L.circleMarker([lat, lon], {
        radius: 5 + a * 18,
        stroke: false,
        fillColor: a > 0.66 ? '#f43f5e' : a > 0.33 ? '#fb923c' : '#fbbf24',
        fillOpacity: 0.15 + a * 0.45,
        interactive: false,
      }).addTo(gruppe);
    }
  }

  async function punkteLaden(e: Ebene, gruppe: Leaflet.LayerGroup) {
    try {
      const r = await api.get<PunkteAntwort>(e.datenUrl!);
      gruppe.clearLayers();
      if (e.art === 'heatmap' && r.heat) heatZeichnen(r.heat, gruppe);
      for (const li of r.linien ?? []) {
        if (li.punkte.length < 2) continue;
        L.polyline(li.punkte, {
          color: li.farbe ?? '#ff5d5d',
          weight: 3,
          opacity: 0.75,
          dashArray: li.gestrichelt ? '6 6' : undefined,
        })
          .bindPopup(popupHtml({ id: li.id, lat: 0, lon: 0, titel: li.titel, text: li.text, symbol: 'ort' }), { maxWidth: 280 })
          .addTo(gruppe);
      }
      for (const p of r.punkte) {
        L.marker([p.lat, p.lon], { icon: symbolIcon(p), title: p.titel, riseOnHover: true })
          .bindPopup(popupHtml(p), { maxWidth: 280 })
          .addTo(gruppe);
      }
      infos[e.id] = { stand: r.stand, demo: r.demo, fehler: r.fehler, hinweis: r.hinweis, anzahl: r.punkte.length + (r.heat?.length ?? 0) + (r.linien?.length ?? 0) };
    } catch (err) {
      infos[e.id] = { stand: null, demo: false, fehler: String(err), anzahl: 0 };
    }
  }

  function ebeneAn(e: Ebene) {
    if (!karte || layer.has(e.id) || e.nichtVerfuegbar) return;
    let l: Leaflet.Layer;
    if (e.art === 'wms') {
      l = L.tileLayer.wms(e.url!, {
        layers: e.wmsLayer!,
        format: 'image/png',
        transparent: true,
        opacity: e.deckkraft ?? 0.75,
        attribution: e.namensnennung,
        version: '1.3.0',
      });
    } else if (e.art === 'wmts' || e.art === 'xyz') {
      l = L.tileLayer(e.url!, { opacity: e.deckkraft ?? 0.8, attribution: e.namensnennung, maxNativeZoom: e.maxZoom ?? 18, maxZoom: 20 });
    } else {
      const g = L.layerGroup([], { attribution: e.namensnennung });
      l = g;
      punkteLaden(e, g);
      if (e.aktualisierenSek) timer.set(e.id, setInterval(() => punkteLaden(e, g), e.aktualisierenSek * 1000));
    }
    l.addTo(karte);
    layer.set(e.id, l);
  }

  function ebeneAus(id: string) {
    const l = layer.get(id);
    if (l && karte) karte.removeLayer(l);
    layer.delete(id);
    clearInterval(timer.get(id));
    timer.delete(id);
  }

  function umschalten(e: Ebene) {
    const neu = new Set(aktiv);
    if (neu.has(e.id)) {
      neu.delete(e.id);
      ebeneAus(e.id);
    } else {
      neu.add(e.id);
      ebeneAn(e);
    }
    aktiv = neu;
    if (ebenenFest) return;
    const liste = [...neu];
    schreiben('karte.auswahl', liste);
    api.put('/api/karte/auswahl', { auswahl: liste }).catch(() => {});
  }

  function basisSetzen(id: string, merken = true) {
    const b = BASIS.find((x) => x.id === id) ?? BASIS[1];
    basis = b.id;
    if (merken && !basisStart) schreiben('karte.basis', b.id);
    if (!karte) return;
    if (basisLayer) karte.removeLayer(basisLayer);
    if (reliefLayer) karte.removeLayer(reliefLayer);
    reliefLayer = null;
    // Relief über der dunklen Karte, aufgehellt, damit Berge und Täler plastisch wirken
    if (b.relief) {
      reliefLayer = L.tileLayer(b.relief, { maxZoom: b.maxZoom, maxNativeZoom: 17, className: 'karte-relief', attribution: '' }).addTo(karte);
      reliefLayer.bringToBack();
    }
    basisLayer = L.tileLayer(b.url, { attribution: b.quelle, maxZoom: b.maxZoom, className: b.klasse }).addTo(karte);
    basisLayer.bringToBack();
  }

  let eingepasst = false;
  function seitenPunkteZeichnen(liste: GeoPunkt[], striche: GeoLinie[], waerme: [number, number, number][]) {
    if (!karte || !L) return;
    seitenPunkte ??= L.layerGroup().addTo(karte);
    seitenPunkte.clearLayers();
    if (waerme.length) heatZeichnen(waerme, seitenPunkte);
    const grenzen: [number, number][] = [];
    for (const li of striche) {
      if (li.punkte.length < 2) continue;
      L.polyline(li.punkte, { color: li.farbe ?? '#ff5d5d', weight: 3, opacity: 0.8, dashArray: li.gestrichelt ? '6 6' : undefined })
        .bindPopup(popupHtml({ id: li.id, lat: 0, lon: 0, titel: li.titel, text: li.text, symbol: 'ort' }), { maxWidth: 280 })
        .addTo(seitenPunkte);
      grenzen.push(...li.punkte);
    }
    for (const p of liste) {
      L.marker([p.lat, p.lon], { icon: symbolIcon(p), title: p.titel }).bindPopup(popupHtml(p)).addTo(seitenPunkte);
      grenzen.push([p.lat, p.lon]);
    }
    if (einpassen && !eingepasst && grenzen.length) {
      eingepasst = true;
      karte.fitBounds(L.latLngBounds(grenzen), { padding: [30, 30], maxZoom: 10 });
    }
  }

  $effect(() => {
    let abgebrochen = false;
    (async () => {
      L = (await import('leaflet')).default;
      if (abgebrochen) return;
      karte = L.map(element, { zoomControl: !kompakt, attributionControl: true, preferCanvas: true, zoomSnap: 0.5 }).setView(zentrum, zoom);
      karte.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
      basisSetzen(basis, false);
      if (onklick) karte.on('click', (ev: Leaflet.LeafletMouseEvent) => onklick?.(ev.latlng.lat, ev.latlng.lng));
      const r = await api.get<{ ebenen: Ebene[]; auswahl: string[] | null }>('/api/karte/ebenen');
      ebenen = r.ebenen;
      const gespeichert = r.auswahl ?? lesen<string[] | null>('karte.auswahl', null);
      const start = new Set(ebenenFest ?? gespeichert ?? r.ebenen.filter((e) => e.standardAn).map((e) => e.id));
      aktiv = start;
      for (const e of sichtbareEbenen) if (start.has(e.id)) ebeneAn(e);
      seitenPunkteZeichnen(punkte, linien, heat);
      aufraeumen = bereit?.(L, karte) ?? null;
    })();
    let aufraeumen: (() => void) | null = null;
    return () => {
      abgebrochen = true;
      aufraeumen?.();
      for (const t of timer.values()) clearInterval(t);
      timer.clear();
      layer.clear();
      karte?.remove();
      karte = null;
    };
  });

  $effect(() => {
    seitenPunkteZeichnen(punkte, linien, heat);
  });

  export function fliegen(lat: number, lon: number, z = 12) {
    karte?.flyTo([lat, lon], z, { duration: 1.2 });
  }
</script>

<div class="karte-rahmen" style="height:{hoehe}">
  <div class="karte" bind:this={element}></div>

  <button class="ebenen-knopf" onclick={() => (panelOffen = !panelOffen)} aria-label="Ebenen">
    <Icon name="ebenen" groesse={18} />{#if !kompakt}<span>Ebenen</span>{/if}
    {#if aktiv.size}<span class="anzahl">{[...aktiv].filter((id) => sichtbareEbenen.some((e) => e.id === id)).length}</span>{/if}
  </button>

  {#if panelOffen}
    <div class="ebenen-panel">
      <div class="zeile-zwischen"><strong>Karte</strong><button class="leise klein" onclick={() => (panelOffen = false)} aria-label="Schliessen"><Icon name="schliessen" groesse={16} /></button></div>
      <div class="basis">
        {#each BASIS as b (b.id)}
          <button class="klein" class:aktiv={basis === b.id} onclick={() => basisSetzen(b.id)}>{b.name}</button>
        {/each}
      </div>
      {#each gruppiert as [gruppe, liste] (gruppe)}
        <div class="gruppe">{gruppe}</div>
        {#each liste as e (e.id)}
          <label class="ebene" class:gesperrt={!!e.nichtVerfuegbar} title={e.nichtVerfuegbar ?? e.hinweis ?? ''}>
            <input type="checkbox" checked={aktiv.has(e.id)} disabled={!!e.nichtVerfuegbar} onchange={() => umschalten(e)} />
            <span class="wachsen">
              {e.name}
              {#if infos[e.id]?.demo}<span class="marke demo">Demo</span>{/if}
              {#if infos[e.id]?.fehler}<span class="marke ausfall">Fehler</span>{/if}
              {#if e.nichtVerfuegbar}<span class="sehr-klein gedaempft block">{e.nichtVerfuegbar}</span>{/if}
              {#if aktiv.has(e.id) && e.hinweis}<span class="sehr-klein gedaempft block">{e.hinweis}</span>{/if}
              {#if aktiv.has(e.id) && infos[e.id]?.hinweis}<span class="sehr-klein gedaempft block">{infos[e.id].hinweis}</span>{/if}
            </span>
            {#if aktiv.has(e.id) && infos[e.id]}<span class="sehr-klein gedaempft">{infos[e.id].anzahl}</span>{/if}
          </label>
        {/each}
      {/each}
    </div>
  {/if}
</div>

<style>
  .karte-rahmen {
    position: relative;
    border-radius: var(--radius);
    overflow: hidden;
    border: 1px solid var(--rand);
    background: #0b1016;
  }
  .karte {
    position: absolute;
    inset: 0;
  }
  .ebenen-knopf {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 500;
    background: #0d141cee;
    backdrop-filter: blur(6px);
  }
  .anzahl {
    background: var(--akzent);
    color: #04111a;
    border-radius: 999px;
    font-size: 0.7rem;
    padding: 0 6px;
    font-weight: 700;
  }
  .ebenen-panel {
    position: absolute;
    top: 56px;
    right: 10px;
    bottom: 10px;
    width: min(300px, calc(100% - 20px));
    z-index: 600;
    background: #0b1118f2;
    backdrop-filter: blur(10px);
    border: 1px solid var(--rand-hell);
    border-radius: 12px;
    padding: 12px;
    overflow-y: auto;
    box-shadow: 0 20px 50px #000a;
  }
  .basis {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin: 10px 0;
  }
  .basis .aktiv {
    border-color: var(--akzent);
    color: var(--akzent);
  }
  .gruppe {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-3);
    margin: 12px 0 4px;
  }
  .ebene {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 6px 4px;
    margin: 0;
    color: var(--text);
    font-size: 0.86rem;
    cursor: pointer;
    border-radius: 6px;
  }
  .ebene:hover {
    background: #ffffff08;
  }
  .ebene.gesperrt {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .block {
    display: block;
  }
  :global(.karte-dunkel) {
    filter: invert(1) hue-rotate(185deg) brightness(0.82) contrast(0.92) saturate(0.6);
  }
  :global(.karte-nacht) {
    filter: invert(1) hue-rotate(195deg) brightness(0.55) contrast(1.15) saturate(0.5);
  }
  :global(.karte-relief) {
    mix-blend-mode: screen;
    filter: invert(1) brightness(0.55) sepia(0.4) hue-rotate(175deg) saturate(1.6);
    opacity: 0.65;
  }
  :global(.heli-anim) {
    background: none;
    border: none;
  }
  :global(.heli-oben) {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    color: var(--farbe);
    filter: drop-shadow(0 0 4px var(--farbe)) drop-shadow(0 0 10px color-mix(in srgb, var(--farbe) 70%, transparent));
    cursor: pointer;
  }
  :global(.heli-oben .rotor) {
    transform-origin: 12px 9px;
    animation: rotorDrehen 0.35s linear infinite;
  }
  :global(.heli-oben.boden .rotor),
  :global(.boden .heli-oben .rotor) {
    animation: none;
  }
  :global(.heli-oben.boden),
  :global(.boden .heli-oben) {
    opacity: 0.6;
    filter: none;
  }
  @keyframes -global-rotorDrehen {
    to {
      transform: rotate(360deg);
    }
  }
  :global(.heli-schild) {
    background: #070b10cc !important;
    backdrop-filter: blur(4px);
    border: 1px solid #ffffff22 !important;
    border-radius: 6px !important;
    color: #e6edf5 !important;
    font: 600 11px/1.3 var(--schrift-zahl, ui-monospace, monospace) !important;
    padding: 2px 6px !important;
    box-shadow: 0 2px 8px #0008 !important;
    white-space: nowrap;
  }
  :global(.heli-schild::before) {
    display: none;
  }
  /* Abgestellte Helis: kein Signal, letzter bekannter Ort. Grün an der Basis, gelb anderswo */
  :global(.heli-oben.geparkt) {
    --ring: #fbbf24;
    color: #8b98a8;
    filter: none;
    opacity: 0.9;
    position: relative;
  }
  :global(.heli-oben.geparkt.basis) {
    --ring: #34d399;
  }
  :global(.heli-oben.geparkt::after) {
    content: '';
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    border: 2px dashed var(--ring);
    box-shadow: 0 0 8px color-mix(in srgb, var(--ring) 50%, transparent);
  }
  :global(.heli-oben.geparkt.basis::after) {
    border-style: solid;
  }
  :global(.heli-oben.geparkt .rotor) {
    animation: none;
  }
  :global(.heli-schild.geparkt) {
    border-color: #fbbf2466 !important;
    color: #c3ccd6 !important;
    font-weight: 500 !important;
  }
  :global(.heli-schild.geparkt.basis) {
    border-color: #34d39966 !important;
  }
  :global(.leaflet-container) {
    background: #0b1016;
    font: inherit;
  }
  :global(.leaflet-control-attribution) {
    background: #0b1118cc !important;
    color: var(--text-3) !important;
    font-size: 10px !important;
  }
  :global(.leaflet-control-attribution a) {
    color: var(--text-2) !important;
  }
  :global(.leaflet-bar a) {
    background: #0d141c !important;
    color: var(--text) !important;
    border-color: var(--rand) !important;
  }
  :global(.leaflet-popup-content-wrapper),
  :global(.leaflet-popup-tip) {
    background: #0f161f;
    color: var(--text);
    border: 1px solid var(--rand-hell);
    box-shadow: 0 10px 30px #000a;
  }
  :global(.leaflet-popup-content) {
    font-size: 0.85rem;
    margin: 10px 12px;
  }
  :global(.leaflet-popup-content img) {
    width: 100%;
    border-radius: 6px;
    margin-top: 6px;
  }
  :global(.popup-text) {
    color: var(--text-2);
    margin-top: 4px;
  }
  :global(.popup-zeit) {
    color: var(--text-3);
    font-size: 0.75rem;
    margin-top: 4px;
  }
  :global(.hub-marker) {
    background: none;
    border: none;
  }
  :global(.hub-symbol) {
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--farbe);
    background: radial-gradient(circle, #0b1118 55%, #0b111800 72%);
    border: 2px solid var(--farbe);
    box-shadow:
      0 0 0 3px #0b111899,
      0 0 14px color-mix(in srgb, var(--farbe) 60%, transparent);
    transition: transform 0.2s;
  }
  :global(.hub-symbol:hover) {
    transform: scale(1.15);
  }
  :global(.hub-symbol.puls::after) {
    content: '';
    position: absolute;
    width: inherit;
    height: inherit;
    border-radius: 50%;
    border: 2px solid var(--farbe);
    animation: hubPuls 2s ease-out infinite;
  }
  :global(.hub-symbol svg) {
    transition: transform 0.6s ease;
  }
  @keyframes -global-hubPuls {
    from {
      transform: scale(1);
      opacity: 0.8;
    }
    to {
      transform: scale(2.2);
      opacity: 0;
    }
  }
</style>
