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

<div class="zeile" style="margin-bottom:10px">
  <select bind:value={organisation} style="width:auto" aria-label="Organisation">
    <option value="Rega">Rega</option>
    <option value="alle">Alle Helikopter</option>
  </select>
  <select bind:value={tage} style="width:auto" aria-label="Zeitraum">
    <option value={3}>3 Tage</option>
    <option value={7}>7 Tage</option>
    <option value={30}>30 Tage</option>
  </select>
  {#if antwort}<span class="klein gedaempft">{antwort.anzahl} Einsätze{antwort.demo ? ' (Demo)' : ''}</span>{/if}
</div>

{#if fehler}<div class="hinweis ausfall klein">{fehler}</div>{/if}

{#if antwort}
  {#if einsatz}
    {#key einsatz.id}
      <Karte hoehe="min(48vh, 420px)" ebenenFest={[]} {punkte} {linien} einpassen basisStart="nacht" />
    {/key}
  {/if}
  <div class="liste">
    {#each antwort.einsaetze as e (e.id)}
      <button type="button" class="einsatz panel" class:aktiv={e.id === gewaehlt} onclick={() => (gewaehlt = e.id)}>
        <div class="zeile-zwischen">
          <span>
            <strong>{e.organisation ?? 'Heli'} {e.kennzeichen ?? e.hex}</strong>
            <span class="marke {ART_KLASSE[e.art]}">{ARTEN[e.art]}</span>
            {#if e.inDerLuft}<span class="marke ausfall">in der Luft</span>{/if}
          </span>
          <span class="klein gedaempft">{datum(e.start)} · {zeit(e.start)} bis {e.ende ? zeit(e.ende) : 'offen'}</span>
        </div>
        <div class="stationen">
          {#each stationen(e) as s, i (i)}
            {#if i > 0}<span class="pfeil" aria-hidden="true">›</span>{/if}
            <span class="station {s.art}" class:verlust={s.verlust}>
              <span class="punkt"></span>{s.name}{#if s.zeit}<span class="gedaempft"> {zeit(s.zeit)}</span>{/if}
            </span>
          {/each}
        </div>
        <div class="sehr-klein gedaempft">
          Dauer {minuten(e.dauerMin)} · Flugzeit {minuten(e.flugMin)}{#if e.basis} · Basis {e.basis}{/if}{#if !e.zurueck && !e.inDerLuft} · Rückflug nicht erfasst{/if}
        </div>
      </button>
    {:else}
      <p class="klein gedaempft">Keine Einsätze in diesem Zeitraum erfasst.</p>
    {/each}
  </div>
  {#if einsatz}
    <div class="zeile" style="margin-top:6px">
      <button type="button" class="klein" onclick={() => navigieren(`/heli?hex=${encodeURIComponent(einsatz.hex)}`)}>Heli Details</button>
    </div>
  {/if}
  <p class="sehr-klein gedaempft">
    Abgeleitet aus selbst erfassten Transponderdaten (ADS-B), ohne Gewähr. Ein Einsatz beginnt mit dem Start und endet bei der Rückkehr an eine Basis. Orte ohne bekannten Platz gelten als Einsatzort.
  </p>
{:else if !fehler}
  <p class="klein gedaempft">Lade…</p>
{/if}

<style>
  .liste {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  .einsatz {
    text-align: left;
    color: inherit;
    font: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }
  .einsatz.aktiv {
    border-color: var(--akzent, #4aa3ff);
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
    font-size: 0.85rem;
  }
  .station {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 6px;
    background: #ffffff0d;
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
