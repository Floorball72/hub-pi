<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ModulInfo, QuellenStatusInfo } from '../../server/geteilt/typen.ts';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import Icon from './Icon.svelte';
  import QuellenListe from './QuellenListe.svelte';

  let { modulId, children, tabs = [], tab = $bindable('') }: { modulId: string; children: Snippet; tabs?: string[]; tab?: string } =
    $props();

  let modul = $state<ModulInfo | null>(null);
  let quellen = $state<QuellenStatusInfo[]>([]);
  let demo = $state(false);
  let quellenOffen = $state(false);

  async function laden() {
    const s = await api.get<{ module: ModulInfo[]; quellen: QuellenStatusInfo[]; demo: boolean }>('/api/status');
    modul = s.module.find((m) => m.id === modulId) ?? null;
    quellen = s.quellen.filter((q) => q.modul === modulId);
    demo = s.demo;
  }

  $effect(() => {
    void modulId;
    laden().catch(() => {});
    if (!tab && tabs.length) tab = tabs[0];
  });

  const ausfaelle = $derived(quellen.filter((q) => q.zustand === 'fehler').length);

  async function umschalten() {
    if (!modul) return;
    const neu = !modul.aktiv;
    const ok = await bestaetigen(
      neu ? `${modul.name} einschalten?` : `${modul.name} ausschalten?`,
      neu ? 'Jobs und Datenquellen des Moduls starten wieder.' : 'Jobs und Datenquellen des Moduls werden angehalten. Das spart Ressourcen. Daten bleiben erhalten.',
      neu ? 'Einschalten' : 'Ausschalten',
      !neu,
    );
    if (!ok) return;
    try {
      await api.post(`/api/module/${modul.id}`, { aktiv: neu, bestaetigt: true });
      melden(neu ? 'Modul eingeschaltet' : 'Modul ausgeschaltet');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
</script>

<section class="modul">
  <header class="kopf">
    <div class="titel">
      <span class="symbol"><Icon name={modul?.symbol ?? modulId} groesse={26} /></span>
      <div>
        <h1>{modul?.name ?? ''}</h1>
        <div class="gedaempft klein">{modul?.beschreibung ?? ''}</div>
      </div>
    </div>
    <div class="zeile">
      {#if demo}<span class="marke demo">Demo Daten</span>{/if}
      <button class="leise klein" onclick={() => (quellenOffen = !quellenOffen)}>
        <span class="punkt {ausfaelle ? 'ausfall' : quellen.length ? 'ok' : ''}"></span>
        Quellen{#if ausfaelle}&nbsp;({ausfaelle} gestört){/if}
      </button>
      {#if modul && !modul.pflicht}
        <label class="schalter" title={modul.aktiv ? 'Modul ausschalten' : 'Modul einschalten'}>
          <input type="checkbox" checked={modul.aktiv} onclick={(e) => { e.preventDefault(); umschalten(); }} />
          <span></span>
        </label>
      {/if}
    </div>
  </header>

  {#if quellenOffen}
    <div class="panel quellen"><h3>Gesundheit der Datenquellen</h3><QuellenListe {quellen} /></div>
  {/if}

  {#if modul && !modul.aktiv}
    <div class="hinweis warnung">Dieses Modul ist ausgeschaltet. Einschalten mit dem Schalter oben rechts.</div>
  {:else}
    {#if tabs.length}
      <nav class="tabs">
        {#each tabs as t (t)}
          <button class:aktiv={tab === t} onclick={() => (tab = t)}>{t}</button>
        {/each}
      </nav>
    {/if}
    {@render children()}
  {/if}
</section>

<style>
  .kopf {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .titel {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .titel h1 {
    margin: 0;
  }
  .symbol {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    color: var(--akzent);
    background: linear-gradient(180deg, #13202d, #0e1620);
    border: 1px solid var(--rand-hell);
  }
  .quellen {
    margin-bottom: 16px;
  }
</style>
