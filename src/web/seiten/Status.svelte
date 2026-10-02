<script lang="ts">
  import type { ModulInfo, QuellenStatusInfo } from '../../server/geteilt/typen.ts';
  import QuellenListe from '../komponenten/QuellenListe.svelte';
  import { api } from '../lib/api.ts';
  import { relativ } from '../lib/format.ts';

  interface Job {
    id: string;
    name: string;
    modul: string;
    laeuft: boolean;
    letzterLauf: string | null;
    letzteDauerMs: number | null;
    letzterFehler: string | null;
    letzteMeldung: string | null;
    naechsterLauf: string | null;
    laeufe: number;
    fehler: number;
  }
  interface StatusDaten {
    module: (ModulInfo & { fehler: string | null })[];
    quellen: QuellenStatusInfo[];
    jobs: Job[];
    daten: { treiber: string; verbunden: boolean; letzterFehler: string | null; puffer: number };
    push: { konfiguriert: boolean; server: string };
    demo: boolean;
    start: string;
  }

  let s = $state<StatusDaten | null>(null);
  async function laden() {
    s = await api.get<StatusDaten>('/api/status');
  }
  $effect(() => {
    laden();
    const t = setInterval(laden, 30000);
    return () => clearInterval(t);
  });

  const ausgefallen = $derived(s?.quellen.filter((q) => q.zustand === 'fehler') ?? []);
</script>

<h1>Status</h1>
<p class="gedaempft klein">Welche Module laufen, welche Datenquellen ausgefallen sind und was die Hintergrundjobs tun.</p>

{#if s}
  <div class="raster uebersicht">
    <div class="panel">
      <h3>Datenbank</h3>
      <div class="zeile"><span class="punkt {s.daten.verbunden ? 'ok' : 'ausfall'}"></span><span class="zahl gross">{s.daten.treiber}</span></div>
      <div class="klein gedaempft">{s.daten.verbunden ? 'verbunden' : 'nicht erreichbar'}{#if s.daten.puffer} · {s.daten.puffer} Messwerte im Offline Puffer{/if}</div>
    </div>
    <div class="panel">
      <h3>Push</h3>
      <div class="zeile"><span class="punkt {s.push.konfiguriert ? 'ok' : 'warnung'}"></span><span class="zahl gross">ntfy</span></div>
      <div class="klein gedaempft">{s.demo ? 'Demo Modus: nur Protokoll' : s.push.konfiguriert ? s.push.server : 'Thema fehlt'}</div>
    </div>
    <div class="panel">
      <h3>Quellen gestört</h3>
      <div class="zahl gross" style="color:{ausgefallen.length ? 'var(--ausfall)' : 'var(--ok)'}">{ausgefallen.length}</div>
      <div class="klein gedaempft">von {s.quellen.length} Quellen</div>
    </div>
    <div class="panel">
      <h3>Hub läuft seit</h3>
      <div class="zahl gross">{relativ(s.start).replace('vor ', '')}</div>
      <div class="klein gedaempft">{s.module.filter((m) => m.aktiv).length} von {s.module.length} Modulen aktiv</div>
    </div>
  </div>

  <div class="raster-2">
    <section class="panel">
      <h2>Module</h2>
      <ul class="liste">
        {#each s.module as m (m.id)}
          <li class="zeile-zwischen">
            <span class="zeile"><span class="punkt {m.fehler ? 'ausfall' : m.aktiv ? 'ok' : ''}"></span><a href="/modul/{m.id}">{m.name}</a></span>
            <span class="marke {m.fehler ? 'ausfall' : m.aktiv ? 'ok' : ''}">{m.fehler ? 'Fehler' : m.aktiv ? 'läuft' : 'aus'}</span>
          </li>
        {/each}
      </ul>
      <h2 style="margin-top:20px">Datenquellen</h2>
      <QuellenListe quellen={s.quellen} />
    </section>

    <section class="panel">
      <h2>Hintergrundjobs</h2>
      <div class="tabelle-scroll">
        <table>
          <thead><tr><th>Job</th><th>Zuletzt</th><th>Ergebnis</th></tr></thead>
          <tbody>
            {#each s.jobs as j (j.id)}
              <tr>
                <td><strong class="klein">{j.name}</strong><div class="sehr-klein gedaempft">{j.modul} · {j.laeufe} Läufe{#if j.fehler}, {j.fehler} Fehler{/if}</div></td>
                <td class="klein">{j.laeuft ? 'läuft…' : relativ(j.letzterLauf)}{#if j.letzteDauerMs !== null}<div class="sehr-klein gedaempft">{j.letzteDauerMs} ms</div>{/if}</td>
                <td class="klein">
                  {#if j.letzterFehler}<span style="color:var(--ausfall)">{j.letzterFehler}</span>{:else}<span class="gedaempft">{j.letzteMeldung ?? 'ok'}</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  </div>
{:else}
  <div class="laedt" style="height:200px"></div>
{/if}

<style>
  .uebersicht {
    margin-bottom: 12px;
  }
  .gross {
    font-size: 1.7rem;
  }
  .panel h3 {
    margin-bottom: 4px;
  }
</style>
