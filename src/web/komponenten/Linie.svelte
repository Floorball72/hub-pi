<script lang="ts">
  // Schlankes Liniendiagramm (eine Reihe) mit Fadenkreuz und Tooltip. Keine Diagramm Bibliothek.
  let {
    punkte,
    hoehe = 140,
    einheit = '',
    titel = '',
    farbe = 'var(--akzent)',
    min: minVorgabe,
    max: maxVorgabe,
    lueckenMs = 0,
    zeitFormat = (t: number) => new Date(t).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  }: {
    punkte: { t: number; v: number | null; markierung?: boolean }[];
    hoehe?: number;
    einheit?: string;
    titel?: string;
    farbe?: string;
    min?: number;
    max?: number;
    /** Abstand, ab dem die Linie unterbrochen wird */
    lueckenMs?: number;
    zeitFormat?: (t: number) => string;
  } = $props();

  let breite = $state(600);
  let hover = $state<number | null>(null);
  const RAND = { l: 38, r: 8, o: 8, u: 20 };

  const gueltig = $derived(punkte.filter((p) => p.v !== null) as { t: number; v: number; markierung?: boolean }[]);
  const tMin = $derived(punkte.length ? punkte[0].t : 0);
  const tMax = $derived(punkte.length ? punkte[punkte.length - 1].t : 1);
  const vMin = $derived(minVorgabe ?? Math.min(0, ...gueltig.map((p) => p.v)));
  const vMaxRoh = $derived(maxVorgabe ?? Math.max(1, ...gueltig.map((p) => p.v)));
  const vMax = $derived(vMaxRoh === vMin ? vMin + 1 : vMaxRoh * (maxVorgabe === undefined ? 1.1 : 1));
  const x = (t: number) => RAND.l + ((t - tMin) / Math.max(1, tMax - tMin)) * (breite - RAND.l - RAND.r);
  const y = (v: number) => RAND.o + (1 - (v - vMin) / (vMax - vMin)) * (hoehe - RAND.o - RAND.u);

  const pfad = $derived.by(() => {
    let d = '';
    let vorher: { t: number; v: number | null } | null = null;
    for (const p of punkte) {
      if (p.v === null) {
        vorher = null;
        continue;
      }
      const neu = !vorher || vorher.v === null || (lueckenMs > 0 && p.t - vorher.t > lueckenMs);
      d += `${neu ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
      vorher = p;
    }
    return d;
  });

  const ticks = $derived([vMin, vMin + (vMax - vMin) / 2, vMax].map((v) => Math.round(v)));

  function bewegen(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const t = tMin + ((e.clientX - r.left - RAND.l) / (breite - RAND.l - RAND.r)) * (tMax - tMin);
    let best = 0;
    for (let i = 1; i < punkte.length; i++) if (Math.abs(punkte[i].t - t) < Math.abs(punkte[best].t - t)) best = i;
    hover = punkte.length ? best : null;
  }

  const hp = $derived(hover !== null ? punkte[hover] : null);
</script>

<figure class="linie" bind:clientWidth={breite}>
  {#if titel}<figcaption class="klein gedaempft">{titel}</figcaption>{/if}
  {#if !gueltig.length}
    <div class="leer" style="height:{hoehe}px">Noch keine Messwerte</div>
  {:else}
    <svg width={breite} height={hoehe} role="img" aria-label={titel} onpointermove={bewegen} onpointerleave={() => (hover = null)}>
      {#each ticks as t (t)}
        <line x1={RAND.l} x2={breite - RAND.r} y1={y(t)} y2={y(t)} class="gitter" />
        <text x={RAND.l - 6} y={y(t) + 4} text-anchor="end" class="achse">{t}</text>
      {/each}
      {#each punkte.filter((p) => p.markierung) as p (p.t)}
        <line x1={x(p.t)} x2={x(p.t)} y1={RAND.o} y2={hoehe - RAND.u} class="markierung" />
      {/each}
      <path d={pfad} fill="none" stroke={farbe} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <text x={RAND.l} y={hoehe - 4} class="achse">{zeitFormat(tMin)}</text>
      <text x={breite - RAND.r} y={hoehe - 4} text-anchor="end" class="achse">{zeitFormat(tMax)}</text>
      {#if hp}
        <line x1={x(hp.t)} x2={x(hp.t)} y1={RAND.o} y2={hoehe - RAND.u} class="kreuz" />
        {#if hp.v !== null}<circle cx={x(hp.t)} cy={y(hp.v)} r="4" fill={farbe} stroke="var(--flaeche)" stroke-width="2" />{/if}
      {/if}
    </svg>
    {#if hp}
      <div class="tooltip" style="left:{Math.min(breite - 150, Math.max(0, x(hp.t) - 70))}px">
        <strong>{hp.v === null ? 'kein Wert' : `${hp.v.toLocaleString('de-CH')} ${einheit}`}</strong>
        <span class="gedaempft">{zeitFormat(hp.t)}</span>
      </div>
    {/if}
  {/if}
</figure>

<style>
  .linie {
    margin: 0;
    position: relative;
  }
  svg {
    display: block;
    touch-action: pan-y;
  }
  .gitter {
    stroke: #ffffff10;
  }
  .achse {
    fill: var(--text-3);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .kreuz {
    stroke: var(--text-3);
    stroke-dasharray: 3 3;
  }
  .markierung {
    stroke: #f8717155;
    stroke-width: 3;
  }
  .tooltip {
    position: absolute;
    top: 0;
    width: 140px;
    background: #0b1118f2;
    border: 1px solid var(--rand-hell);
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 0.75rem;
    display: grid;
    pointer-events: none;
  }
  .leer {
    display: grid;
    place-items: center;
  }
</style>
