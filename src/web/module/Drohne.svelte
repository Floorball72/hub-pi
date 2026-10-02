<script lang="ts">
  import { himmelsrichtung, wetterText } from '../../server/geteilt/wetter.ts';
  import Icon from '../komponenten/Icon.svelte';
  import Karte from '../komponenten/Karte.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import Extras from './drohne/Extras.svelte';
  import Sonne from './drohne/Sonne.svelte';
  import WetterIcon from '../komponenten/WetterIcon.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { datumZeit, zeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { navigieren, ort as ortRoute, parameter } from '../lib/router.svelte.ts';

  interface OrtZeile {
    ort: { id: string; name: string; lat: number; lon: number; status: string; shortlist: boolean; notizen: string | null };
    naechstesFenster: { start: number; ende: number; stunden: number } | null;
    jetztOk: boolean | null;
    gruende: string[];
  }
  interface Detail {
    ort: OrtZeile['ort'] & { flughoehe_m: number | null };
    grenzen: Record<string, number | null>;
    stunden: { t: number; temp: number | null; regen: number | null; code: number | null; wind10: number | null; wind80: number | null; wind120: number | null; boeen: number | null; richtung: number | null; sicht: number | null; wolken: number | null; tag: boolean; urteil: { ok: boolean; gruende: string[] } }[];
    tage: { datum: string; sonne: { aufgang: string | null; untergang: string | null; goldMorgen: [string | null, string | null]; goldAbend: [string | null, string | null]; blauAbend: [string | null, string | null] }; mond: { name: string; beleuchtet: number } }[];
    fenster: { start: number; ende: number; stunden: number }[];
    kp: { aktuell: number | null; maxPrognose: number | null };
    luftraum: { zonen: { name: string; einschraenkung: string; hinweis: string | null; bewilligung: string | null }[]; fehler: string | null; demo: boolean };
    wetterDemo: boolean;
    wetterFehler: string | null;
    notizen: { id: string; text: string; erstellt: string }[];
  }

  let tab = $state('Planung');
  let orte = $state<OrtZeile[]>([]);
  let detail = $state<Detail | null>(null);
  let neu = $state<{ name: string; lat: number; lon: number } | null>(null);
  let notiz = $state('');
  let karte = $state<{ fliegen: (lat: number, lon: number, z?: number) => void } | null>(null);
  const ortId = $derived((void ortRoute.suche, parameter('ort')));

  async function laden() {
    orte = await api.get<OrtZeile[]>('/api/m/drohne/orte');
  }
  $effect(() => {
    laden();
  });
  $effect(() => {
    detail = null;
    if (ortId) {
      tab = 'Planung';
      api.get<Detail>(`/api/m/drohne/ort/${ortId}`).then((d) => {
        detail = d;
        karte?.fliegen(d.ort.lat, d.ort.lon, 13);
      });
    }
  });

  function klick(lat: number, lon: number) {
    neu = { name: '', lat: Math.round(lat * 100000) / 100000, lon: Math.round(lon * 100000) / 100000 };
  }

  async function ortSpeichern(e: SubmitEvent) {
    e.preventDefault();
    if (!neu) return;
    try {
      const o = await api.post<{ id: string }>('/api/daten/drohnen_orte', neu);
      neu = null;
      melden('Ort gespeichert');
      await laden();
      navigieren(`/modul/drohne?ort=${o.id}`);
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    }
  }

  async function notizSpeichern(e: SubmitEvent) {
    e.preventDefault();
    if (!detail || !notiz.trim()) return;
    await api.post('/api/daten/notizen', { text: notiz, bezug_typ: 'ort', bezug_id: detail.ort.id, bezug_name: detail.ort.name });
    notiz = '';
    detail = await api.get<Detail>(`/api/m/drohne/ort/${detail.ort.id}`);
  }

  const fz = (t: number) => new Date(t).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const windHoehe = (s: Detail['stunden'][number], h: number | null) => ((h ?? 120) < 45 ? s.wind10 : (h ?? 120) < 100 ? s.wind80 : s.wind120);
  const naechste48 = $derived(detail ? detail.stunden.filter((s) => s.t >= Date.now() - 3600000).slice(0, 48) : []);
</script>

<ModulRahmen modulId="drohne" tabs={['Planung', 'Sonne', 'Orte', 'Kundendrehs', 'Logbuch', 'Akkus und Wartung', 'Dokumente']} bind:tab>
  {#if tab === 'Planung'}
    <div class="planung">
      <div class="karte-spalte">
        <Karte bind:this={karte} hoehe="min(70vh, 620px)" gruppen={['Drohne', 'Luftraum', 'Wetter']} zentrum={[47.42, 9.1]} zoom={10} onklick={klick} />
        <p class="sehr-klein gedaempft">Auf die Karte tippen, um einen neuen Ort anzulegen. Luftraum Angaben ohne Gewähr, verbindlich ist map.geo.admin.ch.</p>
        {#if neu}
          <form class="panel neu" onsubmit={ortSpeichern}>
            <div class="zeile">
              <input placeholder="Name des Ortes" bind:value={neu.name} required />
              <span class="mono sehr-klein">{neu.lat}, {neu.lon}</span>
            </div>
            <div class="zeile" style="justify-content:flex-end;margin-top:8px">
              <button type="button" onclick={() => (neu = null)}>Abbrechen</button>
              <button class="primaer" type="submit">Ort speichern</button>
            </div>
          </form>
        {/if}
      </div>

      <div class="liste-spalte">
        {#if detail}
          <button class="leise" onclick={() => navigieren('/modul/drohne')}><Icon name="zurueck" groesse={16} />Alle Orte</button>
          <h2>{detail.ort.name}</h2>
          <div class="zeile">
            <span class="marke">{detail.ort.status}</span>
            {#if detail.ort.shortlist}<span class="marke ok">Shortlist</span>{/if}
            {#if detail.wetterDemo}<span class="marke demo">Demo</span>{/if}
            <span class="sehr-klein gedaempft mono">{detail.ort.lat}, {detail.ort.lon}</span>
          </div>
          {#if detail.ort.notizen}<p class="klein">{detail.ort.notizen}</p>{/if}

          <h3 style="margin-top:14px">Flugfenster (48 h)</h3>
          {#if detail.fenster.length}
            {#each detail.fenster.slice(0, 5) as f (f.start)}
              <div class="zeile-zwischen fenster"><span class="zeile"><span class="punkt ok"></span>{fz(f.start)} bis {zeit(new Date(f.ende).toISOString())}</span><span class="gedaempft klein">{f.stunden} h</span></div>
            {/each}
          {:else}<p class="leer">Kein Fenster, das das Mindestwetter erfüllt.</p>{/if}

          <h3 style="margin-top:14px">Luftraum</h3>
          {#if detail.luftraum.fehler}<div class="hinweis ausfall klein">{detail.luftraum.fehler}</div>{/if}
          {#if !detail.luftraum.zonen.length && !detail.luftraum.fehler}
            <div class="hinweis ok klein">Keine Drohnen Einschränkung an diesem Punkt gemeldet.</div>
          {/if}
          {#each detail.luftraum.zonen as z (z.name)}
            <div class="hinweis warnung klein zone">
              <strong>{z.name}</strong>
              <div>{z.einschraenkung}</div>
              {#if z.hinweis}<div class="sehr-klein">{z.hinweis}</div>{/if}
              {#if z.bewilligung}<a class="sehr-klein" href={z.bewilligung} target="_blank" rel="noopener noreferrer">Bewilligung</a>{/if}
            </div>
          {/each}
          <div class="klein gedaempft">KP Index aktuell {detail.kp.aktuell ?? '–'}, Maximum 48 h {detail.kp.maxPrognose ?? '–'}</div>
        {:else}
          <h2>Orte</h2>
          <ul class="liste">
            {#each orte as o (o.ort.id)}
              <li>
                <a class="ort-zeile" href="/modul/drohne?ort={o.ort.id}">
                  <span class="punkt {o.jetztOk ? 'ok' : o.naechstesFenster ? 'warnung' : ''}"></span>
                  <span class="wachsen">
                    <strong>{o.ort.name}</strong>
                    <span class="sehr-klein gedaempft block">
                      {o.ort.status}{o.ort.shortlist ? ' · Shortlist' : ''} ·
                      {o.jetztOk ? 'jetzt fliegbar' : o.naechstesFenster ? `Fenster ${fz(o.naechstesFenster.start)}` : (o.gruende[0] ?? 'kein Fenster in 48 h')}
                    </span>
                  </span>
                  <Icon name="pfeil" groesse={16} />
                </a>
              </li>
            {:else}
              <li class="leer">Noch keine Orte. Auf die Karte tippen.</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    {#if detail}
      <section class="panel" style="margin-top:12px">
        <h2>Wetter auf {detail.ort.flughoehe_m ?? 120} m (nächste 48 Stunden)</h2>
        {#if detail.wetterFehler}<div class="hinweis ausfall">{detail.wetterFehler}</div>{/if}
        <div class="tabelle-scroll">
          <table class="stunden">
            <thead><tr><th>Zeit</th><th></th><th>Wind Höhe</th><th>Böen</th><th>Regen</th><th>Sicht</th><th>Temp</th><th>Urteil</th></tr></thead>
            <tbody>
              {#each naechste48 as s (s.t)}
                <tr class:gut={s.urteil.ok} class:nacht={!s.tag}>
                  <td class="mono">{fz(s.t)}</td>
                  <td><WetterIcon code={s.code} tag={s.tag} groesse={22} /></td>
                  <td>{windHoehe(s, detail.ort.flughoehe_m) ?? '–'} km/h {himmelsrichtung(s.richtung)}</td>
                  <td>{s.boeen ?? '–'}</td>
                  <td>{s.regen ?? 0} mm</td>
                  <td>{s.sicht !== null ? `${Math.round(s.sicht / 1000)} km` : '–'}</td>
                  <td>{s.temp ?? '–'}°</td>
                  <td class="klein">{s.urteil.ok ? 'fliegbar' : s.urteil.gruende.join(', ')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="sehr-klein gedaempft">Grenzen dieses Ortes: Wind {detail.grenzen.wind_max_kmh} km/h, Böen {detail.grenzen.boeen_max_kmh} km/h, Regen {detail.grenzen.niederschlag_max_mm} mm, Sicht {detail.grenzen.sicht_min_m} m, KP {detail.grenzen.kp_max}. Anpassen im Tab «Orte». Wetter: {wetterText(naechste48[0]?.code ?? null)}.</p>
      </section>

      <div class="raster-2" style="margin-top:12px">
        <section class="panel">
          <h2>Sonne und Licht</h2>
          <div class="tabelle-scroll">
            <table>
              <thead><tr><th>Tag</th><th>Aufgang</th><th>Gold abends</th><th>Untergang</th><th>Blau</th><th>Mond</th></tr></thead>
              <tbody>
                {#each detail.tage as t (t.datum)}
                  <tr>
                    <td>{new Date(`${t.datum}T12:00:00Z`).toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' })}</td>
                    <td class="zahl">{zeit(t.sonne.aufgang)}</td>
                    <td class="zahl gold">{zeit(t.sonne.goldAbend[0])}</td>
                    <td class="zahl">{zeit(t.sonne.untergang)}</td>
                    <td class="zahl blau">{zeit(t.sonne.blauAbend[0])} bis {zeit(t.sonne.blauAbend[1])}</td>
                    <td class="klein">{t.mond.name} {Math.round(t.mond.beleuchtet * 100)} %</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="sehr-klein gedaempft">Goldene Stunde: Sonne zwischen 6° und -4°. Blaue Stunde: zwischen -4° und -6°. Berechnet, ohne Geländehorizont.</p>
        </section>
        <section class="panel">
          <h2>Notizen</h2>
          <form class="zeile" onsubmit={notizSpeichern}>
            <input class="wachsen" placeholder="Notiz zu diesem Ort" bind:value={notiz} style="flex:1" />
            <button type="submit">Speichern</button>
          </form>
          <ul class="liste">
            {#each detail.notizen as n (n.id)}<li><div class="klein">{n.text}</div><div class="sehr-klein gedaempft">{datumZeit(n.erstellt)}</div></li>{:else}<li class="leer">Keine Notizen.</li>{/each}
          </ul>
        </section>
      </div>
    {/if}
  {:else if tab === 'Orte'}
    <div class="panel">
      <TabellenEditor tabelle="drohnen_orte" sort="name" spalten={['name', 'status', 'shortlist', 'wetterfenster_alarm', 'wind_max_kmh']} neuText="Ort" onauswahl={(z) => navigieren(`/modul/drohne?ort=${z.id}`)} />
    </div>
  {:else if tab === 'Sonne'}
    <Sonne />
  {:else if tab === 'Logbuch' || tab === 'Akkus und Wartung' || tab === 'Dokumente'}
    <Extras ansicht={tab} />
  {:else}
    <div class="panel">
      <TabellenEditor tabelle="drehs" sort="termin" spalten={['titel', 'kunde_id', 'termin', 'status', 'frist']} neuText="Dreh" />
      <p class="sehr-klein gedaempft">Drehbuch und Lieferstatus pro Dreh im Formular (Bearbeiten). Termine und Fristen erscheinen in der Timeline.</p>
    </div>
  {/if}
</ModulRahmen>

<style>
  .planung {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
    gap: 12px;
  }
  @media (max-width: 900px) {
    .planung {
      grid-template-columns: 1fr;
    }
  }
  .liste-spalte {
    min-width: 0;
  }
  .ort-zeile {
    display: flex;
    gap: 10px;
    align-items: center;
    color: inherit;
  }
  .ort-zeile:hover {
    text-decoration: none;
  }
  .block {
    display: block;
  }
  .neu {
    margin-top: 8px;
  }
  .neu input {
    flex: 1;
  }
  .fenster {
    padding: 4px 0;
  }
  .zone {
    margin: 6px 0;
  }
  .stunden td {
    white-space: nowrap;
    padding: 4px 8px;
  }
  .stunden tr.gut td {
    background: #34d39910;
  }
  .stunden tr.nacht td {
    opacity: 0.55;
  }
  .gold {
    color: #fbbf24;
  }
  .blau {
    color: #7c9cff;
  }
</style>
