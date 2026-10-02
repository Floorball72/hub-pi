<script lang="ts">
  import type { SuchTreffer } from '../../server/geteilt/typen.ts';
  import { api } from '../lib/api.ts';
  import { ort, parameter } from '../lib/router.svelte.ts';

  let treffer = $state<SuchTreffer[] | null>(null);
  const q = $derived((void ort.suche, parameter('q') ?? ''));

  $effect(() => {
    treffer = null;
    if (q.length >= 2) api.get<SuchTreffer[]>(`/api/suche?q=${encodeURIComponent(q)}`).then((t) => (treffer = t));
    else treffer = [];
  });
</script>

<h1>Suche: «{q}»</h1>
{#if treffer === null}
  <div class="laedt" style="height:120px"></div>
{:else if !treffer.length}
  <p class="leer">Keine Treffer.</p>
{:else}
  <ul class="liste panel">
    {#each treffer as t (t.link)}
      <li>
        <a href={t.link}><strong>{t.titel}</strong></a>
        <div class="sehr-klein gedaempft">{t.modul}{t.text ? ` · ${t.text}` : ''}</div>
      </li>
    {/each}
  </ul>
{/if}
