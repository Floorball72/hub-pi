<script lang="ts">
  import type * as Leaflet from 'leaflet';
  import { heliFarbe } from '../../server/geteilt/heli.ts';
  import type { Ampel, BriefingTeil, Kachel, ModulInfo } from '../../server/geteilt/typen.ts';
  import HeliZeitstrahl from '../komponenten/HeliZeitstrahl.svelte';
  import Icon from '../komponenten/Icon.svelte';
  import Karte from '../komponenten/Karte.svelte';
  import KachelAnsicht from '../komponenten/KachelAnsicht.svelte';
  import { ansicht } from '../lib/ansicht.svelte.ts';
  import { api } from '../lib/api.ts';
  import { relativ } from '../lib/format.ts';
  import { type AbgestellterHeli, HeliAnimation, type LiveHeliPos, liveAnim } from '../lib/heliAnimation.ts';
  import { navigieren } from '../lib/router.svelte.ts';

  interface LiveHeli extends LiveHeliPos {
    ort: string | null;
    seit: string | null;
    gestartet: boolean;
  }

  let daten = $state<{ status: Ampel; kacheln: Record<string, Kachel>; module: ModulInfo[]; demo: boolean } | null>(null);
  let briefing = $state<{ teile: BriefingTeil[] } | null>(null);
  let jetzt = $state(new Date());
  // Ab 18 Uhr Rückblick auf den Tag statt Morgenbriefing
  const abend = $derived(jetzt.getHours() >= 18);
  let fehler = $state(false);
  let live = $state<{ helis: LiveHeli[]; abgestellt?: AbgestellterHeli[]; fehler?: string } | null>(null);
  const rettungAktiv = $derived(!!daten?.module.some((m) => m.id === 'rettung' && m.aktiv));
  const inDerLuft = $derived((live?.helis ?? []).filter((h) => !h.amBoden));

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
    anim.setzen(liveAnim(live.helis, true));
    anim.abgestellt(live.abgestellt ?? []);
  });

  async function laden() {
    try {
      daten = await api.get('/api/start');
      fehler = false;
    } catch {
      fehler = true;
    }
    api
      .get<NonNullable<typeof live>>('/api/m/rettung/live')
      .then((l) => (live = l))
      .catch(() => (live = null));
    api
      .get<{ teile: BriefingTeil[] }>(abend ? '/api/abendbericht' : '/api/briefing')
      .then((b) => (briefing = b))
      .catch(() => {});
  }

  $effect(() => {
    laden();
    const t = setInterval(laden, 30000);
    const u = setInterval(() => (jetzt = new Date()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(u);
    };
  });

  const TITEL: Record<Ampel, string> = {
    ok: 'Alles gut',
    warnung: 'Warnung',
    ausfall: 'Ausfall',
    neutral: 'Bereit',
  };

  const stundenFormat = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: 'numeric', hourCycle: 'h23' });
  const stunde = $derived(Number(stundenFormat.formatToParts(jetzt).find((p) => p.type === 'hour')?.value ?? 12));
  const gruss = $derived(stunde < 11 ? 'Guten Morgen' : stunde < 17 ? 'Guten Tag' : 'Guten Abend');

  const probleme = $derived(
    daten
      ? daten.module
          .filter((m) => m.aktiv && ['warnung', 'ausfall'].includes(daten!.kacheln[m.id]?.status ?? ''))
          .map((m) => ({ modul: m, kachel: daten!.kacheln[m.id] }))
      : [],
  );

  const sichtbareModule = $derived(
    (daten?.module ?? []).filter((m) => {
      if (!ansicht.fokus) return true;
      const s = daten?.kacheln[m.id]?.status;
      return s === 'warnung' || s === 'ausfall';
    }),
  );
</script>

<div class="start" class:kiosk={ansicht.kiosk}>
  <section class="held {daten?.status ?? 'neutral'}">
    <div class="links">
      <div class="gruss gedaempft">{gruss}, Jerome</div>
      <div class="zustand zahl">
        <span class="ring {daten?.status ?? 'neutral'}"></span>
        {daten ? TITEL[daten.status] : 'Lade…'}
      </div>
      <div class="gedaempft">
        {#if fehler}
          Verbindung zum Hub unterbrochen. Neuer Versuch in einer Minute.
        {:else if probleme.length}
          {probleme.length === 1 ? '1 Bereich braucht Aufmerksamkeit' : `${probleme.length} Bereiche brauchen Aufmerksamkeit`}:
          {probleme.map((p) => p.modul.name).join(', ')}
        {:else if daten}
          Alle Module und Quellen laufen.
        {/if}
      </div>
    </div>
    <div class="rechts">
      <div class="uhr zahl">{jetzt.toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' })}</div>
      <div class="gedaempft">{jetzt.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long' })}</div>
      {#if daten?.demo}<span class="marke demo">Demo Daten</span>{/if}
    </div>
  </section>

  {#if rettungAktiv && !ansicht.fokus}
    <section class="rettung-jetzt">
      <div class="panel rj-liste">
        <div class="zeile-zwischen">
          <h2><Icon name="rettung" groesse={18} /> Rettung jetzt</h2>
          <span class="zeile sehr-klein"><a href="/lagebild?kiosk=1">Lagebild</a><a href="/modul/rettung">Mehr</a></span>
        </div>
        <div class="rj-zahl zahl">{inDerLuft.length}<span class="gedaempft klein"> {inDerLuft.length === 1 ? 'Heli in der Luft' : 'Helis in der Luft'}, ganze Schweiz</span></div>
        {#if live?.fehler}<div class="hinweis ausfall klein">{live.fehler}</div>{/if}
        {#each inDerLuft.slice(0, 6) as h (h.hex)}
          <a class="zeile-zwischen klein rj-heli" href="/heli?hex={encodeURIComponent(h.hex)}">
            <span class="zeile"><span class="punkt luft" style="background:{heliFarbe(h.organisation)}"></span><span><strong>{h.organisation} {h.kennzeichen ?? h.hex}</strong> <span class="gedaempft">{h.ort ?? 'unterwegs'}</span></span></span>
            <span class="gedaempft">{h.seit ? `${h.gestartet ? 'Start' : 'seit'} ${relativ(h.seit)}` : h.hoeheFt !== null ? `${h.hoeheFt} ft` : ''}</span>
          </a>
        {:else}
          <p class="leer">Gerade ist kein Heli aus deiner Liste mit Transponder in der Luft.</p>
        {/each}
      </div>
      <div class="rj-karte">
        <Karte hoehe="320px" kompakt ebenenFest={[]} bereit={animStarten} zentrum={[46.8, 8.23]} zoom={7} />
      </div>
      <div class="panel rj-rueckblick"><HeliZeitstrahl maxZeilen={8} /></div>
    </section>
  {/if}

  {#if briefing?.teile.length}
    <section class="briefing">
      <h2><Icon name={abend ? 'mond' : 'sonne'} groesse={18} /> {abend ? 'Tagesrückblick' : 'Briefing'}</h2>
      <div class="briefing-raster">
        {#each briefing.teile as t (t.modul + t.titel)}
          <div class="briefing-teil panel">
            <div class="zeile-zwischen">
              <h3>{t.titel}</h3>
              <span class="punkt {t.status}"></span>
            </div>
            <ul class="liste">
              {#each t.zeilen as z, i (i)}
                <li class="zeile-zwischen">
                  <span class="briefing-text">{#if z.status}<span class="punkt {z.status}"></span>{/if}<span>{z.text}</span></span>
                  {#if z.wert}<span class="zahl wert">{z.wert}</span>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section>
    {#if ansicht.fokus}
      <div class="zeile-zwischen"><h2>Fokus: nur was Aufmerksamkeit braucht</h2></div>
    {/if}
    <div class="raster kacheln">
      {#each sichtbareModule as m (m.id)}
        <KachelAnsicht modul={m} kachel={daten?.kacheln[m.id]} />
      {:else}
        {#if daten}<p class="leer">{ansicht.fokus ? 'Nichts zu tun. Alles läuft.' : 'Keine Module aktiv.'}</p>{/if}
      {/each}
    </div>
  </section>
</div>

<style>
  .rettung-jetzt {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
    gap: 12px;
    margin-bottom: 18px;
  }
  .rj-rueckblick {
    grid-column: 1 / -1;
  }
  .rj-karte {
    border-radius: 14px;
    overflow: hidden;
  }
  .rj-zahl {
    font-size: 2rem;
    margin: 4px 0 8px;
  }
  .rj-heli {
    padding: 5px 0;
    border-bottom: 1px solid var(--rand);
    color: inherit;
    text-decoration: none;
  }
  .rj-heli:hover strong {
    text-decoration: underline;
  }
  @media (max-width: 760px) {
    .rettung-jetzt {
      grid-template-columns: 1fr;
    }
  }
  .held {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 22px 24px;
    border-radius: 18px;
    border: 1px solid var(--rand);
    margin-bottom: 18px;
    background:
      radial-gradient(600px 200px at 0% 0%, #34d39914, transparent 70%),
      linear-gradient(180deg, var(--flaeche-2), var(--flaeche));
    position: relative;
    overflow: hidden;
  }
  .held.warnung {
    background:
      radial-gradient(600px 200px at 0% 0%, #fbbf241f, transparent 70%),
      linear-gradient(180deg, var(--flaeche-2), var(--flaeche));
    border-color: #fbbf2433;
  }
  .held.ausfall {
    background:
      radial-gradient(600px 200px at 0% 0%, #f8717126, transparent 70%),
      linear-gradient(180deg, var(--flaeche-2), var(--flaeche));
    border-color: #f8717155;
  }
  .zustand {
    font-size: clamp(2rem, 6vw, 3.2rem);
    line-height: 1.1;
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 4px 0 6px;
  }
  .ring {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 5px solid var(--neutral);
    flex: none;
  }
  .ring.ok {
    border-color: var(--ok);
    box-shadow: 0 0 24px #34d39977;
  }
  .ring.warnung {
    border-color: var(--warnung);
    box-shadow: 0 0 24px #fbbf2477;
  }
  .ring.ausfall {
    border-color: var(--ausfall);
    box-shadow: 0 0 28px #f87171aa;
    animation: pulsieren 1.6s infinite;
  }
  .rechts {
    text-align: right;
    display: grid;
    justify-items: end;
    gap: 4px;
  }
  .uhr {
    font-size: clamp(2rem, 6vw, 3.2rem);
    line-height: 1;
  }
  .briefing {
    margin-bottom: 18px;
  }
  .briefing h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
    font-size: 0.95rem;
  }
  .briefing-raster {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  }
  .briefing-teil {
    padding: 12px 14px;
  }
  .briefing-teil h3 {
    margin: 0;
  }
  .briefing-teil li {
    font-size: 0.88rem;
    padding: 6px 0;
  }
  .wert {
    white-space: nowrap;
  }
  .briefing-text {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .briefing-text .punkt {
    flex: none;
    transform: translateY(-1px);
  }
  .kiosk .held {
    padding: 32px;
  }
  .kiosk .zustand,
  .kiosk .uhr {
    font-size: 4rem;
  }
  @media (max-width: 600px) {
    .rechts {
      text-align: left;
      justify-items: start;
    }
  }
</style>
