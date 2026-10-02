<script lang="ts">
  import { himmelsrichtung, wetterText } from '../../server/geteilt/wetter.ts';
  import Linie from '../komponenten/Linie.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import WetterIcon from '../komponenten/WetterIcon.svelte';
  import { api } from '../lib/api.ts';
  import { zeit } from '../lib/format.ts';

  interface Stunde { t: number; temp: number | null; regen: number | null; regenWahrsch: number | null; code: number | null; tag: boolean }
  interface Tag { datum: string; code: number | null; tmax: number | null; tmin: number | null; regen: number | null; regenWahrsch: number | null; sonnenaufgang: number | null; sonnenuntergang: number | null; boeenMax: number | null }
  interface V { aktuell: { temp: number | null; gefuehlt: number | null; code: number | null; wind: number | null; boeen: number | null; richtung: number | null; feuchte: number | null; tag: boolean } | null; stunden: Stunde[]; tage: Tag[] }
  interface Ort { ort: { name: string; lat: number; lon: number }; vorhersage: V | null; demo: boolean; fehler?: string; stand: string | null }
  interface Sonne { zeiten: { aufgang: string | null; untergang: string | null; goldAbend: [string | null, string | null]; goldMorgen: [string | null, string | null] }; mond: { beleuchtet: number; name: string } }

  let daten = $state<{ orte: Ort[]; kp: { aktuell: number | null; maxPrognose: number | null } | null } | null>(null);
  let sonne = $state<Sonne | null>(null);

  $effect(() => {
    api.get<typeof daten>('/api/m/wetter/orte').then(async (d) => {
      daten = d;
      const o = d?.orte[0]?.ort;
      if (o) sonne = await api.get<Sonne>(`/api/m/wetter/sonne?lat=${o.lat}&lon=${o.lon}`);
    });
  });

  const wochentag = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-CH', { weekday: 'short' });
</script>

<ModulRahmen modulId="wetter">
  {#if !daten}
    <div class="laedt" style="height:300px"></div>
  {:else}
    <div class="raster oben">
      {#if sonne}
        <div class="panel">
          <h3>Sonne heute ({daten.orte[0]?.ort.name})</h3>
          <div class="zeile-zwischen"><span>Aufgang</span><strong class="zahl">{zeit(sonne.zeiten.aufgang)}</strong></div>
          <div class="zeile-zwischen"><span>Untergang</span><strong class="zahl">{zeit(sonne.zeiten.untergang)}</strong></div>
          <div class="zeile-zwischen gedaempft klein"><span>Goldene Stunde abends</span><span>{zeit(sonne.zeiten.goldAbend[0])} bis {zeit(sonne.zeiten.goldAbend[1])}</span></div>
          <div class="zeile-zwischen gedaempft klein"><span>Mond</span><span>{sonne.mond.name}, {Math.round(sonne.mond.beleuchtet * 100)} %</span></div>
        </div>
      {/if}
      {#if daten.kp}
        <div class="panel">
          <h3>KP Index</h3>
          <div class="zahl gross">{daten.kp.aktuell ?? '–'}</div>
          <div class="klein gedaempft">Maximum Prognose 48 h: {daten.kp.maxPrognose ?? '–'}. Ab etwa 5 sind GPS Störungen und Polarlichter möglich.</div>
        </div>
      {/if}
    </div>

    {#each daten.orte as o (o.ort.name)}
      <section class="panel ort">
        {#if !o.vorhersage?.aktuell}
          <h2>{o.ort.name}</h2>
          <div class="hinweis ausfall">{o.fehler ?? 'Keine Daten'}</div>
        {:else}
          {@const a = o.vorhersage.aktuell}
          <div class="kopf">
            <div>
              <h2>{o.ort.name}</h2>
              <div class="zeile jetzt">
                <WetterIcon code={a.code} tag={a.tag} groesse={56} />
                <span class="zahl temp">{Math.round(a.temp ?? 0)}°</span>
                <div class="klein">
                  <div>{wetterText(a.code)}</div>
                  <div class="gedaempft">gefühlt {Math.round(a.gefuehlt ?? 0)}° · Wind {a.wind ?? '–'} km/h {himmelsrichtung(a.richtung)} · Böen {a.boeen ?? '–'} · Feuchte {a.feuchte ?? '–'} %</div>
                </div>
              </div>
            </div>
            {#if o.demo}<span class="marke demo">Demo</span>{/if}
          </div>
          <div class="tage">
            {#each o.vorhersage.tage as t, i (t.datum)}
              <div class="tag">
                <div class="klein gedaempft">{i === 0 ? 'Heute' : wochentag(t.datum)}</div>
                <WetterIcon code={t.code} groesse={34} />
                <div class="zahl">{Math.round(t.tmax ?? 0)}°<span class="gedaempft"> {Math.round(t.tmin ?? 0)}°</span></div>
                <div class="sehr-klein regen">{t.regenWahrsch ?? 0} %</div>
              </div>
            {/each}
          </div>
          <Linie
            titel="Temperatur nächste 48 Stunden"
            einheit="°C"
            hoehe={120}
            min={Math.floor(Math.min(...o.vorhersage.stunden.slice(0, 48).map((s) => s.temp ?? 0)) - 1)}
            punkte={o.vorhersage.stunden.filter((s) => s.t >= Date.now() - 3600000).slice(0, 48).map((s) => ({ t: s.t, v: s.temp }))}
          />
        {/if}
      </section>
    {/each}
    <p class="sehr-klein gedaempft">Wetterdaten: Open-Meteo.com (CC BY 4.0). KP Index: NOAA SWPC.</p>
  {/if}
</ModulRahmen>

<style>
  .oben {
    margin-bottom: 12px;
  }
  .gross {
    font-size: 2.4rem;
  }
  .ort {
    margin-bottom: 12px;
  }
  .kopf {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .jetzt {
    gap: 14px;
  }
  .temp {
    font-size: 3.4rem;
    line-height: 1;
  }
  .tage {
    display: grid;
    grid-template-columns: repeat(7, minmax(60px, 1fr));
    gap: 6px;
    margin: 14px 0;
    overflow-x: auto;
  }
  .tag {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 8px 0;
    border-radius: 10px;
    background: var(--flaeche-3);
  }
  .regen {
    color: var(--akzent);
  }
</style>
