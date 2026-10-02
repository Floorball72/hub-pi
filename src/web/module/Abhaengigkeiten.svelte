<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { datumZeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Fund { id: string; paket: string; version: string; direkt: boolean; vuln_id: string; aliase: string | null; titel: string | null; schwere: string; behoben_in: string | null; erstellt: string }
  interface Eintrag { projekt: { id: string; name: string; quelle: string; ort: string }; funde: Fund[]; lauf: { erstellt: string; pakete: number; genau: boolean; fehler: string | null } | null }
  interface Antwort { projekte: Eintrag[]; tokenGesetzt: boolean }

  const KLASSE: Record<string, string> = { kritisch: 'ausfall', hoch: 'ausfall', mittel: 'warnung', niedrig: '', unbekannt: '' };
  let tab = $state('Funde');
  let d = $state<Antwort | null>(null);
  let laeuft = $state<string | null>(null);
  let filter = $state('alle');

  async function laden() {
    d = await api.get<Antwort>('/api/m/abhaengigkeiten/uebersicht');
  }
  $effect(() => {
    if (tab === 'Funde') laden();
  });
  async function pruefen(id: string) {
    laeuft = id;
    try {
      const r = await api.post<{ pakete: number; funde: number; neu: number; behoben: number }>(`/api/m/abhaengigkeiten/projekt/${id}/pruefen`);
      melden(`${r.pakete} Pakete geprüft, ${r.funde} Funde (${r.neu} neu, ${r.behoben} behoben)`);
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    } finally {
      laeuft = null;
    }
  }
  const sichtbar = (f: Fund[]) => (filter === 'ernst' ? f.filter((x) => x.schwere === 'kritisch' || x.schwere === 'hoch') : filter === 'direkt' ? f.filter((x) => x.direkt) : f);
</script>

<ModulRahmen modulId="abhaengigkeiten" tabs={['Funde', 'Projekte']} bind:tab>
  {#if tab === 'Funde'}
    {#if !d}
      <div class="laedt" style="height:260px"></div>
    {:else}
      <div class="zeile" style="margin-bottom:10px">
        <label for="af" class="klein" style="margin:0">Anzeigen</label>
        <select id="af" bind:value={filter} style="width:auto"><option value="alle">Alle Funde</option><option value="ernst">Nur hoch und kritisch</option><option value="direkt">Nur direkte Abhängigkeiten</option></select>
      </div>
      <div class="stapel">
        {#each d.projekte as e (e.projekt.id)}
          <div class="panel">
            <div class="zeile-zwischen">
              <div>
                <h3 style="margin:0">{e.projekt.name}</h3>
                <div class="sehr-klein gedaempft">
                  {e.projekt.quelle === 'Ordner' && e.projekt.ort === '.' ? 'dieser Hub' : e.projekt.ort}
                  {#if e.lauf}· {e.lauf.fehler ? 'Fehler' : `${e.lauf.pakete} Pakete`} · {datumZeit(e.lauf.erstellt)}{e.lauf.genau ? '' : ' · ohne Lockfile, ungenau'}{/if}
                </div>
              </div>
              <button class="klein" disabled={laeuft === e.projekt.id} onclick={() => pruefen(e.projekt.id)}>{laeuft === e.projekt.id ? 'Prüft …' : 'Jetzt prüfen'}</button>
            </div>
            {#if e.lauf?.fehler}<div class="hinweis ausfall klein" style="margin-top:8px">{e.lauf.fehler}</div>{/if}
            {#if sichtbar(e.funde).length}
              <div class="tabelle-scroll">
                <table>
                  <thead><tr><th>Schwere</th><th>Paket</th><th>Installiert</th><th>Behoben in</th><th>Schwachstelle</th></tr></thead>
                  <tbody>
                    {#each sichtbar(e.funde) as f (f.id)}
                      <tr>
                        <td><span class="marke {KLASSE[f.schwere]}">{f.schwere}</span></td>
                        <td>{f.paket}{#if !f.direkt}<span class="sehr-klein gedaempft"> indirekt</span>{/if}</td>
                        <td class="mono klein">{f.version}</td>
                        <td class="mono klein">{f.behoben_in ?? 'noch offen'}</td>
                        <td class="klein"><a href={`https://osv.dev/vulnerability/${f.vuln_id}`} target="_blank" rel="noopener noreferrer">{f.vuln_id}</a><div class="sehr-klein gedaempft">{f.titel ?? ''}{f.aliase ? ` (${f.aliase})` : ''}</div></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else if !e.lauf?.fehler}
              <p class="leer">{e.funde.length ? 'Keine Funde für diesen Filter.' : e.lauf ? 'Keine bekannten Schwachstellen.' : 'Noch nicht geprüft.'}</p>
            {/if}
          </div>
        {/each}
      </div>
      <p class="sehr-klein gedaempft" style="margin-top:10px">Daten: OSV (osv.dev). Tägliche Prüfung um 05:10, Push nur bei neuen Funden mit Schwere hoch oder kritisch, Wochenübersicht am Montag. Der Hub ändert nie Code.</p>
    {/if}
  {:else}
    <p class="klein gedaempft">GitHub: «besitzer/name» eintragen. Öffentliche Repositories gehen ohne Token (60 Abrufe pro Stunde), private brauchen GITHUB_TOKEN mit Leserecht (Einrichtung). Ordner: absoluter Pfad, den der Dienst lesen darf (nicht unter /home, z.B. /opt/pihub/projekte/name). «.» ist der Hub selbst.</p>
    <div class="panel"><TabellenEditor tabelle="abh_projekte" spalten={['name', 'quelle', 'ort', 'zweig', 'aktiv']} neuText="Projekt" /></div>
  {/if}
</ModulRahmen>
