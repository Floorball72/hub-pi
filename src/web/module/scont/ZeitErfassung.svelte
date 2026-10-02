<script lang="ts">
  import Icon from '../../komponenten/Icon.svelte';
  import TabellenEditor from '../../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../../lib/api.ts';
  import { melden } from '../../lib/meldung.svelte.ts';

  interface Daten {
    laufend: { id: string; kunde_id: string; start: string; beschreibung: string | null } | null;
    proKunde: Record<string, number>;
    kunden: { id: string; name: string; stundensatz: number | null }[];
  }
  let d = $state<Daten | null>(null);
  let jetzt = $state(Date.now());
  let beschreibung = $state('');
  let editor = $state<{ neuLaden: () => Promise<void> } | null>(null);

  async function laden() {
    d = await api.get<Daten>('/api/m/scont/zeit');
  }
  $effect(() => {
    laden();
    const t = setInterval(() => (jetzt = Date.now()), 1000);
    return () => clearInterval(t);
  });

  async function start(kundeId: string) {
    try {
      await api.post('/api/m/scont/zeit/start', { kunde_id: kundeId, beschreibung });
      beschreibung = '';
      await laden();
      await editor?.neuLaden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function stopp() {
    const r = await api.post<{ gestoppt: { minuten: number } | null }>('/api/m/scont/zeit/stopp', {});
    if (r.gestoppt) melden(`${Math.round(r.gestoppt.minuten)} Minuten erfasst`);
    await laden();
    await editor?.neuLaden();
  }
  function dauer(start: string) {
    const s = Math.max(0, Math.floor((jetzt - new Date(start).getTime()) / 1000));
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  const kundeName = (id: string) => d?.kunden.find((k) => k.id === id)?.name ?? 'Kunde';
</script>

{#if d}
  {#if d.laufend}
    <div class="panel laufend">
      <div>
        <div class="klein gedaempft">Läuft für {kundeName(d.laufend.kunde_id)}{d.laufend.beschreibung ? ` · ${d.laufend.beschreibung}` : ''}</div>
        <div class="zahl uhr">{dauer(d.laufend.start)}</div>
      </div>
      <button class="gefahr gross" onclick={stopp}><Icon name="stopp" />Stopp</button>
    </div>
  {/if}
  <div class="feld" style="margin:12px 0">
    <label for="zb">Beschreibung für den nächsten Start (optional)</label>
    <input id="zb" bind:value={beschreibung} placeholder="z.B. Inhalte aktualisiert" />
  </div>
  <div class="kunden">
    {#each d.kunden as k (k.id)}
      <button class="kunde panel" class:aktiv={d.laufend?.kunde_id === k.id} onclick={() => (d?.laufend?.kunde_id === k.id ? stopp() : start(k.id))}>
        <span class="name">{k.name}</span>
        <span class="zahl">{((d.proKunde[k.id] ?? 0) / 60).toLocaleString('de-CH', { maximumFractionDigits: 1 })} h</span>
        <span class="sehr-klein gedaempft">diesen Monat{k.stundensatz ? ` · CHF ${(((d.proKunde[k.id] ?? 0) / 60) * k.stundensatz).toFixed(0)}` : ''}</span>
        <span class="aktion">{d.laufend?.kunde_id === k.id ? 'Stopp' : 'Start'}</span>
      </button>
    {:else}
      <p class="leer">Noch keine aktiven Kunden.</p>
    {/each}
  </div>
  <div class="panel" style="margin-top:14px">
    <TabellenEditor bind:this={editor} tabelle="zeiten" sort="-start" spalten={['kunde_id', 'start', 'minuten', 'beschreibung']} titel="Einträge" neuText="Eintrag" />
  </div>
{:else}
  <div class="laedt" style="height:200px"></div>
{/if}

<style>
  .laufend {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-color: #34d39966;
  }
  .uhr {
    font-size: 2.6rem;
  }
  .gross {
    min-height: 54px;
    font-size: 1.05rem;
    padding: 0 22px;
  }
  .kunden {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  }
  .kunde {
    display: grid;
    text-align: left;
    gap: 2px;
    color: var(--text);
    min-height: 110px;
    align-content: start;
  }
  .kunde .zahl {
    font-size: 1.6rem;
  }
  .kunde.aktiv {
    border-color: var(--ok);
    box-shadow: 0 0 0 1px var(--ok) inset;
  }
  .aktion {
    color: var(--akzent);
    font-size: 0.85rem;
    margin-top: 6px;
  }
  .name {
    font-weight: 600;
  }
</style>
