<script lang="ts">
  import Karte from '../komponenten/Karte.svelte';
  import Linie from '../komponenten/Linie.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import { api } from '../lib/api.ts';
  import { relativ } from '../lib/format.ts';

  interface Parkhaus { id: string; name: string; offen: boolean; total: number | null; frei: number | null; prozent: number | null; lat: number | null; lon: number | null }
  interface Liste { parkhaeuser: Parkhaus[]; stand: string | null; demo: boolean; fehler?: string; namensnennung: string }
  interface Detail { verlauf: { zeit: string; prozent: number | null }[]; typisch: (number | null)[][]; tageMitDaten: number }

  const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  let tab = $state('Übersicht');
  let d = $state<Liste | null>(null);
  let gewaehlt = $state<Parkhaus | null>(null);
  let detail = $state<Detail | null>(null);
  let karte = $state<{ fliegen: (lat: number, lon: number, zoom?: number) => void } | null>(null);

  async function laden() {
    d = await api.get<Liste>('/api/m/parken/liste');
  }
  $effect(() => {
    laden();
    const t = setInterval(laden, 120000);
    return () => clearInterval(t);
  });
  async function waehlen(p: Parkhaus) {
    gewaehlt = p;
    detail = null;
    if (p.lat !== null && p.lon !== null) karte?.fliegen(p.lat, p.lon, 16);
    detail = await api.get<Detail>(`/api/m/parken/parkhaus/${encodeURIComponent(p.id)}`);
  }
  const klasse = (p: Parkhaus) => (!p.offen || p.prozent === null ? '' : p.prozent >= 95 ? 'ausfall' : p.prozent >= 80 ? 'warnung' : 'ok');
  // Sequentielle Skala in einem Farbton (hell = frei, dunkel = voll)
  const zellFarbe = (v: number | null) => (v === null ? 'transparent' : `color-mix(in oklab, #38bdf8 ${Math.round(12 + v * 0.83)}%, #0b1118)`);
</script>

<ModulRahmen modulId="parken" tabs={['Übersicht']} bind:tab>
  <div class="aufteilung">
    <div class="panel">
      <div class="zeile-zwischen">
        <h3>Parkhäuser St. Gallen</h3>
        <span class="sehr-klein gedaempft">{d?.stand ? `Stand ${relativ(d.stand)}` : ''}{#if d?.demo}<span class="marke demo" style="margin-left:6px">Demo</span>{/if}</span>
      </div>
      {#if d?.fehler}<div class="hinweis ausfall klein">{d.fehler}</div>{/if}
      {#if !d}
        <div class="laedt" style="height:300px"></div>
      {:else}
        <ul class="liste">
          {#each d.parkhaeuser as p (p.id)}
            <li>
              <button class="ph" class:aktiv={gewaehlt?.id === p.id} onclick={() => waehlen(p)}>
                <span class="wachsen name">{p.name}</span>
                {#if p.offen}
                  <span class="zahl frei">{p.frei ?? '–'} <span class="sehr-klein gedaempft"> frei</span></span>
                  <span class="balken" role="img" aria-label="{p.prozent ?? '?'} Prozent belegt"><span class={klasse(p)} style="width:{p.prozent ?? 0}%"></span></span>
                  <span class="sehr-klein prozent">{p.prozent ?? '–'} %</span>
                {:else}
                  <span class="marke">geschlossen</span>
                {/if}
              </button>
            </li>
          {:else}<li class="leer">Keine Daten.</li>{/each}
        </ul>
        <p class="sehr-klein gedaempft">Daten: {d.namensnennung}. Nur für private, nicht kommerzielle Nutzung.</p>
      {/if}
    </div>
    <div>
      <Karte bind:this={karte} hoehe="min(52vh, 460px)" gruppen={['Mobilität']} zentrum={[47.4245, 9.376]} zoom={14} />
    </div>
  </div>

  {#if gewaehlt}
    <div class="raster-2" style="margin-top:12px">
      <div class="panel">
        <h3>{gewaehlt.name}: letzte 7 Tage</h3>
        {#if detail}
          {#if detail.verlauf.length}
            <Linie punkte={detail.verlauf.map((w) => ({ t: new Date(w.zeit).getTime(), v: w.prozent }))} einheit="%" min={0} max={100} hoehe={160} lueckenMs={3 * 3600000} />
          {:else}<p class="leer">Noch kein Verlauf gespeichert. Der Hub speichert alle 10 Minuten.</p>{/if}
        {:else}<div class="laedt" style="height:160px"></div>{/if}
      </div>
      <div class="panel">
        <h3>Typische Belegung</h3>
        {#if detail}
          <p class="sehr-klein gedaempft">Median der Belegung in Prozent je Wochentag und Stunde, aus {detail.tageMitDaten} Tagen.{detail.tageMitDaten < 14 ? ' Ab etwa zwei Wochen Daten aussagekräftig.' : ''}</p>
          <div class="tabelle-scroll">
            <table class="muster">
              <thead><tr><th></th>{#each Array.from({ length: 24 }, (_, h) => h) as h (h)}<th class="sehr-klein">{h % 3 === 0 ? h : ''}</th>{/each}</tr></thead>
              <tbody>
                {#each detail.typisch as zeile, i (i)}
                  <tr>
                    <th class="sehr-klein">{TAGE[i]}</th>
                    {#each zeile as v, h (h)}<td style="background:{zellFarbe(v)}" title="{TAGE[i]} {h}:00 bis {h + 1}:00: {v === null ? 'keine Daten' : `${v} % belegt`}"></td>{/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="skala sehr-klein gedaempft"><span>frei</span><span class="verlauf"></span><span>voll</span></div>
        {:else}<div class="laedt" style="height:160px"></div>{/if}
      </div>
    </div>
  {:else}
    <p class="klein gedaempft" style="margin-top:10px">Ein Parkhaus antippen für Verlauf und typische Belegung.</p>
  {/if}
</ModulRahmen>

<style>
  .aufteilung {
    display: grid;
    gap: 12px;
  }
  @media (min-width: 1000px) {
    .aufteilung {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    }
  }
  .ph {
    display: flex;
    width: 100%;
    gap: 10px;
    align-items: center;
    background: transparent;
    border-color: transparent;
    text-align: left;
    padding: 4px 6px;
  }
  .ph.aktiv {
    background: var(--flaeche-3);
    border-color: var(--rand-hell);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .frei {
    width: 74px;
    text-align: right;
  }
  .balken {
    width: 80px;
    height: 8px;
    border-radius: 4px;
    background: var(--flaeche-3);
    overflow: hidden;
    flex: none;
  }
  .balken > span {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--neutral);
  }
  .balken .ok {
    background: var(--ok);
  }
  .balken .warnung {
    background: var(--warnung);
  }
  .balken .ausfall {
    background: var(--ausfall);
  }
  .prozent {
    width: 38px;
    text-align: right;
  }
  .muster {
    border-collapse: separate;
    border-spacing: 2px;
    width: 100%;
  }
  .muster td {
    height: 16px;
    min-width: 10px;
    border-radius: 2px;
    padding: 0;
    border: none;
  }
  .muster th {
    padding: 0 4px 0 0;
    border: none;
    font-weight: 400;
    color: var(--text-3);
  }
  .skala {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
  }
  .verlauf {
    width: 120px;
    height: 8px;
    border-radius: 4px;
    background: linear-gradient(90deg, color-mix(in oklab, #38bdf8 12%, #0b1118), #38bdf8);
  }
  @media (max-width: 640px) {
    .balken {
      width: 50px;
    }
  }
</style>
