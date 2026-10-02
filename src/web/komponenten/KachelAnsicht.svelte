<script lang="ts">
  import type { Kachel, ModulInfo } from '../../server/geteilt/typen.ts';
  import Icon from './Icon.svelte';

  let { modul, kachel }: { modul: ModulInfo; kachel: Kachel | undefined } = $props();
  const status = $derived(kachel?.status ?? 'neutral');
</script>

<a class="kachel {status}" href="/modul/{modul.id}">
  <div class="kopf">
    <span class="symbol"><Icon name={modul.symbol} groesse={18} /></span>
    <span class="name">{kachel?.titel ?? modul.name}</span>
    {#if kachel?.demo}<span class="marke demo">Demo</span>{/if}
    <span class="punkt {status}"></span>
  </div>
  {#if !kachel}
    <div class="laedt" style="height:48px;margin-top:8px"></div>
  {:else}
    {#if kachel.wert}
      <div class="wert zahl">{kachel.wert}{#if kachel.einheit}<span class="einheit">{kachel.einheit}</span>{/if}</div>
    {/if}
    {#if kachel.unter}<div class="unter gedaempft klein">{kachel.unter}</div>{/if}
    {#if kachel.zeilen?.length}
      <ul class="zeilen">
        {#each kachel.zeilen.slice(0, 5) as z, i (i)}
          <li>
            {#if z.status}<span class="punkt {z.status}"></span>{/if}
            <span class="text">{z.text}</span>
            {#if z.wert}<span class="zeilenwert">{z.wert}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if kachel.hinweis}<div class="hinweis-text sehr-klein">{kachel.hinweis}</div>{/if}
  {/if}
</a>

<style>
  .kachel {
    display: block;
    color: inherit;
    text-decoration: none;
    background: linear-gradient(180deg, var(--flaeche-2), var(--flaeche));
    border: 1px solid var(--rand);
    border-radius: var(--radius);
    padding: 14px 16px 12px;
    position: relative;
    overflow: hidden;
    transition:
      border-color 0.2s,
      transform 0.2s;
    min-height: 150px;
  }
  .kachel::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 2px;
    background: var(--neutral);
    opacity: 0.5;
  }
  .kachel.ok::before {
    background: linear-gradient(90deg, var(--ok), transparent);
    opacity: 0.8;
  }
  .kachel.warnung::before {
    background: linear-gradient(90deg, var(--warnung), transparent);
    opacity: 1;
  }
  .kachel.ausfall {
    border-color: #f8717155;
  }
  .kachel.ausfall::before {
    background: var(--ausfall);
    opacity: 1;
  }
  .kachel:hover {
    border-color: var(--rand-hell);
    text-decoration: none;
    transform: translateY(-1px);
  }
  .kopf {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
    font-size: 0.85rem;
  }
  .symbol {
    display: inline-flex;
    color: var(--akzent);
  }
  .name {
    flex: 1;
    font-weight: 500;
  }
  .wert {
    font-size: 2.4rem;
    line-height: 1.1;
    margin-top: 10px;
  }
  .einheit {
    font-size: 1rem;
    color: var(--text-2);
    margin-left: 4px;
    font-weight: 500;
  }
  .zeilen {
    list-style: none;
    padding: 0;
    margin: 10px 0 0;
    font-size: 0.85rem;
  }
  .zeilen li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    border-top: 1px solid #1a2330;
  }
  .text {
    flex: 1;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .zeilenwert {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .hinweis-text {
    margin-top: 8px;
    color: var(--warnung);
  }
</style>
