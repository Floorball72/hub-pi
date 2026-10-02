<script lang="ts">
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Info {
    abgeschlossen: boolean;
    werte: Record<string, string>;
    gesetzt: Record<string, boolean>;
    envPfad: string;
  }
  type Pruefung = { ok: boolean; meldung: string; daten?: unknown };

  const SCHRITTE = ['Zugang', 'Datenbank', 'Push', 'Orte', 'Kalender', 'Region', 'Optional', 'Abschluss'];
  let schritt = $state(0);
  let info = $state<Info | null>(null);
  let w = $state<Record<string, string>>({});
  let passwort = $state('');
  let passwort2 = $state('');
  let ergebnisse = $state<Record<string, Pruefung | 'laeuft'>>({});
  let fertig = $state<string | null>(null);

  $effect(() => {
    api.get<Info>('/api/einrichtung').then((i) => {
      info = i;
      w = { ...i.werte };
      w.DATEN_TREIBER ||= 'lokal';
      w.NTFY_SERVER ||= 'https://ntfy.sh';
      w.ORTE_NAMEN = (i.werte.WETTER_ORTE || 'Kirchberg SG|0|0;St. Gallen|0|0')
        .split(';')
        .map((t) => t.split('|')[0])
        .join('; ');
      w.OEV_HALTESTELLEN ||= 'Kirchberg SG, Post; St. Gallen';
      w.REGION_NAME ||= 'Wil SG';
      w.REGION_RADIUS_KM ||= '40';
      w.ADMIN_BENUTZER ||= 'jerome';
    });
  });

  async function pruefen(art: string) {
    ergebnisse[art] = 'laeuft';
    try {
      const r = await api.post<Pruefung>('/api/einrichtung/pruefen', { art, werte: w });
      ergebnisse[art] = r;
      if (r.ok && art === 'orte') {
        w.WETTER_ORTE = (r.daten as { name: string; lat: number; lon: number }[]).map((o) => `${o.name}|${o.lat}|${o.lon}`).join(';');
      }
      if (r.ok && art === 'region') {
        const d = r.daten as { lat: number; lon: number };
        w.REGION_LAT = String(d.lat);
        w.REGION_LON = String(d.lon);
      }
      if (r.ok && art === 'oev') w.OEV_HALTESTELLEN = (r.daten as string[]).join(';');
    } catch (e) {
      ergebnisse[art] = { ok: false, meldung: fehlerText(e) };
    }
  }

  function ergebnis(art: string): Pruefung | 'laeuft' | undefined {
    return ergebnisse[art];
  }

  function geheimPlatzhalter(feld: string) {
    return info?.gesetzt[feld] ? 'gespeichert (leer lassen, um zu behalten)' : '';
  }

  async function speichern() {
    if (passwort && passwort !== passwort2) {
      melden('Passwörter stimmen nicht überein', 'ausfall');
      schritt = 0;
      return;
    }
    if (!(await bestaetigen('Einrichtung speichern?', 'Die Werte werden in die .env geschrieben. Bei Supabase werden die Migrationen angewendet. Danach startet der Hub neu.', 'Speichern und neu starten'))) return;
    try {
      const { ORTE_NAMEN: _, ...werte } = w;
      const r = await api.post<{ hinweis: string; meldungen: string[] }>('/api/einrichtung/speichern', { werte, passwort, bestaetigt: true });
      fertig = [r.hinweis, ...r.meldungen].join(' ');
      setTimeout(() => (location.href = '/login'), 15000);
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
</script>

{#snippet pruefung(art: string, text = 'Verbindung testen')}
  {@const e = ergebnis(art)}
  <div class="zeile pruefung">
    <button onclick={() => pruefen(art)} disabled={e === 'laeuft'}>{e === 'laeuft' ? 'Prüfe…' : text}</button>
    {#if e && e !== 'laeuft'}<span class="hinweis {e.ok ? 'ok' : 'ausfall'} klein">{e.meldung}</span>{/if}
  </div>
{/snippet}

<div class="einrichtung">
  <h1>Einrichtung</h1>
  {#if info?.abgeschlossen}
    <p class="hinweis">Die Einrichtung ist abgeschlossen. Änderungen werden in die .env geschrieben, danach startet der Hub neu.</p>
  {:else}
    <p class="gedaempft klein">Diese Seite ist nur aus dem lokalen Netz oder über Tailscale erreichbar. Jede Eingabe kann vor dem Speichern getestet werden.</p>
  {/if}

  {#if fertig}
    <div class="hinweis ok">{fertig} Du wirst in 15 Sekunden zum Login weitergeleitet.</div>
  {:else if info}
    <ol class="schritte">
      {#each SCHRITTE as s, i (s)}
        <li><button class:aktiv={i === schritt} class:erledigt={i < schritt} onclick={() => (schritt = i)}><span class="nr">{i + 1}</span>{s}</button></li>
      {/each}
    </ol>

    <section class="panel">
      {#if schritt === 0}
        <h2>Zugang</h2>
        <p class="gedaempft klein">Lokaler Login. Funktioniert auch, wenn Supabase nicht erreichbar ist. Mindestens 10 Zeichen.</p>
        <div class="feld"><label for="b">Benutzer</label><input id="b" bind:value={w.ADMIN_BENUTZER} autocomplete="username" /></div>
        <div class="feld"><label for="p1">Passwort {info.gesetzt.ADMIN_PASSWORT_HASH ? '(leer lassen, um zu behalten)' : ''}</label><input id="p1" type="password" bind:value={passwort} autocomplete="new-password" /></div>
        <div class="feld"><label for="p2">Passwort wiederholen</label><input id="p2" type="password" bind:value={passwort2} autocomplete="new-password" /></div>
      {:else if schritt === 1}
        <h2>Datenbank</h2>
        <div class="feld">
          <label for="t">Datentreiber</label>
          <select id="t" bind:value={w.DATEN_TREIBER}>
            <option value="supabase">Supabase (empfohlen für den Betrieb)</option>
            <option value="lokal">Lokal (SQLite auf der SD Karte)</option>
          </select>
        </div>
        {#if w.DATEN_TREIBER === 'supabase'}
          <p class="gedaempft klein">Werte aus Supabase: Project Settings, API und Database. Der Service Role Key bleibt nur auf dem Pi.</p>
          <div class="feld"><label for="su">Supabase URL</label><input id="su" bind:value={w.SUPABASE_URL} placeholder="https://xyz.supabase.co" /></div>
          <div class="feld"><label for="sa">Anon Key (für den Login)</label><input id="sa" type="password" bind:value={w.SUPABASE_ANON_KEY} placeholder={geheimPlatzhalter('SUPABASE_ANON_KEY')} /></div>
          <div class="feld"><label for="ss">Service Role Key</label><input id="ss" type="password" bind:value={w.SUPABASE_SERVICE_ROLE_KEY} placeholder={geheimPlatzhalter('SUPABASE_SERVICE_ROLE_KEY')} /></div>
          <div class="feld"><label for="sd">Datenbank Verbindung (Session Pooler, postgresql://…)</label><input id="sd" type="password" bind:value={w.SUPABASE_DB_URL} placeholder={geheimPlatzhalter('SUPABASE_DB_URL')} /></div>
          <div class="feld"><label for="se">E-Mail für den Supabase Login</label><input id="se" bind:value={w.ERLAUBTE_EMAILS} placeholder="name@beispiel.ch" /></div>
          {@render pruefung('supabase')}
        {/if}
      {:else if schritt === 2}
        <h2>Push mit ntfy</h2>
        <p class="gedaempft klein">Ein langes, zufälliges Thema wählen (wie ein Passwort). Dasselbe Thema in der ntfy App abonnieren.</p>
        <div class="feld"><label for="ns">Server</label><input id="ns" bind:value={w.NTFY_SERVER} /></div>
        <div class="feld"><label for="nt">Thema</label><input id="nt" type="password" bind:value={w.NTFY_THEMA} placeholder={geheimPlatzhalter('NTFY_THEMA')} /></div>
        <div class="feld"><label for="nk">Zugangstoken (optional)</label><input id="nk" type="password" bind:value={w.NTFY_TOKEN} placeholder={geheimPlatzhalter('NTFY_TOKEN')} /></div>
        {@render pruefung('ntfy', 'Testnachricht senden')}
      {:else if schritt === 3}
        <h2>Orte für Wetter und ÖV</h2>
        <div class="feld"><label for="o">Orte (mit Semikolon getrennt)</label><input id="o" bind:value={w.ORTE_NAMEN} /></div>
        {@render pruefung('orte', 'Orte suchen')}
        <div class="feld"><label for="h">ÖV Haltestellen (mit Semikolon getrennt)</label><input id="h" bind:value={w.OEV_HALTESTELLEN} /></div>
        {@render pruefung('oev', 'Haltestellen prüfen')}
      {:else if schritt === 4}
        <h2>Kalender</h2>
        <p class="gedaempft klein">Google Kalender: Einstellungen des Kalenders, «Geheime Adresse im iCal Format». Wird nur auf dem Pi gespeichert.</p>
        <div class="feld"><label for="i">iCal Adresse</label><input id="i" type="password" bind:value={w.ICAL_URL} placeholder={geheimPlatzhalter('ICAL_URL')} /></div>
        {@render pruefung('ical', 'Kalender lesen')}
      {:else if schritt === 5}
        <h2>Region für Einsätze</h2>
        <div class="feld"><label for="r">Mittelpunkt (Ort)</label><input id="r" bind:value={w.REGION_NAME} /></div>
        <div class="feld"><label for="rr">Radius in km</label><input id="rr" type="number" min="5" max="200" bind:value={w.REGION_RADIUS_KM} /></div>
        {@render pruefung('region', 'Region prüfen')}
        <div class="feld">
          <label for="f">Öffentliche RSS Feeds für Einsatzmeldungen (Name|URL; Name|URL)</label>
          <textarea id="f" rows="3" bind:value={w.EINSATZ_FEEDS} placeholder="Kapo SG|https://…/rss.xml"></textarea>
        </div>
        {@render pruefung('feeds', 'Feeds prüfen (inkl. robots.txt)')}
      {:else if schritt === 6}
        <h2>Optional</h2>
        <div class="feld"><label for="ps">Google PageSpeed API Key (ohne Key gelten strenge Limits)</label><input id="ps" type="password" bind:value={w.PAGESPEED_API_KEY} placeholder={geheimPlatzhalter('PAGESPEED_API_KEY')} /></div>
        <div class="feld"><label for="wi">Windy Webcams API Key</label><input id="wi" type="password" bind:value={w.WINDY_WEBCAMS_KEY} placeholder={geheimPlatzhalter('WINDY_WEBCAMS_KEY')} /></div>
        <h3 style="margin-top:16px">swiss unihockey Hub Login</h3>
        <p class="gedaempft klein">Wird nur in der .env gespeichert und nirgends angezeigt oder geloggt. Der Hub nutzt ihn nicht für Aktionen.</p>
        <div class="feld"><label for="sb">Benutzer</label><input id="sb" type="password" bind:value={w.SUH_LOGIN_BENUTZER} placeholder={geheimPlatzhalter('SUH_LOGIN_BENUTZER')} autocomplete="off" /></div>
        <div class="feld"><label for="sp">Passwort</label><input id="sp" type="password" bind:value={w.SUH_LOGIN_PASSWORT} placeholder={geheimPlatzhalter('SUH_LOGIN_PASSWORT')} autocomplete="off" /></div>
      {:else}
        <h2>Abschluss</h2>
        <ul class="liste">
          <li class="zeile-zwischen"><span>Datentreiber</span><strong>{w.DATEN_TREIBER}</strong></li>
          <li class="zeile-zwischen"><span>Wetter Orte</span><span class="klein">{w.WETTER_ORTE || '–'}</span></li>
          <li class="zeile-zwischen"><span>ÖV</span><span class="klein">{w.OEV_HALTESTELLEN || '–'}</span></li>
          <li class="zeile-zwischen"><span>Region</span><span class="klein">{w.REGION_NAME} ({w.REGION_RADIUS_KM} km)</span></li>
          <li class="zeile-zwischen"><span>Push</span><span class="klein">{w.NTFY_THEMA || info.gesetzt.NTFY_THEMA ? 'konfiguriert' : 'fehlt'}</span></li>
          <li class="zeile-zwischen"><span>Kalender</span><span class="klein">{w.ICAL_URL || info.gesetzt.ICAL_URL ? 'konfiguriert' : 'fehlt'}</span></li>
        </ul>
        <p class="gedaempft klein">Die Werte landen in {info.envPfad}. Danach startet der Hub neu und der Demo Modus ist aus.</p>
        <button class="primaer" onclick={speichern}>Speichern und neu starten</button>
      {/if}
    </section>

    <div class="zeile-zwischen navigation">
      <button disabled={schritt === 0} onclick={() => schritt--}>Zurück</button>
      {#if schritt < SCHRITTE.length - 1}<button class="primaer" onclick={() => schritt++}>Weiter</button>{/if}
    </div>
  {/if}
</div>

<style>
  .einrichtung {
    max-width: 760px;
    margin: 0 auto;
  }
  .schritte {
    list-style: none;
    padding: 0;
    display: flex;
    gap: 6px;
    overflow-x: auto;
    margin: 0 0 14px;
  }
  .schritte button {
    white-space: nowrap;
    font-size: 0.8rem;
    background: transparent;
  }
  .schritte .aktiv {
    border-color: var(--akzent);
    color: var(--akzent);
  }
  .schritte .erledigt {
    color: var(--ok);
  }
  .nr {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--flaeche-3);
    font-size: 0.7rem;
  }
  .pruefung {
    margin: 10px 0 14px;
  }
  .navigation {
    margin-top: 14px;
  }
</style>
