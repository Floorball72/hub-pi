<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datumZeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Unterschied { art: string; gewicht: string; text: string; vorher: string[]; nachher: string[] }
  interface Meldung { id: string; gewicht: string; zusammenfassung: string; unterschiede: Unterschied[]; status: string; erstellt: string }
  interface Eintrag { seite: { id: string; name: string; url: string; intervall_std: number | null }; meldungen: Meldung[]; basisSeit: string | null }

  const KLASSE: Record<string, string> = { hoch: 'ausfall', mittel: 'warnung', niedrig: '' };
  let tab = $state('Änderungen');
  let liste = $state<Eintrag[] | null>(null);
  let offen = $state<string | null>(null);

  async function laden() {
    liste = (await api.get<{ seiten: Eintrag[] }>('/api/m/aenderungen/uebersicht')).seiten;
    if (!offen) offen = liste.flatMap((e) => e.meldungen).find((m) => m.status === 'offen')?.id ?? null;
  }
  $effect(() => {
    if (tab === 'Änderungen') laden();
  });

  async function erwartet(m: Meldung, name: string) {
    if (!(await bestaetigen('Änderung als erwartet bestätigen?', `Der aktuelle Stand von «${name}» wird zur neuen Basis. Spätere Vergleiche gehen von diesem Stand aus.`, 'Erwartet'))) return;
    try {
      await api.post(`/api/m/aenderungen/meldung/${m.id}/erwartet`, { bestaetigt: true });
      melden('Neue Basis gesetzt');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function pruefen(id: string) {
    try {
      const r = await api.post<{ meldung: Meldung | null }>(`/api/m/aenderungen/seite/${id}/pruefen`);
      melden(r.meldung ? `Änderung erkannt: ${r.meldung.gewicht}` : 'Keine Änderung gegenüber der Basis');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function uebernehmen() {
    if (!(await bestaetigen('Seiten übernehmen?', 'Alle aktiven Seiten aus dem Webseiten Wächter werden hier beobachtet (alle 12 Stunden).', 'Übernehmen'))) return;
    const r = await api.post<{ neu: number }>('/api/m/aenderungen/aus-waechter', { bestaetigt: true });
    melden(`${r.neu} Seiten übernommen`);
  }
</script>

<ModulRahmen modulId="aenderungen" tabs={['Änderungen', 'Seiten']} bind:tab>
  {#if tab === 'Änderungen'}
    {#if !liste}
      <div class="laedt" style="height:260px"></div>
    {:else if !liste.length}
      <p class="leer">Noch keine Seiten. Unter «Seiten» erfassen oder aus dem Webseiten Wächter übernehmen.</p>
    {:else}
      <div class="stapel">
        {#each liste as e (e.seite.id)}
          <div class="panel">
            <div class="zeile-zwischen">
              <div>
                <h3 style="margin:0">{e.seite.name}</h3>
                <div class="sehr-klein gedaempft">{e.seite.url} · Basis seit {e.basisSeit ? datumZeit(e.basisSeit) : 'noch keine'} · alle {e.seite.intervall_std ?? 12} h</div>
              </div>
              <button class="klein" onclick={() => pruefen(e.seite.id)}>Jetzt vergleichen</button>
            </div>
            <ul class="liste">
              {#each e.meldungen as m (m.id)}
                <li>
                  <button class="meldung" onclick={() => (offen = offen === m.id ? null : m.id)}>
                    <span class="marke {KLASSE[m.gewicht]}">{m.gewicht}</span>
                    <span class="wachsen klein">{m.zusammenfassung}</span>
                    <span class="sehr-klein gedaempft">{datumZeit(m.erstellt)}</span>
                    {#if m.status === 'erwartet'}<span class="marke ok">erwartet</span>{/if}
                  </button>
                  {#if offen === m.id}
                    <div class="details">
                      {#each m.unterschiede as u (u.art)}
                        <div class="unterschied">
                          <div class="zeile"><strong class="klein">{u.art}</strong><span class="marke {KLASSE[u.gewicht]}">{u.gewicht}</span><span class="klein gedaempft">{u.text}</span></div>
                          <div class="diff">
                            <div><div class="sehr-klein gedaempft">Vorher</div>{#each u.vorher as z, i (i)}<div class="weg mono">{z}</div>{:else}<div class="sehr-klein gedaempft">nichts</div>{/each}</div>
                            <div><div class="sehr-klein gedaempft">Nachher</div>{#each u.nachher as z, i (i)}<div class="neu mono">{z}</div>{:else}<div class="sehr-klein gedaempft">nichts</div>{/each}</div>
                          </div>
                        </div>
                      {/each}
                      {#if m.status === 'offen'}<button class="primaer klein" onclick={() => erwartet(m, e.seite.name)}>Erwartet, als neue Basis übernehmen</button>{/if}
                    </div>
                  {/if}
                </li>
              {:else}<li class="leer">Keine Änderungen seit der Basis.</li>{/each}
            </ul>
          </div>
        {/each}
      </div>
      <p class="sehr-klein gedaempft" style="margin-top:10px">Uhrzeiten, Daten und lange Kennungen werden vor dem Vergleich ausgeblendet. Weitere Ausnahmen je Seite unter «Seiten». Hohes Gewicht: neue externe Skripte, versteckte Links, fremde Formularziele, Weiterleitung auf andere Domains, noindex.</p>
    {/if}
  {:else}
    <button style="margin-bottom:10px" onclick={uebernehmen}>Seiten aus dem Webseiten Wächter übernehmen</button>
    <div class="panel"><TabellenEditor tabelle="aend_seiten" spalten={['name', 'url', 'intervall_std', 'aktiv']} neuText="Seite" /></div>
  {/if}
</ModulRahmen>

<style>
  .meldung {
    display: flex;
    width: 100%;
    gap: 10px;
    align-items: center;
    background: transparent;
    border-color: transparent;
    text-align: left;
    flex-wrap: wrap;
    padding: 4px;
  }
  .details {
    padding: 8px 4px 4px;
  }
  .unterschied {
    margin-bottom: 12px;
  }
  .diff {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 8px;
    margin-top: 6px;
  }
  .weg,
  .neu {
    font-size: 0.75rem;
    padding: 2px 6px;
    border-radius: 4px;
    margin: 2px 0;
    word-break: break-all;
  }
  .weg {
    background: var(--ausfall-bg);
    color: #fecaca;
  }
  .neu {
    background: var(--ok-bg);
    color: #a7f3d0;
  }
</style>
