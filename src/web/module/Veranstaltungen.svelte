<script lang="ts">
  import Icon from '../komponenten/Icon.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { datum, zeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { navigieren } from '../lib/router.svelte.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';

  interface Anlass { id: string; titel: string; start: string; ende: string | null; ort: string | null; link: string | null; kategorie: string | null; distanzKm: number | null; treffer: string[] }
  interface Antwort { anlaesse: Anlass[]; kategorien: string[]; stichworte: string[]; heim: string }

  let tab = $state('Anlässe');
  let d = $state<Antwort | null>(null);
  let filter = $state(lesen('veranstaltungen.filter', { kategorie: '', maxKm: 50, tage: 30, nurTreffer: false }));
  let stichwortText = $state('');

  async function laden() {
    d = await api.get<Antwort>('/api/m/veranstaltungen/liste');
    stichwortText = d.stichworte.join(', ');
  }
  $effect(() => {
    if (tab === 'Anlässe') laden();
  });
  $effect(() => schreiben('veranstaltungen.filter', $state.snapshot(filter)));

  const gefiltert = $derived(
    (d?.anlaesse ?? []).filter(
      (a) =>
        (!filter.kategorie || a.kategorie === filter.kategorie) &&
        (a.distanzKm === null || a.distanzKm <= filter.maxKm) &&
        new Date(a.start).getTime() < Date.now() + filter.tage * 86400000 &&
        (!filter.nurTreffer || a.treffer.length > 0),
    ),
  );

  function uebernehmen(a: Anlass) {
    const p = new URLSearchParams({ neu: '1', titel: a.titel, start: a.start, ort: a.ort ?? '', link: a.link ?? '' });
    navigieren(`/modul/events?${p}`);
  }
  async function stichworteSpeichern() {
    try {
      await api.put('/api/m/veranstaltungen/stichworte', { stichworte: stichwortText.split(',').map((s) => s.trim()).filter(Boolean) });
      melden('Stichworte gespeichert');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function jetztAbrufen() {
    try {
      const r = await api.post<{ ergebnis?: string }>('/api/m/veranstaltungen/aktualisieren');
      melden(r.ergebnis ?? 'Im Demo Modus wird nichts abgerufen');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
</script>

<ModulRahmen modulId="veranstaltungen" tabs={['Anlässe', 'Quellen']} bind:tab>
  {#if tab === 'Anlässe'}
    <div class="panel filter">
      <div class="feld"><label for="vk">Kategorie</label><select id="vk" bind:value={filter.kategorie}><option value="">Alle</option>{#each d?.kategorien ?? [] as k (k)}<option>{k}</option>{/each}</select></div>
      <div class="feld"><label for="vd">Höchstens {filter.maxKm} km ab {d?.heim ?? 'Wohnort'}</label><input id="vd" type="range" min="5" max="150" step="5" bind:value={filter.maxKm} /></div>
      <div class="feld"><label for="vt">Nächste {filter.tage} Tage</label><input id="vt" type="range" min="1" max="120" bind:value={filter.tage} /></div>
      <label class="zeile klein"><input type="checkbox" bind:checked={filter.nurTreffer} />Nur mit Stichwort</label>
    </div>
    {#if !d}
      <div class="laedt" style="height:260px;margin-top:12px"></div>
    {:else}
      <ul class="liste panel" style="margin-top:12px">
        {#each gefiltert as a (a.id)}
          <li class="anlass" class:markiert={a.treffer.length}>
            <div class="datum"><span class="zahl">{new Date(a.start).toLocaleDateString('de-CH', { day: 'numeric', timeZone: 'Europe/Zurich' })}</span><span class="sehr-klein">{new Date(a.start).toLocaleDateString('de-CH', { month: 'short', timeZone: 'Europe/Zurich' })}</span></div>
            <div class="wachsen">
              <div><strong>{a.titel}</strong></div>
              <div class="sehr-klein gedaempft">{datum(a.start)} {zeit(a.start)}{a.ort ? ` · ${a.ort}` : ''}{a.distanzKm !== null ? ` · ${a.distanzKm} km` : ''}</div>
              <div class="zeile" style="margin-top:4px"><span class="marke">{a.kategorie ?? 'Allgemein'}</span>{#each a.treffer as t (t)}<span class="marke warnung">{t}</span>{/each}{#if a.link}<a class="sehr-klein" href={a.link} target="_blank" rel="noopener noreferrer">Quelle</a>{/if}</div>
            </div>
            <button class="klein" onclick={() => uebernehmen(a)} title="In die Event Zentrale übernehmen"><Icon name="plus" groesse={14} />Event</button>
          </li>
        {:else}
          <li class="leer">Keine Anlässe für diese Filter.{#if !d.anlaesse.length} Unter «Quellen» einen Kalender erfassen.{/if}</li>
        {/each}
      </ul>
      <div class="panel" style="margin-top:12px">
        <label for="vs">Stichworte zum Hervorheben (mit Komma getrennt)</label>
        <div class="zeile"><input id="vs" class="wachsen" style="width:auto" bind:value={stichwortText} /><button onclick={stichworteSpeichern}>Speichern</button></div>
      </div>
    {/if}
  {:else}
    <div class="hinweis warnung" style="margin-bottom:12px">Es gibt keine offene Schnittstelle für Anlässe in St. Gallen, deren Nutzung ausdrücklich erlaubt ist. Erfasse nur Quellen, die einen iCal oder RSS Export anbieten und deren Nutzungsbedingungen den Abruf erlauben (z.B. der Kalender eines Vereins oder Veranstalters). Abgerufen wird erst, wenn das Häkchen «Nutzungsbedingungen geprüft» gesetzt ist. robots.txt wird beachtet, Abruf alle 6 Stunden.</div>
    <div class="panel"><TabellenEditor tabelle="veranstaltung_quellen" spalten={['name', 'art', 'kategorie', 'nutzung_geprueft', 'aktiv']} neuText="Quelle" /></div>
    <button style="margin-top:12px" onclick={jetztAbrufen}>Jetzt abrufen</button>
  {/if}
</ModulRahmen>

<style>
  .filter {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
    align-items: end;
  }
  .filter .feld + .feld {
    margin-top: 0;
  }
  .anlass {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .anlass.markiert {
    background: linear-gradient(90deg, #fbbf2412, transparent);
  }
  .datum {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 44px;
    flex: none;
  }
  .datum .zahl {
    font-size: 1.3rem;
  }
</style>
