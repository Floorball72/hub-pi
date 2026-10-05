<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datum } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';

  interface Aufgabe {
    id: string;
    titel: string;
    notiz: string | null;
    liste: string | null;
    faellig: string | null;
    uhrzeit: string | null;
    prioritaet: string | null;
    rhythmus: string | null;
    erledigt: boolean;
    erledigt_am: string | null;
    gruppe?: string;
  }
  interface Routine { id: string; name: string; rhythmus: string; uhrzeit: string | null; heute: boolean; schritte: string[]; erledigt: number[]; fertig: boolean; serie: number }
  interface Artikel { id: string; text: string; menge: string | null; erledigt: boolean }
  interface Uebersicht { heute: string; offen: Aufgabe[]; erledigt: Aufgabe[]; listen: string[]; routinen: Routine[]; einkauf: Artikel[] }

  const GRUPPEN = [
    { id: 'ueberfaellig', name: 'Überfällig' },
    { id: 'heute', name: 'Heute' },
    { id: 'morgen', name: 'Morgen' },
    { id: 'woche', name: 'Nächste 7 Tage' },
    { id: 'spaeter', name: 'Später' },
    { id: 'ohne', name: 'Ohne Datum' },
  ];
  const RHYTHMUS: Record<string, string> = { taeglich: 'täglich', woechentlich: 'wöchentlich', zweiwoechentlich: 'alle 2 Wochen', monatlich: 'monatlich', jaehrlich: 'jährlich' };

  let tab = $state('Heute');
  let u = $state<Uebersicht | null>(null);
  let liste = $state<string>(lesen('aufgaben.liste', ''));
  $effect(() => schreiben('aufgaben.liste', liste));

  async function laden() {
    u = await api.get('/api/m/aufgaben/uebersicht');
  }
  let editorZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  let routinenZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  $effect(() => {
    void tab;
    void JSON.stringify(editorZeilen);
    void JSON.stringify(routinenZeilen);
    laden().catch((e) => melden(fehlerText(e), 'ausfall'));
  });

  const gefiltert = $derived((u?.offen ?? []).filter((a) => !liste || (a.liste || 'Privat') === liste));
  const sichtbar = $derived(tab === 'Heute' ? gefiltert.filter((a) => ['ueberfaellig', 'heute'].includes(a.gruppe ?? '')) : gefiltert);
  const gruppen = $derived(GRUPPEN.map((g) => ({ ...g, eintraege: sichtbar.filter((a) => a.gruppe === g.id) })).filter((g) => g.eintraege.length));
  const routinenHeute = $derived((u?.routinen ?? []).filter((r) => r.heute));

  // ---------- Schnellerfassung ----------
  let eingabe = $state('');
  let sendet = $state(false);
  async function erfassen(e: SubmitEvent) {
    e.preventDefault();
    if (!eingabe.trim() || sendet) return;
    sendet = true;
    try {
      const neu = await api.post<Aufgabe>('/api/m/aufgaben/schnell', { text: eingabe, liste: liste || undefined });
      eingabe = '';
      melden(`«${neu.titel}» erfasst${neu.faellig ? `, fällig ${datum(neu.faellig)}` : ''}${neu.uhrzeit ? ` um ${neu.uhrzeit}` : ''}`, 'ok');
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    } finally {
      sendet = false;
    }
  }

  async function abhaken(a: Aufgabe, erledigt = true) {
    try {
      const r = await api.post<Aufgabe & { naechste?: string | null }>(`/api/m/aufgaben/aufgabe/${a.id}/erledigt`, { erledigt });
      if (r.naechste) melden(`Erledigt. Nächstes Mal am ${datum(r.naechste)}`, 'ok');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function verschieben(a: Aufgabe, tage: number) {
    try {
      await api.post(`/api/m/aufgaben/aufgabe/${a.id}/verschieben`, { tage });
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  async function schritt(r: Routine, i: number) {
    const erledigt = !r.erledigt.includes(i);
    try {
      const res = await api.post<{ erledigt: number[]; fertig: boolean }>(`/api/m/aufgaben/routine/${r.id}/schritt`, { index: i, erledigt });
      if (res.fertig && !r.fertig) melden(`Routine «${r.name}» erledigt`, 'ok');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  // ---------- Einkauf ----------
  let artikel = $state('');
  async function artikelDazu(e: SubmitEvent) {
    e.preventDefault();
    const t = artikel.trim();
    if (!t) return;
    // «2 kg Äpfel» oder «Äpfel 2 kg»: Menge vorne oder hinten erkennen
    const m = t.match(/^(\d+[.,]?\d*\s*(?:kg|g|l|dl|x|stk|pack)?)\s+(.+)$/i) ?? t.match(/^(.+?)\s+(\d+[.,]?\d*\s*(?:kg|g|l|dl|x|stk|pack)?)$/i);
    const [text, menge] = m ? (/^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]]) : [t, null];
    try {
      await api.post('/api/daten/einkauf', { text, menge, erledigt: false });
      artikel = '';
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    }
  }
  async function artikelUmschalten(a: Artikel) {
    try {
      await api.put(`/api/daten/einkauf/${a.id}`, { erledigt: !a.erledigt });
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function aufraeumen() {
    const n = (u?.einkauf ?? []).filter((a) => a.erledigt).length;
    if (!n || !(await bestaetigen('Einkaufsliste aufräumen?', `${n} Artikel im Korb werden aus der Liste entfernt.`, 'Entfernen', true))) return;
    try {
      await api.post('/api/m/aufgaben/einkauf/aufraeumen', { bestaetigt: true });
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  const faelligText = (a: Aufgabe) => {
    if (!a.faellig) return '';
    const t = a.gruppe === 'heute' ? 'heute' : a.gruppe === 'morgen' ? 'morgen' : datum(a.faellig);
    return a.uhrzeit ? `${t} ${a.uhrzeit}` : t;
  };
</script>

{#snippet aufgabeZeile(a: Aufgabe)}
  <li class="aufgabe" class:hoch={a.prioritaet === 'hoch'}>
    <button class="haken" aria-label="{a.titel} erledigen" onclick={() => abhaken(a)}></button>
    <div class="info">
      <span class="titel">{a.titel}</span>
      <span class="klein gedaempft">
        {#if a.faellig}<span class:ueber={a.gruppe === 'ueberfaellig'}>{faelligText(a)}</span>{/if}
        {#if a.rhythmus && a.rhythmus !== 'einmalig'}{' · '}{RHYTHMUS[a.rhythmus] ?? a.rhythmus}{/if}
        {#if !liste && a.liste}{' · '}{a.liste}{/if}
      </span>
    </div>
    {#if a.gruppe === 'ueberfaellig' || a.gruppe === 'heute'}
      <button class="leise klein" onclick={() => verschieben(a, 1)} aria-label="{a.titel} auf morgen schieben">Morgen</button>
    {/if}
  </li>
{/snippet}

<ModulRahmen modulId="aufgaben" tabs={['Heute', 'Alle', 'Routinen', 'Einkauf']} bind:tab>
  {#if !u}
    <div class="laedt">Lädt …</div>
  {:else if tab === 'Heute' || tab === 'Alle'}
    <div class="stapel">
      <form class="panel erfassen" onsubmit={erfassen}>
        <input bind:value={eingabe} placeholder="Neue Aufgabe, z.B. «Offerte schreiben morgen 9:00 #scont !»" maxlength="300" aria-label="Neue Aufgabe" />
        <button class="primaer" disabled={!eingabe.trim() || sendet}>Erfassen</button>
        <p class="sehr-klein gedaempft">Erkennt heute, morgen, Wochentage, Daten wie 12.10., Uhrzeiten, #Liste, ! für wichtig und Wörter wie wöchentlich oder monatlich.</p>
      </form>
      {#if u.listen.length > 1}
        <div class="zeile chips">
          <button class="chip" class:aktiv={!liste} onclick={() => (liste = '')}>Alle</button>
          {#each u.listen as l (l)}
            <button class="chip" class:aktiv={liste === l} onclick={() => (liste = l)}>{l}</button>
          {/each}
        </div>
      {/if}
      {#if tab === 'Heute' && routinenHeute.some((r) => !r.fertig)}
        <div class="panel zeile chips">
          <span class="klein gedaempft">Routinen:</span>
          {#each routinenHeute.filter((r) => !r.fertig) as r (r.id)}
            <button class="chip" onclick={() => (tab = 'Routinen')}>{r.name} {r.erledigt.length}/{r.schritte.length}</button>
          {/each}
        </div>
      {/if}
      {#if !gruppen.length}
        <div class="panel leer">{tab === 'Heute' ? 'Für heute ist alles erledigt.' : 'Keine offenen Aufgaben.'}</div>
      {/if}
      {#each gruppen as g (g.id)}
        <div class="panel">
          <h3 class:ueber={g.id === 'ueberfaellig'}>{g.name} <span class="gedaempft">{g.eintraege.length}</span></h3>
          <ul class="liste aufgaben">
            {#each g.eintraege as a (a.id)}{@render aufgabeZeile(a)}{/each}
          </ul>
        </div>
      {/each}
      {#if tab === 'Alle'}
        {#if u.erledigt.length}
          <details class="panel">
            <summary>Erledigt in den letzten 7 Tagen ({u.erledigt.length})</summary>
            <ul class="liste aufgaben">
              {#each u.erledigt as a (a.id)}
                <li class="aufgabe erledigt">
                  <button class="haken an" aria-label="{a.titel} wieder öffnen" onclick={() => abhaken(a, false)}></button>
                  <div class="info"><span class="titel">{a.titel}</span></div>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
        <details class="panel">
          <summary>Alle Aufgaben bearbeiten</summary>
          <TabellenEditor tabelle="aufgaben" spalten={['titel', 'liste', 'faellig', 'uhrzeit', 'rhythmus', 'erledigt']} sort="faellig" neuText="Aufgabe" bind:zeilen={editorZeilen} />
        </details>
      {/if}
    </div>
  {:else if tab === 'Routinen'}
    <div class="stapel">
      {#if !u.routinen.length}<div class="panel leer">Noch keine Routinen.</div>{/if}
      {#each u.routinen as r (r.id)}
        <div class="panel" class:fertig={r.fertig} class:ruhig={!r.heute}>
          <div class="zeile-zwischen">
            <h3>{r.name}</h3>
            <span class="klein gedaempft">
              {r.rhythmus === 'woechentlich' ? 'diese Woche' : r.heute ? 'heute' : 'heute nicht geplant'}
              {#if r.serie > 1}{' · '}{r.serie} {r.rhythmus === 'woechentlich' ? 'Wochen' : 'Tage'} in Folge{/if}
            </span>
          </div>
          <div class="fortschritt" aria-hidden="true"><span style="width:{r.schritte.length ? (r.erledigt.length / r.schritte.length) * 100 : 0}%"></span></div>
          <ul class="liste aufgaben">
            {#each r.schritte as s, i (i)}
              <li class="aufgabe" class:erledigt={r.erledigt.includes(i)}>
                <button class="haken" class:an={r.erledigt.includes(i)} aria-pressed={r.erledigt.includes(i)} aria-label={s} onclick={() => schritt(r, i)}></button>
                <div class="info"><span class="titel">{s}</span></div>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
      <details class="panel">
        <summary>Routinen bearbeiten</summary>
        <TabellenEditor tabelle="routinen" spalten={['name', 'rhythmus', 'tage', 'uhrzeit', 'aktiv']} sort="name" neuText="Routine" bind:zeilen={routinenZeilen} />
      </details>
    </div>
  {:else}
    <div class="stapel">
      <form class="panel erfassen" onsubmit={artikelDazu}>
        <input bind:value={artikel} placeholder="Artikel, z.B. «2 kg Äpfel»" maxlength="100" aria-label="Neuer Artikel" />
        <button class="primaer" disabled={!artikel.trim()}>Dazu</button>
      </form>
      <div class="panel">
        {#if !u.einkauf.length}
          <div class="leer">Die Einkaufsliste ist leer.</div>
        {:else}
          <ul class="liste aufgaben">
            {#each u.einkauf as a (a.id)}
              <li class="aufgabe" class:erledigt={a.erledigt}>
                <button class="haken" class:an={a.erledigt} aria-pressed={a.erledigt} aria-label={a.text} onclick={() => artikelUmschalten(a)}></button>
                <div class="info"><span class="titel">{a.text}</span></div>
                {#if a.menge}<span class="klein gedaempft">{a.menge}</span>{/if}
              </li>
            {/each}
          </ul>
          {#if u.einkauf.some((a) => a.erledigt)}
            <button class="leise klein" onclick={aufraeumen}>Artikel im Korb entfernen</button>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</ModulRahmen>

<style>
  h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  h3.ueber, .ueber { color: var(--warnung); }
  .erfassen { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .erfassen input { flex: 1; min-width: 12rem; }
  .erfassen p { flex-basis: 100%; margin: 0; }
  .chips { flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .chip { padding: 0.25rem 0.7rem; border-radius: 999px; font-size: 0.85rem; }
  .chip.aktiv { background: var(--akzent); color: var(--bg); border-color: transparent; }
  .aufgaben { list-style: none; padding: 0; margin: 0; }
  .aufgabe { display: flex; align-items: center; gap: 0.7rem; padding: 0.45rem 0; border-bottom: 1px solid var(--rand); }
  .aufgabe:last-child { border-bottom: 0; }
  .aufgabe .info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .aufgabe.hoch .titel { font-weight: 600; }
  .aufgabe.hoch .titel::before { content: '! '; color: var(--warnung); }
  .aufgabe.erledigt .titel { text-decoration: line-through; color: var(--text-3); }
  .haken {
    width: 24px; height: 24px; min-height: 24px; padding: 0; flex-shrink: 0;
    border-radius: 50%; border: 2px solid var(--text-3); background: transparent; cursor: pointer;
  }
  .haken:hover { border-color: var(--ok); }
  .haken.an { background: var(--ok); border-color: var(--ok); }
  .haken.an::after { content: '✓'; color: var(--bg); font-size: 14px; line-height: 20px; display: block; text-align: center; }
  .fortschritt { height: 4px; background: var(--flaeche-3); border-radius: 2px; margin-bottom: 0.4rem; overflow: hidden; }
  .fortschritt span { display: block; height: 100%; background: var(--ok); transition: width 0.2s; }
  .ruhig { opacity: 0.6; }
  summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; }
  details[open] summary { margin-bottom: 0.5rem; }
  @media (pointer: coarse) {
    .haken { width: 32px; height: 32px; min-height: 32px; }
    .haken.an::after { line-height: 28px; }
  }
</style>
