<script lang="ts">
  // Webcam Wand wie eine Videoüberwachung: Raster mit Livebildern, die sich selbst neu laden.
  // Die Bilder holt der Browser direkt beim Betreiber, der Pi lädt nur die Liste.
  import { api } from '../lib/api.ts';
  import { relativ } from '../lib/format.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';

  interface Cam {
    id: string;
    name: string;
    titel: string;
    lat: number;
    lon: number;
    hoehe: number | null;
    bild: string;
    bildGross: string;
    link: string | null;
    zeit: number | null;
    takt: number | null;
    quelle: string;
    km: number;
  }

  const NACHLADEN_MS = 120000;
  const SEITE = 24;

  let antwort = $state<{ cams: Cam[]; stand: string | null; demo: boolean; fehler?: string; namensnennung: string } | null>(null);
  let fehler = $state(false);
  let filter = $state<'favoriten' | 'naehe' | 'alle'>(lesen('webcams.filter', 'naehe'));
  let favoriten = $state<string[]>(lesen('webcams.favoriten', []));
  let anzahl = $state(SEITE);
  let runde = $state(0);
  let geladen = $state(new Date());
  let gross = $state<Cam | null>(null);
  let wand = $state<HTMLElement | null>(null);
  let uhr = $state(new Date());
  // Rundgang: das grosse Bild wechselt von selbst, wie ein Monitor in der Leitstelle
  const TAKTE = [5, 8, 15, 30];
  let rundgang = $state(false);
  let rundgangTakt = $state<number>(lesen('webcams.rundgang', 8));
  let rundgangStart = $state(0);

  const gefiltert = $derived.by(() => {
    const cams = antwort?.cams ?? [];
    if (filter === 'favoriten') return cams.filter((c) => favoriten.includes(c.id));
    if (filter === 'naehe') return cams.filter((c) => c.km <= 60 || favoriten.includes(c.id));
    return cams;
  });
  // Favoriten zuerst, sonst nach Distanz
  const sichtbar = $derived(
    [...gefiltert]
      .sort((a, b) => Number(favoriten.includes(b.id)) - Number(favoriten.includes(a.id)) || a.km - b.km)
      .slice(0, anzahl),
  );

  function laden() {
    api
      .get<NonNullable<typeof antwort>>('/api/m/rettung/webcams')
      .then((a) => {
        antwort = a;
        fehler = false;
        if (filter === 'favoriten' && !a.cams.some((c) => favoriten.includes(c.id))) filter = 'naehe';
      })
      .catch(() => (fehler = true));
  }

  $effect(() => {
    laden();
    const liste = setInterval(laden, 30 * 60000);
    // Bilder neu laden, aber nur wenn die Seite sichtbar ist
    const bilder = setInterval(() => {
      if (document.hidden) return;
      runde++;
      geladen = new Date();
    }, NACHLADEN_MS);
    const u = setInterval(() => (uhr = new Date()), 1000);
    return () => {
      clearInterval(liste);
      clearInterval(bilder);
      clearInterval(u);
    };
  });

  $effect(() => schreiben('webcams.filter', filter));

  function src(adresse: string): string {
    if (!adresse.startsWith('http') || runde === 0) return adresse;
    return `${adresse}${adresse.includes('?') ? '&' : '?'}t=${runde}`;
  }

  function favorit(id: string, e: Event) {
    e.stopPropagation();
    favoriten = favoriten.includes(id) ? favoriten.filter((f) => f !== id) : [...favoriten, id];
    schreiben('webcams.favoriten', favoriten);
  }

  function blaettern(schritt: number) {
    if (!gross) return;
    const i = sichtbar.findIndex((c) => c.id === gross?.id);
    gross = sichtbar[(i + schritt + sichtbar.length) % sichtbar.length] ?? null;
    rundgangStart = Date.now();
  }
  const naechste = $derived.by(() => {
    if (!gross || !rundgang) return null;
    const i = sichtbar.findIndex((c) => c.id === gross?.id);
    return sichtbar[(i + 1) % sichtbar.length] ?? null;
  });

  function rundgangStarten() {
    if (!sichtbar.length) return;
    gross ??= sichtbar[0];
    rundgang = true;
    rundgangStart = Date.now();
  }
  function schliessen() {
    gross = null;
    rundgang = false;
  }
  function taktSetzen(t: number) {
    rundgangTakt = t;
    rundgangStart = Date.now();
    schreiben('webcams.rundgang', t);
  }
  $effect(() => {
    if (!rundgang) return;
    const t = setInterval(() => {
      // Versteckt zählt nicht: danach mit der vollen Zeit weiter statt zu springen
      if (document.hidden || !gross) {
        rundgangStart = Date.now();
        return;
      }
      if (Date.now() - rundgangStart >= rundgangTakt * 1000) blaettern(1);
    }, 250);
    return () => clearInterval(t);
  });

  function taste(e: KeyboardEvent) {
    if (!gross) return;
    if (e.key === 'Escape') schliessen();
    if (e.key === ' ') {
      e.preventDefault();
      if (rundgang) rundgang = false;
      else rundgangStarten();
    }
    if (e.key === 'ArrowRight') blaettern(1);
    if (e.key === 'ArrowLeft') blaettern(-1);
  }

  function vollbild() {
    if (document.fullscreenElement) document.exitFullscreen();
    else wand?.requestFullscreen?.().catch(() => {});
  }

  const zeitFormat = new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const taktText = (s: number | null) => (s ? (s >= 3600 ? `alle ${Math.round(s / 3600)} h` : `alle ${Math.round(s / 60)} min`) : '');
</script>

<svelte:window onkeydown={taste} />

<section class="wand" bind:this={wand}>
  <div class="leiste">
    <span class="live"><span class="rec"></span>LIVE</span>
    <span class="zahl">{sichtbar.length}{gefiltert.length > sichtbar.length ? ` von ${gefiltert.length}` : ''} Kameras</span>
    <span class="uhr">{zeitFormat.format(uhr)}</span>
    <span class="wachsen"></span>
    <div class="wahl" role="group" aria-label="Auswahl">
      <button class:aktiv={filter === 'naehe'} onclick={() => (filter = 'naehe')}>Nähe</button>
      <button class:aktiv={filter === 'favoriten'} onclick={() => (filter = 'favoriten')} disabled={!favoriten.length}>Favoriten {favoriten.length || ''}</button>
      <button class:aktiv={filter === 'alle'} onclick={() => (filter = 'alle')}>Alle</button>
    </div>
    <button class="knopf klein" onclick={rundgangStarten} disabled={!sichtbar.length} title="Die Kameras nacheinander gross zeigen">Rundgang</button>
    <button class="knopf klein" onclick={vollbild}>Vollbild</button>
  </div>

  {#if fehler && !antwort}
    <div class="hinweis ausfall">Die Liste der Webcams ist gerade nicht erreichbar.</div>
  {:else if antwort?.fehler}
    <div class="hinweis ausfall klein">foto-webcam.eu: {antwort.fehler}</div>
  {/if}

  <div class="raster">
    {#each sichtbar as c, i (c.id)}
      <button class="kamera" onclick={() => (gross = c)} title={c.titel}>
        <img src={src(c.bild)} alt={c.titel} loading="lazy" decoding="async" />
        <span class="ecke oben-links"><span class="nr">CAM {String(i + 1).padStart(2, '0')}</span> {c.name}</span>
        <span
          class="stern"
          class:an={favoriten.includes(c.id)}
          role="button"
          tabindex="0"
          aria-label="Favorit"
          onclick={(e) => favorit(c.id, e)}
          onkeydown={(e) => e.key === 'Enter' && favorit(c.id, e)}>★</span
        >
        <span class="ecke unten-links">{zeitFormat.format(geladen).slice(0, 5)}{c.takt ? ` · ${taktText(c.takt)}` : ''}</span>
        <span class="ecke unten-rechts">{c.km} km{c.hoehe ? ` · ${c.hoehe} m` : ''}</span>
      </button>
    {:else}
      {#if antwort}<p class="leer">{filter === 'favoriten' ? 'Noch keine Favoriten. Stern auf einer Kamera antippen.' : 'Keine Webcams gefunden.'}</p>{/if}
    {/each}
  </div>

  {#if gefiltert.length > sichtbar.length}
    <button class="knopf mehr" onclick={() => (anzahl += SEITE)}>Mehr Kameras zeigen</button>
  {/if}

  <p class="sehr-klein gedaempft fuss">
    Bilder laden alle 2 Minuten neu, die Kameras selbst liefern je nach Betreiber alle paar Minuten ein neues Bild.
    {antwort?.namensnennung ?? ''}{antwort?.demo ? ' · Demo Bilder' : ''}{antwort?.stand ? ` · Liste ${relativ(antwort.stand)}` : ''}
  </p>

  {#if gross}
    <div class="gross" role="dialog" aria-modal="true" aria-label={gross.titel}>
      <button class="hintergrund" aria-label="Schliessen" onclick={schliessen}></button>
      <figure>
        <img src={src(gross.bildGross)} alt={gross.titel} />
        {#if rundgang}
          {#key `${gross.id}-${rundgangStart}-${rundgangTakt}`}<div class="fortschritt" style="animation-duration:{rundgangTakt}s"></div>{/key}
          <span class="rg-marke"><span class="rec"></span>RUNDGANG {sichtbar.findIndex((c) => c.id === gross?.id) + 1}/{sichtbar.length}</span>
          {#if naechste}<img class="vorladen" src={src(naechste.bildGross)} alt="" aria-hidden="true" />{/if}
        {/if}
        <figcaption>
          <strong>{gross.titel}</strong>
          <span class="gedaempft klein">{gross.km} km{gross.hoehe ? ` · ${gross.hoehe} m ü. M.` : ''} · {gross.quelle}{gross.zeit ? ` · Liste ${relativ(new Date(gross.zeit).toISOString())}` : ''}</span>
          <span class="wachsen"></span>
          <button class="knopf klein" onclick={() => blaettern(-1)} aria-label="Vorherige">‹</button>
          <button class="knopf klein" onclick={() => blaettern(1)} aria-label="Nächste">›</button>
          {#if rundgang}
            <span class="takt" role="group" aria-label="Wechsel alle">
              {#each TAKTE as t (t)}<button class:aktiv={rundgangTakt === t} onclick={() => taktSetzen(t)}>{t} s</button>{/each}
            </span>
            <button class="knopf klein" onclick={() => (rundgang = false)}>Anhalten</button>
          {:else}
            <button class="knopf klein" onclick={rundgangStarten}>Rundgang</button>
          {/if}
          {#if gross.link}<a class="knopf klein" href={gross.link} target="_blank" rel="noopener noreferrer">Zur Quelle</a>{/if}
          <button class="knopf klein" onclick={schliessen}>Schliessen</button>
        </figcaption>
      </figure>
    </div>
  {/if}
</section>

<style>
  .wand {
    background: #05080c;
    border: 1px solid var(--rand);
    border-radius: 14px;
    padding: 10px;
  }
  .wand:fullscreen {
    border-radius: 0;
    overflow: auto;
  }
  .leiste {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 10px;
    font: 600 12px/1.2 var(--schrift-zahl, ui-monospace, monospace);
    color: var(--text-2);
  }
  .live {
    color: #ff5d5d;
    letter-spacing: 0.1em;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .rec {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #ff3b3b;
    box-shadow: 0 0 8px #ff3b3b;
    animation: blinken 1.4s steps(2, start) infinite;
  }
  @keyframes blinken {
    to {
      visibility: hidden;
    }
  }
  .uhr {
    color: #e6edf5;
  }
  .wachsen {
    flex: 1;
  }
  .wahl {
    display: inline-flex;
    border: 1px solid var(--rand-hell);
    border-radius: 8px;
    overflow: hidden;
  }
  .wahl button {
    background: none;
    border: none;
    color: var(--text-2);
    padding: 5px 10px;
    font: inherit;
    cursor: pointer;
  }
  .wahl button.aktiv {
    background: var(--flaeche-3);
    color: #e6edf5;
  }
  .wahl button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .raster {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 6px;
  }
  .kamera {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: 6px;
    border: 1px solid #ffffff14;
    background: #0b1016;
    padding: 0;
    cursor: zoom-in;
    color: #e6edf5;
  }
  .kamera img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    filter: saturate(0.9) contrast(1.05);
    transition: transform 0.4s ease;
  }
  @media (hover: hover) and (pointer: fine) {
    .kamera:hover img {
      transform: scale(1.04);
    }
  }
  /* Feine Zeilen wie auf einem Überwachungsmonitor */
  .kamera::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(0deg, #0000 0 2px, #0000001f 2px 3px);
    box-shadow: inset 0 0 40px #000a;
  }
  .ecke {
    position: absolute;
    z-index: 1;
    font: 600 10.5px/1.3 var(--schrift-zahl, ui-monospace, monospace);
    background: #000a;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    max-width: calc(100% - 50px);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .oben-links {
    top: 6px;
    left: 6px;
  }
  .nr {
    color: #ff5d5d;
  }
  .unten-links {
    bottom: 6px;
    left: 6px;
    color: var(--text-2);
  }
  .unten-rechts {
    bottom: 6px;
    right: 6px;
    color: var(--text-2);
  }
  .stern {
    position: absolute;
    z-index: 2;
    top: 3px;
    right: 6px;
    font-size: 17px;
    color: #ffffff55;
    text-shadow: 0 1px 3px #000;
    cursor: pointer;
  }
  .stern.an {
    color: #fbbf24;
  }
  .mehr {
    margin: 10px auto 0;
    display: block;
  }
  .fuss {
    margin: 10px 2px 0;
  }
  .leer {
    color: var(--text-2);
    padding: 20px;
  }
  .gross {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .hintergrund {
    position: absolute;
    inset: 0;
    background: #000d;
    border: none;
    cursor: zoom-out;
  }
  figure {
    position: relative;
    margin: 0;
    max-width: min(1400px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  figure img {
    max-width: 100%;
    max-height: calc(100vh - 110px);
    max-height: calc(100dvh - 110px);
    object-fit: contain;
    border-radius: 8px;
    background: #0b1016;
  }
  .fortschritt {
    position: absolute;
    left: 0;
    top: 0;
    height: 3px;
    width: 100%;
    background: #ef4444;
    border-radius: 8px 8px 0 0;
    transform-origin: left;
    animation: ablauf linear forwards;
  }
  @keyframes ablauf {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }
  .rg-marke {
    position: absolute;
    top: 10px;
    left: 10px;
    padding: 3px 8px;
    border-radius: 4px;
    background: #000a;
    color: #e6edf5;
    font: 600 0.72rem ui-monospace, monospace;
    letter-spacing: 0.08em;
  }
  .vorladen {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .takt {
    display: inline-flex;
    border: 1px solid #ffffff22;
    border-radius: 8px;
    overflow: hidden;
  }
  .takt button {
    background: none;
    border: none;
    color: #cbd5e1;
    padding: 4px 8px;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .takt button.aktiv {
    background: #ffffff1f;
    color: #fff;
  }
  figcaption {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    color: #e6edf5;
  }
  @media (max-width: 600px) {
    .raster {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    }
    .unten-rechts {
      display: none;
    }
  }
</style>
