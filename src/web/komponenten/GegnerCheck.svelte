<script lang="ts">
  import { api, fehlerText } from '../lib/api.ts';
  import { datum } from '../lib/format.ts';

  interface FormSpiel { id: string; zeit: string | null; gegner: string; resultat: string; zusatz: string | null; ausgang: 'S' | 'U' | 'N'; heim: boolean }
  interface Bilanz { spiele: number; siege: number; unentschieden: number; niederlagen: number; toreSchnitt: number | null; gegentoreSchnitt: number | null }
  interface Check {
    gegner: string | null;
    rang?: { rang: number; punkte: number | null; spiele: number | null; tore: string | null } | null;
    ranglistenGroesse?: number | null;
    form?: FormSpiel[];
    bilanz?: Bilanz;
    formLetzte5?: Bilanz;
    direkt?: FormSpiel[];
    direktBilanz?: Bilanz;
    skorer?: { name: string; tore: number; assists: number; punkte: number; strafminuten: number; spiele: number }[];
    skorerSpiele?: number;
    fehler: string | null;
  }

  let { teamId }: { teamId: string } = $props();
  let check = $state<Check | null>(null);
  let fehler = $state('');

  $effect(() => {
    const id = teamId;
    check = null;
    fehler = '';
    api
      .get<Check>(`/api/m/unihockey/gegner/${id}`)
      .then((c) => (check = c))
      .catch((e) => (fehler = fehlerText(e)));
  });

  const AUSGANG = { S: 'Sieg', U: 'Unentschieden', N: 'Niederlage' } as const;
</script>

<div class="panel stapel">
  <h3>Gegner Check{check?.gegner ? `: ${check.gegner}` : ''}</h3>
  {#if fehler}
    <div class="hinweis ausfall klein">{fehler}</div>
  {:else if !check}
    <div class="laedt" style="height:120px"></div>
    <p class="sehr-klein gedaempft">Lädt die letzten Spiele des Gegners. Das kann beim ersten Mal einige Sekunden dauern.</p>
  {:else if !check.gegner}
    <p class="leer">Kein nächstes Spiel, also kein Gegner zum Prüfen.</p>
  {:else}
    {#if check.fehler}<div class="hinweis warnung klein">{check.fehler}</div>{/if}
    <div class="kennzahlen">
      {#if check.rang}
        <div><div class="sehr-klein gedaempft">Rang</div><div class="zahl gross">{check.rang.rang}{check.ranglistenGroesse ? `/${check.ranglistenGroesse}` : ''}</div><div class="sehr-klein gedaempft">{check.rang.punkte ?? 0} Punkte aus {check.rang.spiele ?? 0} Spielen</div></div>
      {/if}
      {#if check.formLetzte5?.spiele}
        <div>
          <div class="sehr-klein gedaempft">Form, letzte {check.formLetzte5.spiele}</div>
          <div class="form">
            {#each [...(check.form ?? []).slice(0, 5)].reverse() as f (f.id)}
              <span class="punkt {f.ausgang}" title="{AUSGANG[f.ausgang]} {f.resultat} gegen {f.gegner}">{f.ausgang}</span>
            {/each}
          </div>
          <div class="sehr-klein gedaempft">Ø {check.formLetzte5.toreSchnitt} Tore, {check.formLetzte5.gegentoreSchnitt} Gegentore</div>
        </div>
      {/if}
      {#if check.direktBilanz?.spiele}
        <div><div class="sehr-klein gedaempft">Direktvergleich</div><div class="zahl gross">{check.direktBilanz.siege}:{check.direktBilanz.unentschieden}:{check.direktBilanz.niederlagen}</div><div class="sehr-klein gedaempft">Siege, Unentschieden, Niederlagen</div></div>
      {/if}
    </div>

    {#if check.skorer?.length}
      <div>
        <div class="klein gedaempft">Gefährlichste Spieler (letzte {check.skorerSpiele} Spiele)</div>
        <table>
          <thead><tr><th>Spieler</th><th>Sp</th><th>T</th><th>A</th><th>Pkt</th><th>Strafmin</th></tr></thead>
          <tbody>
            {#each check.skorer as s (s.name)}
              <tr><td>{s.name}</td><td class="zahl">{s.spiele}</td><td class="zahl">{s.tore}</td><td class="zahl">{s.assists}</td><td class="zahl"><strong>{s.punkte}</strong></td><td class="zahl">{s.strafminuten || ''}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if check.skorerSpiele === 0 && check.form?.length}
      <p class="sehr-klein gedaempft">Für die letzten Spiele des Gegners gibt es keine Torschützen.</p>
    {/if}

    {#if check.form?.length}
      <div>
        <div class="klein gedaempft">Letzte Spiele des Gegners</div>
        <ul class="liste">
          {#each check.form.slice(0, 6) as f (f.id)}
            <li class="zeile klein">
              <span class="punkt klein-punkt {f.ausgang}">{f.ausgang}</span>
              <span class="sehr-klein gedaempft datum">{f.zeit ? datum(f.zeit) : ''}</span>
              <span class="wachsen">{f.heim ? 'gegen' : 'bei'} {f.gegner}</span>
              <strong class="zahl">{f.resultat}</strong>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if check.direkt?.length}
      <div>
        <div class="klein gedaempft">Unsere Spiele gegen {check.gegner}</div>
        <ul class="liste">
          {#each check.direkt as f (f.id)}
            <li class="zeile klein">
              <span class="punkt klein-punkt {f.ausgang}">{f.ausgang}</span>
              <span class="sehr-klein gedaempft datum">{f.zeit ? datum(f.zeit) : ''}</span>
              <span class="wachsen">{f.heim ? 'Heim' : 'Auswärts'}</span>
              <strong class="zahl">{f.resultat}</strong>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</div>

<style>
  .kennzahlen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 12px;
  }
  .gross {
    font-size: 1.5rem;
  }
  .form {
    display: flex;
    gap: 4px;
    margin: 4px 0;
  }
  .punkt {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 700;
    color: #0b0f14;
    flex: none;
  }
  .klein-punkt {
    width: 20px;
    height: 20px;
    font-size: 0.65rem;
  }
  .punkt.S {
    background: var(--ok);
  }
  .punkt.U {
    background: var(--warnung);
  }
  .punkt.N {
    background: var(--ausfall);
  }
  .datum {
    width: 70px;
    flex: none;
  }
</style>
