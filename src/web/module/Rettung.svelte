<script lang="ts">
  import Balken from '../komponenten/Balken.svelte';
  import Karte from '../komponenten/Karte.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import Toolbox from './Toolbox.svelte';
  import { api } from '../lib/api.ts';
  import { datumZeit, relativ } from '../lib/format.ts';

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
  }
  interface Meldungen {
    meldungen: { id: string; titel: string; link: string; zeit: string; kategorie: string; quelle: string; text: string }[];
    hinweis: string;
    quellen: string[];
  }

  let tab = $state('Lage');
  let lage = $state<Lage | null>(null);
  let stat = $state<Statistik | null>(null);
  let meld = $state<Meldungen | null>(null);
  let organisation = $state('Rega');
  let zeitraum = $state(90);

  $effect(() => {
    if (tab === 'Lage') api.get<Lage>('/api/m/rettung/lage').then((l) => (lage = l));
    if (tab === 'Einsätze') api.get<Meldungen>('/api/m/rettung/meldungen').then((m) => (meld = m));
  });
  $effect(() => {
    if (tab === 'Rega Statistik') api.get<Statistik>(`/api/m/rettung/statistik?organisation=${encodeURIComponent(organisation)}&tage=${zeitraum}`).then((s) => (stat = s));
  });

  const LAWINE: Record<string, string> = { low: '1 gering', moderate: '2 mässig', considerable: '3 erheblich', high: '4 gross', very_high: '5 sehr gross' };
  const FARBE: Record<number, string> = { 1: 'ok', 2: 'warnung', 3: 'warnung', 4: 'ausfall' };
  const dauer = (a: string, b: string | null) => (b ? `${Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)} min` : 'läuft');
</script>

<ModulRahmen modulId="rettung" tabs={['Lage', 'Einsätze', 'Rega Statistik', 'Toolbox', 'Kennzeichen', 'Webcams']} bind:tab>
  {#if tab === 'Lage'}
    <Karte hoehe="min(62vh, 560px)" gruppen={['Rettung', 'Gefahren', 'Wetter']} zentrum={[47.35, 9.15]} zoom={9} />
    <p class="sehr-klein gedaempft">Helikopter: Es sind nur Luftfahrzeuge sichtbar, die einen Transponder (ADS-B oder Mode S mit Position) senden. Rettungswagen sind nicht öffentlich und werden nicht angezeigt.</p>

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
      <h3 style="margin-top:14px">Flugspuren und Heatmap</h3>
      <Karte hoehe="420px" gruppen={['Rettung']} zentrum={[46.8, 8.23]} zoom={7} />
      <p class="sehr-klein gedaempft">Ebenen «Heli Flugspuren (7 Tage)» und «Rega Einsätze (Heatmap)» im Ebenen Menü einschalten. Statistik nur aus selbst erfassten ADS-B Daten, nicht vollständig.</p>
    {/if}
  {:else if tab === 'Toolbox'}
    <Toolbox />
  {:else if tab === 'Kennzeichen'}
    <div class="hinweis" style="margin-bottom:12px">Kennzeichen oder Präfixe (mit *) pro Organisation, z.B. Rega, Air Zermatt, Air Glaciers, Polizei. Die Standardwerte für die Rega (HB-ZR*, HB-TI*) stammen aus öffentlichen Flottenangaben und müssen geprüft werden. Bitte nur Kennzeichen eintragen, die öffentlich bekannt sind.</div>
    <div class="panel"><TabellenEditor tabelle="heli_kennungen" sort="organisation" spalten={['organisation', 'muster', 'push']} neuText="Kennzeichen" /></div>
  {:else}
    <div class="hinweis" style="margin-bottom:12px">Eigene Webcams mit öffentlicher Bild Adresse (https). Erscheinen auf der Karte in der Ebene «Webcams».</div>
    <div class="panel"><TabellenEditor tabelle="webcams" spalten={['name', 'lat', 'lon', 'bild_url']} neuText="Webcam" /></div>
  {/if}
</ModulRahmen>

<style>
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
</style>
