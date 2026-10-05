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
      <div class="titel">
        <span class="mini" class:denkt={laeuft} aria-hidden="true"></span>
        <strong>Jarvis</strong>
        <a class="mehr" href="/modul/jarvis" onclick={() => (offen = false)}>Ganze Seite</a>
      </div>
      {#if schritte.length || antwort || laeuft}
        <div class="antwort" aria-live="polite">
          {#if schritte.length}
            <div class="schritte">
              {#each schritte as s (s.id)}
                <div class="schritt" class:fehler={s.ok === false} class:wartet={s.ok === undefined || !!s.bestaetigung}>
                  <span class="punkt"></span>{s.beschreibung}
                  {#if s.entschieden}<em>{s.entschieden}</em>{/if}
                  {#if s.bestaetigung}
                    <button class="ja" onclick={() => entscheiden(s, true)}>Ausführen</button>
                    <button onclick={() => entscheiden(s, false)}>Verwerfen</button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if antwort}<p>{antwort}</p>{:else if laeuft && !schritte.length}<p class="tippt" aria-label="Jarvis überlegt"><i></i><i></i><i></i></p>{/if}
        </div>
      {/if}
      <form onsubmit={(e) => { e.preventDefault(); senden(); }}>
        <input bind:this={feld} bind:value={eingabe} placeholder="Frag Jarvis oder gib ihm eine Aufgabe" maxlength="4000" aria-label="Nachricht an Jarvis" autocomplete="off" disabled={laeuft} />
        {#if laeuft}
          <button type="button" class="los stopp" onclick={() => abbruch?.abort()} aria-label="Stopp">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
        {:else}
          <button class="los" disabled={!eingabe.trim()} aria-label="Senden">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        {/if}
      </form>
    </div>
  {/if}
  <button class="rund" class:denkt={laeuft} onclick={() => (offen = !offen)} aria-label={offen ? 'Jarvis schliessen' : 'Jarvis öffnen'} aria-expanded={offen}>
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
    gap: 12px;
    justify-items: end;
  }
  @media (max-width: 800px) {
    .leiste {
      bottom: 76px;
    }
  }
  .rund {
    position: relative;
    width: 56px;
    height: 56px;
    min-height: 0;
    border-radius: 50%;
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--akzent) 50%, transparent);
    background: radial-gradient(circle at 50% 40%, #0f2433, #070d14);
    box-shadow: 0 0 0 1px #ffffff0a inset, 0 6px 22px #0009, 0 0 26px -4px var(--akzent);
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .rund:hover {
    transform: scale(1.06);
  }
  .r {
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    background: conic-gradient(from 0deg, transparent 0 55%, var(--akzent) 100%);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
    animation: dreh 8s linear infinite;
  }
  .rund.denkt .r {
    animation-duration: 1.2s;
  }
  .m {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: radial-gradient(circle at 34% 30%, #fff 0, var(--akzent) 40%, var(--akzent-2) 100%);
    box-shadow: 0 0 14px 2px color-mix(in srgb, var(--akzent) 60%, transparent);
    animation: atmen 3.6s ease-in-out infinite;
  }
  @keyframes dreh {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes atmen {
    50% {
      transform: scale(1.14);
      opacity: 0.85;
    }
  }
  @keyframes puls {
    50% {
      transform: scale(1.3);
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .r,
    .m,
    .mini,
    .tippt i,
    .punkt {
      animation: none !important;
    }
  }
  .karte {
    width: min(92vw, 390px);
    background: linear-gradient(180deg, color-mix(in srgb, var(--flaeche-2) 94%, var(--akzent)), var(--flaeche));
    border: 1px solid color-mix(in srgb, var(--akzent) 24%, var(--rand));
    border-radius: 20px;
    padding: 12px;
    display: grid;
    gap: 10px;
    box-shadow: 0 18px 50px #000a, 0 0 40px -22px var(--akzent);
    animation: auf 0.18s ease-out;
  }
  @keyframes auf {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
  .titel {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
  }
  .titel strong {
    font-family: var(--schrift-zahl);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    font-size: 0.8rem;
    flex: 1;
  }
  .mini {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: radial-gradient(circle at 34% 30%, #fff 0, var(--akzent) 35%, var(--akzent-2) 100%);
    box-shadow: 0 0 10px color-mix(in srgb, var(--akzent) 60%, transparent);
  }
  .mini.denkt {
    animation: puls 0.9s ease-in-out infinite;
  }
  .mehr {
    font-size: 0.75rem;
    color: var(--text-3);
  }
  .mehr:hover {
    color: var(--akzent);
  }
  .antwort {
    max-height: 40vh;
    overflow-y: auto;
    display: grid;
    gap: 8px;
    padding: 2px 4px;
    line-height: 1.5;
  }
  .antwort p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .schritte {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .schritt {
    font-size: 0.76rem;
    color: var(--text-2);
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
  }
  .schritt.fehler {
    color: var(--ausfall);
    border-color: color-mix(in srgb, var(--ausfall) 40%, var(--rand));
  }
  .schritt em {
    color: var(--akzent);
    font-style: normal;
  }
  .schritt button {
    padding: 1px 9px;
    min-height: 0;
    font-size: 0.75rem;
    border-radius: 999px;
  }
  .schritt button.ja {
    background: linear-gradient(135deg, var(--akzent), var(--akzent-2));
    color: #04121a;
    border: 0;
  }
  .punkt {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ok);
  }
  .schritt.fehler .punkt {
    background: var(--ausfall);
  }
  .schritt.wartet .punkt {
    background: var(--warnung);
    animation: puls 1s ease-in-out infinite;
  }
  .tippt {
    display: flex;
    gap: 5px;
    padding: 6px 0;
  }
  .tippt i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--akzent);
    animation: puls 1s ease-in-out infinite;
  }
  .tippt i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .tippt i:nth-child(3) {
    animation-delay: 0.3s;
  }
  form {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 5px 5px 14px;
    border-radius: 999px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand-hell);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  form:focus-within {
    border-color: var(--akzent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--akzent) 18%, transparent);
  }
  form input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    outline: 0;
    box-shadow: none;
    padding: 6px 0;
  }
  .los {
    flex: none;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--akzent), var(--akzent-2));
    color: #04121a;
  }
  .los:disabled {
    background: var(--flaeche-3);
    color: var(--text-3);
    opacity: 1;
  }
  .los.stopp {
    background: var(--ausfall);
    color: #1a0505;
  }
</style>
