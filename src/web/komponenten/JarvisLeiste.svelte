<script lang="ts">
  // Jarvis auf jeder Seite: Knopf unten rechts, darüber ein kleines Eingabefeld mit der letzten Antwort.
  // Die Leiste kann nur fragen, Aufgaben erteilen (mit derselben Vollmacht wie auf der Jarvis Seite)
  // und Seiten im Hub öffnen. Sie führt nichts selbst aus.
  import { api, fehlerText } from '../lib/api.ts';
  import { type JarvisEreignis, jarvisChat } from '../lib/jarvisChat.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { navigieren } from '../lib/router.svelte.ts';

  interface Schritt {
    id: string;
    name: string;
    beschreibung: string;
    ok?: boolean;
    bestaetigung?: string;
    entschieden?: string;
  }

  let offen = $state(false);
  let eingabe = $state('');
  let laeuft = $state(false);
  let antwort = $state('');
  let schritte = $state<Schritt[]>([]);
  let gespraechId: string | undefined;
  let abbruch: AbortController | null = null;
  let feld = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (offen) feld?.focus();
  });

  function ereignis(e: JarvisEreignis & Record<string, any>) {
    if (e.art === 'gespraech') gespraechId = e.id;
    else if (e.art === 'text') antwort += e.text;
    else if (e.art === 'werkzeug') schritte.push({ id: e.id, name: e.name, beschreibung: e.beschreibung });
    else if (e.art === 'ergebnis') {
      const s = schritte.find((x) => x.id === e.id);
      if (s) s.ok = e.ok;
    } else if (e.art === 'bestaetigung') {
      const s = [...schritte].reverse().find((x) => x.name === e.werkzeug && !x.bestaetigung);
      if (s) s.bestaetigung = e.id;
    } else if (e.art === 'fehler') antwort += (antwort ? '\n' : '') + e.text;
  }

  async function senden() {
    const t = eingabe.trim();
    if (!t || laeuft) return;
    eingabe = '';
    antwort = '';
    schritte = [];
    laeuft = true;
    abbruch = new AbortController();
    let ziel = '';
    try {
      await jarvisChat(t, gespraechId, abbruch.signal, (e) => {
        if (e.art === 'navigation') ziel = String((e as Record<string, unknown>).ziel ?? '');
        else ereignis(e as JarvisEreignis & Record<string, any>);
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') antwort ||= `Das hat nicht geklappt: ${fehlerText(e)}`;
    } finally {
      laeuft = false;
      abbruch = null;
      if (ziel) navigieren(ziel);
    }
  }

  async function entscheiden(s: Schritt, ja: boolean) {
    const id = s.bestaetigung;
    if (!id) return;
    try {
      const r = await api.post<{ ok: boolean; text: string }>('/api/m/jarvis/bestaetigen', { id, ja });
      s.entschieden = ja ? (r.ok ? 'Ausgeführt' : 'Fehlgeschlagen') : 'Verworfen';
      s.bestaetigung = undefined;
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
</script>

<div class="leiste">
  {#if offen}
    <div class="karte" role="dialog" aria-label="Jarvis">
      {#if schritte.length || antwort || laeuft}
        <div class="antwort" aria-live="polite">
          {#each schritte as s (s.id)}
            <div class="schritt" class:fehler={s.ok === false}>
              <span class="punkt" class:wartet={s.ok === undefined || !!s.bestaetigung}></span>{s.beschreibung}
              {#if s.entschieden}<em>{s.entschieden}</em>{/if}
              {#if s.bestaetigung}
                <button onclick={() => entscheiden(s, true)}>Ausführen</button>
                <button onclick={() => entscheiden(s, false)}>Verwerfen</button>
              {/if}
            </div>
          {/each}
          {#if antwort}<p>{antwort}</p>{:else if laeuft && !schritte.length}<p class="gedaempft">Ich überlege …</p>{/if}
        </div>
      {/if}
      <form onsubmit={(e) => { e.preventDefault(); senden(); }}>
        <input bind:this={feld} bind:value={eingabe} placeholder="Frag Jarvis oder gib ihm eine Aufgabe" maxlength="4000" aria-label="Nachricht an Jarvis" disabled={laeuft} />
        {#if laeuft}
          <button type="button" onclick={() => abbruch?.abort()}>Stopp</button>
        {:else}
          <button disabled={!eingabe.trim()}>Senden</button>
        {/if}
      </form>
      <a class="mehr" href="/modul/jarvis" onclick={() => (offen = false)}>Ganze Jarvis Seite öffnen</a>
    </div>
  {/if}
  <button class="rund" onclick={() => (offen = !offen)} aria-label={offen ? 'Jarvis schliessen' : 'Jarvis öffnen'} aria-expanded={offen}>
    <span class="r"></span><span class="m"></span>
  </button>
</div>

<style>
  .leiste {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 1500;
    display: grid;
    gap: 10px;
    justify-items: end;
  }
  @media (max-width: 800px) {
    .leiste {
      bottom: 76px;
    }
  }
  .rund {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    padding: 0;
    display: grid;
    place-items: center;
    border: 2px solid currentColor;
    background: #0b1220;
    color: #38bdf8;
    box-shadow: 0 0 18px #38bdf866;
  }
  .r {
    position: absolute;
    inset: 7px;
    border-radius: 50%;
    border: 2px dashed #38bdf8aa;
    animation: dreh 14s linear infinite;
  }
  .m {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #38bdf8;
    box-shadow: 0 0 10px 2px #38bdf8;
  }
  @keyframes dreh {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .r {
      animation: none;
    }
  }
  .karte {
    width: min(92vw, 380px);
    background: #111827;
    border: 1px solid #ffffff22;
    border-radius: 14px;
    padding: 12px;
    display: grid;
    gap: 10px;
    box-shadow: 0 10px 30px #0008;
  }
  .antwort {
    max-height: 40vh;
    overflow-y: auto;
    display: grid;
    gap: 6px;
  }
  .antwort p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .schritt {
    font-size: 0.8rem;
    opacity: 0.85;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .schritt.fehler {
    color: #f87171;
  }
  .schritt button {
    padding: 2px 9px;
    font-size: 0.8rem;
  }
  .punkt {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4ade80;
  }
  .punkt.wartet {
    background: #fbbf24;
  }
  form {
    display: flex;
    gap: 6px;
  }
  form input {
    flex: 1;
    min-width: 0;
  }
  .mehr {
    font-size: 0.8rem;
    opacity: 0.7;
  }
  .gedaempft {
    opacity: 0.7;
  }
</style>
