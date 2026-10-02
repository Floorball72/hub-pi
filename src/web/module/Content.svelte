<script lang="ts">
  import Icon from '../komponenten/Icon.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { datumZeit, zeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';

  interface Punkt { text: string; erledigt: boolean }
  interface Beitrag { id: string; titel: string; zeit: string; plattform: string | null; art: string | null; status: string; notizen: string | null; checkliste: Punkt[] | null; event_id: string | null }
  interface Antwort { beitraege: Beitrag[]; events: { id: string; titel: string; start: string }[]; plattformen: string[]; status: string[] }

  const ZONE = 'Europe/Zurich';
  const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const STATUS_KLASSE: Record<string, string> = { Idee: 'idee', 'in Arbeit': 'arbeit', bereit: 'bereit', veröffentlicht: 'fertig' };

  let tab = $state('Kalender');
  let ansicht = $state<'Monat' | 'Woche' | 'Zeitstrahl'>(lesen('content.ansicht', 'Monat'));
  let bezug = $state(new Date());
  let d = $state<Antwort | null>(null);
  let offen = $state<Beitrag | null>(null);
  let neu = $state<{ titel: string; zeit: string; art: string; plattform: string; event_id: string } | null>(null);
  let vorlagenText = $state('');

  const tagKey = (t: Date) => t.toLocaleDateString('sv-SE', { timeZone: ZONE });
  function wochenStart(t: Date) {
    const x = new Date(t);
    x.setHours(12, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  const raster = $derived.by(() => {
    let start: Date;
    let tage: number;
    if (ansicht === 'Woche') {
      start = wochenStart(bezug);
      tage = 7;
    } else if (ansicht === 'Monat') {
      const erster = new Date(bezug.getFullYear(), bezug.getMonth(), 1, 12);
      start = wochenStart(erster);
      const letzter = new Date(bezug.getFullYear(), bezug.getMonth() + 1, 0, 12);
      tage = Math.ceil((letzter.getTime() - start.getTime()) / 86400000 / 7 + 0.01) * 7;
    } else {
      start = new Date();
      start.setHours(0, 0, 0, 0);
      tage = 42;
    }
    return Array.from({ length: tage }, (_, i) => new Date(start.getTime() + i * 86400000));
  });

  async function laden() {
    const von = new Date(raster[0]);
    von.setHours(0, 0, 0, 0);
    const bis = new Date(raster[raster.length - 1].getTime() + 86400000);
    bis.setHours(0, 0, 0, 0);
    d = await api.get<Antwort>(`/api/m/content/beitraege?von=${von.toISOString()}&bis=${bis.toISOString()}`);
    if (offen) offen = d.beitraege.find((b) => b.id === offen!.id) ?? null;
  }
  $effect(() => {
    if (tab === 'Kalender') {
      void raster;
      laden();
    }
    if (tab === 'Checklisten')
      api.get<Record<string, string[]>>('/api/m/content/vorlagen').then((v) => {
        vorlagenText = Object.entries(v).map(([art, l]) => `${art}: ${l.join('; ')}`).join('\n');
      });
  });

  const proTag = $derived.by(() => {
    const m = new Map<string, { beitraege: Beitrag[]; events: { id: string; titel: string }[] }>();
    for (const t of raster) m.set(tagKey(t), { beitraege: [], events: [] });
    for (const b of d?.beitraege ?? []) m.get(tagKey(new Date(b.zeit)))?.beitraege.push(b);
    for (const e of d?.events ?? []) m.get(tagKey(new Date(e.start)))?.events.push(e);
    return m;
  });

  function blaettern(richtung: number) {
    const x = new Date(bezug);
    if (ansicht === 'Monat') x.setMonth(x.getMonth() + richtung, 1);
    else x.setDate(x.getDate() + 7 * richtung);
    bezug = x;
  }
  function ansichtSetzen(a: typeof ansicht) {
    ansicht = a;
    schreiben('content.ansicht', a);
  }
  const titel = $derived(
    ansicht === 'Monat'
      ? bezug.toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })
      : ansicht === 'Woche'
        ? `Woche ab ${raster[0].toLocaleDateString('de-CH', { day: 'numeric', month: 'long' })}`
        : 'Nächste 6 Wochen',
  );
  const heute = tagKey(new Date());

  async function aendern(b: Beitrag, aenderung: Partial<Beitrag>) {
    try {
      await api.post(`/api/m/content/beitrag/${b.id}`, aenderung);
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  function punktUmschalten(b: Beitrag, i: number) {
    const liste = (b.checkliste ?? []).map((p, j) => (j === i ? { ...p, erledigt: !p.erledigt } : p));
    aendern(b, { checkliste: liste });
  }
  function neuOeffnen(t?: Date) {
    const z = new Date(t ?? new Date());
    z.setHours(18, 0, 0, 0);
    const lokal = new Date(z.getTime() - z.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    neu = { titel: '', zeit: lokal, art: 'Post', plattform: 'Instagram', event_id: '' };
    offen = null;
  }
  async function neuSpeichern() {
    if (!neu) return;
    try {
      await api.post('/api/m/content/neu', { ...neu, zeit: new Date(neu.zeit).toISOString() });
      melden('Beitrag geplant');
      neu = null;
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function vorlagenSpeichern() {
    const obj: Record<string, string[]> = {};
    for (const zeile of vorlagenText.split('\n')) {
      const [art, rest] = zeile.split(':');
      if (art?.trim() && rest) obj[art.trim()] = rest.split(';').map((s) => s.trim()).filter(Boolean);
    }
    try {
      await api.put('/api/m/content/vorlagen', obj);
      melden('Checklisten gespeichert');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  const fortschritt = (b: Beitrag) => {
    const l = b.checkliste ?? [];
    return l.length ? `${l.filter((p) => p.erledigt).length}/${l.length}` : '';
  };
</script>

<ModulRahmen modulId="content" tabs={['Kalender', 'Checklisten', 'Alle Beiträge']} bind:tab>
  {#if tab === 'Kalender'}
    <div class="leiste">
      <div class="zeile">
        {#if ansicht !== 'Zeitstrahl'}
          <button class="klein" aria-label="Zurück" onclick={() => blaettern(-1)}><Icon name="zurueck" groesse={16} /></button>
          <button class="klein" onclick={() => (bezug = new Date())}>Heute</button>
          <button class="klein" aria-label="Weiter" onclick={() => blaettern(1)}><Icon name="pfeil" groesse={16} /></button>
        {/if}
        <strong class="monat">{titel}</strong>
      </div>
      <div class="zeile">
        <div class="umschalter">
          {#each ['Monat', 'Woche', 'Zeitstrahl'] as const as a (a)}
            <button class="klein" class:aktiv={ansicht === a} onclick={() => ansichtSetzen(a)}>{a}</button>
          {/each}
        </div>
        <button class="primaer klein" onclick={() => neuOeffnen()}><Icon name="plus" groesse={16} />Beitrag</button>
      </div>
    </div>

    <div class="aufteilung" class:mit-panel={offen || neu}>
      <div>
        {#if !d}
          <div class="laedt" style="height:380px"></div>
        {:else if ansicht === 'Zeitstrahl'}
          <ol class="zeitstrahl">
            {#each raster as t (t.getTime())}
              {@const tag = proTag.get(tagKey(t))}
              {#if tag && (tag.beitraege.length || tag.events.length)}
                <li>
                  <div class="tagkopf" class:heute={tagKey(t) === heute}>{t.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                  {#each tag.events as e (e.id)}<a class="ev-chip" href={`/modul/events?event=${e.id}`}><Icon name="events" groesse={14} />{e.titel}</a>{/each}
                  {#each tag.beitraege as b (b.id)}
                    <button class="beitrag-zeile {STATUS_KLASSE[b.status]}" onclick={() => ((offen = b), (neu = null))}>
                      <span class="zahl">{zeit(b.zeit)}</span><span class="wachsen">{b.titel}</span><span class="sehr-klein gedaempft">{b.art} · {b.plattform}</span><span class="marke">{b.status}</span>
                    </button>
                  {/each}
                </li>
              {/if}
            {:else}<li class="leer">Nichts geplant.</li>{/each}
          </ol>
        {:else}
          <div class="kalender" class:woche={ansicht === 'Woche'}>
            {#each WOCHENTAGE as w (w)}<div class="wtag sehr-klein gedaempft">{w}</div>{/each}
            {#each raster as t (t.getTime())}
              {@const tag = proTag.get(tagKey(t))}
              <div class="zelle" class:fremd={ansicht === 'Monat' && t.getMonth() !== bezug.getMonth()} class:heute={tagKey(t) === heute}>
                <div class="zeile-zwischen"><span class="sehr-klein tagnr">{t.getDate()}</span><button class="leise mini" aria-label="Beitrag an diesem Tag planen" onclick={() => neuOeffnen(t)}>+</button></div>
                {#each tag?.events ?? [] as e (e.id)}<a class="ev-chip" href={`/modul/events?event=${e.id}`} title={e.titel}><Icon name="events" groesse={12} />{e.titel}</a>{/each}
                {#each tag?.beitraege ?? [] as b (b.id)}
                  <button class="chip {STATUS_KLASSE[b.status]}" class:gewaehlt={offen?.id === b.id} title={`${b.titel} (${b.status})`} onclick={() => ((offen = b), (neu = null))}>
                    <span class="zahl">{zeit(b.zeit)}</span> {b.titel}
                  </button>
                {/each}
              </div>
            {/each}
          </div>
          <div class="legende sehr-klein">
            {#each Object.entries(STATUS_KLASSE) as [s, k] (s)}<span class="zeile"><span class="farbe {k}"></span>{s}</span>{/each}
            <span class="zeile"><Icon name="events" groesse={12} />Veranstaltung</span>
          </div>
        {/if}
      </div>

      {#if offen}
        <aside class="panel seite">
          <div class="zeile-zwischen"><h3>{offen.titel}</h3><button class="leise klein" aria-label="Schliessen" onclick={() => (offen = null)}><Icon name="schliessen" groesse={16} /></button></div>
          <div class="klein gedaempft">{datumZeit(offen.zeit)} · {offen.art} · {offen.plattform}</div>
          {#if offen.event_id}<a class="klein" href={`/modul/events?event=${offen.event_id}`}>Zur Veranstaltung</a>{/if}
          <h4>Status</h4>
          <div class="umschalter">
            {#each d?.status ?? [] as s (s)}
              <button class="klein" class:aktiv={offen.status === s} onclick={() => aendern(offen!, { status: s })}>{s}</button>
            {/each}
          </div>
          <h4>Checkliste {fortschritt(offen)}</h4>
          <ul class="liste">
            {#each offen.checkliste ?? [] as p, i (i)}
              <li><label class="haken"><input type="checkbox" checked={p.erledigt} onchange={() => punktUmschalten(offen!, i)} /><span class:erledigt={p.erledigt}>{p.text}</span></label></li>
            {:else}<li class="leer">Keine Checkliste.</li>{/each}
          </ul>
          {#if offen.notizen}<h4>Notizen</h4><p class="notizen klein">{offen.notizen}</p>{/if}
          <p class="sehr-klein gedaempft">Bearbeiten von Titel, Zeit und Notizen unter «Alle Beiträge». Der Hub veröffentlicht nichts selbst.</p>
        </aside>
      {:else if neu}
        <aside class="panel seite">
          <div class="zeile-zwischen"><h3>Neuer Beitrag</h3><button class="leise klein" aria-label="Schliessen" onclick={() => (neu = null)}><Icon name="schliessen" groesse={16} /></button></div>
          <form onsubmit={(e) => { e.preventDefault(); neuSpeichern(); }}>
            <div class="feld"><label for="nt">Titel</label><input id="nt" bind:value={neu.titel} required maxlength="200" /></div>
            <div class="feld"><label for="nz">Zeitpunkt</label><input id="nz" type="datetime-local" bind:value={neu.zeit} required /></div>
            <div class="feld"><label for="na">Art</label><select id="na" bind:value={neu.art}>{#each ['Post', 'Story', 'Reel', 'Video', 'Karussell'] as a (a)}<option>{a}</option>{/each}</select></div>
            <div class="feld"><label for="np">Plattform</label><select id="np" bind:value={neu.plattform}>{#each d?.plattformen ?? ['Instagram'] as p (p)}<option>{p}</option>{/each}</select></div>
            <div class="feld"><label for="ne">Veranstaltung</label><select id="ne" bind:value={neu.event_id}><option value="">Keine</option>{#each d?.events ?? [] as e (e.id)}<option value={e.id}>{e.titel}</option>{/each}</select></div>
            <button class="primaer" type="submit" style="margin-top:12px">Planen</button>
          </form>
        </aside>
      {/if}
    </div>
  {:else if tab === 'Checklisten'}
    <div class="panel formular">
      <p class="klein gedaempft">Eine Zeile pro Art, Punkte mit Strichpunkt getrennt. Neue Beiträge erhalten die passende Checkliste.</p>
      <textarea rows="8" bind:value={vorlagenText}></textarea>
      <button class="primaer" style="margin-top:10px" onclick={vorlagenSpeichern}>Speichern</button>
    </div>
  {:else}
    <div class="panel"><TabellenEditor tabelle="content_beitraege" sort="-zeit" spalten={['titel', 'zeit', 'art', 'status']} neuText="Beitrag" /></div>
  {/if}
</ModulRahmen>

<style>
  .leiste {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .monat {
    margin-left: 6px;
    text-transform: capitalize;
  }
  .umschalter {
    display: inline-flex;
    gap: 2px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
    border-radius: var(--radius-klein);
    padding: 2px;
    flex-wrap: wrap;
  }
  .umschalter button {
    border-color: transparent;
    background: transparent;
  }
  .umschalter button.aktiv {
    background: var(--flaeche-3);
    border-color: var(--rand-hell);
  }
  .aufteilung {
    display: grid;
    gap: 12px;
  }
  @media (min-width: 1000px) {
    .aufteilung.mit-panel {
      grid-template-columns: 1fr 340px;
    }
  }
  .kalender {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 3px;
  }
  .wtag {
    text-align: center;
    padding: 2px 0;
  }
  .zelle {
    background: var(--flaeche);
    border: 1px solid var(--rand);
    border-radius: 6px;
    min-height: 92px;
    padding: 3px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .woche .zelle {
    min-height: 260px;
  }
  .zelle.fremd {
    opacity: 0.45;
  }
  .zelle.heute {
    border-color: var(--akzent);
  }
  .tagnr {
    padding-left: 3px;
  }
  .mini {
    min-height: 0;
    padding: 0 6px;
    font-size: 0.85rem;
  }
  .chip {
    display: block;
    width: 100%;
    min-height: 0;
    text-align: left;
    font-size: 0.72rem;
    padding: 2px 4px;
    border-radius: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-left: 3px solid var(--neutral);
  }
  .chip.gewaehlt {
    outline: 1px solid var(--akzent);
  }
  .idee {
    border-left-color: #94a3b8 !important;
  }
  .arbeit {
    border-left-color: var(--warnung) !important;
  }
  .bereit {
    border-left-color: var(--akzent) !important;
  }
  .fertig {
    border-left-color: var(--ok) !important;
    opacity: 0.75;
  }
  .ev-chip {
    display: flex;
    gap: 3px;
    align-items: center;
    font-size: 0.7rem;
    color: #c4b5fd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .legende {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 8px;
    color: var(--text-2);
  }
  .farbe {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border-left: 3px solid;
    display: inline-block;
  }
  .zeitstrahl {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .zeitstrahl > li {
    padding: 8px 0 8px 14px;
    border-left: 2px solid var(--rand-hell);
  }
  .tagkopf {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .tagkopf.heute {
    color: var(--akzent);
  }
  .beitrag-zeile {
    display: flex;
    width: 100%;
    gap: 10px;
    margin-top: 4px;
    border-left: 3px solid;
    flex-wrap: wrap;
    text-align: left;
  }
  .seite h3 {
    margin: 0;
  }
  .seite h4 {
    margin: 14px 0 6px;
    font-size: 0.85rem;
    color: var(--text-2);
  }
  .haken {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 0.9rem;
    color: var(--text);
    margin: 0;
    cursor: pointer;
  }
  .erledigt {
    text-decoration: line-through;
    color: var(--text-3);
  }
  .notizen {
    white-space: pre-wrap;
  }
  .formular {
    max-width: 640px;
  }
  @media (max-width: 640px) {
    .zelle {
      min-height: 64px;
    }
    .chip .zahl {
      display: none;
    }
  }
</style>
