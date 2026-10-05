<script lang="ts">
  import type { TimelineEintrag } from '../../server/geteilt/typen.ts';
  import { api } from '../lib/api.ts';
  import { datum, zeit } from '../lib/format.ts';

  let eintraege = $state<TimelineEintrag[] | null>(null);
  let tage = $state(30);

  $effect(() => {
    const von = new Date(Date.now() - 86400000).toISOString();
    const bis = new Date(Date.now() + tage * 86400000).toISOString();
    api.get<TimelineEintrag[]>(`/api/timeline?von=${von}&bis=${bis}`).then((e) => (eintraege = e));
  });

  const gruppiert = $derived.by(() => {
    const g = new Map<string, TimelineEintrag[]>();
    for (const e of eintraege ?? []) {
      const tag = e.ganztags ? e.start.slice(0, 10) : new Date(e.start).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
      g.set(tag, [...(g.get(tag) ?? []), e]);
    }
    return [...g.entries()];
  });

  const FARBE: Record<string, string> = {
    swissunihockey: '#4cc9f0',
    unihockey: '#a78bfa',
    drohne: '#34d399',
    scont: '#fbbf24',
    zentrale: '#94a3b8',
  };
</script>

<div class="zeile-zwischen">
  <h1>Timeline</h1>
  <select bind:value={tage} style="width:auto" aria-label="Zeitraum">
    <option value={7}>7 Tage</option>
    <option value={30}>30 Tage</option>
    <option value={90}>90 Tage</option>
    <option value={365}>1 Jahr</option>
  </select>
</div>
<p class="gedaempft klein">swiss unihockey Einsätze, Kundendrehs, Vipers Spiele, Fristen und Ablaufdaten in einer Liste.</p>

{#if eintraege === null}
  <div class="laedt" style="height:200px"></div>
{:else if !eintraege.length}
  <p class="leer">Nichts geplant.</p>
{:else}
  <div class="timeline">
    {#each gruppiert as [tag, liste] (tag)}
      <section class="tag">
        <h3 class="tag-titel">{datum(tag, true)}</h3>
        {#each liste as e (e.id)}
          <a class="eintrag panel" href={e.link ?? `/modul/${e.modul}`} style="--farbe:{FARBE[e.modul] ?? '#64748b'}">
            <div class="zeit zahl">{e.ganztags ? 'ganztags' : zeit(e.start)}</div>
            <div class="wachsen">
              <div class="zeile"><span class="art">{e.art}</span>{#if e.status && e.status !== 'neutral'}<span class="punkt {e.status}"></span>{/if}</div>
              <strong>{e.titel}</strong>
              {#if e.text}<div class="klein gedaempft">{e.text}</div>{/if}
            </div>
          </a>
        {/each}
      </section>
    {/each}
  </div>
{/if}

<style>
  .timeline {
    max-width: 820px;
  }
  .tag {
    margin-top: 18px;
  }
  .tag-titel {
    position: sticky;
    top: 58px;
    background: var(--bg);
    padding: 4px 0;
    z-index: 2;
  }
  .eintrag {
    display: flex;
    gap: 14px;
    color: inherit;
    padding: 10px 14px;
    margin-bottom: 8px;
    border-left: 3px solid var(--farbe);
  }
  @media (hover: hover) and (pointer: fine) {
    .eintrag:hover {
      text-decoration: none;
      border-color: var(--rand-hell);
      border-left-color: var(--farbe);
    }
  }
  .zeit {
    width: 70px;
    flex: none;
    color: var(--text-2);
  }
  .art {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--farbe);
  }
</style>
