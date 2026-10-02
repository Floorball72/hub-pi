<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datum, datumZeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Punkt { bereich: string; name: string; ok: boolean; punkte: number; max: number; text: string; vorschlag?: string }
  interface Check { note: string; punkte: number; erstellt: string; domain: string; ergebnis: { einzel: Punkt[]; vorschlaege: string[] } }
  interface Zeile { seite: { id: string; name: string; url: string }; aktuell: Check | null; verlauf: { erstellt: string; note: string; punkte: number }[] }
  interface Antwort { seiten: Zeile[]; lecks: { domain: string; adressen: number | null; lecks: string[]; erstellt: string | null }[] | null; hibpAktiv: boolean }

  let tab = $state('Übersicht');
  let d = $state<Antwort | null>(null);
  let offen = $state<string | null>(null);
  let laeuft = $state<string | null>(null);

  async function laden() {
    d = await api.get<Antwort>('/api/m/sicherheit/uebersicht');
    if (!offen && d.seiten.length) offen = d.seiten[0].seite.id;
  }
  $effect(() => {
    laden();
  });
  async function pruefen(z: Zeile) {
    if (!(await bestaetigen('Jetzt prüfen?', `${z.seite.url} wird passiv geprüft (eine Seitenabfrage, zwei TLS Verbindungen, DNS Abfragen).`, 'Prüfen'))) return;
    laeuft = z.seite.id;
    try {
      await api.post(`/api/m/sicherheit/seite/${z.seite.id}/pruefen`);
      melden('Prüfung gespeichert');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    } finally {
      laeuft = null;
    }
  }
  const NOTE_KLASSE: Record<string, string> = { A: 'ok', B: 'ok', C: 'warnung', D: 'ausfall', E: 'ausfall' };
  const gewaehlt = $derived(d?.seiten.find((z) => z.seite.id === offen) ?? null);
  const bereiche = ['Transport', 'Header', 'E-Mail', 'Software'];
</script>

<ModulRahmen modulId="sicherheit" tabs={['Übersicht']} bind:tab>
  {#if !d}
    <div class="laedt" style="height:300px"></div>
  {:else if !d.seiten.length}
    <p class="leer">Keine Seiten. Seiten werden im Webseiten Wächter (scont) erfasst, geprüft werden nur diese Kunden und eigenen Seiten.</p>
  {:else}
    <div class="aufteilung">
      <div class="panel">
        <h3>Seiten</h3>
        <ul class="liste">
          {#each d.seiten as z (z.seite.id)}
            <li>
              <button class="seite" class:aktiv={offen === z.seite.id} onclick={() => (offen = z.seite.id)}>
                <span class="note {NOTE_KLASSE[z.aktuell?.note ?? ''] ?? ''}">{z.aktuell?.note ?? '–'}</span>
                <span class="wachsen"><span>{z.seite.name}</span><span class="sehr-klein gedaempft block">{z.aktuell ? `${z.aktuell.punkte} Punkte · ${datum(z.aktuell.erstellt)}` : 'noch nicht geprüft'}</span></span>
                <span class="verlauf" aria-label="Verlauf der Noten">{#each z.verlauf as v (v.erstellt)}<span class="strich" style="height:{4 + v.punkte * 0.22}px" title="{datum(v.erstellt)}: {v.note} ({v.punkte})"></span>{/each}</span>
              </button>
            </li>
          {/each}
        </ul>
        <p class="sehr-klein gedaempft">Wöchentliche Prüfung in der Nacht. Nur passive Abfragen, wie sie jeder Browser macht. Die Note erscheint im Monatsreport.</p>
      </div>

      {#if gewaehlt}
        <div class="panel">
          <div class="zeile-zwischen">
            <div>
              <h3 style="margin:0">{gewaehlt.seite.name}</h3>
              <div class="sehr-klein gedaempft">{gewaehlt.seite.url}{gewaehlt.aktuell ? ` · geprüft ${datumZeit(gewaehlt.aktuell.erstellt)}` : ''}</div>
            </div>
            <button class="klein" disabled={laeuft === gewaehlt.seite.id} onclick={() => pruefen(gewaehlt!)}>{laeuft === gewaehlt.seite.id ? 'Prüft …' : 'Jetzt prüfen'}</button>
          </div>
          {#if gewaehlt.aktuell}
            {#each bereiche as b (b)}
              {@const punkte = gewaehlt.aktuell.ergebnis.einzel.filter((p) => p.bereich === b)}
              <h4>{b}</h4>
              <table>
                <tbody>
                  {#each punkte as p (p.name)}
                    <tr>
                      <td style="width:22px"><span class="punkt {p.ok ? 'ok' : p.punkte > 0 ? 'warnung' : 'ausfall'}"></span></td>
                      <td>{p.name}</td>
                      <td class="klein gedaempft text">{p.text}</td>
                      <td class="zahl sehr-klein" style="text-align:right">{p.punkte}/{p.max}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/each}
            {#if gewaehlt.aktuell.ergebnis.vorschlaege.length}
              <h4>Vorschläge</h4>
              <ul class="vorschlaege klein">{#each gewaehlt.aktuell.ergebnis.vorschlaege as v (v)}<li>{v}</li>{/each}</ul>
            {/if}
          {:else}
            <p class="leer">Noch keine Prüfung.</p>
          {/if}
        </div>
      {/if}
    </div>

    <div class="panel" style="margin-top:12px">
      <h3>Datenlecks eigener Domains</h3>
      {#if d.lecks}
        <ul class="liste">
          {#each d.lecks as l (l.domain)}
            <li class="zeile"><span class="wachsen">{l.domain}</span><span class="klein">{l.adressen ?? '–'} betroffene Adressen</span><span class="sehr-klein gedaempft">{l.lecks.join(', ')}</span></li>
          {:else}<li class="leer">Keine eigenen Domains erfasst (Webseiten Wächter, Domains, «Eigene Domain»).</li>{/each}
        </ul>
        <p class="sehr-klein gedaempft">Quelle: Have I Been Pwned. Gespeichert werden nur Anzahl und Namen der Lecks, keine Adressen.</p>
      {:else}
        <p class="klein gedaempft">Optional: Mit einem Schlüssel von haveibeenpwned.com (HIBP_API_KEY in der Einrichtung) und verifizierten Domains prüft der Hub wöchentlich auf neue Datenlecks.</p>
      {/if}
    </div>
  {/if}
</ModulRahmen>

<style>
  .aufteilung {
    display: grid;
    gap: 12px;
  }
  @media (min-width: 1000px) {
    .aufteilung {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.4fr);
    }
  }
  .seite {
    display: flex;
    width: 100%;
    gap: 12px;
    align-items: center;
    background: transparent;
    border-color: transparent;
    text-align: left;
    padding: 6px;
  }
  .seite.aktiv {
    background: var(--flaeche-3);
    border-color: var(--rand-hell);
  }
  .block {
    display: block;
  }
  .note {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 1.1rem;
    background: var(--flaeche-3);
    border: 1px solid var(--rand-hell);
    flex: none;
  }
  .note.ok {
    color: var(--ok);
    border-color: #34d39944;
  }
  .note.warnung {
    color: var(--warnung);
    border-color: #fbbf2444;
  }
  .note.ausfall {
    color: var(--ausfall);
    border-color: #f8717144;
  }
  .verlauf {
    display: flex;
    gap: 2px;
    align-items: flex-end;
    height: 28px;
  }
  .strich {
    width: 4px;
    border-radius: 2px;
    background: var(--akzent);
    opacity: 0.8;
  }
  h4 {
    margin: 14px 0 4px;
    font-size: 0.85rem;
    color: var(--text-2);
  }
  .text {
    word-break: break-word;
  }
  .vorschlaege {
    margin: 0;
    padding-left: 18px;
  }
  .vorschlaege li {
    margin: 4px 0;
  }
</style>
