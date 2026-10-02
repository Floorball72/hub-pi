<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datumZeit, relativ } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Job { id: string; name: string; modul: string; fehlerInFolge: number; letzterFehler: string | null; pausiertBis: string | null; laeuft: boolean; laeuftSeit: number | null }
  interface Antwort {
    jobs: Job[];
    anzahlJobs: number;
    module: { id: string; name: string; fehler?: string }[];
    system: { rssMb: number; speicherFreiGb: number | null; speicher: string; schleifeMs: number };
    neustarts: string[];
    protokoll: { id: string; art: string; text: string; erstellt: string }[];
  }
  let tab = $state('Übersicht');
  let d = $state<Antwort | null>(null);
  async function laden() {
    d = await api.get<Antwort>('/api/m/selbstheilung/uebersicht');
  }
  $effect(() => {
    laden();
  });
  async function fortsetzen(j: Job) {
    if (!(await bestaetigen('Pause aufheben?', `Der Job «${j.name}» läuft beim nächsten Takt wieder.`, 'Fortsetzen'))) return;
    try {
      await api.post(`/api/m/selbstheilung/job/${encodeURIComponent(j.id)}/fortsetzen`, { bestaetigt: true });
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function aufraeumen() {
    const r = await api.post<{ ergebnis: string }>('/api/m/selbstheilung/aufraeumen');
    melden(r.ergebnis);
    await laden();
  }
</script>

<ModulRahmen modulId="selbstheilung" tabs={['Übersicht']} bind:tab>
  {#if !d}
    <div class="laedt" style="height:260px"></div>
  {:else}
    <div class="raster">
      <div class="panel"><div class="klein gedaempft">Jobs überwacht</div><div class="zahl gross">{d.anzahlJobs}</div><div class="sehr-klein gedaempft">{d.jobs.filter((j) => j.pausiertBis).length} pausiert, {d.jobs.filter((j) => j.fehlerInFolge).length} mit Fehlern</div></div>
      <div class="panel"><div class="klein gedaempft">Arbeitsspeicher</div><div class="zahl gross">{d.system.rssMb} MB</div><div class="sehr-klein gedaempft">Neustart ab 300 MB über 6 Minuten · Reaktionszeit {d.system.schleifeMs} ms</div></div>
      <div class="panel"><div class="klein gedaempft">Speicher frei</div><div class="zahl gross">{d.system.speicherFreiGb ?? '–'} GB</div><div class="sehr-klein gedaempft">{d.system.speicher === 'ok' ? 'genug' : d.system.speicher === 'knapp' ? 'knapp: es wird früher verdichtet' : 'kritisch'}</div></div>
      <div class="panel"><div class="klein gedaempft">Neustarts (24 h)</div><div class="zahl gross">{d.neustarts.filter((t) => Date.now() - Date.parse(t) < 86400000).length}</div><div class="sehr-klein gedaempft">{d.neustarts.length ? `zuletzt ${relativ(d.neustarts[d.neustarts.length - 1])}` : 'noch keiner'}</div></div>
    </div>

    <div class="panel" style="margin-top:12px">
      <h3>Jobs mit Auffälligkeiten</h3>
      <ul class="liste">
        {#each d.jobs as j (j.id)}
          <li class="zeile">
            <span class="punkt {j.pausiertBis ? 'warnung' : j.fehlerInFolge >= 3 ? 'ausfall' : 'warnung'}"></span>
            <span class="wachsen"><span>{j.name}</span> <span class="sehr-klein gedaempft">{j.modul} · {j.laeuft ? 'läuft' : `${j.fehlerInFolge} Fehler in Folge`}{j.letzterFehler ? ` · ${j.letzterFehler}` : ''}</span></span>
            {#if j.pausiertBis}<span class="marke warnung">Pause bis {new Date(j.pausiertBis).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}</span><button class="klein" onclick={() => fortsetzen(j)}>Fortsetzen</button>{/if}
          </li>
        {:else}<li class="leer">Alle Jobs laufen ohne Fehler.</li>{/each}
        {#each d.module as m (m.id)}<li class="zeile"><span class="punkt ausfall"></span><span class="wachsen">Modul {m.name}: {m.fehler}</span></li>{/each}
      </ul>
    </div>

    <div class="panel" style="margin-top:12px">
      <div class="zeile-zwischen"><h3 style="margin:0">Protokoll</h3><button class="klein" onclick={aufraeumen}>Jetzt aufräumen</button></div>
      <ul class="liste">
        {#each d.protokoll as p (p.id)}
          <li class="zeile"><span class="marke" class:warnung={p.art === 'warnung'}>{p.art}</span><span class="wachsen klein">{p.text}</span><span class="sehr-klein gedaempft">{datumZeit(p.erstellt)}</span></li>
        {:else}<li class="leer">Noch keine Eingriffe nötig.</li>{/each}
      </ul>
    </div>
    <p class="sehr-klein gedaempft" style="margin-top:10px">Ablauf bei Fehlern: nach 3 Fehlern in Folge wird das Modul neu geladen. Fällt der Job danach wieder aus, wird er pausiert (15 min, 1 h, 4 h, 12 h). Erst wenn das nicht hilft, kommt eine Nachricht. Hängt ein Job oder wird der Speicher zu gross, startet der Dienst neu (höchstens einmal pro Stunde, dreimal pro Tag).</p>
  {/if}
</ModulRahmen>

<style>
  .gross {
    font-size: 1.5rem;
  }
</style>
