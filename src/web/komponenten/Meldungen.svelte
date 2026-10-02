<script lang="ts">
  import { meldungen } from '../lib/meldung.svelte.ts';
</script>

<div class="meldungen" aria-live="polite">
  {#each meldungen.liste as m (m.id)}
    <div class="meldung hinweis {m.art}">{m.text}</div>
  {/each}
</div>

<style>
  .meldungen {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(80px + env(safe-area-inset-bottom));
    z-index: 3000;
    display: grid;
    gap: 8px;
    width: min(92vw, 420px);
  }
  .meldung {
    box-shadow: 0 10px 30px #000a;
    background: #131b25;
  }
</style>
