<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { relativ } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Q {
    id: string;
    name: string;
    modul: string;
    grundSek: number;
    wirksamSek: number;
    minSek: number;
    wichtig: boolean;
    einstellung: { modus: 'auto' | 'fix' | 'aus'; fixSek?: number; budget?: number };
    zaehler: { heute: number; gesamt: number; fehlerInFolge: number; gesperrtBis: string | null; verweigert: number; letzterAbruf: string | null };
    zustand: string;
  }
  interface Antwort { quellen: Q[]; nutzung: string; faktoren: Record<string, number>; bedingt: { gesendet: number; nichtGeaendert: number } }

  const STUFE: Record<string, string> = { aktiv: 'Aktiv genutzt', ruhig: 'Ruhig (15 min ohne Nutzung)', schlaf: 'Keine Nutzung seit 2 Stunden', nacht: 'Nacht (23 bis 6 Uhr)' };
  let tab = $state('Quellen');
  let d = $state<Antwort | null>(null);
  let bearbeitet = $state<{ id: string; modus: string; fixMin: number; budget: number } | null>(null);

  async function laden() {
    d = await api.get<Antwort>('/api/m/abrufe/liste');
  }
  $effect(() => {
    laden();
  });
  function dauer(s: number) {
    if (s < 120) return `${s} s`;
    if (s < 7200) return `${Math.round(s / 60)} min`;
    if (s < 172800) return `${Math.round(s / 360) / 10} h`;
    return `${Math.round(s / 86400)} Tage`;
  }
  async function speichern() {
    if (!bearbeitet) return;
    try {
      await api.put(`/api/m/abrufe/quelle/${encodeURIComponent(bearbeitet.id)}`, { modus: bearbeitet.modus, fixSek: bearbeitet.fixMin * 60, budget: bearbeitet.budget });
      melden('Gespeichert');
      bearbeitet = null;
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
</script>

<ModulRahmen modulId="abrufe" tabs={['Quellen']} bind:tab>
  {#if !d}
    <div class="laedt" style="height:300px"></div>
  {:else}
    <div class="raster" style="margin-bottom:12px">
      <div class="panel">
        <div class="klein gedaempft">Aktuelle Stufe</div>
        <div class="zahl gross">{STUFE[d.nutzung] ?? d.nutzung}</div>
        <div class="sehr-klein gedaempft">Faktor {d.faktoren[d.nutzung]} auf den Grundtakt. Wichtige Quellen (Alarme) höchstens 1.5.</div>
      </div>
      <div class="panel">
        <div class="klein gedaempft">Abrufe heute</div>
        <div class="zahl gross">{d.quellen.reduce((s, q) => s + q.zaehler.heute, 0)}</div>
        <div class="sehr-klein gedaempft">{d.bedingt.nichtGeaendert} von {d.bedingt.gesendet} bedingten Abrufen ohne Änderung (304)</div>
      </div>
    </div>
    <div class="panel tabelle-scroll">
      <table>
        <thead><tr><th>Quelle</th><th>Modus</th><th>Grundtakt</th><th>Wirksam</th><th>Heute</th><th>Gesamt</th><th>Zustand</th><th></th></tr></thead>
        <tbody>
          {#each d.quellen as q (q.id)}
            <tr>
              <td><div>{q.name}</div><div class="sehr-klein gedaempft">{q.modul}{q.wichtig ? ' · wichtig' : ''}</div></td>
              <td><span class="marke" class:warnung={q.einstellung.modus === 'aus'}>{q.einstellung.modus}{q.einstellung.modus === 'fix' && q.einstellung.fixSek ? ` ${dauer(q.einstellung.fixSek)}` : ''}</span>{#if q.einstellung.budget}<div class="sehr-klein gedaempft">Budget {q.einstellung.budget}</div>{/if}</td>
              <td class="zahl klein">{dauer(q.grundSek)}</td>
              <td class="zahl klein">{dauer(q.wirksamSek)}</td>
              <td class="zahl">{q.zaehler.heute}</td>
              <td class="zahl klein">{q.zaehler.gesamt}</td>
              <td class="sehr-klein">{q.zaehler.gesperrtBis ? `Pause bis ${new Date(q.zaehler.gesperrtBis).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}` : q.zustand}{q.zaehler.letzterAbruf ? ` · ${relativ(q.zaehler.letzterAbruf)}` : ''}</td>
              <td><button class="leise klein" onclick={() => (bearbeitet = { id: q.id, modus: q.einstellung.modus, fixMin: Math.round((q.einstellung.fixSek ?? q.grundSek) / 60) || 1, budget: q.einstellung.budget ?? 0 })}>Ändern</button></td>
            </tr>
            {#if bearbeitet?.id === q.id}
              <tr>
                <td colspan="8">
                  <div class="zeile">
                    {#each ['auto', 'fix', 'aus'] as m (m)}<label class="zeile klein" style="margin:0"><input type="radio" name="modus" value={m} bind:group={bearbeitet.modus} />{m}</label>{/each}
                    {#if bearbeitet.modus === 'fix'}<label class="klein" style="margin:0">alle <input type="number" min="1" style="width:80px" bind:value={bearbeitet.fixMin} /> min</label>{/if}
                    <label class="klein" style="margin:0">Budget pro Tag <input type="number" min="0" style="width:90px" bind:value={bearbeitet.budget} /></label>
                    <button class="primaer klein" onclick={speichern}>Speichern</button>
                    <button class="leise klein" onclick={() => (bearbeitet = null)}>Abbrechen</button>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
    <p class="sehr-klein gedaempft" style="margin-top:10px">Auto: Grundtakt der Quelle mal Faktor der Nutzung, nach Fehlern längere Abstände und ab drei Fehlern eine Pause (wichtige Quellen nie). Fix: fester Abstand. Aus: kein Abruf, es gilt der letzte Stand. Abrufe mit ETag oder Last-Modified fragen nur nach Änderungen. Zähler beginnen nach jedem Neustart bei null.</p>
  {/if}
</ModulRahmen>

<style>
  .gross {
    font-size: 1.3rem;
  }
</style>
