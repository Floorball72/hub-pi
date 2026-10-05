<script lang="ts">
  import type { Component } from 'svelte';
  import type { ModulInfo } from '../server/geteilt/typen.ts';
  import Befehlspalette from './komponenten/Befehlspalette.svelte';
  import Bestaetigung from './komponenten/Bestaetigung.svelte';
  import Icon from './komponenten/Icon.svelte';
  import Meldungen from './komponenten/Meldungen.svelte';
  import { api } from './lib/api.ts';
  import { navigieren, ort, parameter } from './lib/router.svelte.ts';
  import { lesen, schreiben } from './lib/speicher.ts';
  import { ansicht } from './lib/ansicht.svelte.ts';
  import { gruppieren, STANDARD_ZU } from './lib/navigation.ts';
  import { palette, paletteOeffnen } from './lib/palette.svelte.ts';
  import Start from './seiten/Start.svelte';
  import Login from './seiten/Login.svelte';

  // Seiten werden erst bei Bedarf geladen
  const SEITEN: Record<string, () => Promise<{ default: Component }>> = {
    '/alarme': () => import('./seiten/Alarme.svelte'),
    '/hub-status': () => import('./seiten/Status.svelte'),
    '/system': () => import('./seiten/System.svelte'),
    '/einrichtung': () => import('./seiten/Einrichtung.svelte'),
    '/suche': () => import('./seiten/Suche.svelte'),
    '/timeline': () => import('./seiten/Timeline.svelte'),
    '/karte': () => import('./seiten/KarteSeite.svelte'),
    '/notizen': () => import('./seiten/Notizen.svelte'),
    '/heli': () => import('./seiten/Heli.svelte'),
    '/lagebild': () => import('./seiten/Lagebild.svelte'),
  };
  const MODULSEITEN: Record<string, () => Promise<{ default: Component }>> = {
    zentrale: () => import('./module/Zentrale.svelte'),
    wetter: () => import('./module/Wetter.svelte'),
    mobilitaet: () => import('./module/Mobilitaet.svelte'),
    scont: () => import('./module/Scont.svelte'),
    rettung: () => import('./module/Rettung.svelte'),
    drohne: () => import('./module/Drohne.svelte'),
    unihockey: () => import('./module/Unihockey.svelte'),
    analyse: () => import('./module/Analyse.svelte'),
    smarthome: () => import('./module/SmartHome.svelte'),
    aufgaben: () => import('./module/Aufgaben.svelte'),
    swissunihockey: () => import('./module/SwissUnihockey.svelte'),
    events: () => import('./module/Events.svelte'),
    content: () => import('./module/Content.svelte'),
    veranstaltungen: () => import('./module/Veranstaltungen.svelte'),
    parken: () => import('./module/Parken.svelte'),
    dienste: () => import('./module/Dienste.svelte'),
    sicherheit: () => import('./module/Sicherheit.svelte'),
    abhaengigkeiten: () => import('./module/Abhaengigkeiten.svelte'),
    aenderungen: () => import('./module/Aenderungen.svelte'),
    teams: () => import('./module/Teams.svelte'),
    abrufe: () => import('./module/Abrufe.svelte'),
    auffaelligkeiten: () => import('./module/Auffaelligkeiten.svelte'),
    selbstheilung: () => import('./module/Selbstheilung.svelte'),
    updates: () => import('./module/Updates.svelte'),
    drehwetter: () => import('./module/Drehwetter.svelte'),
  };

  let sitzung = $state<{ angemeldet: boolean; benutzer: string | null; demo: boolean; einrichtungOffen: boolean } | null>(null);
  let module = $state<ModulInfo[]>([]);
  let menueOffen = $state(false);
  // Zugeklappte Gruppen der Seitenleiste, im Browser gemerkt
  // Eigener Schlüssel seit der neuen Gruppierung, damit «Wenig genutzt» zugeklappt startet
  let zu = $state<string[]>(lesen('nav.zu.v3', STANDARD_ZU));
  const gruppen = $derived(gruppieren(module));

  function gruppeUmschalten(id: string) {
    zu = zu.includes(id) ? zu.filter((g) => g !== id) : [...zu, id];
    schreiben('nav.zu.v3', zu);
  }

  async function sitzungLaden() {
    sitzung = await api.get('/api/sitzung');
    if (sitzung?.angemeldet) module = await api.get<ModulInfo[]>('/api/module').catch(() => []);
  }

  $effect(() => {
    void ort.pfad;
    if (ort.pfad !== '/login' || !sitzung) sitzungLaden().catch(() => {});
    menueOffen = false;
  });

  $effect(() => {
    if (parameter('kiosk') === '1') ansicht.kiosk = true;
  });

  const seite = $derived.by(() => {
    if (ort.pfad.startsWith('/modul/')) {
      const id = ort.pfad.split('/')[2];
      return MODULSEITEN[id] ?? null;
    }
    return SEITEN[ort.pfad] ?? null;
  });

  function fokusUmschalten() {
    ansicht.fokus = !ansicht.fokus;
    schreiben('fokus', ansicht.fokus);
  }
  function kioskUmschalten() {
    ansicht.kiosk = !ansicht.kiosk;
    if (ansicht.kiosk) document.documentElement.requestFullscreen?.().catch(() => {});
  }
  async function abmelden() {
    await api.post('/api/logout');
    navigieren('/login');
  }
  function aktion(name: string) {
    if (name === 'kiosk') kioskUmschalten();
    else if (name === 'fokus') fokusUmschalten();
    else if (name === 'abmelden') abmelden();
  }
  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);

  ansicht.fokus = lesen('fokus', false);

  const offen = $derived(ort.pfad === '/login' || (ort.pfad === '/einrichtung' && sitzung?.einrichtungOffen));
</script>

<svelte:window
  onkeydown={(e) => {
    const imFeld = e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable]');
    if (sitzung?.angemeldet && ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !imFeld))) {
      e.preventDefault();
      if (palette.offen) palette.offen = false;
      else paletteOeffnen();
    }
    if (e.key === 'Escape' && ansicht.kiosk) ansicht.kiosk = false;
  }}
/>

{#if ort.pfad === '/login'}
  <Login />
{:else if sitzung && !sitzung.angemeldet && !offen}
  {#if sitzung.einrichtungOffen && ort.pfad === '/'}
    <div class="willkommen panel">
      <h1>Willkommen beim Pi Hub</h1>
      <p class="gedaempft">Der Hub ist noch nicht eingerichtet. Der Assistent führt durch alle Schritte.</p>
      <div class="zeile"><a class="knopf primaer" href="/einrichtung">Einrichtung starten</a><a class="knopf" href="/login">Anmelden</a></div>
    </div>
  {:else}
    <Login />
  {/if}
{:else if sitzung}
  <div class="rahmen" class:kiosk={ansicht.kiosk}>
    {#if !ansicht.kiosk}
      <aside class="seitenleiste" class:offen={menueOffen}>
        <a class="logo" href="/">
          <img src="/icon.svg" alt="" width="30" height="30" />
          <span>Pi Hub</span>
        </a>
        <nav>
          <a href="/" class:aktiv={ort.pfad === '/'}><Icon name="zentrale" />Start</a>
          <a href="/karte" class:aktiv={ort.pfad === '/karte'}><Icon name="karte" />Karte</a>
          <a href="/timeline" class:aktiv={ort.pfad === '/timeline'}><Icon name="timeline" />Timeline</a>
          {#each gruppen as g (g.id)}
            {@const hatAktive = g.seiten.some((x) => x.pfad === ort.pfad)}
            {@const offen = hatAktive || !zu.includes(g.id)}
            <button class="trenner" class:offen aria-expanded={offen} onclick={() => gruppeUmschalten(g.id)} disabled={hatAktive}>
              <span>{g.name}</span>
              {#if !offen}<span class="anzahl">{g.seiten.length}</span>{/if}
              <Icon name="pfeil" groesse={14} />
            </button>
            {#if offen}
              {#each g.seiten as x (x.pfad)}
                <a href={x.pfad} class:aktiv={ort.pfad === x.pfad} class:aus={x.aus}><Icon name={x.symbol} />{x.name}</a>
              {/each}
            {/if}
          {/each}
        </nav>
        <div class="fuss">
          {#if sitzung.benutzer}<div class="sehr-klein gedaempft">Angemeldet als {sitzung.benutzer}</div>{/if}
          <button class="leise klein" onclick={abmelden}><Icon name="abmelden" groesse={16} />Abmelden</button>
        </div>
      </aside>
      {#if menueOffen}<div class="schleier" role="presentation" onclick={() => (menueOffen = false)}></div>{/if}
    {/if}

    <main>
      {#if !ansicht.kiosk}
        <header class="leiste">
          <button class="leise menue-knopf" aria-label="Menü" onclick={() => (menueOffen = !menueOffen)}><Icon name="menu" /></button>
          <button type="button" class="suche" onclick={() => paletteOeffnen()} aria-label="Suchen oder springen" title="Suchen oder springen ({mac ? '⌘' : 'Ctrl'} K)">
            <Icon name="suche" groesse={16} />
            <span class="suche-text">Suchen oder springen…</span>
            <kbd class="suche-taste">{mac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          {#if sitzung.demo}<span class="marke demo" title="Alle Daten sind Beispieldaten">Demo</span>{/if}
          <button class="leise" class:an={ansicht.fokus} title="Fokusmodus: nur Wichtiges" aria-label="Fokusmodus" onclick={fokusUmschalten}><Icon name="fokus" /></button>
          <button class="leise" title="Kiosk Modus" aria-label="Kiosk Modus" onclick={kioskUmschalten}><Icon name="kiosk" /></button>
        </header>
      {/if}
      <div class="inhalt">
        {#if ort.pfad === '/'}
          <Start />
        {:else if seite}
          {#await seite() then s}
            <s.default />
          {:catch}
            <div class="hinweis ausfall">Seite konnte nicht geladen werden.</div>
          {/await}
        {:else}
          <div class="panel"><h1>Nicht gefunden</h1><a href="/">Zur Startseite</a></div>
        {/if}
      </div>
    </main>

    {#if !ansicht.kiosk}
      <nav class="unten">
        <a href="/" class:aktiv={ort.pfad === '/'}><Icon name="zentrale" /><span>Start</span></a>
        <a href="/karte" class:aktiv={ort.pfad === '/karte'}><Icon name="karte" /><span>Karte</span></a>
        <a href="/timeline" class:aktiv={ort.pfad === '/timeline'}><Icon name="timeline" /><span>Timeline</span></a>
        <a href="/alarme" class:aktiv={ort.pfad === '/alarme'}><Icon name="alarm" /><span>Alarme</span></a>
        <button class="leise" onclick={() => (menueOffen = true)}><Icon name="menu" /><span>Mehr</span></button>
      </nav>
    {/if}
  </div>
{/if}

{#if sitzung?.angemeldet}<Befehlspalette {module} onaktion={aktion} />{/if}
<Bestaetigung />
<Meldungen />

<style>
  .rahmen {
    display: grid;
    grid-template-columns: 240px 1fr;
    min-height: 100vh;
    min-height: 100dvh;
  }
  .rahmen.kiosk {
    grid-template-columns: 1fr;
  }
  .seitenleiste {
    position: sticky;
    top: 0;
    height: 100vh;
    height: 100dvh;
    overflow-y: auto;
    border-right: 1px solid var(--rand);
    background: #0a0f15cc;
    backdrop-filter: blur(8px);
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 1000;
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--schrift-zahl);
    font-weight: 600;
    font-size: 1.15rem;
    color: var(--text);
    padding: 4px 8px 10px;
  }
  @media (hover: hover) and (pointer: fine) {
    .logo:hover {
      text-decoration: none;
    }
  }
  nav a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 9px;
    color: var(--text-2);
    font-size: 0.92rem;
  }
  @media (hover: hover) and (pointer: fine) {
    nav a:hover {
      background: var(--flaeche-3);
      color: var(--text);
      text-decoration: none;
    }
  }
  nav a.aktiv {
    background: linear-gradient(90deg, #4cc9f01f, transparent);
    color: var(--text);
    box-shadow: inset 2px 0 0 var(--akzent);
  }
  nav a.aus {
    opacity: 0.5;
  }
  .trenner {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-height: 0;
    margin-top: 10px;
    padding: 6px 10px 4px;
    border: none;
    border-radius: 6px;
    background: none;
    font-size: 0.7rem;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-3);
    cursor: pointer;
  }
  @media (hover: hover) and (pointer: fine) {
    .trenner:hover:not(:disabled) {
      color: var(--text-2);
    }
  }
  .trenner:disabled {
    cursor: default;
    opacity: 1;
  }
  .trenner span:first-child {
    flex: 1;
    text-align: left;
  }
  .trenner :global(svg) {
    transition: transform 0.2s ease;
  }
  .trenner.offen :global(svg) {
    transform: rotate(90deg);
  }
  .anzahl {
    font-family: var(--schrift-zahl);
    letter-spacing: 0;
  }
  .fuss {
    margin-top: auto;
    display: grid;
    gap: 6px;
    padding: 0 8px;
  }
  main {
    min-width: 0;
  }
  .leiste {
    position: sticky;
    top: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: #080c11d9;
    backdrop-filter: blur(10px);
    border-bottom: 1px solid #ffffff0a;
  }
  .leiste .an {
    color: var(--akzent);
  }
  .suche {
    flex: 1;
    min-width: 0;
    max-width: 520px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #0b1118;
    border: 1px solid var(--rand-hell);
    border-radius: 999px;
    padding: 0 14px;
    color: var(--text-3);
  }
  button.suche {
    min-height: 38px;
    font-weight: 400;
    font-size: 0.92rem;
    cursor: text;
    text-align: left;
  }
  @media (hover: hover) and (pointer: fine) {
    button.suche:hover {
      border-color: var(--akzent);
      color: var(--text-2);
    }
  }
  .suche-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .suche-taste {
    font-family: var(--schrift-zahl);
    font-size: 0.7rem;
    padding: 1px 6px;
    border-radius: 5px;
    border: 1px solid var(--rand-hell);
    color: var(--text-3);
  }
  @media (max-width: 760px) {
    .suche-taste {
      display: none;
    }
  }
  .inhalt {
    padding: 20px;
    max-width: 1500px;
    margin: 0 auto;
    padding-bottom: 100px;
  }
  .menue-knopf {
    display: none;
  }
  .unten {
    display: none;
  }
  .willkommen {
    width: min(100% - 32px, 480px);
    margin: 15vh auto;
    margin: 15dvh auto;
  }
  .schleier {
    display: none;
  }

  @media (max-width: 860px) {
    .rahmen {
      grid-template-columns: 1fr;
    }
    .seitenleiste {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: 270px;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      background: #0a0f15;
    }
    .seitenleiste.offen {
      transform: none;
      box-shadow: 20px 0 60px #000c;
    }
    .schleier {
      display: block;
      position: fixed;
      inset: 0;
      background: #0008;
      z-index: 950;
    }
    .menue-knopf {
      display: inline-flex;
    }
    .leiste {
      padding: 8px 12px;
      padding-top: calc(8px + env(safe-area-inset-top));
    }
    .inhalt {
      padding: 14px 12px 110px;
    }
    .unten {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 900;
      background: #0a0f15f2;
      backdrop-filter: blur(10px);
      border-top: 1px solid var(--rand);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .unten a,
    .unten button {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 8px 0 6px;
      font-size: 0.68rem;
      color: var(--text-2);
      border: none;
      border-radius: 0;
      min-height: 0;
      background: none;
    }
    .unten a.aktiv {
      color: var(--akzent);
    }
  }
</style>
