<script lang="ts">
  // Lagebild Rettung für einen Bildschirm oder ein Tablet: Karte der Schweiz über die ganze Fläche,
  // bewegte Helis, Rega Basen, Uhr und Zahlen als Overlay, Wiedergabe der letzten 24 Stunden.
  import type * as Leaflet from 'leaflet';
  import { basisAusPlatz, heliFarbe } from '../../server/geteilt/heli.ts';
  import type { GeoPunkt } from '../../server/geteilt/typen.ts';
  import Karte from '../komponenten/Karte.svelte';
  import { ansicht } from '../lib/ansicht.svelte.ts';
  import { api } from '../lib/api.ts';
  import { relativ } from '../lib/format.ts';
  import { type AbgestellterHeli, type AnimHeli, abgestelltOrt, abgestelltTitel, HeliAnimation, liveAnim } from '../lib/heliAnimation.ts';
  import { navigieren } from '../lib/router.svelte.ts';
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
    lat: number;
    lon: number;
    kurs: number | null;
    zeit: number;
    spur: [number, number][];
  }
  interface Cam {
    id: string;
    name: string;
    lat: number;
    lon: number;
    hoehe: number | null;
    bild: string;
    bildGross: string;
    link: string | null;
    zeit: number | null;
  }
  interface Lage {
    alerts: { id: string; titel: string; herausgeber: string; inRegion: boolean }[];
    warnungen: { id: string; ereignis: string; gebiet: string; stufe: number }[];
  }
  interface Basis {
    id: string;
    name: string;
    status: 'unterwegs' | 'zuhause' | 'unbekannt';
    unterwegs: { hex: string; kennzeichen: string | null }[];
    zuHause: string[];
    heute: number;
  }
  interface WFlug {
    id: string;
    hex: string;
    organisation: string;
    kennzeichen: string | null;
    von: string | null;
    nach: string | null;
    start: number;
    ende: number;
    punkte: [number, number, number][];
    geschaetzt: boolean;
  }
  interface RueckblickFlug {
    id: string;
    hex: string;
    organisation: string;
    kennzeichen: string | null;
    start: string;
    von: string | null;
    laufend: boolean;
  }

  let live = $state<{ helis: LiveHeli[]; abgestellt?: AbgestellterHeli[]; stand: string | null; fehler?: string } | null>(null);
  let lage = $state<Lage | null>(null);
  let basen = $state<{ basen: Basis[]; punkte: GeoPunkt[] } | null>(null);
  let starts = $state<RueckblickFlug[]>([]);
  let fluegeHeute = $state<number | null>(null);
  let jetzt = $state(new Date());
  let seiteOffen = $state(lesen('lagebild.seite', true));

  const inDerLuft = $derived((live?.helis ?? []).filter((h) => !h.amBoden));
  const amBoden = $derived((live?.helis ?? []).filter((h) => h.amBoden));
  const abgestellt = $derived(live?.abgestellt ?? []);
  // Vermutlich an der Basis abgestellte Helis pro Basis Name
  const anBasis = $derived(
    abgestellt.reduce((m, h) => {
      if (h.anBasis && h.platz) m.set(h.platz, [...(m.get(h.platz) ?? []), h.kennzeichen ?? h.hex]);
      return m;
    }, new Map<string, string[]>()),
  );

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

  // Bewegte Helis auf der Karte
  // Kamera beim Heli: nächste Webcam bis 25 km, Bild alle 2 Minuten frisch
  const CAM_KM = 25;
  let cams = $state<Cam[]>([]);
  let camRunde = $state(0);
  let camGross = $state<{ cam: Cam; km: number; hex: string; name: string } | null>(null);
  function camsHolen() {
    api
      .get<{ cams: Cam[] }>('/api/m/rettung/webcams')
      .then((x) => (cams = x.cams))
      .catch(() => {});
  }
  function km(a: number, b: number, c: number, d: number): number {
    const r = Math.PI / 180;
    const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  }
  function naechsteCam(lat: number, lon: number): { cam: Cam; km: number } | null {
    let best: { cam: Cam; km: number } | null = null;
    for (const c of cams) {
      const k = km(lat, lon, c.lat, c.lon);
      if (k <= CAM_KM && (!best || k < best.km)) best = { cam: c, km: k };
    }
    return best;
  }
  const camBeiHeli = $derived(new Map(inDerLuft.map((h) => [h.hex, naechsteCam(h.lat, h.lon)])));
  function camSrc(adresse: string): string {
    if (!adresse.startsWith('http') || camRunde === 0) return adresse;
    return `${adresse}${adresse.includes('?') ? '&' : '?'}t=${camRunde}`;
  }
  function camZeigen(h: LiveHeli) {
    const c = camBeiHeli.get(h.hex);
    if (c) camGross = { ...c, hex: h.hex, name: h.kennzeichen ?? h.hex };
  }
  $effect(() => {
    camsHolen();
    const t = setInterval(camsHolen, 30 * 60000);
    const b = setInterval(() => {
      if (document.visibilityState === 'visible') camRunde++;
    }, 120000);
    return () => {
      clearInterval(t);
      clearInterval(b);
    };
  });

  let anim: HeliAnimation | null = null;
  function animStarten(L: typeof Leaflet, karte: Leaflet.Map) {
    anim = new HeliAnimation(L, karte);
    anim.onklick = (h) => {
      // Heli in der Luft mit Kamera in der Nähe: zuerst das Bild zeigen
      const l = !wiedergabe ? inDerLuft.find((x) => x.hex === h.id) : null;
      if (l && camBeiHeli.get(l.hex)) return camZeigen(l);
      if (!h.link) return;
      ansicht.kiosk = false;
      navigieren(h.link);
    };
    if (live && !wiedergabe) {
      anim.setzen(liveAnim(live.helis));
      anim.abgestellt(live.abgestellt ?? []);
    }
    // Die Liste rechts deckt den Osten ab: Ausschnitt etwas nach links schieben
    if (seiteOffen && innerWidth > 860) karte.panBy([150, 0], { animate: false });
    return () => {
      anim?.stop();
      anim = null;
    };
  }

  function liveHolen() {
    api
      .get<NonNullable<typeof live>>('/api/m/rettung/live')
      .then((l) => {
        live = l;
        startsPruefen(l.helis);
        if (!wiedergabe) {
          anim?.setzen(liveAnim(l.helis));
          anim?.abgestellt(l.abgestellt ?? []);
        }
      })
      .catch(() => {});
    api
      .get<{ basen: Basis[]; punkte: GeoPunkt[] }>('/api/m/rettung/basen')
      .then((b) => (basen = b))
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
    api
      .get<{ fluege: RueckblickFlug[] }>('/api/m/rettung/rueckblick')
      .then((r) => (starts = [...r.fluege].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 4)))
      .catch(() => {});
  }

  $effect(() => {
    liveHolen();
    lageHolen();
    const a = setInterval(liveHolen, 20000);
    const b = setInterval(lageHolen, 120000);
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
      cancelAnimationFrame(wRahmen);
      document.removeEventListener('visibilitychange', wach);
      sperre?.release().catch(() => {});
      audio?.close().catch(() => {});
    };
  });

  // Wiedergabe: Flüge der letzten 24 Stunden als Film
  const TEMPI = [60, 300, 900, 1800];
  let wiedergabe = $state<{ von: number; bis: number; fluege: WFlug[] } | null>(null);
  let wLaden = $state(false);
  let wZeit = $state(0);
  let wLaeuft = $state(false);
  let wTempo = $state(lesen('lagebild.tempo', 900));
  let wRahmen = 0;
  let wLetzte = 0;

  async function wiedergabeStarten() {
    wLaden = true;
    try {
      const w = await api.get<{ von: number; bis: number; fluege: WFlug[] }>('/api/m/rettung/wiedergabe?stunden=24');
      wiedergabe = w;
      wZeit = w.von;
      if (anim) {
        anim.setzen([]);
        anim.abgestellt([]);
        anim.direkt = true;
      }
      bildZeigen();
      wSpielen();
    } finally {
      wLaden = false;
    }
  }

  function wiedergabeBeenden() {
    cancelAnimationFrame(wRahmen);
    wLaeuft = false;
    wiedergabe = null;
    if (anim) {
      anim.setzen([]);
      anim.direkt = false;
      if (live) {
        anim.setzen(liveAnim(live.helis));
        anim.abgestellt(live.abgestellt ?? []);
      }
    }
  }

  function wSpielen() {
    if (!wiedergabe) return;
    if (wZeit >= wiedergabe.bis) wZeit = wiedergabe.von;
    wLaeuft = true;
    wLetzte = performance.now();
    cancelAnimationFrame(wRahmen);
    const schritt = (t: number) => {
      if (!wiedergabe || !wLaeuft) return;
      wZeit = Math.min(wiedergabe.bis, wZeit + (t - wLetzte) * wTempo);
      wLetzte = t;
      bildZeigen();
      if (wZeit >= wiedergabe.bis) {
        wLaeuft = false;
        return;
      }
      wRahmen = requestAnimationFrame(schritt);
    };
    wRahmen = requestAnimationFrame(schritt);
  }

  function wPause() {
    wLaeuft = false;
    cancelAnimationFrame(wRahmen);
  }

  function tempoSetzen(t: number) {
    wTempo = t;
    schreiben('lagebild.tempo', t);
  }

  /** Position eines Flugs zur Zeit t, mit Kurs aus dem Abschnitt und der Spur der letzten 20 Minuten */
  function flugBei(f: WFlug, t: number): AnimHeli | null {
    const p = f.punkte;
    if (t < p[0][2] || t > p[p.length - 1][2]) return null;
    let i = 0;
    while (i < p.length - 2 && p[i + 1][2] < t) i++;
    const a = p[i];
    const b = p[Math.min(i + 1, p.length - 1)];
    const anteil = b[2] > a[2] ? (t - a[2]) / (b[2] - a[2]) : 0;
    const lat = a[0] + (b[0] - a[0]) * anteil;
    const lon = a[1] + (b[1] - a[1]) * anteil;
    const kurs =
      b !== a
        ? (Math.atan2((b[1] - a[1]) * Math.cos((lat * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI
        : null;
    const spur = p.filter((x) => x[2] <= t && x[2] >= t - 20 * 60000).map((x) => [x[0], x[1]] as [number, number]);
    const basis = basisAusPlatz(f.von);
    return {
      id: f.id,
      lat,
      lon,
      kurs: kurs === null ? null : (kurs + 360) % 360,
      kmh: null,
      zeit: t,
      amBoden: false,
      farbe: heliFarbe(f.organisation),
      schild: f.kennzeichen ?? f.hex,
      spur,
      basis: basis ? [basis.lat, basis.lon] : null,
      link: `/heli?hex=${encodeURIComponent(f.hex)}`,
    };
  }

  const wAktiv = $derived(wiedergabe ? wiedergabe.fluege.filter((f) => wZeit >= f.punkte[0][2] && wZeit <= f.punkte[f.punkte.length - 1][2]) : []);

  function bildZeigen() {
    if (!wiedergabe || !anim) return;
    anim.setzen(wiedergabe.fluege.map((f) => flugBei(f, wZeit)).filter((x): x is AnimHeli => !!x));
  }

  // Balken unter dem Regler: Helis in der Luft pro 15 Minuten
  const wBalken = $derived.by(() => {
    if (!wiedergabe) return [];
    const n = 96;
    const schritt = (wiedergabe.bis - wiedergabe.von) / n;
    const werte = Array.from({ length: n }, (_, i) => {
      const t = wiedergabe!.von + (i + 0.5) * schritt;
      return wiedergabe!.fluege.filter((f) => f.start <= t && f.ende >= t).length;
    });
    const max = Math.max(1, ...werte);
    return werte.map((w) => w / max);
  });
  const wGeschaetzt = $derived(!!wiedergabe?.fluege.some((f) => f.geschaetzt));

  const uhr = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });
  const sekunden = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', second: '2-digit' });
  const tag = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long' });
  const wUhr = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const alertsRegion = $derived(lage?.alerts.filter((a) => a.inRegion) ?? []);
  const warnungenHoch = $derived(lage?.warnungen.filter((w) => w.stufe >= 3) ?? []);
  const basenSortiert = $derived(
    [...(basen?.basen ?? [])].sort(
      (a, b) =>
        ['unterwegs', 'zuhause', 'unbekannt'].indexOf(a.status) - ['unterwegs', 'zuhause', 'unbekannt'].indexOf(b.status) ||
        b.heute - a.heute,
    ),
  );
  const STATUS_TEXT = { unterwegs: 'unterwegs', zuhause: 'zu Hause', unbekannt: 'keine Daten' };
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && camGross) camGross = null; }} />

<div class="lagebild" class:vollbild={ansicht.kiosk}>
  <div class="lb-karte" class:blitz={neu.size > 0}>
    <Karte
      hoehe="100%"
      kompakt
      basisStart="nacht"
      ebenenFest={['rettung.spital']}
      ebenenZusatz={['wetter.radar', 'rettung.heatmap']}
      punkte={basen?.punkte ?? []}
      zentrum={[46.82, 8.23]}
      zoom={8}
      bereit={animStarten}
    />
  </div>

  <!-- Kopf: Uhr, Zahl in der Luft, letzte Starts -->
  <div class="hud hud-kopf">
    {#if wiedergabe}
      <div class="hud-marke">Wiedergabe</div>
      <div class="hud-uhr zahl">{wUhr.format(wZeit)}</div>
      <div class="hud-luft"><span class="hud-zahl zahl" class:aktiv={wAktiv.length > 0}>{wAktiv.length}</span><span>in der Luft</span></div>
    {:else}
      <div class="hud-uhr zahl">{uhr.format(jetzt)}<span class="hud-sek">{sekunden.format(jetzt).padStart(2, '0')}</span></div>
      <div class="sehr-klein gedaempft">{tag.format(jetzt)}</div>
      <div class="hud-luft"><span class="hud-zahl zahl" class:aktiv={inDerLuft.length > 0}>{inDerLuft.length}</span><span>{inDerLuft.length === 1 ? 'Heli in der Luft' : 'Helis in der Luft'}</span></div>
      <div class="hud-klein sehr-klein gedaempft">{amBoden.length} am Boden erfasst · {fluegeHeute ?? '·'} Flüge in 24 h</div>
      {#if starts.length}
        <div class="hud-starts">
          {#each starts as s (s.id)}
            <div class="sehr-klein"><span class="punkt" style="background:{heliFarbe(s.organisation)}"></span>{uhr.format(new Date(s.start))} <strong>{s.kennzeichen ?? s.hex}</strong> <span class="gedaempft">{s.von ?? ''}</span></div>
          {/each}
        </div>
      {/if}
    {/if}
    <div class="zeile hud-knoepfe">
      <button class="knopf klein" class:aktiv={tonAn} onclick={tonUmschalten} aria-pressed={tonAn} title="Kurzer Ton, wenn ein Heli startet">{tonAn ? 'Ton an' : 'Ton aus'}</button>
      <button class="knopf klein" onclick={() => { seiteOffen = !seiteOffen; schreiben('lagebild.seite', seiteOffen); }} aria-pressed={seiteOffen}>Liste</button>
      <a class="sehr-klein" href="/modul/rettung" onclick={() => (ansicht.kiosk = false)}>Schliessen</a>
    </div>
  </div>

  <!-- Seite: Helis, Basen, Warnungen -->
  {#if seiteOffen}
    <aside class="hud hud-seite">
      {#if live?.fehler}<div class="hinweis ausfall klein">{live.fehler}</div>{/if}
      <h2>{wiedergabe ? `In der Luft um ${uhr.format(wZeit)}` : 'In der Luft'}</h2>
      {#if wiedergabe}
        {#each wAktiv as f (f.id)}
          <a class="lb-heli" href="/heli?hex={encodeURIComponent(f.hex)}" onclick={() => (ansicht.kiosk = false)}>
            <span class="zeile"><span class="punkt luft" style="background:{heliFarbe(f.organisation)}"></span><strong>{f.kennzeichen ?? f.hex}</strong></span>
            <div class="sehr-klein gedaempft">{f.organisation} · ab {uhr.format(f.start)}{f.von ? ` · ${f.von}` : ''}</div>
          </a>
        {:else}
          <p class="leer klein">Zu diesem Zeitpunkt war kein erfasster Heli in der Luft.</p>
        {/each}
      {:else}
      {#each inDerLuft as h (h.hex)}
        {@const c = camBeiHeli.get(h.hex)}
        <div class="lb-heli-block">
        <a class="lb-heli" class:neu={neu.has(h.hex)} class:mit-cam={!!c} href="/heli?hex={encodeURIComponent(h.hex)}" onclick={() => (ansicht.kiosk = false)}>
          <div class="zeile-zwischen">
            <span class="zeile"><span class="punkt luft" style="background:{heliFarbe(h.organisation)}"></span><strong>{h.kennzeichen ?? h.hex}</strong></span>
            <span class="sehr-klein gedaempft">{[h.hoeheFt !== null ? `${h.hoeheFt} ft` : null, h.kmh !== null ? `${h.kmh} km/h` : null].filter(Boolean).join(' · ')}</span>
          </div>
          <div class="sehr-klein gedaempft">
            {h.organisation} · {h.ort ?? 'unterwegs'}{#if h.startPlatz} · ab {h.startPlatz.replace('Rega Basis ', 'Basis ')}{/if}{#if h.seit} · {relativ(h.seit)}{/if}
          </div>
        </a>
        {#if c}
          <button class="lb-cam" onclick={() => camZeigen(h)} title="Webcam {c.cam.name} gross zeigen">
            <img src={camSrc(c.cam.bild)} alt="Webcam {c.cam.name}" loading="lazy" />
            <span class="lb-cam-text sehr-klein"><span class="rec"></span>{c.cam.name} · {c.km < 1 ? '<1' : Math.round(c.km)} km</span>
          </button>
        {/if}
        </div>
      {:else}
        <p class="leer klein">Gerade ist kein Heli aus der Liste mit Transponder in der Luft.</p>
      {/each}
      {#if abgestellt.length}
        <h2>Zuletzt gesehen</h2>
        {#each abgestellt as h (h.hex)}
          <a class="lb-heli geparkt" href="/heli?hex={encodeURIComponent(h.hex)}" title={abgestelltTitel(h)} onclick={() => (ansicht.kiosk = false)}>
            <div class="zeile-zwischen">
              <span class="zeile"><span class="punkt ring" class:basis={h.anBasis}></span><strong>{h.kennzeichen ?? h.hex}</strong></span>
              <span class="sehr-klein gedaempft">{relativ(new Date(h.zeit).toISOString())}</span>
            </div>
            <div class="sehr-klein gedaempft">
              {h.anBasis ? 'Steht an der' : h.art === 'landung' ? 'Gelandet bei' : 'Letztes Signal bei'} {abgestelltOrt(h) || 'unbekanntem Ort'}
            </div>
          </a>
        {/each}
      {/if}
      {/if}

      {#if basenSortiert.length}
        <h2>Rega Basen</h2>
        <div class="lb-basen">
          {#each basenSortiert as b (b.id)}
            <div class="lb-basis {b.status}" class:steht={b.status === 'unbekannt' && anBasis.has(b.name)} title={b.status === 'unbekannt' ? 'Am Boden ist oft kein Empfang' : ''}>
              <span class="punkt"></span>
              <span class="wachsen">{b.name.replace('Rega Basis ', '')}</span>
              <span class="sehr-klein gedaempft">{b.status === 'unterwegs' ? b.unterwegs.map((u) => u.kennzeichen ?? u.hex).join(', ') : b.status === 'unbekannt' && anBasis.has(b.name) ? `${anBasis.get(b.name)?.join(', ')} steht` : STATUS_TEXT[b.status]}{b.heute ? ` · ${b.heute}` : ''}</span>
            </div>
          {/each}
        </div>
      {/if}

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
        Nur Luftfahrzeuge mit eingeschaltetem Transponder. {live?.stand ? `Stand ${relativ(live.stand)}.` : ''} Start an einer Rega Basis ist vermutet, wenn der erste Empfang nahe der Basis liegt. ADS-B Daten: adsb.lol (ODbL), Basen: rega.ch und OpenStreetMap
      </p>
    </aside>
  {/if}

  {#if camGross}
    <div class="lb-cam-gross" role="dialog" aria-modal="true" aria-label="Webcam beim Heli">
      <button class="lb-cam-zu" aria-label="Schliessen" onclick={() => (camGross = null)}></button>
      <figure>
        <img src={camSrc(camGross.cam.bildGross)} alt="Webcam {camGross.cam.name}" />
        <figcaption class="zeile-zwischen">
          <span><span class="rec"></span><strong>{camGross.cam.name}</strong> <span class="gedaempft klein">{Math.round(camGross.km)} km von {camGross.name}{camGross.cam.hoehe ? ` · ${camGross.cam.hoehe} m` : ''}{camGross.cam.zeit ? ` · Bild ${relativ(new Date(camGross.cam.zeit).toISOString())}` : ''}</span></span>
          <span class="zeile">
            {#if camGross.cam.link}<a class="knopf klein" href={camGross.cam.link} target="_blank" rel="noopener">Zur Quelle</a>{/if}
            <a class="knopf klein" href="/heli?hex={encodeURIComponent(camGross.hex)}" onclick={() => (ansicht.kiosk = false)}>Heli Details</a>
            <button class="knopf klein" onclick={() => (camGross = null)}>Schliessen</button>
          </span>
          <span class="sehr-klein gedaempft lb-cam-hinweis">Nächste Webcam zur Position des Helis. Der Heli ist meist nicht im Bild.</span>
        </figcaption>
      </figure>
    </div>
  {/if}

  <!-- Wiedergabe der letzten 24 Stunden -->
  <div class="hud hud-wiedergabe" class:offen={!!wiedergabe}>
    {#if wiedergabe}
      <button class="knopf klein" onclick={() => (wLaeuft ? wPause() : wSpielen())} aria-label={wLaeuft ? 'Pause' : 'Abspielen'}>{wLaeuft ? 'Pause' : 'Abspielen'}</button>
      <div class="w-regler">
        <div class="w-balken" aria-hidden="true">
          {#each wBalken as b, i (i)}<span style="height:{Math.max(4, b * 100)}%"></span>{/each}
        </div>
        <input
          type="range"
          min={wiedergabe.von}
          max={wiedergabe.bis}
          step={60000}
          value={wZeit}
          oninput={(e) => {
            wZeit = Number((e.target as HTMLInputElement).value);
            bildZeigen();
          }}
          aria-label="Zeitpunkt der Wiedergabe"
        />
        <div class="w-achse sehr-klein gedaempft"><span>{wUhr.format(wiedergabe.von)}</span><span>{wiedergabe.fluege.length} Flüge{wGeschaetzt ? ', bei älteren Flügen Zeit pro Punkt geschätzt' : ''}</span><span>jetzt</span></div>
      </div>
      <div class="w-tempo" role="group" aria-label="Tempo">
        {#each TEMPI as t (t)}<button class="knopf klein" class:aktiv={wTempo === t} onclick={() => tempoSetzen(t)}>{t >= 60 ? `${t / 60} min/s` : `${t}x`}</button>{/each}
      </div>
      <button class="knopf klein" onclick={wiedergabeBeenden}>Live</button>
    {:else}
      <button class="knopf klein" onclick={wiedergabeStarten} disabled={wLaden}>{wLaden ? 'Lade…' : 'Wiedergabe 24 h'}</button>
    {/if}
  </div>
</div>

<style>
  .lagebild {
    position: relative;
    height: calc(100vh - 120px);
    height: calc(100dvh - 120px);
    border-radius: 14px;
    overflow: hidden;
    background: #05080c;
  }
  .lagebild.vollbild {
    height: calc(100vh - 24px);
    height: calc(100dvh - 24px);
  }
  .lb-karte {
    position: absolute;
    inset: 0;
  }
  .lb-karte :global(.karte-rahmen) {
    border: none;
    border-radius: 0;
  }
  .hud {
    position: absolute;
    z-index: 700;
    background: #060a10b8;
    backdrop-filter: blur(10px);
    border: 1px solid #ffffff14;
    border-radius: 14px;
    box-shadow: 0 10px 40px #0009;
  }
  .hud-kopf {
    top: 12px;
    left: 12px;
    padding: 14px 16px;
    min-width: 230px;
    max-width: 300px;
  }
  .hud-uhr {
    font-size: 2.8rem;
    line-height: 1;
    letter-spacing: 0.02em;
  }
  .hud-sek {
    font-size: 1.1rem;
    color: var(--text-3);
    margin-left: 4px;
  }
  .hud-marke {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #fbbf24;
    margin-bottom: 2px;
  }
  .hud-luft {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 10px;
    color: var(--text-2);
  }
  .hud-zahl {
    font-size: 3.4rem;
    line-height: 1;
    color: var(--text-2);
  }
  .hud-zahl.aktiv {
    color: #ff5d5d;
    text-shadow:
      0 0 12px #ff5d5d99,
      0 0 30px #ff5d5d55;
  }
  .hud-klein {
    margin-top: 4px;
  }
  .hud-starts {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #ffffff14;
    display: grid;
    gap: 3px;
  }
  .hud-starts .punkt {
    margin-right: 6px;
  }
  .hud-knoepfe {
    margin-top: 12px;
    gap: 8px;
  }
  .hud-seite {
    top: 58px;
    right: 12px;
    bottom: 100px;
    width: 300px;
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hud-seite h2 {
    margin: 6px 0 2px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-3);
  }
  .lb-heli {
    display: block;
    padding: 7px 9px;
    border: 1px solid #ffffff12;
    border-radius: 10px;
    color: inherit;
    text-decoration: none;
  }
  .lb-heli:hover {
    border-color: var(--text-2);
  }
  .lb-basen {
    display: grid;
    gap: 2px;
  }
  .lb-basis {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    padding: 2px 0;
  }
  .lb-basis .punkt {
    background: #64748b;
  }
  .lb-basis.zuhause .punkt {
    background: #34d399;
    box-shadow: 0 0 8px #34d399;
  }
  .lb-basis.unterwegs .punkt {
    background: #ff5d5d;
    box-shadow: 0 0 10px #ff5d5d;
    animation: pulsieren 1.6s infinite;
  }
  .lb-basis.unbekannt {
    color: var(--text-3);
  }
  .lb-basis.steht {
    color: inherit;
  }
  .lb-basis.steht .punkt {
    background: transparent;
    border: 2px solid #34d399;
  }
  .lb-heli-block {
    display: flex;
    flex-direction: column;
  }
  .lb-heli.mit-cam {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .lb-cam {
    position: relative;
    display: block;
    padding: 0;
    border: 1px solid #ffffff12;
    border-top: none;
    border-radius: 0 0 10px 10px;
    overflow: hidden;
    background: #000;
    cursor: zoom-in;
    aspect-ratio: 16 / 7;
  }
  .lb-cam img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    filter: saturate(0.85);
  }
  .lb-cam-text {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 3px 7px;
    text-align: left;
    color: #e2e8f0;
    background: linear-gradient(transparent, #000c);
    font-family: ui-monospace, monospace;
  }
  .rec {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 5px;
    border-radius: 50%;
    background: #ef4444;
    animation: pulsieren 1.6s infinite;
  }
  .lb-cam-gross {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: grid;
    place-items: center;
    padding: 16px;
    background: #000d;
  }
  .lb-cam-zu {
    position: absolute;
    inset: 0;
    background: none;
    border: none;
    cursor: zoom-out;
  }
  .lb-cam-gross figure {
    position: relative;
    margin: 0;
    max-width: min(1200px, 100%);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lb-cam-gross img {
    max-width: 100%;
    max-height: 75vh;
    object-fit: contain;
    border-radius: 8px;
    background: #000;
  }
  .lb-cam-gross figcaption {
    flex-wrap: wrap;
    gap: 8px;
  }
  .lb-cam-hinweis {
    flex-basis: 100%;
  }
  .lb-heli.geparkt {
    border-style: dashed;
    opacity: 0.85;
  }
  .punkt.ring {
    background: transparent;
    border: 2px dashed #fbbf24;
  }
  .punkt.ring.basis {
    border: 2px solid #34d399;
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
      box-shadow:
        inset 0 0 0 4px var(--ausfall),
        inset 0 0 60px #f8717188;
    }
  }
  .lb-karte.blitz::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 650;
    pointer-events: none;
    animation: rand-blitz 1s ease-in-out 6;
  }
  .lb-warnung {
    padding: 4px 0;
  }
  .lb-fuss {
    margin-top: auto;
    padding-top: 8px;
  }
  .hud-wiedergabe {
    left: 12px;
    bottom: 12px;
    padding: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hud-wiedergabe.offen {
    right: 12px;
    padding: 10px 12px;
  }
  .w-regler {
    flex: 1;
    min-width: 0;
    position: relative;
  }
  .w-balken {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 22px;
    opacity: 0.55;
  }
  .w-balken span {
    flex: 1;
    background: linear-gradient(to top, #ff5d5d, #ff5d5d55);
    border-radius: 1px 1px 0 0;
  }
  .w-regler input {
    width: 100%;
    margin: 2px 0 0;
    accent-color: #ff5d5d;
  }
  .w-achse {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .w-tempo {
    display: flex;
    gap: 4px;
  }
  @media (max-width: 860px) {
    .lagebild,
    .lagebild.vollbild {
      height: auto;
      overflow: visible;
      background: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .lb-karte {
      position: relative;
      height: 62vh;
      border-radius: 14px;
      overflow: hidden;
    }
    .hud {
      position: static;
      max-width: none;
      width: auto;
    }
    .hud-kopf {
      order: -1;
    }
    .hud-wiedergabe,
    .hud-wiedergabe.offen {
      flex-wrap: wrap;
    }
    .w-regler {
      flex-basis: 100%;
      order: 3;
    }
  }
</style>
