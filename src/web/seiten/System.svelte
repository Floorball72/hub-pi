<script lang="ts">
  import Icon from '../komponenten/Icon.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datumZeit, relativ } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface System {
    temperaturC: number | null;
    ramGesamtMb: number;
    ramVerfuegbarMb: number;
    prozessRssMb: number;
    prozessHeapMb: number;
    speicherGesamtGb: number | null;
    speicherFreiGb: number | null;
    last: number[];
    kerne: number;
    laufzeitSek: number;
    prozessLaufzeitSek: number;
    tailscale: { installiert: boolean; verbunden: boolean | null; name?: string; ip?: string };
    backup: { letztes: string | null; alterStunden: number | null; anzahl: number };
    drosselung: string | null;
    node: string;
  }
  interface Backup {
    name: string;
    groesseKb: number;
    zeit: string;
  }
  interface Aktivitaet {
    id: string;
    erstellt: string;
    modul: string;
    art: string;
    text: string;
  }

  let s = $state<System | null>(null);
  let backups = $state<Backup[]>([]);
  let log = $state<Aktivitaet[]>([]);
  let laeuft = $state('');

  async function laden() {
    const [a, b, c] = await Promise.all([
      api.get<System>('/api/system'),
      api.get<{ dateien: Backup[] }>('/api/backups'),
      api.get<Aktivitaet[]>('/api/aktivitaet?limit=80'),
    ]);
    s = a;
    backups = b.dateien;
    log = c;
  }
  $effect(() => {
    laden();
    const t = setInterval(laden, 15000);
    return () => clearInterval(t);
  });

  async function aktion(pfad: string, titel: string, text: string, knopf: string, gefahr = false) {
    if (!(await bestaetigen(titel, text, knopf, gefahr))) return;
    laeuft = pfad;
    try {
      const r = await api.post<{ hinweis?: string; name?: string }>(pfad, { bestaetigt: true });
      melden(r.hinweis ?? (r.name ? `Backup ${r.name} erstellt` : 'Erledigt'));
      if (pfad.endsWith('neustart')) setTimeout(() => location.reload(), 20000);
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    } finally {
      laeuft = '';
    }
  }

  function dauer(sek: number) {
    const t = Math.floor(sek / 86400);
    const h = Math.floor((sek % 86400) / 3600);
    const m = Math.floor((sek % 3600) / 60);
    return t ? `${t} T ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  }

  const ramProzent = $derived(s ? Math.round(((s.ramGesamtMb - s.ramVerfuegbarMb) / s.ramGesamtMb) * 100) : 0);
  const speicherProzent = $derived(s?.speicherGesamtGb ? Math.round(((s.speicherGesamtGb - (s.speicherFreiGb ?? 0)) / s.speicherGesamtGb) * 100) : 0);
  const ART: Record<string, string> = { fehler: 'ausfall', warnung: 'warnung', aktion: 'ok' };
</script>

<h1>System</h1>

{#if s}
  <div class="raster werte">
    <div class="panel wert-panel">
      <h3>CPU Temperatur</h3>
      <div class="zahl gross" style="color:{(s.temperaturC ?? 0) > 75 ? 'var(--ausfall)' : (s.temperaturC ?? 0) > 65 ? 'var(--warnung)' : 'var(--text)'}">{s.temperaturC ?? '–'}<span class="einheit">°C</span></div>
      <div class="klein gedaempft">{s.drosselung === null ? 'Drosselung unbekannt (kein Pi)' : s.drosselung === '0x0' ? 'keine Drosselung' : `Drosselung ${s.drosselung}`}</div>
    </div>
    <div class="panel wert-panel">
      <h3>RAM des Hubs</h3>
      <div class="zahl gross" style="color:{s.prozessRssMb > 300 ? 'var(--ausfall)' : s.prozessRssMb > 250 ? 'var(--warnung)' : 'var(--text)'}">{s.prozessRssMb}<span class="einheit">MB</span></div>
      <div class="klein gedaempft">Ziel unter 300 MB · Heap {s.prozessHeapMb} MB</div>
    </div>
    <div class="panel wert-panel">
      <h3>RAM System</h3>
      <div class="zahl gross">{ramProzent}<span class="einheit">%</span></div>
      <div class="balken"><span style="width:{ramProzent}%"></span></div>
      <div class="klein gedaempft">{s.ramVerfuegbarMb} von {s.ramGesamtMb} MB verfügbar</div>
    </div>
    <div class="panel wert-panel">
      <h3>Speicher</h3>
      <div class="zahl gross">{s.speicherFreiGb ?? '–'}<span class="einheit">GB frei</span></div>
      <div class="balken"><span style="width:{speicherProzent}%"></span></div>
      <div class="klein gedaempft">von {s.speicherGesamtGb ?? '–'} GB</div>
    </div>
    <div class="panel wert-panel">
      <h3>Tailscale</h3>
      <div class="zeile"><span class="punkt {s.tailscale.verbunden ? 'ok' : 'warnung'}"></span><span class="zahl mittel">{!s.tailscale.installiert ? 'nicht installiert' : s.tailscale.verbunden ? 'verbunden' : 'getrennt'}</span></div>
      <div class="klein gedaempft">{s.tailscale.name ?? ''} {s.tailscale.ip ?? ''}</div>
    </div>
    <div class="panel wert-panel">
      <h3>Laufzeit</h3>
      <div class="zahl mittel">{dauer(s.laufzeitSek)}</div>
      <div class="klein gedaempft">Hub seit {dauer(s.prozessLaufzeitSek)} · Last {s.last.join(' / ')} · {s.kerne} Kerne · Node {s.node}</div>
    </div>
  </div>
{:else}
  <div class="laedt" style="height:150px"></div>
{/if}

<div class="raster-2" style="margin-top:12px">
  <section class="panel">
    <h2>Aktionen</h2>
    <p class="klein gedaempft">Jede Aktion fragt vorher nach.</p>
    <div class="zeile aktionen">
      <button disabled={!!laeuft} onclick={() => aktion('/api/aktionen/backup', 'Backup erstellen?', 'Alle Tabellen werden als komprimierte Datei auf der SD Karte gesichert.', 'Backup erstellen')}><Icon name="backup" groesse={16} />Backup auslösen</button>
      <button disabled={!!laeuft} onclick={() => aktion('/api/aktionen/neustart', 'Dienst neu starten?', 'Der Hub ist etwa 20 Sekunden nicht erreichbar.', 'Neu starten', true)}><Icon name="neustart" groesse={16} />Dienst neu starten</button>
      <button disabled={!!laeuft} onclick={() => aktion('/api/aktionen/aktualisieren', 'Aktualisieren?', 'Der Pi holt die neueste Version aus Git, baut sie und startet neu. Bei einem Fehler bleibt die alte Version aktiv.', 'Aktualisieren', true)}><Icon name="start" groesse={16} />Deploy (Git Pull)</button>
    </div>

    <h2 style="margin-top:22px">Backups</h2>
    {#if !backups.length}
      <p class="leer">Noch kein Backup vorhanden. Täglich um 03:30 läuft eines automatisch.</p>
    {:else}
      <ul class="liste">
        {#each backups as b (b.name)}
          <li class="zeile-zwischen"><span class="mono">{b.name}</span><span class="klein gedaempft">{b.groesseKb} KB · {relativ(b.zeit)}</span></li>
        {/each}
      </ul>
      <p class="sehr-klein gedaempft">Die letzten 14 Backups bleiben erhalten. Wiederherstellen: npm run backup -- --einspielen &lt;Datei&gt;</p>
    {/if}
  </section>

  <section class="panel">
    <h2>Aktivitätslog</h2>
    <ul class="liste log">
      {#each log as a (a.id)}
        <li>
          <div class="zeile"><span class="punkt {ART[a.art] ?? ''}"></span><span class="klein">{a.text}</span></div>
          <div class="sehr-klein gedaempft">{datumZeit(a.erstellt)} · {a.modul}</div>
        </li>
      {:else}
        <li class="leer">Noch keine Einträge.</li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .gross {
    font-size: 2.6rem;
    line-height: 1.1;
  }
  .mittel {
    font-size: 1.3rem;
  }
  .einheit {
    font-size: 0.95rem;
    color: var(--text-2);
    margin-left: 4px;
  }
  .wert-panel h3 {
    margin-bottom: 2px;
  }
  .balken {
    height: 6px;
    border-radius: 3px;
    background: #1b2531;
    overflow: hidden;
    margin: 6px 0;
  }
  .balken span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--akzent), var(--akzent-2));
  }
  .aktionen {
    margin-top: 8px;
  }
  .log {
    max-height: 520px;
    overflow-y: auto;
  }
</style>
