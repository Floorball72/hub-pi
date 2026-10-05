<script lang="ts">
  import type * as Leaflet from 'leaflet';
  import type { GeoPunkt } from '../../server/geteilt/typen.ts';
  import { heliFarbe } from '../../server/geteilt/heli.ts';
  import Balken from '../komponenten/Balken.svelte';
  import EinsatzChronik from '../komponenten/EinsatzChronik.svelte';
  import HeliZeitstrahl from '../komponenten/HeliZeitstrahl.svelte';
  import Karte from '../komponenten/Karte.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import WebcamWand from '../komponenten/WebcamWand.svelte';
  import Toolbox from './Toolbox.svelte';
  import { api } from '../lib/api.ts';
  import { datumZeit, relativ } from '../lib/format.ts';
  import { type AbgestellterHeli, HeliAnimation, type LiveHeliPos, liveAnim, liveSchleife } from '../lib/heliAnimation.ts';
  import { navigieren } from '../lib/router.svelte.ts';

  interface Lage {
    alerts: { id: string; titel: string; text: string; herausgeber: string; schwere: string; ereignis: string; inRegion: boolean; link: string | null; entwarnung: boolean }[];
    warnungen: { id: string; ereignis: string; gebiet: string; stufe: number; farbe: string; beginn: string | null; ende: string | null; text: string }[];
    warnungenAlle: number;
    warnGebiete: string[];
    erdbeben: { id: string; zeit: string; magnitude: number; ort: string; tiefeKm: number; distanzKm: number }[];
    lawinen: { region: string; stufe: string; gueltigBis: string | null }[];
    fehler: Record<string, string | undefined>;
  }
  interface Statistik {
    anzahl: number;
    proStunde: number[];
    proWochentag: number[];
    orte: [string, number][];
    ziele: [string, number][];
    startplaetze: [string, number][];
    dauerMin: number | null;
    letzte: { start: string; ende: string | null; organisation: string | null; kennzeichen: string | null; start_ort: string | null; ende_ort: string | null; start_platz?: string | null; ende_platz?: string | null }[];
    laufend: number;
    organisationen: string[];
    einsatz?: {
      anzahl: number;
      proBasis: { basis: string; anzahl: number; flugMin: number; dauerMin: number | null }[];
      spitaeler: [string, number][];
      gemeinden?: [string, number][];
      orte: { name: string; lat: number; lon: number; basis: string | null; start: string; kennzeichen: string | null }[];
      woche: Record<'diese' | 'vorher', { einsaetze: number; mitEinsatzort: number; flugMin: number }>;
    };
  }
  interface Live {
    helis: (LiveHeliPos & { typ: string | null; ort: string | null; seit: string | null; gestartet: boolean })[];
    abgestellt?: AbgestellterHeli[];
    stand: string | null;
    fehler?: string;
  }
  interface Meldungen {
    meldungen: { id: string; titel: string; link: string; zeit: string; kategorie: string; quelle: string; text: string }[];
    hinweis: string;
    quellen: string[];
  }

  interface Basis {
    id: string;
    name: string;
    status: 'unterwegs' | 'zuhause' | 'vermutet' | 'unbekannt';
    unterwegs: { hex: string; kennzeichen: string | null }[];
    zuHause: string[];
    vermutet: string[];
    letzteRueckkehr: { zeit: string; kennzeichen: string | null } | null;
    heute: number;
  }

  let tab = $state('Lage');
  let basen = $state<Basis[] | null>(null);
  let heatArt = $state('alles');
  let lage = $state<Lage | null>(null);
  let stat = $state<Statistik | null>(null);
  let meld = $state<Meldungen | null>(null);
  let live = $state<Live | null>(null);
  let organisation = $state('Rega');
  let zeitraum = $state(90);
  let basis = $state('');
  let tageszeit = $state('alle');
  let wochentage = $state('alle');
  let heat = $state<{ heat: [number, number, number][]; hinweis: string } | null>(null);

  $effect(() => {
    if (tab === 'Lage') api.get<Lage>('/api/m/rettung/lage').then((l) => (lage = l));
    if (tab === 'Einsätze') api.get<Meldungen>('/api/m/rettung/meldungen').then((m) => (meld = m));
  });
  $effect(() => {
    if (tab !== 'Lage') return;
    return liveSchleife((schnell) =>
      api.get<Live>(`/api/m/rettung/live${schnell ? '?schnell=1' : ''}`).then((l) => {
        live = l;
        return l.helis.some((h) => !h.amBoden);
      }),
    );
  });
  $effect(() => {
    if (tab !== 'Lage') return;
    const holen = () => api.get<{ basen: Basis[] }>('/api/m/rettung/basen').then((b) => (basen = b.basen)).catch(() => {});
    holen();
    const t = setInterval(holen, 60000);
    return () => clearInterval(t);
  });
  const BASIS_STATUS: Record<Basis['status'], string> = { unterwegs: 'unterwegs', zuhause: 'zu Hause', vermutet: 'vermutlich zu Hause', unbekannt: 'keine Daten' };
  // Bewegte Helis auf der Karte, gespeist aus /live
  let anim = $state.raw<HeliAnimation | null>(null);
  function animStarten(L: typeof Leaflet, karte: Leaflet.Map) {
    const a = new HeliAnimation(L, karte);
    a.onklick = (h) => h.link && navigieren(h.link);
    anim = a;
    return () => {
      a.stop();
      anim = null;
    };
  }
  $effect(() => {
    if (!anim || !live) return;
    anim.setzen(liveAnim(live.helis, false));
    anim.abgestellt(live.abgestellt ?? []);
  });
  $effect(() => {
    if (tab === 'Rega Statistik') api.get<Statistik>(`/api/m/rettung/statistik?organisation=${encodeURIComponent(organisation)}&tage=${zeitraum}`).then((s) => (stat = s));
  });
  $effect(() => {
    if (tab !== 'Rega Statistik') return;
    const q = new URLSearchParams({ organisation, tage: String(zeitraum), tageszeit, wochentage, basis, nur: heatArt === 'einsatzorte' ? 'einsatzorte' : '' });
    api.get<{ heat: [number, number, number][]; hinweis: string }>(`/api/m/rettung/heatmap?${q}`).then((h) => (heat = h)).catch(() => (heat = null));
  });

  const LAWINE: Record<string, string> = { low: '1 gering', moderate: '2 mässig', considerable: '3 erheblich', high: '4 gross', very_high: '5 sehr gross' };
  const FARBE: Record<number, string> = { 1: 'ok', 2: 'warnung', 3: 'warnung', 4: 'ausfall' };
  const BASIS_FARBEN = ['#4aa3ff', '#ffb020', '#3ecf8e', '#ef5350', '#b388ff', '#26c6da', '#ff7043', '#d4e157', '#f06292', '#8d6e63', '#90a4ae', '#ffd54f', '#81c784'];
  const basisFarbe = (b: string | null) => {
    if (!b) return '#8a97a8';
    const i = stat?.einsatz?.proBasis.findIndex((x) => x.basis === b) ?? -1;
    return i < 0 ? '#8a97a8' : BASIS_FARBEN[i % BASIS_FARBEN.length];
  };
  const stunden = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);
  const wert = (n: number, einheit: string) => (einheit ? stunden(n) : String(n));
  const einsatzPunkte = $derived<GeoPunkt[]>(
    (stat?.einsatz?.orte ?? []).map((o, i) => ({
      id: `eo-${i}`,
      lat: o.lat,
      lon: o.lon,
      titel: o.name,
      text: `${o.kennzeichen ?? ''} ${datumZeit(o.start)}${o.basis ? `, Basis ${o.basis}` : ''}`,
      symbol: 'ort',
      farbe: basisFarbe(o.basis),
      groesse: 16,
    })),
  );
  const dauer = (a: string, b: string | null) => (b ? `${Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)} min` : 'läuft');
</script>

<ModulRahmen modulId="rettung" tabs={['Lage', 'Chronik', 'Einsätze', 'Rega Statistik', 'Toolbox', 'Kennzeichen', 'Webcams']} bind:tab>
  {#if tab === 'Lage'}
    <Karte hoehe="min(62vh, 560px)" gruppen={['Rettung', 'Gefahren', 'Wetter']} ohne={['rettung.helis']} bereit={animStarten} zentrum={[47.35, 9.15]} zoom={9} />
    <p class="sehr-klein gedaempft">Helikopter: Es sind nur Luftfahrzeuge sichtbar, die einen Transponder (ADS-B oder Mode S mit Position) senden. Rettungswagen sind nicht öffentlich und werden nicht angezeigt.</p>

    {#if live}
      <section class="panel" style="margin-top:12px">
        <div class="zeile-zwischen">
          <h2>Jetzt erfasst, ganze Schweiz</h2>
          <span class="zeile sehr-klein gedaempft">{live.stand ? `Stand ${relativ(live.stand)}` : ''}<a href="/lagebild?kiosk=1">Lagebild im Vollbild</a></span>
        </div>
        {#if live.fehler}<div class="hinweis ausfall klein">{live.fehler}</div>{/if}
        {#each live.helis as h (h.hex)}
          <a class="zeile-zwischen klein heli" href="/heli?hex={encodeURIComponent(h.hex)}">
            <span class="zeile">
              <span class="punkt" class:luft={!h.amBoden} style="background:{h.amBoden ? '' : heliFarbe(h.organisation)}"></span>
              <span><strong>{h.organisation} {h.kennzeichen ?? h.hex}</strong> <span class="gedaempft">{h.ort ?? 'unterwegs'}</span>
                {#if h.startPlatz}<br /><span class="sehr-klein gedaempft">gestartet bei {h.startPlatz}</span>{/if}</span>
            </span>
            <span class="gedaempft rechts">
              {h.amBoden ? 'am Boden' : [h.hoeheFt !== null ? `${h.hoeheFt} ft` : null, h.kmh !== null ? `${h.kmh} km/h` : null].filter(Boolean).join(' · ')}
              {#if h.seit}<br /><span class="sehr-klein">{h.gestartet ? 'Start' : 'erfasst'} {relativ(h.seit)}</span>{/if}
            </span>
          </a>
        {:else}
          <p class="leer">Gerade kein Heli aus der Kennzeichen Liste mit Transponder erfasst.</p>
        {/each}
      </section>
    {/if}
    {#if basen}
      <section class="panel" style="margin-top:12px">
        <h2>Rega Basen</h2>
        <div class="basen">
          {#each basen as b (b.id)}
            <div class="basis-zeile klein">
              <span class="zeile"><span class="farbpunkt status-{b.status}"></span><strong>{b.name.replace('Rega Basis ', '')}</strong></span>
              <span class:gedaempft={b.status === 'unbekannt'}>
                {BASIS_STATUS[b.status]}{b.status === 'unterwegs' ? `: ${b.unterwegs.map((u) => u.kennzeichen ?? u.hex).join(', ')}` : b.status === 'zuhause' ? `: ${b.zuHause.join(', ')}` : b.status === 'vermutet' ? `: ${b.vermutet.join(', ')}` : ''}
              </span>
              <span class="gedaempft">{b.letzteRueckkehr ? `zurück ${relativ(b.letzteRueckkehr.zeit)}` : ''}</span>
              <span class="zahl">{b.heute} heute</span>
            </div>
          {/each}
        </div>
        <p class="sehr-klein gedaempft">Nur aus ADS-B abgeleitet. Am Boden gibt es oft keinen Empfang, deshalb gilt ein Heli nach der Landung an der Basis oder nach zwei Stunden ohne Signal als vermutlich zu Hause.</p>
      </section>
    {/if}
    <section class="panel" style="margin-top:12px"><HeliZeitstrahl maxZeilen={20} /></section>

    {#if lage}
      <div class="raster-2" style="margin-top:12px">
        <section class="panel">
          <h2>Alertswiss</h2>
          {#if lage.fehler.alerts}<div class="hinweis ausfall klein">{lage.fehler.alerts}</div>{/if}
          {#each lage.alerts.filter((a) => a.inRegion) as a (a.id)}
            <div class="meldung">
              <div class="zeile-zwischen"><strong>{a.titel}</strong><span class="marke {a.schwere === 'severe' || a.schwere === 'extreme' ? 'ausfall' : 'warnung'}">{a.ereignis}</span></div>
              <div class="klein gedaempft">{a.herausgeber}</div>
              <div class="klein">{a.text.slice(0, 280)}</div>
              {#if a.link}<a class="sehr-klein" href={a.link} target="_blank" rel="noopener noreferrer">Mehr</a>{/if}
            </div>
          {:else}
            <p class="leer">Keine Meldung für die Region.</p>
          {/each}
          {#if lage.alerts.filter((a) => !a.inRegion).length}
            <details class="klein"><summary>{lage.alerts.filter((a) => !a.inRegion).length} Meldungen in anderen Regionen</summary>
              <ul>{#each lage.alerts.filter((a) => !a.inRegion) as a (a.id)}<li>{a.titel} <span class="gedaempft">({a.herausgeber})</span></li>{/each}</ul>
            </details>
          {/if}
        </section>

        <section class="panel">
          <h2>Unwetterwarnungen</h2>
          {#if lage.fehler.warnungen}<div class="hinweis ausfall klein">{lage.fehler.warnungen}</div>{/if}
          {#each lage.warnungen as w (w.id)}
            <div class="meldung">
              <div class="zeile-zwischen"><strong>{w.ereignis}</strong><span class="marke {FARBE[w.stufe] ?? ''}">Stufe {w.stufe} ({w.farbe})</span></div>
              <div class="klein gedaempft">{w.gebiet}{w.beginn ? ` · ${datumZeit(w.beginn)}` : ''}{w.ende ? ` bis ${datumZeit(w.ende)}` : ''}</div>
              <div class="klein">{w.text}</div>
            </div>
          {:else}
            <p class="leer">Keine Warnung für {lage.warnGebiete.join(', ')}. ({lage.warnungenAlle} Warnungen schweizweit)</p>
          {/each}
          <p class="sehr-klein gedaempft">Stufen nach MeteoAlarm: 2 gelb, 3 orange, 4 rot. Quelle MeteoSchweiz über MeteoAlarm.</p>
        </section>

        <section class="panel">
          <h2>Erdbeben (7 Tage)</h2>
          {#each lage.erdbeben.slice(0, 10) as e (e.id)}
            <div class="zeile-zwischen klein beben">
              <span class="zeile"><span class="zahl mag" class:stark={e.magnitude >= 3}>M{e.magnitude.toFixed(1)}</span>{e.ort}</span>
              <span class="gedaempft">{relativ(e.zeit)} · {e.distanzKm} km</span>
            </div>
          {:else}
            <p class="leer">Keine Erdbeben.</p>
          {/each}
          <p class="sehr-klein gedaempft">Schweizerischer Erdbebendienst (SED) an der ETH Zürich. Sprengungen und Erdrutsche ausgeblendet.</p>
        </section>

        <section class="panel">
          <h2>Lawinen</h2>
          {#each lage.lawinen.slice(0, 12) as l (l.region)}
            <div class="zeile-zwischen klein"><span>{l.region}</span><span class="marke {l.stufe === 'low' ? 'ok' : 'warnung'}">{LAWINE[l.stufe] ?? l.stufe}</span></div>
          {:else}
            <p class="leer">Kein aktuelles Lawinenbulletin (im Winter verfügbar).</p>
          {/each}
          <p class="sehr-klein gedaempft">WSL Institut für Schnee und Lawinenforschung SLF</p>
        </section>
      </div>
    {/if}
  {:else if tab === 'Chronik'}
    <EinsatzChronik />
  {:else if tab === 'Einsätze'}
    <div class="hinweis warnung" style="margin-bottom:12px">Zeitverzögert: Diese Einsatzauswertungen stammen aus öffentlichen Medienmitteilungen. Sie erscheinen oft erst Stunden oder Tage nach dem Ereignis.</div>
    {#if meld}
      <section class="panel">
        <ul class="liste">
          {#each meld.meldungen as m (m.id)}
            <li>
              <div class="zeile-zwischen"><a href={m.link} target="_blank" rel="noopener noreferrer"><strong>{m.titel}</strong></a><span class="marke {m.kategorie === 'Mitteilung' ? '' : 'warnung'}">{m.kategorie}</span></div>
              <div class="sehr-klein gedaempft">{m.quelle} · veröffentlicht {datumZeit(m.zeit)} ({relativ(m.zeit)})</div>
              {#if m.text}<div class="klein">{m.text.slice(0, 220)}</div>{/if}
            </li>
          {:else}
            <li class="leer">Keine Meldungen.</li>
          {/each}
        </ul>
        <p class="sehr-klein gedaempft">Quellen: {meld.quellen.join(', ')}. Abruf alle 15 Minuten, robots.txt wird beachtet. Weitere Feeds in der Einrichtung.</p>
      </section>
    {/if}
  {:else if tab === 'Rega Statistik'}
    <div class="zeile" style="margin-bottom:10px">
      <select bind:value={organisation} style="width:auto" aria-label="Organisation">
        <option value="alle">Alle Helikopter</option>
        {#each stat?.organisationen ?? ['Rega'] as o (o)}<option value={o}>{o}</option>{/each}
      </select>
      <select bind:value={zeitraum} style="width:auto" aria-label="Zeitraum">
        <option value={30}>30 Tage</option>
        <option value={90}>90 Tage</option>
        <option value={365}>1 Jahr</option>
      </select>
    </div>
    {#if stat}
      <div class="raster werte">
        <div class="panel"><h3>Erfasste Flüge</h3><div class="zahl gross">{stat.anzahl}</div></div>
        <div class="panel"><h3>Jetzt in der Luft</h3><div class="zahl gross">{stat.laufend}</div></div>
        <div class="panel"><h3>Pro Tag</h3><div class="zahl gross">{(stat.anzahl / zeitraum).toFixed(1)}</div></div>
        <div class="panel"><h3>Typische Flugdauer</h3><div class="zahl gross">{stat.dauerMin !== null ? `${stat.dauerMin} min` : 'offen'}</div></div>
      </div>
      <div class="raster-2">
        <section class="panel"><Balken titel="Flüge nach Tageszeit (Start, Schweizer Zeit)" werte={stat.proStunde} beschriftung={stat.proStunde.map((_, i) => `${i}h`)} einheit="Flüge" /></section>
        <section class="panel"><Balken titel="Flüge nach Wochentag" werte={stat.proWochentag} beschriftung={['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']} einheit="Flüge" /></section>
        <section class="panel">
          <h3>Häufigste Orte (Start oder Landung)</h3>
          {#each stat.orte as [o, n] (o)}<div class="zeile-zwischen klein"><span>{o}</span><span class="zahl">{n}</span></div>{/each}
        </section>
        <section class="panel">
          <h3>Häufigste Ziele (Spital oder Landeplatz)</h3>
          {#each stat.ziele as [o, n] (o)}<div class="zeile-zwischen klein"><span>{o}</span><span class="zahl">{n}</span></div>{:else}<p class="klein gedaempft">Noch keine Landung bei einem bekannten Platz erfasst. Gilt erst für neue Flüge.</p>{/each}
        </section>
        <section class="panel">
          <h3>Häufigste Startplätze</h3>
          {#each stat.startplaetze as [o, n] (o)}<div class="zeile-zwischen klein"><span>{o}</span><span class="zahl">{n}</span></div>{:else}<p class="klein gedaempft">Noch kein Start bei einem bekannten Platz erfasst. Gilt erst für neue Flüge.</p>{/each}
        </section>
        <section class="panel">
          <h3>Letzte Flüge</h3>
          {#each stat.letzte.slice(0, 10) as f (f.start + f.kennzeichen)}
            <div class="zeile-zwischen klein"><span>{f.organisation ?? 'Heli'} {f.kennzeichen ?? ''} · {f.start_platz ?? f.start_ort ?? '?'} nach {f.ende_platz ?? f.ende_ort ?? '?'}</span><span class="gedaempft">{datumZeit(f.start)} · {dauer(f.start, f.ende)}</span></div>
          {/each}
        </section>
      </div>
      {#if stat.einsatz}
        {@const w = stat.einsatz.woche}
        <h3 style="margin-top:14px">Einsätze, letzte 7 Tage im Vergleich zur Vorwoche</h3>
        <div class="raster werte">
          {#each [['Einsätze', w.diese.einsaetze, w.vorher.einsaetze, ''], ['Mit Einsatzort', w.diese.mitEinsatzort, w.vorher.mitEinsatzort, ''], ['Flugzeit', w.diese.flugMin, w.vorher.flugMin, ' min']] as [titel, jetzt, vorher, e] (titel)}
            {@const einheit = String(e)}
            {@const d = Number(jetzt) - Number(vorher)}
            <div class="panel">
              <h3>{titel}</h3>
              <div class="zahl gross">{wert(Number(jetzt), einheit)}</div>
              <div class="klein" class:plus={d > 0} class:minus={d < 0}>{d > 0 ? '+' : d < 0 ? '−' : '±'}{wert(Math.abs(d), einheit)} zur Vorwoche ({wert(Number(vorher), einheit)})</div>
            </div>
          {/each}
        </div>
        <div class="raster-2">
          <section class="panel">
            <h3>Pro Basis ({stat.einsatz.anzahl} Einsätze im Zeitraum)</h3>
            <div class="basis-tabelle klein">
              <span class="gedaempft">Basis</span><span class="gedaempft zahl">Einsätze</span><span class="gedaempft zahl">Flugzeit</span><span class="gedaempft zahl">Typisch</span>
              {#each stat.einsatz.proBasis as b (b.basis)}
                <span><span class="farbpunkt" style="background:{basisFarbe(b.basis)}"></span>{b.basis}</span>
                <span class="zahl">{b.anzahl}</span>
                <span class="zahl">{stunden(b.flugMin)}</span>
                <span class="zahl">{b.dauerMin !== null ? `${b.dauerMin} min` : 'offen'}</span>
              {:else}<span class="gedaempft" style="grid-column:1/-1">Noch keine Einsätze erfasst.</span>{/each}
            </div>
          </section>
          <section class="panel">
            <h3>Einsatzorte nach Gemeinde</h3>
            {#each stat.einsatz.gemeinden ?? [] as [o, n] (o)}<div class="zeile-zwischen klein"><span>{o}</span><span class="zahl">{n}</span></div>{:else}<p class="klein gedaempft">Noch kein Einsatzort mit Gemeinde erfasst.</p>{/each}
            <p class="sehr-klein gedaempft">Landungen ausserhalb von Basis und Spital, Gemeinde von geo.admin.ch. Vermutete Einsatzorte, ohne Gewähr.</p>
          </section>
          <section class="panel">
            <h3>Spitäler nach Häufigkeit</h3>
            {#each stat.einsatz.spitaeler as [o, n] (o)}<div class="zeile-zwischen klein"><span>{o}</span><span class="zahl">{n}</span></div>{:else}<p class="klein gedaempft">Noch keine Landung bei einem Spital erfasst.</p>{/each}
          </section>
        </div>
        <h3 style="margin-top:14px">Einsatzorte nach Basis</h3>
        <Karte hoehe="420px" ebenenFest={[]} punkte={einsatzPunkte} einpassen={einsatzPunkte.length > 0} zentrum={[46.8, 8.23]} zoom={7} basisStart="nacht" />
        <p class="sehr-klein gedaempft">Landungen ohne bekannten Platz, eingefärbt nach der Basis des Einsatzes. Abgeleitet aus Transponderdaten, ohne Gewähr.</p>
      {/if}
      <div class="zeile-zwischen" style="margin-top:14px">
        <h3>Heatmap Schweiz</h3>
        <div class="zeile">
          <select bind:value={heatArt} style="width:auto" aria-label="Inhalt der Heatmap">
            <option value="alles">Alle Flüge</option>
            <option value="einsatzorte">Nur Einsatzorte</option>
          </select>
          <select bind:value={basis} style="width:auto" aria-label="Basis">
            <option value="">Alle Basen</option>
            {#each stat.startplaetze as [o] (o)}<option value={o}>{o}</option>{/each}
          </select>
          <select bind:value={tageszeit} style="width:auto" aria-label="Tageszeit">
            <option value="alle">Ganzer Tag</option>
            <option value="morgen">Morgen 6 bis 10 Uhr</option>
            <option value="tag">Tag 10 bis 17 Uhr</option>
            <option value="abend">Abend 17 bis 22 Uhr</option>
            <option value="nacht">Nacht 22 bis 6 Uhr</option>
          </select>
          <select bind:value={wochentage} style="width:auto" aria-label="Wochentage">
            <option value="alle">Alle Tage</option>
            <option value="werktag">Werktage</option>
            <option value="wochenende">Wochenende</option>
          </select>
        </div>
      </div>
      <Karte hoehe="460px" ebenenFest={[]} heat={heat?.heat ?? []} zentrum={[46.8, 8.23]} zoom={7} />
      <p class="sehr-klein gedaempft">{heat?.hinweis ?? 'Lade…'}. {heatArt === 'einsatzorte' ? 'Nur Landungen ausserhalb von Basis und Spital.' : 'Start und Landung zählen doppelt.'} Nur aus selbst erfassten ADS-B Daten, nicht vollständig.</p>
    {/if}
  {:else if tab === 'Toolbox'}
    <Toolbox />
  {:else if tab === 'Kennzeichen'}
    <div class="hinweis" style="margin-bottom:12px">Kennzeichen oder Präfixe (mit *) pro Organisation, z.B. Rega, Air Zermatt, Air Glaciers, Polizei. Die Standardwerte für die Rega (HB-ZR*, HB-TI*) stammen aus öffentlichen Flottenangaben und müssen geprüft werden. Bitte nur Kennzeichen eintragen, die öffentlich bekannt sind.</div>
    <div class="panel"><TabellenEditor tabelle="heli_kennungen" sort="organisation" spalten={['organisation', 'muster', 'push']} neuText="Kennzeichen" /></div>
  {:else}
    <WebcamWand />
    <h2 style="margin-top:20px">Eigene Webcams</h2>
    <div class="hinweis" style="margin-bottom:12px">Eigene Webcams mit öffentlicher Bild Adresse (https). Erscheinen in der Wand oben und auf der Karte in der Ebene «Webcams».</div>
    <div class="panel"><TabellenEditor tabelle="webcams" spalten={['name', 'lat', 'lon', 'bild_url']} neuText="Webcam" /></div>
  {/if}
</ModulRahmen>

<style>
  .basen {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 6px 12px;
    align-items: center;
  }
  .basis-zeile {
    display: contents;
  }
  .status-unterwegs {
    background: #ff5d5d;
  }
  .status-zuhause {
    background: #34d399;
  }
  .status-vermutet {
    background: #6ee7b7;
    opacity: 0.6;
  }
  .status-unbekannt {
    background: #94a3b8;
  }
  .heli {
    padding: 6px 0;
    border-bottom: 1px solid var(--rand);
    color: inherit;
    text-decoration: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .heli:hover strong {
      text-decoration: underline;
    }
  }
  .heli .rechts {
    text-align: right;
  }
  .meldung {
    padding: 8px 0;
    border-bottom: 1px solid #1a2330;
  }
  .meldung:last-child {
    border-bottom: none;
  }
  .beben {
    padding: 4px 0;
  }
  .mag {
    min-width: 44px;
    color: var(--text-2);
  }
  .mag.stark {
    color: var(--warnung);
  }
  .werte {
    margin-bottom: 12px;
  }
  .gross {
    font-size: 2rem;
  }
  .plus {
    color: var(--warnung);
  }
  .minus {
    color: var(--ok);
  }
  .basis-tabelle {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: 4px 14px;
  }
  .farbpunkt {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 6px;
  }
</style>
