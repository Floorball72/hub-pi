<script lang="ts">
  // Generischer Editor für bearbeitbare Tabellen. Formular und Prüfung kommen aus dem Schema des Backends.
  import type { Snippet } from 'svelte';
  import type { SpaltenInfo, TabellenInfo } from '../../server/geteilt/typen.ts';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datum, datumZeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { tabellenInfo } from '../lib/schema.ts';
  import Icon from './Icon.svelte';

  type Zeile = Record<string, unknown> & { id: string };

  let {
    tabelle,
    titel = '',
    filter = {},
    spalten = [],
    sort = '-erstellt',
    neuText = 'Neu',
    leerText = 'Noch keine Einträge.',
    zeilen = $bindable([]),
    onauswahl,
    aktionen,
    kompakt = false,
  }: {
    tabelle: string;
    titel?: string;
    filter?: Record<string, string>;
    spalten?: string[];
    sort?: string;
    neuText?: string;
    leerText?: string;
    zeilen?: Zeile[];
    onauswahl?: (z: Zeile) => void;
    aktionen?: Snippet<[Zeile]>;
    kompakt?: boolean;
  } = $props();

  let info = $state<TabellenInfo | null>(null);
  let fehler = $state('');
  let bearbeitet = $state<Record<string, unknown> | null>(null);
  let bearbeitetId = $state<string | null>(null);
  let verweise = $state<Record<string, { id: string; text: string }[]>>({});
  let speichert = $state(false);

  const sichtbar = $derived.by(() => {
    if (!info) return [] as SpaltenInfo[];
    const ohneFilter = info.spalten.filter((s) => !(s.name in filter));
    return spalten.length ? spalten.map((n) => info!.spalten.find((s) => s.name === n)).filter((s): s is SpaltenInfo => !!s) : ohneFilter.slice(0, 4);
  });

  async function laden() {
    try {
      info = await tabellenInfo(tabelle);
      const q = new URLSearchParams({ ...filter, sort, limit: '500' });
      zeilen = await api.get<Zeile[]>(`/api/daten/${tabelle}?${q}`);
      for (const s of info.spalten.filter((x) => x.verweis)) {
        const ziel = await tabellenInfo(s.verweis!).catch(() => null);
        const liste = await api.get<Zeile[]>(`/api/daten/${s.verweis}?limit=500`).catch(() => []);
        verweise[s.name] = liste.map((z) => ({ id: z.id, text: String(z[ziel?.anzeige ?? 'name'] ?? z.id) }));
      }
      fehler = '';
    } catch (e) {
      fehler = fehlerText(e);
    }
  }

  $effect(() => {
    void tabelle;
    void JSON.stringify(filter);
    laden();
  });

  function neu() {
    bearbeitetId = null;
    bearbeitet = { ...filter };
  }

  function bearbeiten(z: Zeile) {
    bearbeitetId = z.id;
    const kopie: Record<string, unknown> = {};
    for (const s of info?.spalten ?? []) {
      const w = z[s.name];
      kopie[s.name] = s.typ === 'zeit' && typeof w === 'string' ? zeitFuerEingabe(w) : s.typ === 'json' && w !== null ? JSON.stringify(w) : w;
    }
    bearbeitet = kopie;
  }

  function zeitFuerEingabe(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function speichern(e: SubmitEvent) {
    e.preventDefault();
    if (!bearbeitet || !info) return;
    const daten: Record<string, unknown> = { ...filter };
    for (const s of info.spalten) {
      if (!(s.name in bearbeitet)) continue;
      let w = bearbeitet[s.name];
      if (s.typ === 'zeit' && typeof w === 'string' && w) w = new Date(w).toISOString();
      if (s.typ === 'json' && typeof w === 'string') {
        try {
          w = w.trim() ? JSON.parse(w) : null;
        } catch {
          melden(`${s.label}: kein gültiges JSON`, 'ausfall');
          return;
        }
      }
      daten[s.name] = w;
    }
    speichert = true;
    try {
      if (bearbeitetId) await api.put(`/api/daten/${tabelle}/${bearbeitetId}`, daten);
      else await api.post(`/api/daten/${tabelle}`, daten);
      melden('Gespeichert');
      bearbeitet = null;
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    } finally {
      speichert = false;
    }
  }

  async function loeschen(z: Zeile) {
    const name = String(z[info?.anzeige ?? 'name'] ?? 'Eintrag');
    if (!(await bestaetigen('Eintrag löschen?', `«${name}» wird endgültig gelöscht.`, 'Löschen', true))) return;
    try {
      await api.del(`/api/daten/${tabelle}/${z.id}?bestaetigt=ja`);
      melden('Gelöscht');
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    }
  }

  function anzeigen(s: SpaltenInfo, w: unknown): string {
    if (w === null || w === undefined || w === '') return '–';
    if (s.verweis) return verweise[s.name]?.find((v) => v.id === w)?.text ?? '–';
    if (s.typ === 'bool') return w ? 'ja' : 'nein';
    if (s.typ === 'datum') return datum(String(w), true);
    if (s.typ === 'zeit') return datumZeit(String(w));
    if (s.typ === 'json') return JSON.stringify(w).slice(0, 60);
    if (s.typ === 'real' && typeof w === 'number') return `${w.toLocaleString('de-CH')}${s.einheit ? ` ${s.einheit}` : ''}`;
    if (s.typ === 'int' && typeof w === 'number') return `${w}${s.einheit ? ` ${s.einheit}` : ''}`;
    return String(w);
  }

  export function neuLaden() {
    return laden();
  }
</script>

<div class="editor" class:kompakt>
  <div class="zeile-zwischen kopfzeile">
    {#if titel}<h2>{titel}</h2>{:else}<span></span>{/if}
    <button class="klein" onclick={neu}><Icon name="plus" groesse={16} />{neuText}</button>
  </div>

  {#if fehler}<div class="hinweis ausfall">{fehler}</div>{/if}

  {#if bearbeitet && info}
    <form class="formular panel" onsubmit={speichern}>
      <div class="felder">
        {#each info.spalten.filter((s) => !(s.name in filter)) as s (s.name)}
          <div class="feld" class:breit={s.lang || s.typ === 'json'}>
            <label for="f-{tabelle}-{s.name}">{s.label}{s.pflicht ? ' *' : ''}{s.einheit ? ` (${s.einheit})` : ''}</label>
            {#if s.verweis}
              <select id="f-{tabelle}-{s.name}" bind:value={bearbeitet[s.name]}>
                <option value={null}>–</option>
                {#each verweise[s.name] ?? [] as v (v.id)}<option value={v.id}>{v.text}</option>{/each}
              </select>
            {:else if s.optionen}
              <select id="f-{tabelle}-{s.name}" bind:value={bearbeitet[s.name]} required={s.pflicht}>
                {#if !s.pflicht}<option value={null}>–</option>{/if}
                {#each s.optionen as o (o)}<option value={o}>{o}</option>{/each}
              </select>
            {:else if s.typ === 'bool'}
              <label class="schalter"><input id="f-{tabelle}-{s.name}" type="checkbox" bind:checked={bearbeitet[s.name] as boolean} /><span></span></label>
            {:else if s.lang || s.typ === 'json'}
              <textarea id="f-{tabelle}-{s.name}" rows="4" bind:value={bearbeitet[s.name]} required={s.pflicht}></textarea>
            {:else if s.typ === 'int' || s.typ === 'real'}
              <input id="f-{tabelle}-{s.name}" type="number" step={s.typ === 'int' ? '1' : 'any'} min={s.min} max={s.max} bind:value={bearbeitet[s.name]} required={s.pflicht} />
            {:else if s.typ === 'datum'}
              <input id="f-{tabelle}-{s.name}" type="date" bind:value={bearbeitet[s.name]} required={s.pflicht} />
            {:else if s.typ === 'zeit'}
              <input id="f-{tabelle}-{s.name}" type="datetime-local" bind:value={bearbeitet[s.name]} required={s.pflicht} />
            {:else}
              <input id="f-{tabelle}-{s.name}" type="text" bind:value={bearbeitet[s.name]} required={s.pflicht} />
            {/if}
          </div>
        {/each}
      </div>
      <div class="zeile knoepfe">
        <button type="button" onclick={() => (bearbeitet = null)}>Abbrechen</button>
        <button type="submit" class="primaer" disabled={speichert}>{bearbeitetId ? 'Änderungen speichern' : 'Erstellen'}</button>
      </div>
    </form>
  {/if}

  {#if !zeilen.length && !fehler}
    <p class="leer">{leerText}</p>
  {:else}
    <div class="tabelle-scroll">
      <table>
        <thead>
          <tr>
            {#each sichtbar as s (s.name)}<th>{s.label}</th>{/each}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each zeilen as z (z.id)}
            <tr class:klickbar={!!onauswahl} onclick={() => onauswahl?.(z)}>
              {#each sichtbar as s (s.name)}<td>{anzeigen(s, z[s.name])}</td>{/each}
              <td class="aktionen">
                {#if aktionen}{@render aktionen(z)}{/if}
                <button class="leise klein" title="Bearbeiten" aria-label="Bearbeiten" onclick={(e) => { e.stopPropagation(); bearbeiten(z); }}><Icon name="bearbeiten" groesse={16} /></button>
                <button class="leise klein" title="Löschen" aria-label="Löschen" onclick={(e) => { e.stopPropagation(); loeschen(z); }}><Icon name="loeschen" groesse={16} /></button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .kopfzeile {
    margin-bottom: 8px;
  }
  .kopfzeile h2 {
    margin: 0;
  }
  .formular {
    margin-bottom: 14px;
  }
  .felder {
    display: grid;
    gap: 10px 14px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  }
  .feld + .feld {
    margin-top: 0;
  }
  .breit {
    grid-column: 1 / -1;
  }
  .knoepfe {
    justify-content: flex-end;
    margin-top: 12px;
  }
  .aktionen {
    white-space: nowrap;
    text-align: right;
    width: 1%;
  }
  .klickbar {
    cursor: pointer;
  }
  @media (hover: hover) and (pointer: fine) {
    .klickbar:hover td {
      background: #ffffff05;
    }
  }
  .kompakt td {
    padding: 5px 6px;
  }
</style>
