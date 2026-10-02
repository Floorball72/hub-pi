<script lang="ts">
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
</script>

<h1>Schnellnotizen</h1>
<p class="gedaempft klein">Notizen können an Orte, Kunden, Einsätze oder Drehs gehängt werden. Auf den Detailseiten erscheinen sie beim jeweiligen Eintrag.</p>
<div class="panel">
  <TabellenEditor tabelle="notizen" spalten={['text', 'bezug_typ', 'bezug_name', 'angeheftet']} neuText="Notiz" leerText="Noch keine Notizen." />
</div>
