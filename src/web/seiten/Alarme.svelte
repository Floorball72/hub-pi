<script lang="ts">
  import type { AlarmRegel } from '../../server/geteilt/typen.ts';
  import Icon from '../komponenten/Icon.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datumZeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  type Regel = AlarmRegel & { modulAktiv: boolean };
  interface Alarm {
    id: string;
    erstellt: string;
    titel: string;
    text: string;
    status: string;
    grund: string;
    modul: string;
    prioritaet: number;
  }

  let regeln = $state<Regel[]>([]);
  let verlauf = $state<Alarm[]>([]);
  let offen = $state<string | null>(null);
  let entwurf = $state<Partial<AlarmRegel>>({});

  async function laden() {
    [regeln, verlauf] = await Promise.all([api.get<Regel[]>('/api/alarm/regeln'), api.get<Alarm[]>('/api/alarm/verlauf?limit=100')]);
  }
  $effect(() => {
    laden();
  });

  const gruppen = $derived(
    Object.entries(
      regeln.reduce<Record<string, Regel[]>>((acc, r) => {
        (acc[r.modul] ??= []).push(r);
        return acc;
      }, {}),
    ),
  );

  async function umschalten(r: Regel) {
    const neu = !r.aktiv;
    if (!(await bestaetigen(`Regel «${r.name}» ${neu ? 'einschalten' : 'ausschalten'}?`, neu ? 'Push Meldungen dieser Regel werden wieder gesendet.' : 'Es werden keine Push Meldungen dieser Regel mehr gesendet.', neu ? 'Einschalten' : 'Ausschalten', !neu))) return;
    await speichern(r.id, { aktiv: neu });
  }

  function bearbeiten(r: Regel) {
    offen = offen === r.id ? null : r.id;
    entwurf = { schwelle: r.schwelle, ruhe_von: r.ruhe_von, ruhe_bis: r.ruhe_bis, nachts: r.nachts, prioritaet: r.prioritaet, cooldown_min: r.cooldown_min };
  }

  async function speichern(id: string, a: Partial<AlarmRegel>) {
    try {
      await api.put(`/api/alarm/regeln/${id}`, a);
      melden('Regel gespeichert');
      offen = null;
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  async function test() {
    if (!(await bestaetigen('Testnachricht senden?', 'Eine Testnachricht wird über ntfy an dein Handy geschickt.', 'Senden'))) return;
    try {
      const r = await api.post<{ hinweis?: string }>('/api/alarm/test', {});
      melden(r.hinweis ?? 'Testnachricht gesendet');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  const STATUS: Record<string, string> = {
    gesendet: 'ok',
    unterdrueckt: 'warnung',
    fehler: 'ausfall',
    demo: 'demo',
    verworfen: '',
    nicht_konfiguriert: 'warnung',
  };
  const STATUSTEXT: Record<string, string> = {
    gesendet: 'gesendet',
    unterdrueckt: 'Ruhezeit',
    fehler: 'Fehler',
    demo: 'Demo',
    verworfen: 'verworfen',
    nicht_konfiguriert: 'ntfy fehlt',
  };
</script>

<div class="zeile-zwischen kopf">
  <div>
    <h1>Alarmzentrale</h1>
    <p class="gedaempft klein">Alle Push Meldungen laufen hier durch. Module melden Ereignisse, die Regeln entscheiden, ob ntfy sendet. In der Ruhezeit (Standard 00:00 bis 06:00) wird nur gesendet, wenn «auch nachts» an ist.</p>
  </div>
  <button onclick={test}><Icon name="alarm" groesse={16} />Testnachricht</button>
</div>

<div class="raster-2">
  <section class="panel">
    <h2>Regeln</h2>
    {#each gruppen as [modul, liste] (modul)}
      <h3 class="modul-titel">{modul}</h3>
      <ul class="liste">
        {#each liste as r (r.id)}
          <li>
            <div class="zeile-zwischen">
              <button class="leise regel-name" onclick={() => bearbeiten(r)}>
                <span class="punkt {r.aktiv && r.modulAktiv ? 'ok' : ''}"></span>
                <span>
                  <strong>{r.name}</strong>
                  <span class="sehr-klein gedaempft block">
                    P{r.prioritaet}
                    {#if r.schwelle !== null} · Schwelle {r.schwelle} {r.schwelle_label ?? ''}{/if}
                    · {r.nachts ? 'auch nachts' : `Ruhe ${r.ruhe_von ?? '–'} bis ${r.ruhe_bis ?? '–'}`}
                    {#if !r.modulAktiv} · Modul aus{/if}
                  </span>
                </span>
              </button>
              <label class="schalter"><input type="checkbox" checked={r.aktiv} onclick={(e) => { e.preventDefault(); umschalten(r); }} /><span></span></label>
            </div>
            {#if offen === r.id}
              <form class="einstellungen" onsubmit={(e) => { e.preventDefault(); speichern(r.id, entwurf); }}>
                <p class="sehr-klein gedaempft">{r.beschreibung}</p>
                <div class="felder">
                  {#if r.schwelle !== null || r.schwelle_label}
                    <div><label for="s-{r.id}">Schwelle ({r.schwelle_label ?? ''})</label><input id="s-{r.id}" type="number" step="any" bind:value={entwurf.schwelle} /></div>
                  {/if}
                  <div><label for="p-{r.id}">Priorität (1 bis 5)</label><input id="p-{r.id}" type="number" min="1" max="5" bind:value={entwurf.prioritaet} /></div>
                  <div><label for="rv-{r.id}">Ruhe von</label><input id="rv-{r.id}" type="time" bind:value={entwurf.ruhe_von} /></div>
                  <div><label for="rb-{r.id}">Ruhe bis</label><input id="rb-{r.id}" type="time" bind:value={entwurf.ruhe_bis} /></div>
                  <div><label for="c-{r.id}">Sperrfrist (Minuten)</label><input id="c-{r.id}" type="number" min="0" bind:value={entwurf.cooldown_min} /></div>
                  <div class="zeile nachts"><label class="schalter"><input type="checkbox" bind:checked={entwurf.nachts} /><span></span></label><span class="klein">auch nachts senden</span></div>
                </div>
                <div class="zeile" style="justify-content:flex-end;margin-top:10px">
                  <button type="button" onclick={() => (offen = null)}>Abbrechen</button>
                  <button type="submit" class="primaer">Speichern</button>
                </div>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  </section>

  <section class="panel">
    <h2>Verlauf</h2>
    {#if !verlauf.length}
      <p class="leer">Noch keine Ereignisse.</p>
    {:else}
      <ul class="liste">
        {#each verlauf as a (a.id)}
          <li>
            <div class="zeile-zwischen">
              <strong class="klein">{a.titel}</strong>
              <span class="marke {STATUS[a.status] ?? ''}">{STATUSTEXT[a.status] ?? a.status}</span>
            </div>
            <div class="klein gedaempft">{a.text}</div>
            <div class="sehr-klein gedaempft">{datumZeit(a.erstellt)} · {a.modul} · {a.grund}</div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .kopf {
    align-items: flex-start;
    margin-bottom: 14px;
    gap: 16px;
  }
  .kopf p {
    max-width: 720px;
  }
  .modul-titel {
    text-transform: capitalize;
    margin-top: 14px;
    margin-bottom: 0;
    font-size: 0.8rem;
    letter-spacing: 0.05em;
  }
  .regel-name {
    text-align: left;
    justify-content: flex-start;
    padding: 4px 0;
    color: var(--text);
    flex: 1;
    align-items: flex-start;
  }
  .regel-name .punkt {
    margin-top: 6px;
  }
  .block {
    display: block;
  }
  .einstellungen {
    background: #0b1118;
    border: 1px solid var(--rand);
    border-radius: 10px;
    padding: 12px;
    margin-top: 8px;
  }
  .felder {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
  .nachts {
    align-self: end;
    padding-bottom: 6px;
  }
</style>
