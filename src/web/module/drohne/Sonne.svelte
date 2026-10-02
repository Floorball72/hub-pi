<script lang="ts">
  import { api, fehlerText } from '../../lib/api.ts';
  import { bestaetigen } from '../../lib/bestaetigen.svelte.ts';
  import { melden } from '../../lib/meldung.svelte.ts';

  interface Faktor { name: string; label: string; wert: number; text: string }
  interface Prognose { tag: string; ereignis: 'aufgang' | 'untergang'; score: number; faktoren: Faktor[]; zeit: string; azimut: number; richtung: string }
  interface Ort { id: string; name: string; shortlist: boolean; sonnen_alarm: boolean | null }

  let orte = $state<Ort[]>([]);
  let ortId = $state('');
  let daten = $state<{ prognosen: Prognose[]; gewichte: Record<string, number> } | null>(null);
  let vergleich = $state<{ anzahl: number; mittlererFehler: number | null; korrelation: number | null; zeilen: { datum: string; ereignis: string; score: number; bewertung: number; ort_id: string }[] } | null>(null);
  let gewichte = $state<Record<string, number>>({});
  let offen = $state<string | null>(null);

  $effect(() => {
    api.get<Ort[]>('/api/daten/drohnen_orte?sort=name').then((o) => {
      orte = o;
      ortId ||= (o.find((x) => x.shortlist) ?? o[0])?.id ?? '';
    });
    api.get<typeof vergleich>('/api/m/drohne/sonne/vergleich').then((v) => (vergleich = v));
  });
  $effect(() => {
    if (!ortId) return;
    daten = null;
    api.get<{ prognosen: Prognose[]; gewichte: Record<string, number> }>(`/api/m/drohne/sonne/prognose?ort=${ortId}`).then((d) => {
      daten = d;
      gewichte = { ...d.gewichte };
    });
  });

  async function bewerten(p: Prognose, sterne: number) {
    try {
      await api.post('/api/m/drohne/sonne/bewertung', { ort_id: ortId, datum: p.tag, ereignis: p.ereignis, bewertung: sterne });
      melden('Danke, Bewertung gespeichert');
      vergleich = await api.get('/api/m/drohne/sonne/vergleich');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function gewichteSpeichern() {
    if (!(await bestaetigen('Gewichte speichern?', 'Die Prognose für alle Orte wird mit den neuen Gewichten berechnet.', 'Speichern'))) return;
    try {
      await api.put('/api/m/drohne/sonne/gewichte', gewichte);
      melden('Gewichte gespeichert');
      ortId = `${ortId}`;
      daten = await api.get(`/api/m/drohne/sonne/prognose?ort=${ortId}`);
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  const farbe = (s: number) => (s >= 75 ? 'var(--ok)' : s >= 50 ? 'var(--warnung)' : 'var(--text-3)');
  const zeitText = (iso: string) => new Date(iso).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const vorbei = (p: Prognose) => new Date(p.zeit).getTime() < Date.now();
  const LABEL: Record<string, string> = { wolken: 'Wolken', horizont: 'Horizont', tief: 'Tiefe Wolken', sicht: 'Sicht', feuchte: 'Feuchte', regen: 'Regen' };
</script>

<div class="zeile" style="margin-bottom:12px">
  <label for="so" class="klein">Ort</label>
  <select id="so" bind:value={ortId} style="width:auto">{#each orte as o (o.id)}<option value={o.id}>{o.name}{o.shortlist ? ' ★' : ''}</option>{/each}</select>
</div>

{#if !daten}
  <div class="laedt" style="height:200px"></div>
{:else}
  <div class="karten">
    {#each daten.prognosen as p (p.tag + p.ereignis)}
      <div class="panel prognose">
        <div class="zeile-zwischen">
          <span class="klein">{p.ereignis === 'aufgang' ? 'Sonnenaufgang' : 'Sonnenuntergang'}</span>
          <span class="sehr-klein gedaempft">{zeitText(p.zeit)} · {p.richtung} {p.azimut}°</span>
        </div>
        <button class="score leise" onclick={() => (offen = offen === p.tag + p.ereignis ? null : p.tag + p.ereignis)}>
          <span class="zahl" style="color:{farbe(p.score)}">{p.score}</span><span class="gedaempft klein">/ 100 · Faktoren</span>
        </button>
        {#if offen === p.tag + p.ereignis}
          {#each p.faktoren as f (f.name)}
            <div class="faktor">
              <div class="zeile-zwischen sehr-klein"><span>{f.label}</span><span class="gedaempft">{f.text}</span></div>
              <div class="balken"><span style="width:{f.wert * 100}%"></span></div>
            </div>
          {/each}
        {/if}
        {#if vorbei(p)}
          <div class="sterne">
            <span class="sehr-klein gedaempft">Wie war es wirklich?</span>
            {#each [1, 2, 3, 4, 5] as s (s)}<button class="leise klein" aria-label="{s} Sterne" onclick={() => bewerten(p, s)}>{'★'.repeat(s)}</button>{/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="raster-2" style="margin-top:12px">
    <section class="panel">
      <h2>Prognose gegen Realität</h2>
      {#if vergleich?.anzahl}
        <div class="zeile"><span class="zahl gross">{vergleich.mittlererFehler}</span><span class="klein gedaempft">Punkte mittlerer Fehler · {vergleich.anzahl} Bewertungen{vergleich.korrelation !== null ? ` · Korrelation ${vergleich.korrelation}` : ''}</span></div>
        <ul class="liste klein">
          {#each vergleich.zeilen.slice(0, 10) as z (z.datum + z.ereignis + z.ort_id)}
            <li class="zeile-zwischen"><span>{z.datum} {z.ereignis}</span><span>Prognose {z.score} · {'★'.repeat(z.bewertung)}</span></li>
          {/each}
        </ul>
      {:else}<p class="leer">Noch keine Bewertungen. Nach einem Abend hier mit Sternen bewerten.</p>{/if}
    </section>
    <section class="panel">
      <h2>Gewichte</h2>
      <p class="sehr-klein gedaempft">Formel und Bedeutung in docs/SONNENUNTERGANG.md. 0 schaltet einen Faktor aus.</p>
      <div class="gewichte">
        {#each Object.keys(gewichte) as k (k)}
          <div><label for="g-{k}">{LABEL[k] ?? k}</label><input id="g-{k}" type="number" step="0.05" min="0" max="10" bind:value={gewichte[k]} /></div>
        {/each}
      </div>
      <button class="primaer" style="margin-top:10px" onclick={gewichteSpeichern}>Gewichte speichern</button>
    </section>
  </div>
  <p class="sehr-klein gedaempft">Heuristik ohne belegte Genauigkeit. Wetterdaten Open-Meteo (CC BY 4.0). Horizont: tiefe Wolken 80 km in Richtung der Sonne.</p>
{/if}

<style>
  .karten {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
  }
  .score {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 0;
  }
  .score .zahl {
    font-size: 2.6rem;
  }
  .faktor {
    margin: 4px 0;
  }
  .balken {
    height: 5px;
    border-radius: 3px;
    background: #1b2531;
    overflow: hidden;
  }
  .balken span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #fb923c, #fbbf24);
  }
  .sterne {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin-top: 6px;
  }
  .sterne button {
    color: #fbbf24;
    padding: 2px 6px;
  }
  .gross {
    font-size: 2rem;
  }
  .gewichte {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(3, 1fr);
  }
</style>
