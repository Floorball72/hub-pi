<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
</script>

<ModulRahmen modulId="zentrale">
  <div class="raster">
    <a class="panel knopf-flaeche" href="/system"><h2>System</h2><p class="gedaempft klein">Temperatur, RAM, Speicher, Tailscale, Backups und Aktionen</p></a>
    <a class="panel knopf-flaeche" href="/hub-status"><h2>Status</h2><p class="gedaempft klein">Module, Datenquellen und Hintergrundjobs</p></a>
    <a class="panel knopf-flaeche" href="/alarme"><h2>Alarmzentrale</h2><p class="gedaempft klein">Regeln und Verlauf der Push Meldungen</p></a>
    <a class="panel knopf-flaeche" href="/timeline"><h2>Timeline</h2><p class="gedaempft klein">Einsätze, Drehs, Spiele und Fristen</p></a>
    <a class="panel knopf-flaeche" href="/notizen"><h2>Notizen</h2><p class="gedaempft klein">Schnellnotizen zu Orten, Kunden und Einsätzen</p></a>
  </div>
</ModulRahmen>

<style>
  .knopf-flaeche {
    color: inherit;
  }
  @media (hover: hover) and (pointer: fine) {
    .knopf-flaeche:hover {
      text-decoration: none;
      border-color: var(--rand-hell);
    }
  }
</style>
