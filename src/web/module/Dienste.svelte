<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api } from '../lib/api.ts';
  import { datumZeit, relativ } from '../lib/format.ts';

  type Stufe = 'ok' | 'wartung' | 'gering' | 'stoerung' | 'ausfall' | 'unbekannt';
  interface Eintrag {
    dienst: { id: string; name: string; url: string; hostet_seiten: boolean };
    stufe: Stufe;
    text: string;
    vorfaelle: { name: string; status: string; wirkung: string; link: string | null; seit: string | null }[];
    fehler?: string;
    demo: boolean;
    stand: string | null;
  }
  interface Antwort {
    dienste: Eintrag[];
    zusammenhang: { ausfaelle: { name: string; start: string }[]; dienste: string[] } | null;
    verlauf: { id: string; dienst_id: string; stufe: Stufe; text: string; erstellt: string }[];
  }
  const LABEL: Record<Stufe, string> = { ok: 'Normal', wartung: 'Wartung', gering: 'Teilweise gestört', stoerung: 'Störung', ausfall: 'Ausfall', unbekannt: 'Unbekannt' };
  const ampel = (s: Stufe) => (s === 'ok' ? 'ok' : s === 'ausfall' || s === 'stoerung' ? 'ausfall' : s === 'unbekannt' ? '' : 'warnung');

  let tab = $state('Übersicht');
  let d = $state<Antwort | null>(null);
  $effect(() => {
    if (tab !== 'Übersicht') return;
    const laden = () => api.get<Antwort>('/api/m/dienste/uebersicht').then((x) => (d = x));
    laden();
    const t = setInterval(laden, 120000);
    return () => clearInterval(t);
  });
  const name = (id: string) => d?.dienste.find((x) => x.dienst.id === id)?.dienst.name ?? 'Dienst';
  const statusseite = (u: string) => u.replace(/\/v1\/health$/, '');
</script>

<ModulRahmen modulId="dienste" tabs={['Übersicht', 'Dienste verwalten']} bind:tab>
  {#if tab === 'Übersicht'}
    {#if !d}
      <div class="laedt" style="height:260px"></div>
    {:else}
      {#if d.zusammenhang}
        <div class="hinweis warnung" style="margin-bottom:12px">
          Möglicher Zusammenhang: {d.zusammenhang.dienste.join(', ')} meldet eine Störung, während der Webseiten Wächter Ausfälle sieht
          ({d.zusammenhang.ausfaelle.map((a) => a.name).join(', ')}). <a href="/modul/scont">Zum Webseiten Wächter</a>
        </div>
      {/if}
      <div class="raster">
        {#each d.dienste as e (e.dienst.id)}
          <div class="panel dienst">
            <div class="zeile-zwischen">
              <strong>{e.dienst.name}</strong>
              <span class="marke {ampel(e.stufe)}"><span class="punkt {ampel(e.stufe)}"></span>{LABEL[e.stufe]}</span>
            </div>
            <div class="klein gedaempft">{e.text}</div>
            {#each e.vorfaelle as v (v.name)}
              <div class="vorfall klein">
                {#if v.link}<a href={v.link} target="_blank" rel="noopener noreferrer">{v.name}</a>{:else}{v.name}{/if}
                <div class="sehr-klein gedaempft">{v.status}{v.seit ? ` · seit ${relativ(v.seit).replace('vor ', '')}` : ''}</div>
              </div>
            {/each}
            {#if e.fehler}<div class="sehr-klein" style="color:var(--ausfall)">{e.fehler}</div>{/if}
            <div class="zeile-zwischen sehr-klein gedaempft">
              <span>{e.stand ? `Stand ${relativ(e.stand)}` : ''}{e.dienst.hostet_seiten ? ' · hostet Kundenseiten' : ''}</span>
              <a href={statusseite(e.dienst.url)} target="_blank" rel="noopener noreferrer">Statusseite</a>
            </div>
          </div>
        {/each}
      </div>
      <div class="panel" style="margin-top:12px">
        <h3>Verlauf</h3>
        <ul class="liste">
          {#each d.verlauf as v (v.id)}
            <li class="zeile"><span class="punkt {ampel(v.stufe)}"></span><span class="wachsen">{name(v.dienst_id)}: {v.text}</span><span class="sehr-klein gedaempft">{datumZeit(v.erstellt)}</span></li>
          {:else}<li class="leer">Noch keine Wechsel erfasst.</li>{/each}
        </ul>
      </div>
    {/if}
  {:else}
    <p class="klein gedaempft">Weitere Dienste mit Atlassian Statuspage: Adresse der Statusseite eintragen (z.B. https://www.githubstatus.com), der Hub liest <code>/api/v2/status.json</code>. Für einfache Prüfungen «Health JSON» mit einer Adresse, die <code>{'{"healthy":true}'}</code> liefert.</p>
    <div class="panel"><TabellenEditor tabelle="dienste" spalten={['name', 'art', 'url', 'push', 'hostet_seiten']} neuText="Dienst" /></div>
  {/if}
</ModulRahmen>

<style>
  .dienst {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .vorfall {
    background: color-mix(in srgb, var(--warnung) 10%, transparent);
    border-radius: 6px;
    padding: 6px 8px;
  }
</style>
