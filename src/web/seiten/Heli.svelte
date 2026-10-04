<script lang="ts">
  // Ein Heli im Detail: wo er gerade ist, der laufende Flug, Flüge der letzten 30 Tage.
  import { heliFarbe } from '../../server/geteilt/heli.ts';
  import type { GeoLinie, GeoPunkt } from '../../server/geteilt/typen.ts';
  import Karte from '../komponenten/Karte.svelte';
  import { api } from '../lib/api.ts';
  import { datumZeit, relativ, zahl } from '../lib/format.ts';
  import { parameter } from '../lib/router.svelte.ts';

  interface Flug {
    id: string;
    start: string;
    start_art: string | null;
    start_ort: string | null;
    start_platz: string | null;
    ende: string | null;
    ende_art: string | null;
    ende_ort: string | null;
    ende_platz: string | null;
    max_hoehe_ft: number | null;
    spur: [number, number][] | null;
  }
  interface Detail {
    hex: string;
    organisation: string | null;
    kennzeichen: string | null;
    typ: string | null;
    position: { lat: number; lon: number; amBoden: boolean; hoeheFt: number | null; kmh: number | null; kurs: number | null; zeit: string; ort: string | null } | null;
    laufend: { start: string; gestartet: boolean; startPlatz: string | null; maxHoeheFt: number | null; spur: [number, number][] } | null;
    anzahl30: number;
    heute: number;
    dauerMin: number | null;
    ziele: [string, number][];
    startplaetze: [string, number][];
    fluege: Flug[];
    stand: string | null;
    demo: boolean;
  }

  const hex = $derived(parameter('hex') ?? '');
  let d = $state<Detail | null>(null);
  let fehler = $state<string | null>(null);

  $effect(() => {
    const h = hex;
    if (!h) return;
    const holen = () =>
      api
        .get<Detail>(`/api/m/rettung/heli/${encodeURIComponent(h)}`)
        .then((x) => {
          d = x;
          fehler = null;
        })
        .catch((e) => (fehler = String(e)));
    holen();
    const t = setInterval(holen, 30000);
    return () => clearInterval(t);
  });

  const farbe = $derived(heliFarbe(d?.organisation));
  const name = $derived(d ? `${d.organisation ?? 'Helikopter'} ${d.kennzeichen ?? d.hex}` : '');
  const minuten = (a: string, b: string | null) => Math.max(1, Math.round(((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / 60000));

  const punkte = $derived<GeoPunkt[]>(
    d?.position
      ? [
          {
            id: d.hex,
            lat: d.position.lat,
            lon: d.position.lon,
            titel: name,
            text: d.position.amBoden ? 'am Boden' : [d.position.hoeheFt !== null ? `${d.position.hoeheFt} ft` : null, d.position.kmh !== null ? `${d.position.kmh} km/h` : null].filter(Boolean).join(' · '),
            symbol: 'heli',
            farbe,
            richtung: d.position.kurs ?? undefined,
            zeit: d.position.zeit,
          },
        ]
      : [],
  );
  // Laufender Flug gestrichelt, Flüge der letzten 24 Stunden durchgezogen und blasser
  const linien = $derived<GeoLinie[]>([
    ...(d?.laufend ? [{ id: 'laufend', titel: `${name} in der Luft`, text: `Seit ${datumZeit(d.laufend.start)}`, farbe, gestrichelt: true, punkte: d.laufend.spur }] : []),
    ...(d?.fluege ?? [])
      .filter((f) => f.spur && f.spur.length > 1)
      .map((f) => ({
        id: f.id,
        titel: `${f.start_platz ?? f.start_ort ?? '?'} nach ${f.ende_platz ?? f.ende_ort ?? '?'}`,
        text: `${datumZeit(f.start)}, ${minuten(f.start, f.ende)} min`,
        farbe: '#7dd3fc',
        punkte: f.spur!,
      })),
  ]);
</script>

<p class="sehr-klein"><a href="/modul/rettung">Rettung</a></p>

{#if !hex}
  <p class="leer">Kein Heli gewählt.</p>
{:else if fehler && !d}
  <div class="hinweis ausfall">{fehler}</div>
{:else if d}
  <div class="kopf">
    <div>
      <h1><span class="punkt" class:luft={d.position && !d.position.amBoden} style="background:{d.position && !d.position.amBoden ? farbe : ''}"></span> {name}</h1>
      <p class="gedaempft klein">{[d.typ, `Transponder ${d.hex.toUpperCase()}`].filter(Boolean).join(' · ')}{#if d.demo} <span class="marke demo">Demo</span>{/if}</p>
    </div>
    <div class="zustand panel">
      {#if d.position && !d.position.amBoden}
        <div class="zahl gross">In der Luft</div>
        <div class="klein">{d.position.ort ?? 'unterwegs'} · {[d.position.hoeheFt !== null ? `${zahl(d.position.hoeheFt)} ft` : null, d.position.kmh !== null ? `${d.position.kmh} km/h` : null].filter(Boolean).join(' · ')}</div>
        {#if d.laufend}<div class="sehr-klein gedaempft">{d.laufend.gestartet ? 'Gestartet' : 'Erfasst'} {relativ(d.laufend.start)}{d.laufend.startPlatz ? ` bei ${d.laufend.startPlatz}` : ''}</div>{/if}
      {:else if d.position}
        <div class="zahl gross">Am Boden</div>
        <div class="klein">{d.position.ort ?? ''}</div>
        <div class="sehr-klein gedaempft">Transponder empfangen {relativ(d.position.zeit)}</div>
      {:else}
        <div class="zahl gross">Nicht erfasst</div>
        <div class="sehr-klein gedaempft">Gerade kein Signal. Letzter Flug {d.fluege[0] ? relativ(d.fluege[0].ende ?? d.fluege[0].start) : 'unbekannt'}.</div>
      {/if}
    </div>
  </div>

  <Karte hoehe="min(55vh, 460px)" ebenenFest={[]} {punkte} {linien} einpassen zentrum={[46.8, 8.23]} zoom={7} />
  <p class="sehr-klein gedaempft">Gestrichelt: laufender Flug. Hellblau: Flüge der letzten 24 Stunden und der letzte Flug. Nur Daten des Transponders (ADS-B), ohne Gewähr.</p>

  <div class="raster werte">
    <div class="panel"><h3>Flüge 24 Stunden</h3><div class="zahl gross">{d.heute}</div></div>
    <div class="panel"><h3>Flüge 30 Tage</h3><div class="zahl gross">{d.anzahl30}</div></div>
    <div class="panel"><h3>Typische Flugdauer</h3><div class="zahl gross">{d.dauerMin !== null ? `${d.dauerMin} min` : 'offen'}</div></div>
  </div>

  <div class="raster-2">
    <section class="panel">
      <h3>Häufigste Ziele</h3>
      {#each d.ziele as [o, n] (o)}<div class="zeile-zwischen klein"><span>{o}</span><span class="zahl">{n}</span></div>{:else}<p class="klein gedaempft">Noch keine Landung bei einem bekannten Platz.</p>{/each}
    </section>
    <section class="panel">
      <h3>Häufigste Startplätze</h3>
      {#each d.startplaetze as [o, n] (o)}<div class="zeile-zwischen klein"><span>{o}</span><span class="zahl">{n}</span></div>{:else}<p class="klein gedaempft">Noch kein Start bei einem bekannten Platz.</p>{/each}
    </section>
  </div>

  <section class="panel" style="margin-top:12px">
    <h3>Flüge der letzten 30 Tage</h3>
    {#each d.fluege as f (f.id)}
      <div class="zeile-zwischen klein flug">
        <span>{f.start_platz ?? f.start_ort ?? '?'} nach {f.ende_platz ?? f.ende_ort ?? '?'}{#if f.ende_art === 'signalverlust'} <span class="sehr-klein gedaempft">(Signal verloren)</span>{/if}</span>
        <span class="gedaempft rechts">{datumZeit(f.start)} · {minuten(f.start, f.ende)} min{f.max_hoehe_ft ? ` · max ${zahl(f.max_hoehe_ft)} ft` : ''}</span>
      </div>
    {:else}
      <p class="leer">Noch kein abgeschlossener Flug erfasst.</p>
    {/each}
  </section>
{:else}
  <p class="gedaempft">Lade...</p>
{/if}

<style>
  .kopf {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .kopf h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
  }
  .zustand {
    min-width: 220px;
  }
  .gross {
    font-size: 1.6rem;
  }
  .werte {
    margin: 12px 0;
  }
  .flug {
    padding: 6px 0;
    border-bottom: 1px solid var(--rand);
  }
  .flug:last-child {
    border-bottom: none;
  }
  .rechts {
    text-align: right;
  }
</style>
