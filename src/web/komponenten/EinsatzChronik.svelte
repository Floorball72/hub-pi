<script lang="ts">
  import type { GeoLinie, GeoPunkt } from '../../server/geteilt/typen.ts';
  import { api } from '../lib/api.ts';
  import { datum, zeit } from '../lib/format.ts';
  import { navigieren } from '../lib/router.svelte.ts';
  import Karte from './Karte.svelte';

  interface Etappe {
    id: string;
    von: string | null;
    nach: string | null;
    art: 'basis' | 'spital' | 'landeplatz' | 'einsatzort' | 'weg';
    start: string;
    ende: string | null;
    minuten: number | null;
    lat: number | null;
    lon: number | null;
    signalverlust: boolean;
    spur: [number, number][];
  }
  interface Einsatz {
    id: string;
    hex: string;
    organisation: string | null;
    kennzeichen: string | null;
    basis: string | null;
    start: string;
    ende: string | null;
    zurueck: boolean;
    art: 'einsatzort' | 'verlegung' | 'spital' | 'unklar';
    einsatzort: { name: string; lat: number; lon: number } | null;
    spitaeler: string[];
    flugMin: number;
    dauerMin: number | null;
    etappen: Etappe[];
    inDerLuft: boolean;
  }
  interface Antwort {
    einsaetze: Einsatz[];
    anzahl: number;
    tage: number;
    stand: string | null;
    demo: boolean;
  }

  let tage = $state(7);
  let organisation = $state('Rega');
  let antwort = $state<Antwort | null>(null);
  let fehler = $state('');
  let gewaehlt = $state<string | null>(null);
  let filter = $state<Einsatz['art'] | 'alle'>('alle');

  $effect(() => {
    const q = new URLSearchParams({ tage: String(tage), organisation });
    fehler = '';
    api
      .get<Antwort>(`/api/m/rettung/einsaetze?${q}`)
      .then((a) => {
        antwort = a;
        if (!a.einsaetze.some((e) => e.id === gewaehlt)) gewaehlt = a.einsaetze[0]?.id ?? null;
      })
      .catch((e) => (fehler = String(e?.message ?? e)));
  });

  const ARTEN: Record<Einsatz['art'], string> = {
    einsatzort: 'Einsatzort',
    verlegung: 'Verlegung zwischen Spitälern',
    spital: 'Spitalflug',
    unklar: 'Unklar',
  };
  const ART_KLASSE: Record<Einsatz['art'], string> = { einsatzort: 'warnung', verlegung: 'info', spital: 'info', unklar: '' };
  const HALT_FARBE: Record<string, string> = { basis: '#3ecf8e', spital: '#ef5350', einsatzort: '#ffb020', landeplatz: '#ffb020' };

  const einsatz = $derived(antwort?.einsaetze.find((e) => e.id === gewaehlt) ?? null);
  const gefiltert = $derived((antwort?.einsaetze ?? []).filter((e) => filter === 'alle' || e.art === filter));
  const zaehler = $derived(
    (antwort?.einsaetze ?? []).reduce<Record<string, number>>((z, e) => {
      z[e.art] = (z[e.art] ?? 0) + 1;
      return z;
    }, {}),
  );
  const flugTotal = $derived(gefiltert.reduce((s, e) => s + e.flugMin, 0));
  const ART_LISTE = Object.keys(ARTEN) as Einsatz['art'][];

  /** Nach Tag gruppiert, neuste zuerst */
  const tageListe = $derived.by(() => {
    const g = new Map<string, Einsatz[]>();
    for (const e of gefiltert) {
      const tag = new Date(e.start).toDateString();
      g.set(tag, [...(g.get(tag) ?? []), e]);
    }
    return [...g.entries()].map(([tag, liste]) => ({ tag, titel: tagTitel(liste[0].start), liste }));
  });

  function tagTitel(iso: string) {
    const d = new Date(iso).toDateString();
    const wt = new Date(iso).toLocaleDateString('de-CH', { weekday: 'long' });
    if (d === new Date().toDateString()) return `Heute, ${wt}`;
    if (d === new Date(Date.now() - 86400000).toDateString()) return `Gestern, ${wt}`;
    return `${wt}, ${datum(iso)}`;
  }

  function minuten(m: number | null) {
    if (m === null) return 'offen';
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  }

  /** Stationen: Start, dann jede Landung */
  function stationen(e: Einsatz) {
    const s: { name: string; zeit: string | null; art: string; verlust: boolean }[] = [];
    const erste = e.etappen[0];
    if (erste) s.push({ name: erste.von ?? 'Unbekannt', zeit: erste.start, art: e.basis && erste.von === e.basis ? 'basis' : 'weg', verlust: false });
    for (const t of e.etappen) {
      if (t.ende) s.push({ name: t.nach ?? (t.signalverlust ? 'Signal verloren' : 'Unbekannt'), zeit: t.ende, art: t.art, verlust: t.signalverlust });
      else s.push({ name: 'in der Luft', zeit: null, art: 'weg', verlust: false });
    }
    return s;
  }

  const linien = $derived<GeoLinie[]>(
    (einsatz?.etappen ?? [])
      .filter((t) => t.spur.length > 1)
      .map((t, i) => ({
        id: t.id,
        titel: `Etappe ${i + 1}`,
        text: `${t.von ?? '?'} nach ${t.nach ?? '?'}`,
        farbe: i % 2 ? '#7cc4ff' : '#4aa3ff',
        gestrichelt: !t.ende,
        punkte: t.spur,
      })),
  );
  const punkte = $derived<GeoPunkt[]>(
    (einsatz?.etappen ?? []).flatMap((t, i) => {
      const p: GeoPunkt[] = [];
      if (i === 0 && t.spur.length) {
        const [lat, lon] = t.spur[0];
        p.push({ id: `${t.id}-start`, lat, lon, titel: t.von ?? 'Start', text: `Start ${zeit(t.start)}`, symbol: 'basis', farbe: HALT_FARBE.basis });
      }
      if (t.ende && t.lat !== null && t.lon !== null) {
        p.push({
          id: `${t.id}-halt`,
          lat: t.lat,
          lon: t.lon,
          titel: t.nach ?? (t.signalverlust ? 'Signal verloren' : 'Landung'),
          text: `Landung ${zeit(t.ende)}`,
          symbol: t.art === 'basis' ? 'basis' : t.art === 'spital' ? 'spital' : t.art === 'einsatzort' ? 'einsatz' : 'halt',
          farbe: HALT_FARBE[t.art],
        });
      }
      return p;
    }),
  );
</script>

<div class="kopf">
  <div class="zeile">
    <select bind:value={organisation} style="width:auto" aria-label="Organisation">
      <option value="Rega">Rega</option>
      <option value="alle">Alle Helikopter</option>
    </select>
    <select bind:value={tage} style="width:auto" aria-label="Zeitraum">
      <option value={3}>3 Tage</option>
      <option value={7}>7 Tage</option>
      <option value={30}>30 Tage</option>
    </select>
  </div>
  {#if antwort}
    <div class="filter" role="group" aria-label="Art des Einsatzes">
      <button type="button" class:an={filter === 'alle'} onclick={() => (filter = 'alle')}>Alle <span class="zahl">{antwort.anzahl}</span></button>
      {#each ART_LISTE as a (a)}
        {#if zaehler[a]}
          <button type="button" class="art-{a}" class:an={filter === a} onclick={() => (filter = a)}>
            <span class="punkt"></span>{ARTEN[a]} <span class="zahl">{zaehler[a]}</span>
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

{#if fehler}<div class="hinweis ausfall klein">{fehler}</div>{/if}

{#if antwort}
  <p class="sehr-klein gedaempft" style="margin:0 0 8px">
    {gefiltert.length} Einsätze, zusammen {minuten(flugTotal)} in der Luft{antwort.demo ? ' (Demo)' : ''}
  </p>
  <div class="aufteilung">
    <div class="karte-spalte">
      {#if einsatz}
        {#key einsatz.id}
          <Karte hoehe="min(48vh, 440px)" ebenenFest={[]} {punkte} {linien} einpassen basisStart="nacht" />
        {/key}
        <div class="auswahl klein">
          <strong>{einsatz.organisation ?? 'Heli'} {einsatz.kennzeichen ?? einsatz.hex}</strong>
          <span class="gedaempft">{datum(einsatz.start)}, {zeit(einsatz.start)} bis {einsatz.ende ? zeit(einsatz.ende) : 'offen'}</span>
          <button type="button" class="klein" onclick={() => navigieren(`/heli?hex=${encodeURIComponent(einsatz.hex)}`)}>Heli Details</button>
        </div>
      {/if}
    </div>
    <div class="liste">
      {#each tageListe as t (t.tag)}
        <h3 class="tag">{t.titel} <span class="gedaempft">· {t.liste.length}</span></h3>
        {#each t.liste as e (e.id)}
          <button type="button" class="einsatz art-{e.art}" class:aktiv={e.id === gewaehlt} onclick={() => (gewaehlt = e.id)}>
            <span class="uhr">
              <strong>{zeit(e.start)}</strong>
              <span class="sehr-klein gedaempft">{e.ende ? zeit(e.ende) : 'offen'}</span>
            </span>
            <span class="inhalt">
              <span class="zeile-zwischen">
                <span>
                  <strong>{e.kennzeichen ?? e.hex}</strong>
                  <span class="gedaempft klein">{e.basis ? e.basis.replace('Rega Basis ', '') : (e.organisation ?? '')}</span>
                </span>
                <span>
                  {#if e.inDerLuft}<span class="marke ausfall">in der Luft</span>{/if}
                  <span class="marke {ART_KLASSE[e.art]}">{ARTEN[e.art]}</span>
                </span>
              </span>
              <span class="stationen">
                {#each stationen(e) as s, i (i)}
                  {#if i > 0}<span class="pfeil" aria-hidden="true">›</span>{/if}
                  <span class="station {s.art}" class:verlust={s.verlust}><span class="punkt"></span>{s.name}</span>
                {/each}
              </span>
              <span class="sehr-klein gedaempft">
                Dauer {minuten(e.dauerMin)} · Flugzeit {minuten(e.flugMin)}{#if !e.zurueck && !e.inDerLuft} · Rückflug nicht erfasst{/if}
              </span>
            </span>
          </button>
        {/each}
      {:else}
        <p class="klein gedaempft">Keine Einsätze in diesem Zeitraum erfasst.</p>
      {/each}
    </div>
  </div>
  <p class="sehr-klein gedaempft">
    Abgeleitet aus selbst erfassten Transponderdaten (ADS-B), ohne Gewähr. Ein Einsatz beginnt mit dem Start und endet bei der Rückkehr an eine Basis. Orte ohne bekannten Platz gelten als Einsatzort. Kurze Lücken im Empfang gelten nicht als Landung.
  </p>
{:else if !fehler}
  <p class="klein gedaempft">Lade…</p>
{/if}

<style>
  .kopf {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    margin-bottom: 8px;
  }
  .filter {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .filter button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.8rem;
    background: transparent;
    border: 1px solid var(--rand);
    color: var(--text-2);
  }
  .filter button.an {
    color: var(--text);
    border-color: var(--akzent, #4aa3ff);
    background: #4aa3ff1a;
  }
  .aufteilung {
    display: grid;
    gap: 12px;
  }
  @media (min-width: 900px) {
    .aufteilung {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      align-items: start;
    }
    .karte-spalte {
      position: sticky;
      top: 12px;
      order: 2;
    }
    .liste {
      max-height: 78vh;
      overflow-y: auto;
      padding-right: 4px;
    }
  }
  .auswahl {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: center;
    margin-top: 6px;
  }
  .auswahl button {
    margin-left: auto;
  }
  .liste {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tag {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-2);
    margin: 10px 0 2px;
    position: sticky;
    top: 0;
    background: var(--bg);
    padding: 4px 0;
    z-index: 1;
    flex-shrink: 0;
  }
  .tag:first-child {
    margin-top: 0;
  }
  .einsatz {
    text-align: left;
    color: inherit;
    font: inherit;
    cursor: pointer;
    display: grid;
    grid-template-columns: 3.4rem 1fr;
    gap: 10px;
    flex-shrink: 0;
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid transparent;
    border-left: 3px solid #8a97a8;
    background: #ffffff08;
  }
  .einsatz:hover {
    background: #ffffff10;
  }
  .einsatz.art-einsatzort {
    border-left-color: #ffb020;
  }
  .einsatz.art-verlegung,
  .einsatz.art-spital {
    border-left-color: #7cc4ff;
  }
  .einsatz.aktiv {
    border-top-color: var(--akzent, #4aa3ff);
    border-right-color: var(--akzent, #4aa3ff);
    border-bottom-color: var(--akzent, #4aa3ff);
    background: #4aa3ff14;
  }
  .uhr {
    display: flex;
    flex-direction: column;
    font-variant-numeric: tabular-nums;
  }
  .inhalt {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .filter .punkt {
    background: #8a97a8;
  }
  .filter .art-einsatzort .punkt {
    background: #ffb020;
  }
  .filter .art-verlegung .punkt,
  .filter .art-spital .punkt {
    background: #7cc4ff;
  }
  .marke {
    font-size: 0.72rem;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid var(--rand);
    margin-left: 6px;
    color: var(--text-2);
  }
  .marke.warnung {
    color: #ffb020;
    border-color: #ffb02066;
  }
  .marke.info {
    color: #7cc4ff;
    border-color: #7cc4ff55;
  }
  .marke.ausfall {
    color: #ef5350;
    border-color: #ef535066;
  }
  .stationen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 0.8rem;
  }
  .station {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .punkt {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #8a97a8;
  }
  .station.basis .punkt {
    background: #3ecf8e;
  }
  .station.spital .punkt {
    background: #ef5350;
  }
  .station.einsatzort .punkt,
  .station.landeplatz .punkt {
    background: #ffb020;
  }
  .station.verlust {
    opacity: 0.7;
    font-style: italic;
  }
  .pfeil {
    color: var(--text-2);
  }
</style>
