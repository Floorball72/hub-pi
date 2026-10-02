<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import { api } from '../lib/api.ts';
  import { zeit } from '../lib/format.ts';

  interface Tafel {
    haltestelle: string;
    tafel: { haltestelle: string; abfahrten: { zeit: string; verspaetungMin: number | null; gleis: string | null; linie: string; ziel: string; art: string }[] } | null;
    fehler?: string;
    demo: boolean;
  }
  let tafeln = $state<Tafel[] | null>(null);
  let jetzt = $state(Date.now());

  async function laden() {
    tafeln = (await api.get<{ tafeln: Tafel[] }>('/api/m/mobilitaet/abfahrten')).tafeln;
  }
  $effect(() => {
    laden();
    const t = setInterval(laden, 60000);
    const u = setInterval(() => (jetzt = Date.now()), 15000);
    return () => {
      clearInterval(t);
      clearInterval(u);
    };
  });
  const minuten = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - jetzt) / 60000));
</script>

<ModulRahmen modulId="mobilitaet">
  {#if !tafeln}
    <div class="laedt" style="height:240px"></div>
  {:else}
    <div class="raster-2">
      {#each tafeln as t (t.haltestelle)}
        <section class="panel">
          <h2>{t.tafel?.haltestelle ?? t.haltestelle}</h2>
          {#if !t.tafel}<div class="hinweis ausfall">{t.fehler ?? 'Keine Daten'}</div>{:else}
            <ul class="liste">
              {#each t.tafel.abfahrten.filter((a) => new Date(a.zeit).getTime() > jetzt - 60000) as a (a.zeit + a.linie)}
                <li class="abfahrt">
                  <span class="linie art-{a.art}">{a.linie}</span>
                  <span class="wachsen">{a.ziel}{#if a.gleis}<span class="gedaempft sehr-klein"> Gleis {a.gleis}</span>{/if}</span>
                  <span class="zahl">{zeit(a.zeit)}</span>
                  {#if a.verspaetungMin}<span class="marke warnung">+{a.verspaetungMin}</span>{/if}
                  <span class="zahl minuten">{minuten(a.zeit)}′</span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
    <p class="sehr-klein gedaempft">Fahrplan und Echtzeit: transport.opendata.ch (opentransportdata.swiss). Haltestellen in der Einrichtung ändern.</p>
  {/if}
</ModulRahmen>

<style>
  .abfahrt {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .linie {
    min-width: 54px;
    text-align: center;
    font-weight: 600;
    font-size: 0.8rem;
    padding: 2px 6px;
    border-radius: 6px;
    background: #1f2a38;
  }
  .art-IR,
  .art-IC,
  .art-EC {
    background: #b91c1c;
  }
  .art-S {
    background: #1d4ed8;
  }
  .art-B {
    background: #a16207;
  }
  .minuten {
    width: 40px;
    text-align: right;
    color: var(--akzent);
  }
</style>
