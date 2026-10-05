<script lang="ts">
  // Halbes Unihockey Feld (20 x 20 m), Tor oben. Koordinaten 0 bis 1, y = 0 an der Bande hinter dem Tor.
  // Zeigt Abschlüsse als Punkte oder als Heatmap und meldet angetippte Stellen.

  interface Punkt {
    id: string;
    typ: string;
    team: string;
    x: number;
    y: number;
  }

  let {
    punkte = [],
    heatmap = false,
    zonen = false,
    markierung = null,
    farbe = 'var(--akzent)',
    ontipp,
  }: {
    punkte?: Punkt[];
    heatmap?: boolean;
    zonen?: boolean;
    markierung?: { x: number; y: number } | null;
    farbe?: string;
    ontipp?: (x: number, y: number) => void;
  } = $props();

  let svg = $state<SVGSVGElement>();

  // 10 Einheiten pro Meter
  const ZELLEN = 10;
  const raster = $derived.by(() => {
    if (!heatmap) return [];
    const zaehler = new Map<string, number>();
    for (const p of punkte) {
      const k = `${Math.min(ZELLEN - 1, Math.floor(p.x * ZELLEN))}:${Math.min(ZELLEN - 1, Math.floor(p.y * ZELLEN))}`;
      zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
    }
    const max = Math.max(1, ...zaehler.values());
    return [...zaehler].map(([k, n]) => {
      const [x, y] = k.split(':').map(Number);
      return { x, y, n, deckung: 0.12 + (n / max) * 0.7 };
    });
  });

  function tipp(e: MouseEvent) {
    if (!ontipp || !svg) return;
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const x = Math.min(1, Math.max(0, p.x / 200));
    const y = Math.min(1, Math.max(0, p.y / 200));
    ontipp(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<svg
  bind:this={svg}
  viewBox="0 0 200 200"
  class="feld"
  class:tippbar={!!ontipp}
  onclick={tipp}
  role={ontipp ? 'application' : 'img'}
  aria-label="Spielfeld mit Abschlüssen"
>
  <rect x="1" y="1" width="198" height="240" rx="18" class="bande" />
  <line x1="1" y1="199" x2="199" y2="199" class="linie" />
  <circle cx="100" cy="200" r="30" class="linie" fill="none" />
  <!-- Torraum 5 x 4 m, Torhüterraum 2.5 x 1 m, Tor 1.6 m -->
  <rect x="75" y="28.5" width="50" height="40" class="linie" fill="none" />
  <rect x="87.5" y="35" width="25" height="10" class="linie" fill="none" />
  <line x1="20" y1="35" x2="180" y2="35" class="linie duenn" />
  <rect x="92" y="28.5" width="16" height="6.5" class="tor-rahmen" />
  <circle cx="15" cy="35" r="1.5" class="punkt-markierung" />
  <circle cx="185" cy="35" r="1.5" class="punkt-markierung" />
  {#if zonen}
    <circle cx="100" cy="35" r="50" class="zone" />
    <circle cx="100" cy="35" r="100" class="zone" />
    <line x1="60" y1="35" x2="60" y2="126.6" class="zone" />
    <line x1="140" y1="35" x2="140" y2="126.6" class="zone" />
    <text x="100" y="80" class="zonen-text">Torraum</text>
    <text x="100" y="118" class="zonen-text">Slot</text>
    <text x="28" y="95" class="zonen-text">Seite</text>
    <text x="172" y="95" class="zonen-text">Seite</text>
    <text x="100" y="175" class="zonen-text">Distanz</text>
  {/if}
  {#if heatmap}
    {#each raster as z (`${z.x}:${z.y}`)}
      <rect x={z.x * 20} y={z.y * 20} width="20" height="20" fill={farbe} opacity={z.deckung} />
    {/each}
  {:else}
    {#each punkte as p (p.id)}
      <circle cx={p.x * 200} cy={p.y * 200} r={p.typ === 'tor' ? 4.2 : 3.2} class="schuss {p.typ}" />
    {/each}
  {/if}
  {#if markierung}
    <circle cx={markierung.x * 200} cy={markierung.y * 200} r="6" class="markierung" />
  {/if}
</svg>

<style>
  .feld {
    width: 100%;
    max-width: 520px;
    display: block;
    margin: 0 auto;
    background: #0d2a1f;
    border-radius: 14px;
    touch-action: manipulation;
  }
  .tippbar {
    cursor: crosshair;
  }
  .bande {
    fill: #10321f;
    stroke: #e6edf3aa;
    stroke-width: 1.5;
  }
  .linie {
    stroke: #e6edf388;
    stroke-width: 0.8;
    fill: none;
  }
  .duenn {
    stroke-width: 0.5;
    stroke-dasharray: 2 2;
  }
  .tor-rahmen {
    fill: none;
    stroke: #f87171;
    stroke-width: 1.4;
  }
  .punkt-markierung {
    fill: #e6edf388;
  }
  .zone {
    fill: none;
    stroke: #fbbf2455;
    stroke-width: 0.7;
    stroke-dasharray: 3 3;
  }
  .zonen-text {
    fill: #fbbf2488;
    font-size: 7px;
    text-anchor: middle;
  }
  .schuss {
    stroke: #080c11;
    stroke-width: 0.8;
  }
  .schuss.tor {
    fill: var(--ok);
  }
  .schuss.gehalten {
    fill: var(--akzent);
  }
  .schuss.daneben {
    fill: none;
    stroke: var(--text-2);
    stroke-width: 1.2;
  }
  .schuss.geblockt {
    fill: var(--warnung);
  }
  .markierung {
    fill: none;
    stroke: #fff;
    stroke-width: 1.5;
    stroke-dasharray: 2 2;
  }
</style>
