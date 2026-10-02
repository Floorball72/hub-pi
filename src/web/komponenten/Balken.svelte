<script lang="ts">
  // Einfaches Säulendiagramm (eine Reihe) mit Tooltip pro Säule.
  let { werte, beschriftung, titel = '', hoehe = 130, einheit = '' }: { werte: number[]; beschriftung: string[]; titel?: string; hoehe?: number; einheit?: string } = $props();
  let hover = $state<number | null>(null);
  const max = $derived(Math.max(1, ...werte));
</script>

<figure class="balken">
  {#if titel}<figcaption class="klein gedaempft">{titel}</figcaption>{/if}
  <div class="flaeche" style="height:{hoehe}px" role="img" aria-label={titel}>
    {#each werte as w, i (i)}
      <div class="spalte" role="presentation" onpointerenter={() => (hover = i)} onpointerleave={() => (hover = null)}>
        <div class="saeule" class:aktiv={hover === i} style="height:{Math.max(w ? 3 : 0, (w / max) * 100)}%"></div>
        {#if hover === i}<div class="tip">{beschriftung[i]}: {w} {einheit}</div>{/if}
      </div>
    {/each}
  </div>
  <div class="achse">
    {#each beschriftung as b, i (i)}<span class:sichtbar={beschriftung.length <= 8 || i % 3 === 0}>{b}</span>{/each}
  </div>
</figure>

<style>
  .balken {
    margin: 0;
  }
  .flaeche {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    border-bottom: 1px solid #ffffff14;
  }
  .spalte {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
    position: relative;
  }
  .saeule {
    width: 100%;
    background: var(--akzent);
    border-radius: 4px 4px 0 0;
    opacity: 0.85;
  }
  .saeule.aktiv {
    opacity: 1;
    background: var(--akzent-2);
  }
  .tip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    background: #0b1118f2;
    border: 1px solid var(--rand-hell);
    border-radius: 6px;
    padding: 2px 6px;
    font-size: 0.72rem;
    z-index: 3;
    pointer-events: none;
  }
  .achse {
    display: flex;
    gap: 2px;
  }
  .achse span {
    flex: 1;
    text-align: center;
    font-size: 0.65rem;
    color: var(--text-3);
    visibility: hidden;
  }
  .achse span.sichtbar {
    visibility: visible;
  }
</style>
