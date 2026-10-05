<script lang="ts">
  import GegnerCheck from '../komponenten/GegnerCheck.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api } from '../lib/api.ts';
  import { datum, zeit } from '../lib/format.ts';

  interface Spiel { id: string; zeit: string | null; heim: string; gast: string; resultat: string | null; zusatz: string | null; ort: string | null }
  interface Team {
    team: { id: string; name: string };
    titel: string;
    spiele: Spiel[];
    rangliste: { titel: string; zeilen: { rang: number; team: string; spiele: number | null; punkte: number | null; tore: string | null; hervorgehoben: boolean }[] } | null;
    naechstes: Spiel | null;
    letztes: Spiel | null;
    demo: boolean;
    fehler?: string;
  }

  let tab = $state('Teams');
  let teams = $state<Team[] | null>(null);
  let alle = $state<Record<string, boolean>>({});

  $effect(() => {
    if (tab === 'Teams') api.get<Team[]>('/api/m/unihockey/uebersicht').then((t) => (teams = t));
  });

  const kurzName = (n: string) => n.replace(/\s*\(.*\)$/, '');
</script>

<ModulRahmen modulId="unihockey" tabs={['Teams', 'Einstellungen']} bind:tab>
  {#if tab === 'Teams'}
    {#if !teams}
      <div class="laedt" style="height:300px"></div>
    {:else}
      {#each teams as t (t.team.id)}
        <section class="team">
          <h2>{kurzName(t.team.name)}</h2>
          <p class="sehr-klein gedaempft">{t.titel}</p>
          {#if t.fehler}<div class="hinweis ausfall klein">{t.fehler}</div>{/if}
          <div class="raster-2">
            <div class="panel">
              <div class="raster-2 innen">
                <div>
                  <h3>Nächstes Spiel</h3>
                  {#if t.naechstes?.zeit}
                    <div class="zahl gross">{datum(t.naechstes.zeit)} {zeit(t.naechstes.zeit)}</div>
                    <div>{t.naechstes.heim} : {t.naechstes.gast}</div>
                    <div class="sehr-klein gedaempft">{t.naechstes.ort ?? ''}</div>
                  {:else}<p class="leer">Kein Spiel geplant.</p>{/if}
                </div>
                <div>
                  <h3>Letztes Resultat</h3>
                  {#if t.letztes}
                    <div class="zahl gross">{t.letztes.resultat}{#if t.letztes.zusatz}<span class="klein gedaempft"> {t.letztes.zusatz}</span>{/if}</div>
                    <div>{t.letztes.heim} : {t.letztes.gast}</div>
                    <div class="sehr-klein gedaempft">{t.letztes.zeit ? datum(t.letztes.zeit) : ''}</div>
                  {:else}<p class="leer">Noch kein Resultat.</p>{/if}
                </div>
              </div>
              <h3 style="margin-top:12px">Spielplan</h3>
              <ul class="liste">
                {#each (alle[t.team.id] ? t.spiele : t.spiele.filter((s) => !s.zeit || new Date(s.zeit).getTime() > Date.now() - 21 * 86400000).slice(0, 8)) as s (s.id)}
                  <li class="spiel">
                    <span class="sehr-klein gedaempft datum">{s.zeit ? `${datum(s.zeit)} ${zeit(s.zeit)}` : ''}</span>
                    <span class="wachsen klein">{s.heim} : {s.gast}</span>
                    <strong class="zahl">{s.resultat ?? '–'}</strong>
                  </li>
                {/each}
              </ul>
              <button class="leise klein" onclick={() => (alle[t.team.id] = !alle[t.team.id])}>{alle[t.team.id] ? 'Weniger' : `Alle ${t.spiele.length} Spiele`}</button>
            </div>
            <div class="panel">
              <h3>Rangliste</h3>
              {#if t.rangliste}
                <table>
                  <thead><tr><th>Rg</th><th>Team</th><th>Sp</th><th>Tore</th><th>P</th></tr></thead>
                  <tbody>
                    {#each t.rangliste.zeilen as z (z.team)}
                      <tr class:eigenes={z.hervorgehoben}><td>{z.rang}</td><td>{z.team}</td><td>{z.spiele ?? ''}</td><td>{z.tore ?? ''}</td><td class="zahl">{z.punkte ?? ''}</td></tr>
                    {/each}
                  </tbody>
                </table>
              {:else}<p class="leer">Keine Rangliste.</p>{/if}
            </div>
          </div>
          {#if t.naechstes}<div class="gegner"><GegnerCheck teamId={t.team.id} /></div>{/if}
        </section>
      {/each}
      <p class="sehr-klein gedaempft">Daten: swiss unihockey (öffentliche API v2).</p>
    {/if}
  {:else}
    <p class="klein gedaempft">Team ID: auf swissunihockey.ch das Team öffnen, die Zahl in der Adresse ist die ID. Saison leer lassen für die aktuelle Saison.</p>
    <div class="panel"><TabellenEditor tabelle="teams" spalten={['name', 'team_id', 'saison', 'favorit', 'push_spielende']} neuText="Team" /></div>
  {/if}
</ModulRahmen>

<style>
  .team {
    margin-bottom: 22px;
  }
  .team h2 {
    margin-bottom: 0;
  }
  .gross {
    font-size: 1.5rem;
  }
  .gegner {
    margin-top: 14px;
  }
  .innen {
    gap: 16px;
  }
  .spiel {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 5px 0;
  }
  .datum {
    width: 110px;
    flex: none;
  }
  tr.eigenes td {
    background: #4cc9f01a;
    color: var(--text);
    font-weight: 600;
  }
</style>
