<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { chf, datum } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Gegenstand {
    id: string;
    name: string;
    kategorie: string | null;
    ort: string | null;
    marke: string | null;
    modell: string | null;
    gekauft_am: string | null;
    preis: number | null;
    wartung_monate: number | null;
    wartung_text: string | null;
    letzte_wartung: string | null;
    ausgemustert: boolean;
    garantieEnde: string | null;
    garantieTage: number | null;
    wartung: string | null;
    wartungTage: number | null;
  }
  interface Gruppe { name: string; anzahl: number; wert: number }
  interface Uebersicht {
    heute: string;
    summen: { anzahl: number; wert: number; garantie: number; ohnePreis: number };
    orte: Gruppe[];
    kategorien: Gruppe[];
    garantien: Gegenstand[];
    wartungen: Gegenstand[];
    gegenstaende: Gegenstand[];
  }

  let tab = $state('Übersicht');
  let u = $state<Uebersicht | null>(null);
  let zeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  let filter = $state('');
  let ort = $state('');

  async function laden() {
    u = await api.get('/api/m/inventar/uebersicht');
  }
  $effect(() => {
    void tab;
    void JSON.stringify(zeilen);
    laden().catch((e) => melden(fehlerText(e), 'ausfall'));
  });

  const maxOrt = $derived(Math.max(1, ...(u?.orte ?? []).map((o) => o.wert)));
  const maxKat = $derived(Math.max(1, ...(u?.kategorien ?? []).map((k) => k.wert)));
  const sichtbar = $derived(
    (u?.gegenstaende ?? []).filter((g) => {
      if (g.ausgemustert) return false;
      if (ort && (g.ort || 'Ohne Standort') !== ort) return false;
      const q = filter.trim().toLowerCase();
      return !q || [g.name, g.marke, g.modell, g.ort, g.kategorie].some((x) => x?.toLowerCase().includes(q));
    }),
  );
  const mitWartung = $derived(
    (u?.gegenstaende ?? []).filter((g) => g.wartung && !g.ausgemustert).sort((a, b) => (a.wartungTage ?? 0) - (b.wartungTage ?? 0)),
  );
  const ausgemustert = $derived((u?.gegenstaende ?? []).filter((g) => g.ausgemustert));

  function garantieText(g: Gegenstand): string {
    if (!g.garantieEnde || g.garantieTage == null) return 'ohne Garantie';
    if (g.garantieTage < 0) return `Garantie abgelaufen ${datum(g.garantieEnde, true)}`;
    if (g.garantieTage === 0) return 'Garantie endet heute';
    return g.garantieTage <= 90 ? `Garantie noch ${g.garantieTage} Tage` : `Garantie bis ${datum(g.garantieEnde, true)}`;
  }
  function wartungText(g: Gegenstand): string {
    const t = g.wartungTage;
    if (t == null) return '';
    if (t < 0) return `seit ${-t} ${-t === 1 ? 'Tag' : 'Tagen'} fällig`;
    if (t === 0) return 'heute fällig';
    if (t === 1) return 'morgen fällig';
    return `fällig ${datum(g.wartung, true)} (in ${t} Tagen)`;
  }
  const details = (g: Gegenstand) => [g.marke, g.modell].filter(Boolean).join(' ');

  async function gewartet(g: Gegenstand) {
    try {
      const r = await api.post<{ naechste: string | null }>(`/api/m/inventar/gegenstand/${g.id}/gewartet`, {});
      melden(`Wartung ${g.name} erledigt${r.naechste ? `, nächste ${datum(r.naechste, true)}` : ''}`, 'ok');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
</script>

<ModulRahmen modulId="inventar" tabs={['Übersicht', 'Liste', 'Wartung']} bind:tab>
  {#if !u}
    <div class="laedt">Lädt …</div>
  {:else if tab === 'Übersicht'}
    <div class="stapel">
      <div class="kennzahlen">
        <div class="panel"><div class="sehr-klein gedaempft">Gegenstände</div><div class="zahl gross">{u.summen.anzahl}</div><div class="sehr-klein gedaempft">{u.summen.garantie} mit laufender Garantie</div></div>
        <div class="panel"><div class="sehr-klein gedaempft">Neuwert</div><div class="zahl gross">{chf(u.summen.wert)}</div><div class="sehr-klein gedaempft">{u.summen.ohnePreis ? `${u.summen.ohnePreis} ohne Preis` : 'alle mit Preis'}</div></div>
        <div class="panel" class:warnfeld={u.wartungen.some((g) => (g.wartungTage ?? 1) <= 0)}>
          <div class="sehr-klein gedaempft">Wartungen 30 Tage</div><div class="zahl gross">{u.wartungen.length}</div><div class="sehr-klein gedaempft">{u.wartungen.filter((g) => (g.wartungTage ?? 1) <= 0).length} fällig</div>
        </div>
      </div>

      {#if u.wartungen.length || u.garantien.length}
        <div class="raster-2">
          <div class="panel">
            <h3>Wartungen</h3>
            {#if !u.wartungen.length}<div class="leer">Nichts fällig in den nächsten 30 Tagen.</div>{/if}
            <ul class="liste">
              {#each u.wartungen as g (g.id)}
                <li class="eintrag" class:dringend={(g.wartungTage ?? 1) <= 0}>
                  <div class="info"><span class="titel">{g.name}</span><span class="sehr-klein gedaempft">{g.wartung_text || 'Wartung'} · {wartungText(g)}</span></div>
                  <button class="leise klein" onclick={() => gewartet(g)}>Erledigt</button>
                </li>
              {/each}
            </ul>
          </div>
          <div class="panel">
            <h3>Garantie endet bald</h3>
            {#if !u.garantien.length}<div class="leer">Keine Garantie endet in den nächsten 90 Tagen.</div>{/if}
            <ul class="liste">
              {#each u.garantien as g (g.id)}
                <li class="eintrag" class:dringend={(g.garantieTage ?? 99) <= 14}>
                  <div class="info"><span class="titel">{g.name}</span><span class="sehr-klein gedaempft">{details(g) || g.kategorie} · bis {datum(g.garantieEnde, true)}</span></div>
                  <span class="zahl sehr-klein">{g.garantieTage} Tage</span>
                </li>
              {/each}
            </ul>
            <p class="sehr-klein gedaempft">Mängel vor Ablauf melden. Der Hub erinnert 30 und 7 Tage vorher.</p>
          </div>
        </div>
      {/if}

      <div class="raster-2">
        <div class="panel">
          <h3>Nach Standort</h3>
          <ul class="liste gruppen">
            {#each u.orte as o (o.name)}
              <li>
                <button class="zeile-knopf" onclick={() => { ort = o.name; tab = 'Liste'; }}>
                  <span>{o.name} <span class="gedaempft sehr-klein">{o.anzahl}</span></span><span class="zahl">{chf(o.wert)}</span>
                </button>
                <div class="leiste" aria-hidden="true"><span style="width:{(o.wert / maxOrt) * 100}%"></span></div>
              </li>
            {/each}
          </ul>
        </div>
        <div class="panel">
          <h3>Nach Kategorie</h3>
          <ul class="liste gruppen">
            {#each u.kategorien as k (k.name)}
              <li>
                <div class="zeile-zwischen"><span>{k.name} <span class="gedaempft sehr-klein">{k.anzahl}</span></span><span class="zahl">{chf(k.wert)}</span></div>
                <div class="leiste" aria-hidden="true"><span style="width:{(k.wert / maxKat) * 100}%"></span></div>
              </li>
            {/each}
          </ul>
        </div>
      </div>

      <div class="panel zeile-zwischen">
        <div><h3>Liste für die Versicherung</h3><p class="sehr-klein gedaempft">Alle Gegenstände mit Kaufpreis, Seriennummer und Beleg als CSV für Excel. Bei einem Schaden oder zum Prüfen der Hausrat Versicherungssumme.</p></div>
        <a class="knopf" href="/api/m/inventar/inventar.csv" download>CSV herunterladen</a>
      </div>
    </div>
  {:else if tab === 'Liste'}
    <div class="stapel">
      <div class="panel filter">
        <input class="wachsen" type="search" bind:value={filter} placeholder="Suchen nach Name, Marke, Standort" aria-label="Inventar durchsuchen" />
        <select bind:value={ort} aria-label="Standort">
          <option value="">Alle Standorte</option>
          {#each u.orte as o (o.name)}<option value={o.name}>{o.name}</option>{/each}
        </select>
      </div>
      <div class="panel">
        {#if !sichtbar.length}<div class="leer">{u.gegenstaende.length ? 'Nichts gefunden.' : 'Noch nichts erfasst. Unten erfassen.'}</div>{/if}
        <ul class="liste">
          {#each sichtbar as g (g.id)}
            <li class="eintrag">
              <div class="info">
                <span class="titel">{g.name}{#if details(g)}<span class="gedaempft">{' · '}{details(g)}</span>{/if}</span>
                <span class="sehr-klein gedaempft">
                  {g.ort || 'Ohne Standort'}{#if g.gekauft_am}{' · '}gekauft {datum(g.gekauft_am, true)}{/if} · {garantieText(g)}
                </span>
              </div>
              {#if g.preis != null}<span class="zahl">{chf(g.preis)}</span>{/if}
            </li>
          {/each}
        </ul>
      </div>
      {#if ausgemustert.length}
        <details class="panel">
          <summary>Ausgemustert ({ausgemustert.length})</summary>
          <ul class="liste">
            {#each ausgemustert as g (g.id)}
              <li class="eintrag ruhig"><div class="info"><span class="titel">{g.name}</span></div>{#if g.preis != null}<span class="zahl">{chf(g.preis)}</span>{/if}</li>
            {/each}
          </ul>
        </details>
      {/if}
      <details class="panel">
        <summary>Gegenstände erfassen und bearbeiten</summary>
        <p class="sehr-klein gedaempft">Garantie in Monaten ab Kaufdatum, in der Schweiz meist 24. Weicht sie ab, «Garantie bis» setzen. Für Wartungen ein Intervall in Monaten eintragen.</p>
        <TabellenEditor tabelle="gegenstaende" spalten={['name', 'kategorie', 'ort', 'marke', 'gekauft_am', 'preis', 'garantie_monate', 'wartung_monate', 'ausgemustert']} sort="name" neuText="Gegenstand" bind:zeilen />
      </details>
    </div>
  {:else}
    <div class="stapel">
      <div class="panel">
        {#if !mitWartung.length}<div class="leer">Kein Gegenstand mit Wartungsintervall. In der Liste «Wartung alle» setzen.</div>{/if}
        <ul class="liste">
          {#each mitWartung as g (g.id)}
            <li class="eintrag" class:dringend={(g.wartungTage ?? 1) <= 0}>
              <div class="info">
                <span class="titel">{g.name}</span>
                <span class="sehr-klein gedaempft">{g.wartung_text || 'Wartung'} · alle {g.wartung_monate} Monate · {wartungText(g)}</span>
                {#if g.letzte_wartung}<span class="sehr-klein gedaempft">zuletzt {datum(g.letzte_wartung, true)}</span>{/if}
              </div>
              <button class="leise klein" onclick={() => gewartet(g)}>Erledigt</button>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
</ModulRahmen>

<style>
  h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  .kennzahlen { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .gross { font-size: 1.45rem; font-weight: 600; }
  .warnfeld { border-color: var(--warnung); }
  .liste { list-style: none; padding: 0; margin: 0; }
  .eintrag { display: flex; align-items: center; gap: 0.7rem; padding: 0.5rem 0; border-bottom: 1px solid var(--rand); }
  .eintrag:last-child { border-bottom: 0; }
  .eintrag .info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .eintrag.dringend .titel { color: var(--warnung); }
  .eintrag.ruhig { opacity: 0.6; }
  .gruppen li { padding: 0.3rem 0; }
  .zeile-knopf { display: flex; justify-content: space-between; width: 100%; background: none; border: 0; padding: 0; min-height: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .zeile-knopf:hover { color: var(--akzent); }
  .leiste { height: 6px; background: var(--flaeche-3); border-radius: 3px; margin-top: 0.25rem; overflow: hidden; }
  .leiste span { display: block; height: 100%; background: var(--akzent); }
  .filter { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .filter .wachsen { flex: 1; min-width: 10rem; }
  .knopf { white-space: nowrap; }
  summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; }
  details[open] summary { margin-bottom: 0.5rem; }
</style>
