<script lang="ts">
  import Icon from '../komponenten/Icon.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import WetterIcon from '../komponenten/WetterIcon.svelte';
  import { wetterText } from '../../server/geteilt/wetter.ts';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datum, datumZeit, zeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { navigieren, parameter } from '../lib/router.svelte.ts';

  interface Ev {
    id: string;
    titel: string;
    start: string;
    ende: string | null;
    ort_name: string | null;
    typ: string | null;
    status: string;
    notizen: string | null;
    link: string | null;
    fortschritt?: { total: number; erledigt: number };
    vorbei?: boolean;
  }
  interface Aufgabe { id: string; text: string; frist: string | null; erledigt: boolean }
  interface Detail {
    event: Ev;
    ablauf: { id: string; zeit: string; dauer_min: number | null; text: string; rolle: string | null }[];
    aufgaben: Aufgabe[];
    checkliste: Aufgabe[];
    wetter: { stunden: { t: number; temp: number | null; code: number | null; regen: number | null; boeen: number | null; tag: boolean }[]; tag: { tmax: number | null; tmin: number | null; regenWahrsch: number | null; code: number | null } | null; demo: boolean; fehler?: string } | null;
    beitraege: { id: string; titel: string; zeit: string; plattform: string | null; status: string }[];
    vorlagen: { id: string; name: string }[];
  }

  let tab = $state('Übersicht');
  let liste = $state<Ev[] | null>(null);
  let detail = $state<Detail | null>(null);
  let jetzt = $state(Date.now());
  let zeigeVergangene = $state(false);
  const gewaehlt = $derived(parameter('event'));

  let neu = $state({ titel: '', start: '', vorlage_id: '', ort_name: '', typ: '', link: '', notizen: '' });
  let vorlagen = $state<{ id: string; name: string }[]>([]);

  async function listeLaden() {
    liste = await api.get<Ev[]>('/api/m/events/liste');
  }
  async function detailLaden(id: string) {
    try {
      detail = await api.get<Detail>(`/api/m/events/event/${id}`);
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
      navigieren('/modul/events', true);
    }
  }

  $effect(() => {
    const t = setInterval(() => (jetzt = Date.now()), 1000);
    return () => clearInterval(t);
  });
  $effect(() => {
    if (tab !== 'Übersicht') return;
    if (gewaehlt) detailLaden(gewaehlt);
    else {
      detail = null;
      listeLaden();
    }
  });
  $effect(() => {
    if (tab === 'Neu') {
      api.get<{ id: string; name: string }[]>('/api/daten/event_vorlagen?sort=name&limit=100').then((v) => (vorlagen = v));
      const p = new URLSearchParams(location.search);
      // Übernahme aus «Veranstaltungen in der Region»
      if (p.get('titel')) {
        neu.titel = p.get('titel') ?? '';
        neu.start = p.get('start') ? lokalInput(p.get('start')!) : '';
        neu.ort_name = p.get('ort') ?? '';
        neu.link = p.get('link') ?? '';
      }
    }
  });
  $effect(() => {
    if (parameter('neu')) tab = 'Neu';
  });

  function lokalInput(iso: string) {
    const d = new Date(iso);
    const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return t.toISOString().slice(0, 16);
  }

  function countdown(iso: string) {
    const s = Math.floor((new Date(iso).getTime() - jetzt) / 1000);
    if (s <= 0) return null;
    const tage = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return { tage, h, m, s: s % 60 };
  }

  async function abhaken(a: Aufgabe) {
    try {
      await api.post(`/api/m/events/aufgabe/${a.id}`, { erledigt: !a.erledigt });
      a.erledigt = !a.erledigt;
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  async function erstellen() {
    try {
      const ev = await api.post<Ev>('/api/m/events/neu', { ...neu, start: neu.start ? new Date(neu.start).toISOString() : '' });
      melden('Veranstaltung erstellt');
      neu = { titel: '', start: '', vorlage_id: '', ort_name: '', typ: '', link: '', notizen: '' };
      tab = 'Übersicht';
      navigieren(`/modul/events?event=${ev.id}`);
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  async function alsVorlage() {
    if (!detail) return;
    if (!(await bestaetigen('Als Vorlage speichern?', `Aufgaben, Checkliste und Ablauf von «${detail.event.titel}» werden als neue Vorlage gespeichert. Fristen werden relativ zum Beginn übernommen.`, 'Speichern'))) return;
    try {
      await api.post(`/api/m/events/event/${detail.event.id}/als-vorlage`, { bestaetigt: true });
      melden('Vorlage gespeichert');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  const kommende = $derived((liste ?? []).filter((e) => zeigeVergangene || !e.vorbei));
  const offenUeberfaellig = (a: Aufgabe) => !a.erledigt && a.frist && new Date(a.frist).getTime() < jetzt;
</script>

<ModulRahmen modulId="events" tabs={['Übersicht', 'Neu', 'Vorlagen', 'Alle Daten']} bind:tab>
  {#if tab === 'Übersicht'}
    {#if gewaehlt}
      {#if !detail}
        <div class="laedt" style="height:300px"></div>
      {:else}
        {@const e = detail.event}
        {@const c = countdown(e.start)}
        <button class="leise klein" onclick={() => navigieren('/modul/events')}><Icon name="zurueck" groesse={16} />Alle Veranstaltungen</button>
        <div class="kopf panel">
          <div class="wachsen">
            <div class="zeile"><span class="marke">{e.typ ?? 'Veranstaltung'}</span><span class="marke" class:ok={e.status === 'bestätigt'} class:ausfall={e.status === 'abgesagt'}>{e.status}</span></div>
            <h2>{e.titel}</h2>
            <div class="klein gedaempft">{datumZeit(e.start)}{e.ende ? ` bis ${zeit(e.ende)}` : ''}{e.ort_name ? ` · ${e.ort_name}` : ''}</div>
            {#if e.link}<a class="klein" href={e.link} target="_blank" rel="noopener noreferrer">Link öffnen</a>{/if}
          </div>
          {#if c}
            <div class="countdown" aria-label="Countdown">
              <div><span class="zahl">{c.tage}</span><span class="sehr-klein">Tage</span></div>
              <div><span class="zahl">{String(c.h).padStart(2, '0')}</span><span class="sehr-klein">Std</span></div>
              <div><span class="zahl">{String(c.m).padStart(2, '0')}</span><span class="sehr-klein">Min</span></div>
              <div><span class="zahl">{String(c.s).padStart(2, '0')}</span><span class="sehr-klein">Sek</span></div>
            </div>
          {:else}
            <span class="marke">begonnen oder vorbei</span>
          {/if}
        </div>

        <div class="raster-2" style="margin-top:12px">
          <div class="panel">
            <h3>Ablaufplan</h3>
            <ul class="liste">
              {#each detail.ablauf as a (a.id)}
                <li class="zeile"><span class="zahl zeitspalte">{zeit(a.zeit)}</span><span class="wachsen">{a.text}{a.dauer_min ? ` (${a.dauer_min} min)` : ''}</span>{#if a.rolle}<span class="marke">{a.rolle}</span>{/if}</li>
              {:else}<li class="leer">Noch kein Ablauf. Einträge unter «Alle Daten» erfassen.</li>{/each}
            </ul>
          </div>
          <div class="panel">
            <h3>Wetter am Ort</h3>
            {#if detail.wetter}
              {#if detail.wetter.tag}
                <div class="zeile"><WetterIcon code={detail.wetter.tag.code} groesse={40} /><div><div>{wetterText(detail.wetter.tag.code)}</div><div class="klein gedaempft">{detail.wetter.tag.tmin ?? '–'}° bis {detail.wetter.tag.tmax ?? '–'}°, Regen {detail.wetter.tag.regenWahrsch ?? '–'} %</div></div>{#if detail.wetter.demo}<span class="marke demo">Demo</span>{/if}</div>
              {/if}
              <div class="stunden">
                {#each detail.wetter.stunden as s (s.t)}
                  <div class="stunde"><span class="sehr-klein gedaempft">{zeit(new Date(s.t).toISOString())}</span><WetterIcon code={s.code} tag={s.tag} groesse={24} /><span class="zahl">{s.temp !== null ? Math.round(s.temp) : '–'}°</span><span class="sehr-klein gedaempft">{s.regen ?? 0} mm</span></div>
                {/each}
              </div>
              <p class="sehr-klein gedaempft">Wetterdaten: Open-Meteo</p>
            {:else}
              <p class="leer">Wetter erscheint 7 Tage vor Beginn, sobald der Ort Koordinaten hat.</p>
            {/if}
          </div>
          <div class="panel">
            <h3>Aufgaben</h3>
            <ul class="liste">
              {#each detail.aufgaben as a (a.id)}
                <li><label class="haken"><input type="checkbox" checked={a.erledigt} onchange={() => abhaken(a)} /><span class:erledigt={a.erledigt} class="wachsen">{a.text}</span>{#if a.frist}<span class="marke" class:ausfall={offenUeberfaellig(a)}>{datum(a.frist)}</span>{/if}</label></li>
              {:else}<li class="leer">Keine Aufgaben.</li>{/each}
            </ul>
          </div>
          <div class="panel">
            <h3>Checkliste</h3>
            <ul class="liste">
              {#each detail.checkliste as a (a.id)}
                <li><label class="haken"><input type="checkbox" checked={a.erledigt} onchange={() => abhaken(a)} /><span class:erledigt={a.erledigt}>{a.text}</span></label></li>
              {:else}<li class="leer">Keine Einträge.</li>{/each}
            </ul>
          </div>
          <div class="panel">
            <h3>Content zu dieser Veranstaltung</h3>
            <ul class="liste">
              {#each detail.beitraege as b (b.id)}
                <li class="zeile"><span class="wachsen">{b.titel}</span><span class="sehr-klein gedaempft">{datumZeit(b.zeit)}</span><span class="marke">{b.status}</span></li>
              {:else}<li class="leer">Noch keine Beiträge verknüpft. Im Content Kalender die Veranstaltung auswählen.</li>{/each}
            </ul>
          </div>
          <div class="panel">
            <h3>Notizen</h3>
            {#if e.notizen}<p class="notizen">{e.notizen}</p>{:else}<p class="leer">Keine Notizen.</p>{/if}
            <button class="klein" onclick={alsVorlage}>Als Vorlage speichern</button>
          </div>
        </div>
      {/if}
    {:else if !liste}
      <div class="laedt" style="height:240px"></div>
    {:else}
      <div class="zeile-zwischen" style="margin-bottom:10px">
        <label class="zeile klein"><input type="checkbox" bind:checked={zeigeVergangene} />Vergangene zeigen</label>
        <button class="primaer klein" onclick={() => (tab = 'Neu')}><Icon name="plus" groesse={16} />Veranstaltung</button>
      </div>
      <div class="raster">
        {#each kommende as e (e.id)}
          {@const c = countdown(e.start)}
          <a class="panel ev" class:vorbei={e.vorbei} href={`/modul/events?event=${e.id}`}>
            <div class="zeile-zwischen"><span class="marke">{e.typ ?? 'Veranstaltung'}</span><span class="sehr-klein gedaempft">{e.status}</span></div>
            <strong>{e.titel}</strong>
            <span class="klein gedaempft">{datumZeit(e.start)}{e.ort_name ? ` · ${e.ort_name}` : ''}</span>
            <div class="zeile-zwischen">
              <span class="zahl gross">{c ? (c.tage > 0 ? `${c.tage} T` : `${c.h} h ${c.m} min`) : 'vorbei'}</span>
              {#if e.fortschritt?.total}<span class="klein">{e.fortschritt.erledigt} von {e.fortschritt.total} erledigt</span>{/if}
            </div>
            {#if e.fortschritt?.total}<div class="balken"><div style="width:{(100 * e.fortschritt.erledigt) / e.fortschritt.total}%"></div></div>{/if}
          </a>
        {:else}
          <p class="leer">Keine Veranstaltungen geplant.</p>
        {/each}
      </div>
    {/if}
  {:else if tab === 'Neu'}
    <form class="panel formular" onsubmit={(ev) => { ev.preventDefault(); erstellen(); }}>
      <div class="feld"><label for="et">Titel</label><input id="et" bind:value={neu.titel} required maxlength="300" /></div>
      <div class="feld"><label for="es">Beginn</label><input id="es" type="datetime-local" bind:value={neu.start} required /></div>
      <div class="feld"><label for="ev">Vorlage</label><select id="ev" bind:value={neu.vorlage_id}><option value="">Ohne Vorlage</option>{#each vorlagen as v (v.id)}<option value={v.id}>{v.name}</option>{/each}</select></div>
      <div class="feld"><label for="eo">Ort</label><input id="eo" bind:value={neu.ort_name} maxlength="200" /></div>
      <div class="feld"><label for="ety">Typ</label><input id="ety" bind:value={neu.typ} maxlength="100" placeholder="z.B. Turnier, Hochzeit, Firmenanlass…" /></div>
      <div class="feld"><label for="el">Link</label><input id="el" type="url" bind:value={neu.link} placeholder="https://" /></div>
      <div class="feld"><label for="en">Notizen</label><textarea id="en" rows="3" bind:value={neu.notizen}></textarea></div>
      <p class="sehr-klein gedaempft">Koordinaten für das Wetter lassen sich danach unter «Alle Daten» ergänzen. Bitte keine Personendaten Dritter erfassen.</p>
      <button class="primaer" type="submit">Erstellen</button>
    </form>
  {:else if tab === 'Vorlagen'}
    <p class="klein gedaempft">Einträge als JSON: <code>{'[{"text":"Halle reservieren","art":"Aufgabe","tage":-30}]'}</code>, Ablauf: <code>{'[{"minuten":-60,"text":"Aufbau"}]'}</code>. Einfacher: eine Veranstaltung fertig planen und «Als Vorlage speichern».</p>
    <div class="panel"><TabellenEditor tabelle="event_vorlagen" spalten={['name', 'typ']} neuText="Vorlage" /></div>
  {:else}
    <div class="stapel">
      <div class="panel"><TabellenEditor tabelle="events" sort="-start" spalten={['titel', 'start', 'ort_name', 'status']} titel="Veranstaltungen" neuText="Veranstaltung" /></div>
      <div class="panel"><TabellenEditor tabelle="event_ablauf" sort="zeit" spalten={['event_id', 'zeit', 'text', 'rolle']} titel="Ablauf" neuText="Programmpunkt" /></div>
      <div class="panel"><TabellenEditor tabelle="event_aufgaben" sort="frist" spalten={['event_id', 'text', 'art', 'frist', 'erledigt']} titel="Aufgaben und Checkliste" neuText="Aufgabe" /></div>
    </div>
  {/if}
</ModulRahmen>

<style>
  .kopf {
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .kopf h2 {
    margin: 6px 0 2px;
  }
  .countdown {
    display: flex;
    gap: 8px;
  }
  .countdown > div {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: var(--flaeche-3);
    border: 1px solid var(--rand-hell);
    border-radius: var(--radius-klein);
    padding: 6px 10px;
    min-width: 56px;
  }
  .countdown .zahl {
    font-size: 1.6rem;
  }
  .zeitspalte {
    width: 48px;
  }
  .haken {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 0.95rem;
    color: var(--text);
    margin: 0;
    cursor: pointer;
  }
  .erledigt {
    text-decoration: line-through;
    color: var(--text-3);
  }
  .stunden {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    margin-top: 10px;
  }
  .stunde {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 48px;
  }
  .notizen {
    white-space: pre-wrap;
  }
  .ev {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--text);
  }
  @media (hover: hover) and (pointer: fine) {
    .ev:hover {
      text-decoration: none;
      border-color: #3a4d65;
    }
  }
  .ev.vorbei {
    opacity: 0.6;
  }
  .gross {
    font-size: 1.4rem;
  }
  .balken {
    height: 5px;
    background: var(--flaeche-3);
    border-radius: 3px;
    overflow: hidden;
  }
  .balken > div {
    height: 100%;
    background: var(--akzent);
  }
  .formular {
    max-width: 560px;
  }
</style>
