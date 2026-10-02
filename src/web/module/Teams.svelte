<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api } from '../lib/api.ts';
  import { datum, zeit } from '../lib/format.ts';

  interface Spiel { id: string; zeit: string | null; heim: string; gast: string; toreHeim: number | null; toreGast: number | null; beendet: boolean; wettbewerb: string | null; ort: string | null }
  interface Eintrag {
    team: { id: string; name: string; sport: string | null; quelle: string };
    spiele: Spiel[];
    tabelle: { rang: number; team: string; spiele: number | null; punkte: number | null; tore: string | null; eigenes: boolean }[];
    hinweis: string | null;
    naechstes: Spiel | null;
    letztes: Spiel | null;
    demo: boolean;
    fehler?: string;
  }
  let tab = $state('Teams');
  let liste = $state<Eintrag[] | null>(null);
  $effect(() => {
    if (tab === 'Teams') api.get<Eintrag[]>('/api/m/teams/uebersicht').then((l) => (liste = l));
  });
  const res = (s: Spiel) => (s.toreHeim !== null && s.toreGast !== null ? `${s.toreHeim}:${s.toreGast}` : '–');
</script>

<ModulRahmen modulId="teams" tabs={['Teams', 'Einstellungen']} bind:tab>
  {#if tab === 'Teams'}
    {#if !liste}
      <div class="laedt" style="height:260px"></div>
    {:else}
      {#each liste as e (e.team.id)}
        <section style="margin-bottom:20px">
          <h2 style="margin-bottom:0">{e.team.name}</h2>
          <p class="sehr-klein gedaempft">{e.team.sport ?? ''} · Quelle {e.team.quelle}{e.demo ? ' · Demo' : ''}</p>
          {#if e.fehler}<div class="hinweis ausfall klein">{e.fehler}</div>{/if}
          {#if e.hinweis}<div class="hinweis klein" style="margin-bottom:10px">{e.hinweis}</div>{/if}
          <div class="raster-2">
            <div class="panel">
              <div class="raster-2" style="gap:16px">
                <div>
                  <h3>Nächstes Spiel</h3>
                  {#if e.naechstes}
                    <div class="zahl gross">{datum(e.naechstes.zeit)} {zeit(e.naechstes.zeit)}</div>
                    <div>{e.naechstes.heim} : {e.naechstes.gast}</div>
                    <div class="sehr-klein gedaempft">{[e.naechstes.wettbewerb, e.naechstes.ort].filter(Boolean).join(' · ')}</div>
                  {:else}<p class="leer">Kein Spiel bekannt.</p>{/if}
                </div>
                <div>
                  <h3>Letztes Resultat</h3>
                  {#if e.letztes}
                    <div class="zahl gross">{res(e.letztes)}</div>
                    <div>{e.letztes.heim} : {e.letztes.gast}</div>
                    <div class="sehr-klein gedaempft">{datum(e.letztes.zeit)}{e.letztes.wettbewerb ? ` · ${e.letztes.wettbewerb}` : ''}</div>
                  {:else}<p class="leer">Kein Resultat bekannt.</p>{/if}
                </div>
              </div>
            </div>
            <div class="panel">
              <h3>Tabelle</h3>
              {#if e.tabelle.length}
                <div class="tabelle-scroll">
                  <table>
                    <thead><tr><th>Rg</th><th>Team</th><th>Sp</th><th>Tore</th><th>P</th></tr></thead>
                    <tbody>
                      {#each e.tabelle as z (z.team)}
                        <tr class:eigenes={z.eigenes}><td>{z.rang}</td><td>{z.team}</td><td>{z.spiele ?? ''}</td><td>{z.tore ?? ''}</td><td class="zahl">{z.punkte ?? ''}</td></tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else}<p class="leer">Keine Tabelle verfügbar.</p>{/if}
            </div>
          </div>
        </section>
      {/each}
      <p class="sehr-klein gedaempft">Daten: TheSportsDB.com (freie Nutzung mit Namensnennung) und OpenLigaDB (Community). Bei Spielen fragt der Hub alle 10 Minuten nach, sonst alle 30 Minuten aus dem Zwischenspeicher.</p>
    {/if}
  {:else}
    <p class="klein gedaempft">TheSportsDB: Team ID aus der Adresse auf thesportsdb.com (FC St. Gallen 134406), Liga ID für die Tabelle (Super League 4675). OpenLigaDB: Teamname, Liga Kürzel (z.B. ch1) und Saisonjahr. Gibt es keine Quelle mit erlaubter Nutzung, «keine» wählen: das Team erscheint dann mit diesem Hinweis.</p>
    <div class="panel"><TabellenEditor tabelle="sport_teams" spalten={['name', 'sport', 'quelle', 'team_id', 'liga', 'push_spielende']} neuText="Team" /></div>
  {/if}
</ModulRahmen>

<style>
  .gross {
    font-size: 1.5rem;
  }
  tr.eigenes td {
    background: #4cc9f01a;
    color: var(--text);
    font-weight: 600;
  }
</style>
