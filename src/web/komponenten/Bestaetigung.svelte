<script lang="ts">
  import { dialog, schliessen } from '../lib/bestaetigen.svelte.ts';

  function taste(e: KeyboardEvent) {
    if (!dialog.offen) return;
    if (e.key === 'Escape') schliessen(false);
  }
</script>

<svelte:window onkeydown={taste} />

{#if dialog.offen}
  <div class="hintergrund" role="presentation" onclick={() => schliessen(false)}>
    <div class="dialog panel" role="alertdialog" aria-modal="true" aria-labelledby="dialog-titel" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <h2 id="dialog-titel">{dialog.offen.titel}</h2>
      <p class="gedaempft">{dialog.offen.text}</p>
      <div class="zeile knoepfe">
        <button onclick={() => schliessen(false)}>Abbrechen</button>
        <button class={dialog.offen.gefahr ? 'gefahr' : 'primaer'} onclick={() => schliessen(true)}>{dialog.offen.knopf}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .hintergrund {
    position: fixed;
    inset: 0;
    background: #000a;
    backdrop-filter: blur(3px);
    display: grid;
    place-items: center;
    z-index: 2000;
    padding: 16px;
  }
  .dialog {
    max-width: 420px;
    width: 100%;
  }
  .knoepfe {
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
