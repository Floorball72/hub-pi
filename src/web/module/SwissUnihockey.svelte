<script lang="ts">
  import Icon from '../komponenten/Icon.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { zeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { navigieren, ort, parameter } from '../lib/router.svelte.ts';

  interface Einsatz {
    schluessel: string;
    titel: string;
    start: string;
    ende: string | null;
    ganztags: boolean;
    typ: string | null;
    status: string;
    ersatzFuer: string | null;
    postzeit: string | null;
    text: string;
    ort: string;
    erledigt?: number;
    schritte?: number;
  }
  interface Spiel { id: string; zeitText: string; heim: string; gast: string; resultat: string | null; status: string | null; beendet: boolean; liga: string | null }
  interface Detail { einsatz: Einsatz; schritte: { id: string; abschnitt: string; text: string }[]; erledigt: string[]; notizen: string; spiele: Spiel[]; spieleFehler?: string; ligen: string[] }

  let tab = $state('Einsätze');
  let liste = $state<{ einsaetze: Einsatz[]; fehler?: string; demo: boolean; konfiguriert: boolean; loginHinterlegt: boolean; vorlageAnzahl: number } | null>(null);
  let detail = $state<Detail | null>(null);
  let notizen = $state('');
  const schluessel = $derived((void ort.suche, parameter('einsatz')));

  async function laden() {
    liste = await api.get('/api/m/swissunihockey/einsaetze');
  }
  async function detailLaden(s: string) {
    detail = await api.get<Detail>(`/api/m/swissunihockey/einsatz?schluessel=${encodeURIComponent(s)}`);
    notizen = detail.notizen;
  }
  $effect(() => {
    laden();
  });
  $effect(() => {
    detail = null;
    if (schluessel) {
      tab = 'Einsätze';
      detailLaden(schluessel).catch((e) => melden(fehlerText(e), 'ausfall'));
    }
  });

  async function abhaken(id: string, erledigt: boolean) {
    if (!detail) return;
    const r = await api.post<{ erledigt: string[] }>('/api/m/swissunihockey/einsatz/status', { schluessel: detail.einsatz.schluessel, schritt: id, erledigt });
    detail.erledigt = r.erledigt;
  }
  async function notizenSpeichern() {
    if (!detail) return;
    await api.post('/api/m/swissunihockey/einsatz/status', { schluessel: detail.einsatz.schluessel, notizen });
    melden('Notiz gespeichert');
  }
  async function vorlageLaden() {
    if (!(await bestaetigen('Checkliste neu laden?', 'Die Vorlage wird durch die Schritte aus docs/swissunihockey-ablauf.md ersetzt. Abgehakte Schritte bestehender Einsätze gehen dabei verloren.', 'Neu laden', true))) return;
    try {
      const r = await api.post<{ schritte: number }>('/api/m/swissunihockey/vorlage/neu-laden', { bestaetigt: true });
      melden(`${r.schritte} Schritte geladen`);
      tab = 'Einsätze';
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  const tag = (iso: string) => new Date(iso).toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long' });
  const STATUS: Record<string, string> = { fix: 'ok', 'evtl.': 'warnung', Ersatz: '' };
  const abschnitte = $derived(detail ? [...new Set(detail.schritte.map((s) => s.abschnitt))] : []);
</script>

<ModulRahmen modulId="swissunihockey" tabs={['Einsätze', 'Checkliste Vorlage']} bind:tab>
  <div class="hinweis klein" style="margin-bottom:12px">
    Dieses Modul zeigt nur Infos und eine Checkliste. Es erstellt, schreibt und postet nichts.
    {#if liste}Geteilter Login in der .env: {liste.loginHinterlegt ? 'hinterlegt' : 'nicht hinterlegt'}.{/if}
  </div>

  {#if tab === 'Einsätze'}
    {#if detail}
      <button class="leise" onclick={() => navigieren('/modul/swissunihockey')}><Icon name="zurueck" groesse={16} />Alle Einsätze</button>
      <div class="kopf panel">
        <div class="zeile"><span class="marke {STATUS[detail.einsatz.status] ?? ''}">{detail.einsatz.status}{detail.einsatz.ersatzFuer ? ` für ${detail.einsatz.ersatzFuer}` : ''}</span>{#if detail.einsatz.typ}<span class="marke">{detail.einsatz.typ}</span>{/if}</div>
        <h2>{tag(detail.einsatz.start)}</h2>
        <div class="zahl gross">{detail.einsatz.ganztags ? 'ganztags' : zeit(detail.einsatz.start)}{#if detail.einsatz.postzeit}<span class="gedaempft klein">{' · '}Postzeit ca. {zeit(detail.einsatz.postzeit)} (geschätzt: Termin plus 3 Stunden)</span>{/if}</div>
        {#if detail.einsatz.text}<p class="klein gedaempft vor">{detail.einsatz.text}</p>{/if}
      </div>

      <div class="raster-2" style="margin-top:12px">
        <section class="panel">
          <h2>Checkliste</h2>
          {#if !detail.schritte.length}
            <p class="leer">Noch keine Schritte. Der Ablauf von Marion Kaufmann kommt in docs/swissunihockey-ablauf.md. Bis dahin im Tab «Checkliste Vorlage» Schritte von Hand anlegen.</p>
          {:else}
            {#each abschnitte as a (a)}
              <h3>{a}</h3>
              {#each detail.schritte.filter((s) => s.abschnitt === a) as s (s.id)}
                <label class="schritt">
                  <input type="checkbox" checked={detail.erledigt.includes(s.id)} onchange={(e) => abhaken(s.id, (e.target as HTMLInputElement).checked)} />
                  <span class:erledigt={detail.erledigt.includes(s.id)}>{s.text}</span>
                </label>
              {/each}
            {/each}
          {/if}
          <h3 style="margin-top:14px">Notizen zum Einsatz</h3>
          <textarea rows="3" bind:value={notizen}></textarea>
          <button class="klein" style="margin-top:6px" onclick={notizenSpeichern}>Notiz speichern</button>
        </section>

        <section class="panel">
          <h2>Spiele des Tages</h2>
          {#if detail.spieleFehler}<div class="hinweis ausfall klein">{detail.spieleFehler}</div>{/if}
          {#if detail.ligen.length}<p class="sehr-klein gedaempft">Hervorgehoben: Ligen aus dem Kalendereintrag ({detail.ligen.join(', ')})</p>{/if}
          {#each [...new Set(detail.spiele.map((s) => s.liga))] as liga (liga)}
            <h3 class:hervor={detail.ligen.includes(liga ?? '')}>{liga}</h3>
            {#each detail.spiele.filter((s) => s.liga === liga) as s (s.id)}
              <div class="spiel" class:hervor={detail.ligen.includes(liga ?? '')}>
                <span class="status sehr-klein" class:beendet={s.beendet}>{s.beendet ? 'beendet' : (s.status ?? s.zeitText)}</span>
                <span class="wachsen">{s.heim} : {s.gast}</span>
                <strong class="zahl">{s.resultat ?? '–'}</strong>
              </div>
            {/each}
          {:else}
            <p class="leer">Keine Spiele für diesen Tag gefunden.</p>
          {/each}
          <p class="sehr-klein gedaempft">Daten: swiss unihockey. Live Stand wird alle 2 Minuten aktualisiert.</p>
        </section>
      </div>
    {:else if liste}
      {#if liste.fehler}<div class="hinweis ausfall">{liste.fehler}</div>{/if}
      {#if !liste.konfiguriert}<div class="hinweis warnung">iCal Adresse fehlt. In der Einrichtung unter «Kalender» eintragen.</div>{/if}
      <div class="einsaetze">
        {#each liste.einsaetze as e (e.schluessel)}
          <a class="einsatz panel" href="/modul/swissunihockey?einsatz={encodeURIComponent(e.schluessel)}">
            <div class="zeile-zwischen">
              <span class="klein gedaempft">{tag(e.start)}</span>
              <span class="marke {STATUS[e.status] ?? ''}">{e.status}</span>
            </div>
            <div class="zahl gross">{e.ganztags ? 'ganztags' : zeit(e.start)}</div>
            <div><strong>{e.typ ?? 'Einsatz'}</strong>{e.ersatzFuer ? ` · Ersatz für ${e.ersatzFuer}` : ''}</div>
            <div class="sehr-klein gedaempft">{e.postzeit ? `Postzeit ca. ${zeit(e.postzeit)}` : ''}{e.schritte ? ` · Checkliste ${e.erledigt}/${e.schritte}` : ''}</div>
          </a>
        {:else}
          <p class="leer">Keine Einsätze in den nächsten 90 Tagen (Kalendertermine mit «swiss unihockey |» am Anfang).</p>
        {/each}
      </div>
    {:else}
      <div class="laedt" style="height:200px"></div>
    {/if}
  {:else}
    <div class="zeile-zwischen" style="margin-bottom:10px">
      <p class="klein gedaempft">Schritte frei bearbeitbar. Sobald docs/swissunihockey-ablauf.md ausgefüllt ist, lässt sich die Vorlage daraus laden.</p>
      <button onclick={vorlageLaden}>Aus Ablauf Datei laden</button>
    </div>
    <div class="panel"><TabellenEditor tabelle="suh_vorlage" sort="reihenfolge" spalten={['reihenfolge', 'abschnitt', 'text', 'fuer']} neuText="Schritt" /></div>
  {/if}
</ModulRahmen>

<style>
  .einsaetze {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  }
  .einsatz {
    color: inherit;
    display: grid;
    gap: 4px;
  }
  @media (hover: hover) and (pointer: fine) {
    .einsatz:hover {
      text-decoration: none;
      border-color: var(--rand-hell);
    }
  }
  .gross {
    font-size: 1.8rem;
  }
  .kopf {
    margin-top: 8px;
  }
  .vor {
    white-space: pre-line;
  }
  .schritt {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    color: var(--text);
    font-size: 0.92rem;
    padding: 6px 0;
    margin: 0;
    cursor: pointer;
  }
  .erledigt {
    color: var(--text-3);
    text-decoration: line-through;
  }
  .spiel {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 5px 0;
    font-size: 0.88rem;
    border-bottom: 1px solid #1a2330;
  }
  .spiel.hervor {
    background: #4cc9f00d;
  }
  h3.hervor {
    color: var(--akzent);
  }
  .status {
    width: 64px;
    color: var(--akzent);
  }
  .status.beendet {
    color: var(--text-3);
  }
</style>
