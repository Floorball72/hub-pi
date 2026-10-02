<script lang="ts">
  import Balken from '../../komponenten/Balken.svelte';
  import TabellenEditor from '../../komponenten/TabellenEditor.svelte';
  import { api } from '../../lib/api.ts';
  import { datum } from '../../lib/format.ts';

  let { ansicht }: { ansicht: 'Logbuch' | 'Akkus und Wartung' | 'Dokumente' } = $props();

  interface Extras {
    statistik: { anzahl: number; minutenTotal: number; anzahlJahr: number; minutenJahr: number; proMonat: number[]; letzterFlug: string | null };
    akkus: { id: string; name: string; zyklen: number; zyklen_max: number | null; anteil: number | null; status: string }[];
    fristen: { titel: string; datum: string; art: string }[];
  }
  let x = $state<Extras | null>(null);
  $effect(() => {
    void ansicht;
    api.get<Extras>('/api/m/drohne/extras').then((d) => (x = d));
  });
  const tageBis = (d: string) => Math.floor((new Date(`${d}T12:00:00Z`).getTime() - Date.now()) / 86400000);
</script>

{#if ansicht === 'Logbuch'}
  {#if x}
    <div class="raster werte">
      <div class="panel"><h3>Flüge total</h3><div class="zahl gross">{x.statistik.anzahl}</div><div class="klein gedaempft">{Math.round(x.statistik.minutenTotal / 60)} Stunden</div></div>
      <div class="panel"><h3>Dieses Jahr</h3><div class="zahl gross">{x.statistik.anzahlJahr}</div><div class="klein gedaempft">{x.statistik.minutenJahr} Minuten</div></div>
      <div class="panel"><h3>Letzter Flug</h3><div class="zahl gross">{x.statistik.letzterFlug ? datum(x.statistik.letzterFlug) : '–'}</div></div>
    </div>
    <div class="panel" style="margin-bottom:12px"><Balken titel="Flugminuten pro Monat (dieses Jahr)" werte={x.statistik.proMonat} beschriftung={['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']} einheit="min" /></div>
  {/if}
  <div class="panel"><TabellenEditor tabelle="drohnen_fluege" sort="-datum" spalten={['datum', 'dauer_min', 'ort_id', 'akku_id', 'kategorie', 'zweck']} neuText="Flug" /></div>
{:else if ansicht === 'Akkus und Wartung'}
  {#if x?.akkus.length}
    <div class="raster akkus">
      {#each x.akkus as a (a.id)}
        <div class="panel">
          <div class="zeile-zwischen"><strong>{a.name}</strong><span class="marke">{a.status}</span></div>
          <div class="zahl gross">{a.zyklen}<span class="klein gedaempft"> / {a.zyklen_max ?? '?'} Zyklen</span></div>
          {#if a.anteil !== null}<div class="balken"><span class:warn={a.anteil >= 90} style="width:{Math.min(100, a.anteil)}%"></span></div>{/if}
        </div>
      {/each}
    </div>
  {/if}
  <p class="sehr-klein gedaempft">Zyklen = Startwert plus Flüge im Logbuch mit diesem Akku. Push ab dem eingestellten Anteil (Alarmzentrale).</p>
  <div class="panel" style="margin-bottom:12px"><TabellenEditor tabelle="akkus" sort="name" spalten={['name', 'drohne', 'zyklen_start', 'zyklen_max', 'status']} titel="Akkus" neuText="Akku" /></div>
  <div class="panel"><TabellenEditor tabelle="wartung" sort="-datum" spalten={['datum', 'gegenstand', 'arbeit', 'naechste']} titel="Wartungslog" neuText="Wartung" /></div>
{:else}
  {#if x?.fristen.length}
    <div class="panel" style="margin-bottom:12px">
      <h3>Bald fällig (120 Tage)</h3>
      {#each x.fristen as f (f.titel + f.datum)}
        <div class="zeile-zwischen klein frist"><span>{f.titel} <span class="gedaempft">({f.art})</span></span><span class="marke {tageBis(f.datum) < 30 ? 'warnung' : ''}">{datum(f.datum, true)} · {tageBis(f.datum)} Tage</span></div>
      {/each}
    </div>
  {/if}
  <div class="panel"><TabellenEditor tabelle="drohnen_dokumente" sort="ablauf" spalten={['titel', 'art', 'ablauf']} neuText="Dokument" /></div>
  <p class="sehr-klein gedaempft">Nur Daten zu Fristen speichern, keine Ausweisscans. Erinnerung per Push ab der Schwelle in der Alarmzentrale (Standard 30 Tage).</p>
{/if}

<style>
  .werte,
  .akkus {
    margin-bottom: 12px;
  }
  .gross {
    font-size: 1.8rem;
  }
  .balken {
    height: 6px;
    border-radius: 3px;
    background: #1b2531;
    overflow: hidden;
    margin-top: 6px;
  }
  .balken span {
    display: block;
    height: 100%;
    background: var(--ok);
  }
  .balken span.warn {
    background: var(--warnung);
  }
  .frist {
    padding: 5px 0;
  }
</style>
