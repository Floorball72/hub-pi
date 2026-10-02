<script lang="ts">
  import { api, fehlerText } from '../lib/api.ts';
  import { navigieren, parameter } from '../lib/router.svelte.ts';

  let benutzer = $state('');
  let passwort = $state('');
  let fehler = $state('');
  let laeuft = $state(false);
  let info = $state<{ demo: boolean; einrichtungOffen: boolean } | null>(null);

  api.get<{ demo: boolean; einrichtungOffen: boolean; angemeldet: boolean }>('/api/sitzung').then((s) => {
    info = s;
    if (s.angemeldet) navigieren('/', true);
  });

  async function anmelden(e: SubmitEvent) {
    e.preventDefault();
    laeuft = true;
    fehler = '';
    try {
      await api.post('/api/login', { benutzer, passwort });
      const weiter = parameter('weiter');
      location.href = weiter && weiter.startsWith('/') && !weiter.startsWith('//') ? weiter : '/';
    } catch (err) {
      fehler = fehlerText(err);
    } finally {
      laeuft = false;
    }
  }
</script>

<div class="login">
  <form class="panel" onsubmit={anmelden}>
    <div class="marke-gross"><img src="/icon.svg" alt="" width="44" height="44" /><span>Pi Hub</span></div>
    <div class="feld">
      <label for="benutzer">Benutzer oder E-Mail</label>
      <input id="benutzer" autocomplete="username" bind:value={benutzer} required />
    </div>
    <div class="feld">
      <label for="passwort">Passwort</label>
      <input id="passwort" type="password" autocomplete="current-password" bind:value={passwort} required />
    </div>
    {#if fehler}<div class="hinweis ausfall" style="margin-top:12px">{fehler}</div>{/if}
    <button class="primaer voll" type="submit" disabled={laeuft}>{laeuft ? 'Prüfe…' : 'Anmelden'}</button>
    {#if info?.demo}<p class="sehr-klein gedaempft">Demo Modus: Benutzer «jerome», Passwort «demo», solange kein Passwort gesetzt ist.</p>{/if}
    {#if info?.einrichtungOffen}<p class="sehr-klein"><a href="/einrichtung">Einrichtung starten</a></p>{/if}
  </form>
</div>

<style>
  .login {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  form {
    width: min(100%, 380px);
  }
  .marke-gross {
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: var(--schrift-zahl);
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 20px;
  }
  .voll {
    width: 100%;
    justify-content: center;
    margin-top: 16px;
  }
</style>
