<script lang="ts">
  import type { ModulInfo, SuchTreffer } from '../../server/geteilt/typen.ts';
  import { api } from '../lib/api.ts';
  import { AKTIONEN, type Befehl, filtern, modulBefehle, SEITEN } from '../lib/befehle.ts';
  import { palette } from '../lib/palette.svelte.ts';
  import { navigieren } from '../lib/router.svelte.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';
  import Icon from './Icon.svelte';

  let { module, onaktion }: { module: ModulInfo[]; onaktion: (name: string) => void } = $props();

  let eingabeFeld = $state<HTMLInputElement | null>(null);
  let liste = $state<HTMLElement | null>(null);
  let auswahl = $state(0);
  let helis = $state<Befehl[]>([]);
  let inhalte = $state<Befehl[]>([]);
  let zuletzt = $state<string[]>(lesen('palette.zuletzt', []));

  const rettungAktiv = $derived(module.some((m) => m.id === 'rettung' && m.aktiv));
  const alle = $derived([...SEITEN, ...modulBefehle(module.filter((m) => m.id !== 'zentrale')), ...helis, ...AKTIONEN]);

  // Beim Öffnen: Feld fokussieren, Helis einmal laden
  $effect(() => {
    if (!palette.offen) return;
    auswahl = 0;
    queueMicrotask(() => eingabeFeld?.focus());
    if (!rettungAktiv) return;
    api
      .get<{ helis: { hex: string; organisation: string; kennzeichen: string | null; amBoden: boolean; ort?: string | null }[]; abgestellt?: { hex: string; organisation: string; kennzeichen: string | null; platz: string | null }[] }>('/api/m/rettung/live')
      .then((l) => {
        const gesehen = new Set<string>();
        const neu: Befehl[] = [];
        for (const h of l.helis) {
          gesehen.add(h.hex);
          neu.push({ id: `h:${h.hex}`, titel: `${h.organisation} ${h.kennzeichen ?? h.hex}`, text: h.amBoden ? 'am Boden' : `in der Luft${h.ort ? `, ${h.ort}` : ''}`, gruppe: 'Helikopter', symbol: 'heli', link: `/heli?hex=${encodeURIComponent(h.hex)}`, woerter: h.hex });
        }
        for (const h of l.abgestellt ?? []) {
          if (gesehen.has(h.hex)) continue;
          neu.push({ id: `h:${h.hex}`, titel: `${h.organisation} ${h.kennzeichen ?? h.hex}`, text: h.platz ? `steht bei ${h.platz}` : 'letzter Standort', gruppe: 'Helikopter', symbol: 'heli', link: `/heli?hex=${encodeURIComponent(h.hex)}`, woerter: h.hex });
        }
        helis = neu;
      })
      .catch(() => {});
  });

  // Inhalte (Kunden, Orte, Notizen usw.) über die globale Suche, leicht verzögert
  $effect(() => {
    const q = palette.eingabe.trim();
    inhalte = [];
    if (!palette.offen || q.length < 2) return;
    const t = setTimeout(() => {
      api
        .get<SuchTreffer[]>(`/api/suche?q=${encodeURIComponent(q)}`)
        .then((tr) => {
          if (palette.eingabe.trim() !== q) return;
          inhalte = tr.slice(0, 8).map((x) => ({ id: `i:${x.link}`, titel: x.titel, text: x.text ? `${x.modul} · ${x.text}` : x.modul, gruppe: 'Inhalte', symbol: 'suche', link: x.link }));
        })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(t);
  });

  const treffer = $derived.by(() => {
    const q = palette.eingabe.trim();
    if (!q) {
      const nachId = new Map(alle.map((b) => [b.id, b]));
      const letzte = zuletzt.flatMap((id) => {
        const b = nachId.get(id);
        return b ? [{ ...b, gruppe: 'Zuletzt' }] : [];
      });
      const schon = new Set(zuletzt);
      return [...letzte, ...SEITEN.filter((b) => !schon.has(b.id)).slice(0, 5), ...AKTIONEN.filter((b) => !schon.has(b.id)).slice(0, 2)];
    }
    // Immer am Schluss: in allen Inhalten suchen oder den Text als Notiz speichern
    const zum: Befehl[] =
      q.length >= 2
        ? [
            { id: 'z:suche', titel: `Überall suchen nach «${q}»`, gruppe: 'Mehr', symbol: 'suche', link: `/suche?q=${encodeURIComponent(q)}` },
            { id: 'z:notiz', titel: 'Als Notiz speichern', text: q, gruppe: 'Mehr', symbol: 'notiz', aktion: 'notiz' },
          ]
        : [];
    return [...filtern(alle, q, 14), ...inhalte, ...zum];
  });

  // Gruppen in der Reihenfolge des ersten Auftretens, Index über alle Treffer
  const gruppen = $derived.by(() => {
    const g: { name: string; eintraege: { b: Befehl; i: number }[] }[] = [];
    treffer.forEach((b, i) => {
      let x = g.find((y) => y.name === b.gruppe);
      if (!x) g.push((x = { name: b.gruppe, eintraege: [] }));
      x.eintraege.push({ b, i });
    });
    return g;
  });

  // Reihenfolge der Anzeige, für Pfeiltasten
  const reihenfolge = $derived(gruppen.flatMap((g) => g.eintraege.map((e) => e.i)));

  $effect(() => {
    void palette.eingabe;
    auswahl = 0;
  });
  $effect(() => {
    if (auswahl >= reihenfolge.length) auswahl = Math.max(0, reihenfolge.length - 1);
  });

  function schliessen() {
    palette.offen = false;
    palette.eingabe = '';
  }

  async function notizSpeichern(text: string) {
    try {
      await api.post('/api/daten/notizen', { text, angeheftet: true });
      melden('Notiz gespeichert und angeheftet');
      window.dispatchEvent(new Event('pihub:notizen'));
    } catch {
      melden('Notiz konnte nicht gespeichert werden', 'ausfall');
    }
  }

  function ausfuehren(b: Befehl) {
    if (b.aktion === 'notiz') {
      const text = palette.eingabe.trim();
      schliessen();
      notizSpeichern(text);
      return;
    }
    if (b.gruppe === 'Mehr') {
      schliessen();
      if (b.link) navigieren(b.link);
      return;
    }
    zuletzt = [b.id, ...zuletzt.filter((x) => x !== b.id)].slice(0, 5);
    if (b.gruppe !== 'Inhalte') schreiben('palette.zuletzt', zuletzt);
    schliessen();
    if (b.aktion) onaktion(b.aktion);
    else if (b.link) navigieren(b.link);
  }

  function taste(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = reihenfolge.length;
      if (!n) return;
      auswahl = (auswahl + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      queueMicrotask(() => liste?.querySelector('.gewaehlt')?.scrollIntoView({ block: 'nearest' }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const b = treffer[reihenfolge[auswahl]];
      if (b) ausfuehren(b);
      else if (palette.eingabe.trim().length >= 2) {
        const q = palette.eingabe.trim();
        schliessen();
        navigieren(`/suche?q=${encodeURIComponent(q)}`);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      schliessen();
    }
  }
</script>

{#if palette.offen}
  <div class="schleier">
    <button class="hintergrund" aria-label="Schliessen" tabindex="-1" onclick={schliessen}></button>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Befehlspalette">
      <div class="eingabe">
        <Icon name="suche" groesse={18} />
        <input
          bind:this={eingabeFeld}
          bind:value={palette.eingabe}
          onkeydown={taste}
          placeholder="Wohin? Modul, Tab, Heli, Kunde, Ort…"
          aria-label="Befehl oder Suche"
          autocomplete="off"
          spellcheck="false"
        />
        <kbd>Esc</kbd>
      </div>
      <div class="treffer" bind:this={liste} role="listbox" aria-label="Treffer">
        {#each gruppen as g (g.name)}
          <div class="gruppe">{g.name}</div>
          {#each g.eintraege as { b, i } (b.id + g.name)}
            <button
              type="button"
              role="option"
              aria-selected={reihenfolge[auswahl] === i}
              class="eintrag"
              class:gewaehlt={reihenfolge[auswahl] === i}
              onmousemove={() => (auswahl = reihenfolge.indexOf(i))}
              onclick={() => ausfuehren(b)}
            >
              <span class="sym"><Icon name={b.symbol} groesse={17} /></span>
              <span class="titel">{b.titel}{#if b.text}<span class="text">{b.text}</span>{/if}</span>
              {#if reihenfolge[auswahl] === i}<kbd>↵</kbd>{/if}
            </button>
          {/each}
        {:else}
          <p class="leer">
            Nichts gefunden.{#if palette.eingabe.trim().length >= 2} Enter sucht in allen Inhalten.{/if}
          </p>
        {/each}
      </div>
      <div class="fuss sehr-klein gedaempft">
        <span><kbd>↑</kbd><kbd>↓</kbd> wählen</span><span><kbd>↵</kbd> öffnen</span><span><kbd>Ctrl</kbd><kbd>K</kbd> oder <kbd>/</kbd> überall</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .schleier {
    position: fixed;
    inset: 0;
    z-index: 2500;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 12vh 16px 16px;
  }
  .hintergrund {
    position: absolute;
    inset: 0;
    border: none;
    border-radius: 0;
    background: #05080cb3;
    backdrop-filter: blur(3px);
    cursor: default;
  }
  .palette {
    position: relative;
    width: min(620px, 100%);
    max-height: 72vh;
    display: flex;
    flex-direction: column;
    background: var(--flaeche-2);
    border: 1px solid var(--rand-hell);
    border-radius: 16px;
    box-shadow: 0 24px 80px #000a;
    overflow: hidden;
    animation: auf 0.14s ease-out;
  }
  @keyframes auf {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.99);
    }
  }
  .eingabe {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--rand);
    color: var(--text-2);
  }
  .eingabe input {
    flex: 1;
    border: none;
    background: none;
    font-size: 1.05rem;
    padding: 4px 0;
    outline: none;
    box-shadow: none;
    color: var(--text);
  }
  .eingabe:focus-within {
    border-bottom-color: #4cc9f088;
  }
  .treffer {
    overflow-y: auto;
    padding: 6px;
  }
  .gruppe {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-3);
    padding: 10px 10px 4px;
  }
  .eintrag {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 0;
    padding: 8px 10px;
    border: none;
    border-radius: 10px;
    background: none;
    color: var(--text);
    text-align: left;
    font-weight: 400;
    cursor: pointer;
  }
  .eintrag.gewaehlt {
    background: linear-gradient(90deg, #4cc9f026, #4cc9f00a);
    box-shadow: inset 2px 0 0 var(--akzent);
  }
  .sym {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 8px;
    background: var(--flaeche-3);
    color: var(--text-2);
  }
  .gewaehlt .sym {
    color: var(--akzent);
  }
  .titel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .text {
    font-size: 0.78rem;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .leer {
    padding: 18px 12px;
    color: var(--text-3);
  }
  .fuss {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    padding: 8px 14px;
    border-top: 1px solid var(--rand);
  }
  kbd {
    font-family: var(--schrift-zahl);
    font-size: 0.7rem;
    padding: 1px 5px;
    margin: 0 2px;
    border-radius: 5px;
    border: 1px solid var(--rand-hell);
    background: var(--flaeche-3);
    color: var(--text-2);
  }
  @media (max-width: 600px) {
    .schleier {
      padding-top: 10px;
    }
    .fuss {
      display: none;
    }
  }
</style>
