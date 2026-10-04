<script lang="ts">
  // Ein Heli im Detail: wo er gerade ist, der laufende Flug, Flüge der letzten 30 Tage.
  import { basisAusPlatz, heliFarbe } from '../../server/geteilt/heli.ts';
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
  interface Aufenthalt {
    ankunft: string;
    bis: string | null;
    art: 'basis' | 'spital' | 'landeplatz' | 'einsatzort';
    platz: string | null;
    ort: string | null;
    signalverlust: boolean;
    verlassen: boolean;
  }
  interface Detail {
    hex: string;
    organisation: string | null;
    kennzeichen: string | null;
    typ: string | null;
    position: { lat: number; lon: number; amBoden: boolean; hoeheFt: number | null; kmh: number | null; kurs: number | null; zeit: string; ort: string | null } | null;
    laufend: { start: string; gestartet: boolean; startPlatz: string | null; maxHoeheFt: number | null; spur: [number, number][] } | null;
    zuletzt: { lat: number; lon: number; zeit: number; art: 'landung' | 'signalverlust' | 'laufend'; platz: string | null; anBasis: boolean } | null;
    aufenthalte: Aufenthalt[];
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
  const ARTEN = { basis: 'Basis', spital: 'Spital', landeplatz: 'Landeplatz', einsatzort: 'Einsatzort' } as const;
  // Dauer kurz und lesbar: 45 min, 3 h 20 min, 2 Tage
  function dauer(a: string, b: string | null): string {
    const min = Math.max(1, Math.round(((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / 60000));
    if (min < 60) return `${min} min`;
    if (min < 48 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
    return `${Math.round(min / 1440)} Tage`;
  }
  const zuletztIso = $derived(d?.zuletzt ? new Date(d.zuletzt.zeit).toISOString() : null);
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
      : d?.zuletzt
        ? [
            {
              id: `${d.hex}-zuletzt`,
              lat: d.zuletzt.lat,
              lon: d.zuletzt.lon,
              titel: `${name} zuletzt gesehen`,
              text: [d.zuletzt.platz, zuletztIso ? datumZeit(zuletztIso) : null].filter(Boolean).join(' · '),
              symbol: 'heli',
              farbe: d.zuletzt.anBasis ? '#34d399' : '#fbbf24',
            },
          ]
        : [],
  );
  // Lücke im Empfang zwischen Basis und erstem oder letztem Fix, grau gestrichelt
  function luecken(id: string, spur: [number, number][], von: string | null, nach: string | null): GeoLinie[] {
    const aus: GeoLinie[] = [];
    const a = basisAusPlatz(von);
    const b = basisAusPlatz(nach);
    if (a && spur.length) aus.push({ id: `${id}-von`, titel: `Start ${von}`, text: 'Ohne Empfang, vermutet', farbe: '#94a3b8', gestrichelt: true, punkte: [[a.lat, a.lon], [spur[0][0], spur[0][1]]] });
    if (b && spur.length) aus.push({ id: `${id}-nach`, titel: `Landung ${nach}`, text: 'Ohne Empfang, vermutet', farbe: '#94a3b8', gestrichelt: true, punkte: [[spur[spur.length - 1][0], spur[spur.length - 1][1]], [b.lat, b.lon]] });
    return aus;
  }

  // Laufender Flug gestrichelt, Flüge der letzten 24 Stunden durchgezogen und blasser
  const linien = $derived<GeoLinie[]>([
    ...(d?.laufend ? luecken('laufend', d.laufend.spur, d.laufend.startPlatz, null) : []),
    ...(d?.fluege ?? []).filter((f) => f.spur && f.spur.length).flatMap((f) => luecken(f.id, f.spur!, f.start_platz, f.ende_platz)),
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
      {:else if d.zuletzt && zuletztIso}
        <div class="zahl gross">{d.zuletzt.anBasis ? 'An der Basis' : d.zuletzt.art === 'laufend' ? 'Signal verloren' : 'Steht ausserhalb'}</div>
        <div class="klein"><span class="ring" class:basis={d.zuletzt.anBasis}></span> {d.zuletzt.platz ?? 'Ort unbekannt'}</div>
        <div class="sehr-klein gedaempft">Letztes Signal vor {dauer(zuletztIso, null)} ({datumZeit(zuletztIso)})</div>
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
    <h3>Wo er stand, letzte 7 Tage</h3>
    {#each d.aufenthalte as a (a.ankunft)}
      <div class="aufenthalt klein">
        <span class="marke art-{a.verlassen ? 'weg' : a.art}">{a.verlassen ? 'Ausser Empfang' : ARTEN[a.art]}</span>
        <span class="wo">{a.platz ?? a.ort ?? 'Ort unbekannt'}{#if a.platz && a.ort && a.art !== 'basis'} <span class="sehr-klein gedaempft">{a.ort}</span>{/if}{#if a.signalverlust} <span class="sehr-klein gedaempft">(Signal tief verloren)</span>{/if}</span>
        <span class="gedaempft rechts">{datumZeit(a.ankunft)}{#if !a.verlassen} · {a.bis ? dauer(a.ankunft, a.bis) : `seit ${dauer(a.ankunft, null)}`}{/if}</span>
      </div>
    {:else}
      <p class="klein gedaempft">In den letzten 7 Tagen keine Landung erfasst.</p>
    {/each}
  </section>

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
  .aufenthalt {
    display: grid;
    grid-template-columns: 7.5em 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--rand);
  }
  .aufenthalt:last-child {
    border-bottom: none;
  }
  .aufenthalt .marke {
    text-align: center;
  }
  .art-basis {
    color: #34d399;
  }
  .art-spital {
    color: #f87171;
  }
  .art-einsatzort {
    color: #fbbf24;
  }
  .art-landeplatz {
    color: #7dd3fc;
  }
  .art-weg {
    color: var(--gedaempft, #94a3b8);
  }
  .ring {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 2px dashed #fbbf24;
    vertical-align: middle;
  }
  .ring.basis {
    border: 2px solid #34d399;
  }
  @media (max-width: 560px) {
    .aufenthalt {
      grid-template-columns: 6.5em 1fr;
    }
    .aufenthalt .rechts {
      grid-column: 2;
      text-align: left;
    }
  }
</style>
