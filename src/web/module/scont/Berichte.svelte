<script lang="ts">
  import { api } from '../../lib/api.ts';

  let kunden = $state<{ id: string; name: string }[]>([]);
  let kunde = $state('');
  const heute = new Date();
  let monat = $state(`${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}`);

  $effect(() => {
    api.get<{ id: string; name: string }[]>('/api/daten/kunden?sort=name').then((k) => {
      kunden = k;
      kunde ||= k[0]?.id ?? '';
    });
  });
</script>

<div class="raster-2">
  <section class="panel">
    <h2>Monatsreport als PDF</h2>
    <p class="klein gedaempft">Verfügbarkeit, Antwortzeiten, Ausfälle, PageSpeed, Qualitäts und Sicherheitsnote, Aufwand aus der Zeiterfassung und weiterverrechnete Kosten.</p>
    <div class="feld"><label for="rk">Kunde</label>
      <select id="rk" bind:value={kunde}>{#each kunden as k (k.id)}<option value={k.id}>{k.name}</option>{/each}</select>
    </div>
    <div class="feld"><label for="rm">Monat</label><input id="rm" type="month" bind:value={monat} /></div>
    <a class="knopf primaer" style="margin-top:12px" href={`/api/m/scont/report?kunde=${kunde}&monat=${monat}`} target="_blank" rel="noopener">PDF öffnen</a>
  </section>
  <section class="panel">
    <h2>Öffentliche Statusseite</h2>
    <p class="klein gedaempft">Zeigt ohne Login nur die Namen und die Verfügbarkeit der Seiten, bei denen «Auf öffentlicher Statusseite» eingeschaltet ist. Keine Adressen, keine Fehlermeldungen.</p>
    <a class="knopf" href="/status" target="_blank" rel="noopener">Statusseite ansehen</a>
    <p class="sehr-klein gedaempft" style="margin-top:12px">Für Kunden ohne Tailscale: siehe docs/TAILSCALE.md, Abschnitt Funnel.</p>
  </section>
</div>
