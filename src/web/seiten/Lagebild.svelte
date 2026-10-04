<script lang="ts">
  // Lagebild Rettung für einen Bildschirm oder ein Tablet: grosse Karte der Schweiz, Helis in der Luft, Uhr, Warnungen.
  import { heliFarbe } from '../../server/geteilt/heli.ts';
  import Karte from '../komponenten/Karte.svelte';
  import { ansicht } from '../lib/ansicht.svelte.ts';
  import { api } from '../lib/api.ts';
  import { relativ } from '../lib/format.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';

  interface LiveHeli {
    hex: string;
    organisation: string;
    kennzeichen: string | null;
    typ: string | null;
    amBoden: boolean;
    hoeheFt: number | null;
    kmh: number | null;
    ort: string | null;
    seit: string | null;
    gestartet: boolean;
    startPlatz: string | null;
  }
  interface Lage {
    alerts: { id: string; titel: string; herausgeber: string; inRegion: boolean }[];
    warnungen: { id: string; ereignis: string; gebiet: string; stufe: number }[];
  }

  let live = $state<{ helis: LiveHeli[]; stand: string | null; fehler?: string } | null>(null);
  let lage = $state<Lage | null>(null);
  let fluegeHeute = $state<number | null>(null);
  let jetzt = $state(new Date());

  const inDerLuft = $derived((live?.helis ?? []).filter((h) => !h.amBoden));
  const amBoden = $derived((live?.helis ?? []).filter((h) => h.amBoden));

  // Start Meldung: Ton (nur nach Klick, Browser erlauben Audio erst nach einer Geste) und Blinken
  let tonAn = $state(lesen('lagebild.ton', false));
  let neu = $state<Set<string>>(new Set());
  let gesehen: Set<string> | null = null;
  let audio: AudioContext | null = null;

  function tonUmschalten() {
    tonAn = !tonAn;
    schreiben('lagebild.ton', tonAn);
    if (tonAn) {
      audio ??= new AudioContext();
      audio.resume().catch(() => {});
      piepen();
    }
  }

  function piepen() {
    if (!tonAn) return;
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const t0 = audio.currentTime;
    // zwei kurze Töne, hoch und tief
    for (const [i, hz] of [880, 660].entries()) {
      const osz = audio.createOscillator();
      const laut = audio.createGain();
      osz.type = 'sine';
      osz.frequency.value = hz;
      const s = t0 + i * 0.22;
      laut.gain.setValueAtTime(0.0001, s);
      laut.gain.exponentialRampToValueAtTime(0.25, s + 0.02);
      laut.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
      osz.connect(laut).connect(audio.destination);
      osz.start(s);
      osz.stop(s + 0.21);
    }
  }

  function startsPruefen(helis: LiveHeli[]) {
    const luft = new Set(helis.filter((h) => !h.amBoden).map((h) => h.hex));
    if (gesehen) {
      const frisch = [...luft].filter((hex) => !gesehen!.has(hex));
      if (frisch.length) {
        neu = new Set([...neu, ...frisch]);
        piepen();
        setTimeout(() => {
          neu = new Set([...neu].filter((h) => !frisch.includes(h)));
        }, 12000);
      }
    }
    gesehen = luft;
  }

  function liveHolen() {
    api
      .get<NonNullable<typeof live>>('/api/m/rettung/live')
      .then((l) => {
        live = l;
        startsPruefen(l.helis);
      })
      .catch(() => {});
  }
  function lageHolen() {
    api
      .get<Lage>('/api/m/rettung/lage')
      .then((l) => (lage = l))
      .catch(() => {});
    api
      .get<{ anzahl: number }>('/api/m/rettung/statistik?organisation=alle&tage=1')
      .then((s) => (fluegeHeute = s.anzahl))
      .catch(() => {});
  }

  $effect(() => {
    liveHolen();
    lageHolen();
    const a = setInterval(liveHolen, 20000);
    const b = setInterval(lageHolen, 300000);
    const c = setInterval(() => (jetzt = new Date()), 1000);
    // Bildschirm wach halten, solange die Seite offen ist (wenn der Browser es kann)
    let sperre: { release: () => Promise<void> } | null = null;
    const wach = () => {
      if (document.visibilityState !== 'visible') return;
      (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
        ?.request('screen')
        .then((s) => (sperre = s))
        .catch(() => {});
    };
    wach();
    document.addEventListener('visibilitychange', wach);
    return () => {
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
      document.removeEventListener('visibilitychange', wach);
      sperre?.release().catch(() => {});
      audio?.close().catch(() => {});
    };
  });

  const uhr = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });
  const tag = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long' });
  const alertsRegion = $derived(lage?.alerts.filter((a) => a.inRegion) ?? []);
  const warnungenHoch = $derived(lage?.warnungen.filter((w) => w.stufe >= 3) ?? []);
</script>

<div class="lagebild" class:vollbild={ansicht.kiosk}>
  <div class="lb-karte" class:blitz={neu.size > 0}>
    <Karte hoehe="100%" kompakt ebenenFest={['rettung.helis', 'rettung.spital']} ebenenZusatz={['wetter.radar']} zentrum={[46.8, 8.23]} zoom={8} />
  </div>

  <aside class="lb-seite">
    <div class="zeile-zwischen">
      <div>
        <div class="lb-uhr zahl">{uhr.format(jetzt)}</div>
        <div class="klein gedaempft">{tag.format(jetzt)}</div>
      </div>
      <span class="zeile">
        <button class="knopf klein" class:aktiv={tonAn} onclick={tonUmschalten} aria-pressed={tonAn} title="Kurzer Ton, wenn ein Heli startet">{tonAn ? 'Ton an' : 'Ton aus'}</button>
        <a class="sehr-klein" href="/modul/rettung" onclick={() => (ansicht.kiosk = false)}>Schliessen</a>
      </span>
    </div>

    <div class="lb-werte">
      <div><div class="lb-zahl zahl" class:aktiv={inDerLuft.length > 0}>{inDerLuft.length}</div><div class="sehr-klein gedaempft">in der Luft</div></div>
      <div><div class="lb-zahl zahl">{amBoden.length}</div><div class="sehr-klein gedaempft">am Boden erfasst</div></div>
      <div><div class="lb-zahl zahl">{fluegeHeute ?? '·'}</div><div class="sehr-klein gedaempft">Flüge 24 h</div></div>
    </div>

    {#if live?.fehler}<div class="hinweis ausfall klein">{live.fehler}</div>{/if}

    <h2>In der Luft</h2>
    <div class="lb-liste">
      {#each inDerLuft as h (h.hex)}
        <a class="lb-heli" class:neu={neu.has(h.hex)} href="/heli?hex={encodeURIComponent(h.hex)}" onclick={() => (ansicht.kiosk = false)}>
          <div class="zeile-zwischen">
            <span class="zeile"><span class="punkt luft" style="background:{heliFarbe(h.organisation)}"></span><strong>{h.organisation} {h.kennzeichen ?? h.hex}</strong></span>
            <span class="klein gedaempft">{[h.hoeheFt !== null ? `${h.hoeheFt} ft` : null, h.kmh !== null ? `${h.kmh} km/h` : null].filter(Boolean).join(' · ')}</span>
          </div>
          <div class="klein gedaempft">
            {h.ort ?? 'unterwegs'}{#if h.startPlatz} · ab {h.startPlatz}{/if}{#if h.seit} · {h.gestartet ? 'Start' : 'erfasst'} {relativ(h.seit)}{/if}
          </div>
        </a>
      {:else}
        <p class="leer">Gerade ist kein Heli aus der Liste mit Transponder in der Luft.</p>
      {/each}
    </div>

    {#if alertsRegion.length || warnungenHoch.length}
      <h2>Warnungen</h2>
      {#each alertsRegion as a (a.id)}
        <div class="klein lb-warnung"><span class="marke ausfall">Alertswiss</span> {a.titel}</div>
      {/each}
      {#each warnungenHoch as w (w.id)}
        <div class="klein lb-warnung"><span class="marke warnung">Stufe {w.stufe}</span> {w.ereignis}, {w.gebiet}</div>
      {/each}
    {/if}

    <p class="sehr-klein gedaempft lb-fuss">
      Nur Luftfahrzeuge mit eingeschaltetem Transponder. {live?.stand ? `Stand ${relativ(live.stand)}.` : ''} ADS-B Daten: adsb.lol (ODbL)
    </p>
  </aside>
</div>

<style>
  .lagebild {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    grid-template-rows: calc(100vh - 120px);
    gap: 12px;
  }
  .lagebild.vollbild {
    grid-template-rows: calc(100vh - 24px);
  }
  .lb-karte {
    height: 100%;
    min-height: 0;
    border-radius: 14px;
    overflow: hidden;
  }
  .lb-seite {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 4px 4px 0;
  }
  .lb-seite h2 {
    margin: 6px 0 0;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
  }
  .lb-uhr {
    font-size: 3rem;
    line-height: 1;
  }
  .lb-werte {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .lb-werte > div {
    background: var(--flaeche);
    border: 1px solid var(--rand);
    border-radius: 12px;
    padding: 10px;
  }
  .lb-zahl {
    font-size: 2rem;
    line-height: 1.1;
  }
  .lb-zahl.aktiv {
    color: var(--ausfall);
  }
  .lb-liste {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lb-heli {
    display: block;
    padding: 8px 10px;
    border: 1px solid var(--rand);
    border-radius: 10px;
    color: inherit;
    text-decoration: none;
  }
  .lb-heli:hover {
    border-color: var(--text-2);
  }
  .knopf.aktiv {
    border-color: var(--ok);
    color: var(--ok);
  }
  .lb-heli.neu {
    animation: start-blitz 1s ease-in-out 6;
    border-color: var(--ausfall);
  }
  .lb-karte.blitz {
    animation: rand-blitz 1s ease-in-out 6;
  }
  @keyframes start-blitz {
    50% {
      background: #f8717133;
    }
  }
  @keyframes rand-blitz {
    50% {
      box-shadow: 0 0 0 4px var(--ausfall), 0 0 30px #f8717188;
    }
  }
  .lb-warnung {
    padding: 4px 0;
  }
  .lb-fuss {
    margin-top: auto;
  }
  @media (max-width: 860px) {
    .lagebild,
    .lagebild.vollbild {
      grid-template-columns: 1fr;
      grid-template-rows: 60vh auto;
    }
  }
</style>
