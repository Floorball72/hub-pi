<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datumZeit, zeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Geraet {
    id: string;
    name: string;
    raum: string | null;
    typ: string | null;
    adapter: string;
    bestaetigen: boolean;
    favorit: boolean;
    zustand: { an: boolean | null; leistungW: number | null };
    fehler: string | null;
    timer: { bis: string; an: boolean } | null;
  }
  interface Plan { id: string; geraet_id: string; aktion: string; art: string; uhrzeit: string | null; versatz_min: number | null; tage: string | null; aktiv: boolean; naechster: string | null }
  interface Szene { id: string; name: string; zustaende: Record<string, boolean> | null }
  interface Uebersicht { geraete: Geraet[]; plaene: Plan[]; szenen: Szene[]; adapter: { id: string; name: string }[] }

  const TIMER = [15, 30, 60, 120];

  let tab = $state('Geräte');
  let u = $state<Uebersicht | null>(null);
  let laeuft = $state<string | null>(null);
  let timerFuer = $state<string | null>(null);

  async function laden() {
    u = await api.get('/api/m/smarthome/uebersicht');
  }
  let geraetZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  let planZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  let szenenZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  $effect(() => {
    void tab;
    void JSON.stringify(geraetZeilen);
    void JSON.stringify(planZeilen);
    void JSON.stringify(szenenZeilen);
    laden().catch((e) => melden(fehlerText(e), 'ausfall'));
  });
  // Zustand alle 30 Sekunden auffrischen, solange die Seite offen ist
  $effect(() => {
    const t = setInterval(() => laden().catch(() => {}), 30000);
    return () => clearInterval(t);
  });

  const raeume = $derived.by(() => {
    const m = new Map<string, Geraet[]>();
    for (const g of u?.geraete ?? []) {
      const r = g.raum || 'Ohne Raum';
      m.set(r, [...(m.get(r) ?? []), g]);
    }
    return [...m.entries()];
  });
  const anzahlAn = $derived((u?.geraete ?? []).filter((g) => g.zustand.an).length);
  const leistung = $derived((u?.geraete ?? []).reduce((s, g) => s + (g.zustand.leistungW ?? 0), 0));
  const geraetName = (id: string) => u?.geraete.find((g) => g.id === id)?.name ?? 'Gelöschtes Gerät';

  async function schalten(g: Geraet, an: boolean, minuten?: number) {
    let bestaetigt = false;
    if (g.bestaetigen) {
      bestaetigt = await bestaetigen(`${g.name} ${an ? 'einschalten' : 'ausschalten'}?`, 'Dieses Gerät ist so eingestellt, dass es nur mit Bestätigung schaltet.', an ? 'Einschalten' : 'Ausschalten');
      if (!bestaetigt) return;
    }
    laeuft = g.id;
    try {
      const neu = await api.post<Geraet>(`/api/m/smarthome/geraet/${g.id}/schalten`, { an, minuten, bestaetigt });
      if (u) u.geraete = u.geraete.map((x) => (x.id === g.id ? neu : x));
      if (minuten) melden(`${g.name} ${an ? 'an' : 'aus'} für ${minuten} Minuten`, 'ok');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    } finally {
      laeuft = null;
      timerFuer = null;
    }
  }

  async function szeneAusfuehren(s: Szene) {
    laeuft = s.id;
    try {
      const r = await api.post<{ ok: boolean; ergebnisse: { ok: boolean; name?: string; fehler?: string }[] }>(`/api/m/smarthome/szene/${s.id}`);
      const fehler = r.ergebnisse.filter((e) => !e.ok);
      melden(fehler.length ? `Szene «${s.name}»: ${fehler.length} Gerät(e) nicht erreicht` : `Szene «${s.name}» ausgeführt`, fehler.length ? 'ausfall' : 'ok');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    } finally {
      laeuft = null;
    }
  }

  let szenenName = $state('');
  async function szeneSpeichern() {
    if (!szenenName.trim()) return;
    if (!(await bestaetigen('Szene speichern?', `Der aktuelle Zustand aller erreichbaren Geräte wird als «${szenenName.trim()}» gespeichert.`, 'Speichern'))) return;
    try {
      await api.post('/api/m/smarthome/szene', { name: szenenName.trim() });
      szenenName = '';
      melden('Szene gespeichert', 'ok');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  const planText = (p: Plan) => {
    const v = p.versatz_min ? ` ${p.versatz_min > 0 ? '+' : ''}${p.versatz_min} min` : '';
    const wann = p.art === 'uhrzeit' ? (p.uhrzeit ?? '?') : `${p.art === 'sonnenuntergang' ? 'Sonnenuntergang' : 'Sonnenaufgang'}${v}`;
    return `${p.aktion === 'an' ? 'An' : 'Aus'} um ${wann}, ${p.tage || 'täglich'}`;
  };
  const szenenText = (s: Szene) =>
    Object.entries(s.zustaende ?? {})
      .map(([id, an]) => `${geraetName(id)} ${an ? 'an' : 'aus'}`)
      .join(', ');
</script>

<ModulRahmen modulId="smarthome" tabs={['Geräte', 'Zeitpläne', 'Szenen', 'Einrichten']} bind:tab>
  {#if !u}
    <div class="laedt">Lädt …</div>
  {:else if tab === 'Geräte'}
    <div class="stapel">
      <div class="panel zeile-zwischen">
        <div><span class="zahl">{anzahlAn}</span> <span class="gedaempft">von {u.geraete.length} an</span></div>
        {#if leistung}<div class="gedaempft">{Math.round(leistung)} W gerade</div>{/if}
      </div>
      {#if u.szenen.length}
        <div class="zeile szenen">
          {#each u.szenen as s (s.id)}
            <button class="knopf" disabled={laeuft === s.id} onclick={() => szeneAusfuehren(s)}>{s.name}</button>
          {/each}
        </div>
      {/if}
      {#if !u.geraete.length}
        <div class="panel leer">Noch keine Geräte. Unter «Einrichten» ein Gerät erfassen.</div>
      {/if}
      {#each raeume as [raum, liste] (raum)}
        <div class="panel">
          <h3>{raum}</h3>
          <div class="geraete">
            {#each liste as g (g.id)}
              <div class="geraet" class:an={g.zustand.an} class:fehler={!!g.fehler}>
                <button
                  class="schalter"
                  disabled={laeuft === g.id || (!!g.fehler && g.zustand.an === null)}
                  aria-pressed={!!g.zustand.an}
                  aria-label="{g.name} {g.zustand.an ? 'ausschalten' : 'einschalten'}"
                  onclick={() => schalten(g, !g.zustand.an)}
                >
                  <span class="punkt"></span>
                </button>
                <div class="info">
                  <strong>{g.name}</strong>
                  <span class="klein gedaempft">
                    {#if g.fehler}nicht erreichbar
                    {:else if g.zustand.an === null}Zustand unbekannt
                    {:else}{g.zustand.an ? 'an' : 'aus'}{#if g.zustand.leistungW}, {g.zustand.leistungW} W{/if}{/if}
                    {#if g.timer}, {g.timer.an ? 'an' : 'aus'} um {zeit(g.timer.bis)}{/if}
                  </span>
                </div>
                <button class="knopf klein" onclick={() => (timerFuer = timerFuer === g.id ? null : g.id)} aria-label="Timer für {g.name}">Timer</button>
              </div>
              {#if timerFuer === g.id}
                <div class="zeile timer">
                  <span class="klein gedaempft">{g.zustand.an ? 'Aus' : 'An'} für</span>
                  {#each TIMER as m (m)}
                    <button class="knopf klein" onclick={() => schalten(g, !g.zustand.an, m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
      <p class="sehr-klein gedaempft">Timer laufen im Hub. Bei einem Neustart des Hubs werden laufende Timer abgebrochen.</p>
    </div>
  {:else if tab === 'Zeitpläne'}
    <div class="stapel">
      <div class="panel">
        <h3>Nächste Schaltungen</h3>
        {#if !u.plaene.some((p) => p.naechster)}
          <div class="leer">Keine aktiven Zeitpläne.</div>
        {:else}
          <ul class="liste">
            {#each [...u.plaene].filter((p) => p.naechster).sort((a, b) => (a.naechster ?? '').localeCompare(b.naechster ?? '')) as p (p.id)}
              <li class="zeile-zwischen">
                <span><strong>{geraetName(p.geraet_id)}</strong> <span class="gedaempft klein">{planText(p)}</span></span>
                <span class="klein">{datumZeit(p.naechster)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="panel">
        <TabellenEditor tabelle="smarthome_zeitplaene" spalten={['geraet_id', 'aktion', 'art', 'uhrzeit', 'versatz_min', 'tage', 'aktiv']} sort="geraet_id" neuText="Zeitplan" bind:zeilen={planZeilen} />
        <p class="sehr-klein gedaempft">Tage zum Beispiel «Mo-Fr», «Sa,So» oder «täglich». Sonnenzeiten gelten für den ersten Wetterort. Der Versatz verschiebt den Zeitpunkt, negativ heisst früher.</p>
      </div>
    </div>
  {:else if tab === 'Szenen'}
    <div class="stapel">
      <div class="panel">
        <h3>Aktuellen Zustand als Szene speichern</h3>
        <div class="zeile">
          <input placeholder="Name, z.B. Filmabend" bind:value={szenenName} maxlength="60" />
          <button class="knopf" disabled={!szenenName.trim()} onclick={szeneSpeichern}>Speichern</button>
        </div>
      </div>
      {#each u.szenen as s (s.id)}
        <div class="panel zeile-zwischen">
          <div><strong>{s.name}</strong><div class="klein gedaempft">{szenenText(s) || 'Keine Geräte'}</div></div>
          <button class="knopf" disabled={laeuft === s.id} onclick={() => szeneAusfuehren(s)}>Ausführen</button>
        </div>
      {/each}
      <div class="panel"><TabellenEditor tabelle="smarthome_szenen" spalten={['name']} sort="name" neuText="Szene" bind:zeilen={szenenZeilen} /></div>
    </div>
  {:else}
    <div class="stapel">
      <div class="panel">
        <TabellenEditor tabelle="smarthome_geraete" spalten={['name', 'raum', 'adapter', 'adresse', 'favorit']} sort="raum" neuText="Gerät" bind:zeilen={geraetZeilen} />
      </div>
      <div class="panel hilfe">
        <h3>Welcher Adapter?</h3>
        <ul class="liste klein">
          <li><strong>Shelly Gen 1</strong> (Shelly Plug, Plug S, 1, 2.5): IP Adresse eintragen, Kanal 0 bei einem Ausgang.</li>
          <li><strong>Shelly Plus und Gen 2 bis 4</strong> (Plus Plug S, Plug S Gen3, Pro): IP Adresse, Kanal 0.</li>
          <li><strong>Tasmota</strong> (umgeflashte Steckdosen, z.B. Gosund, Nous A1T): IP Adresse, Kanal 0 für Power1.</li>
          <li><strong>Eigene HTTP Adressen</strong>: für Geräte mit lokaler Schnittstelle. Adressen für an, aus und Status, dazu das Feld im Status (z.B. «ison» oder «relays.0.ison»).</li>
          <li><strong>Virtuell</strong>: ohne echtes Gerät, zum Ausprobieren von Zeitplänen und Szenen.</li>
        </ul>
        <p class="sehr-klein gedaempft">Die Geräte werden direkt im Heimnetz angesprochen, ohne Cloud. Der Pi muss sie erreichen. Am besten im Router eine feste IP vergeben. Steckdosen, die nur über eine Hersteller Cloud laufen (z.B. Tuya ohne lokalen Zugang), lassen sich so nicht steuern.</p>
      </div>
    </div>
  {/if}
</ModulRahmen>

<style>
  h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  .szenen { flex-wrap: wrap; gap: 0.5rem; }
  .geraete { display: grid; gap: 0.5rem; }
  .geraet { display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0; }
  .geraet .info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .schalter {
    width: 52px; height: 30px; min-height: 30px; border-radius: 15px; padding: 3px;
    background: var(--flaeche-3, #333); border: 1px solid var(--rand, #444);
    display: flex; align-items: center; flex-shrink: 0; cursor: pointer;
  }
  .schalter .punkt { width: 22px; height: 22px; border-radius: 50%; background: var(--text-2, #aaa); transition: transform 0.15s; }
  .geraet.an .schalter { background: var(--ok, #2e9d5b); border-color: transparent; }
  .geraet.an .schalter .punkt { transform: translateX(22px); background: #fff; }
  .geraet.fehler .info strong { color: var(--warnung, #d9a400); }
  .timer { flex-wrap: wrap; gap: 0.4rem; padding-left: 3.6rem; }
  .zeile input { flex: 1; }
  .hilfe li { margin-bottom: 0.4rem; }
</style>
