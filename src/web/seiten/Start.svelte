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
  import { melden } from '../lib/meldung.svelte.ts';
  import { navigieren } from '../lib/router.svelte.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';
  import { LEERES_LAYOUT, ordnen, type StartLayout, umschalten, verschieben } from '../lib/startLayout.ts';

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
  // Sonntagabend: Rückblick auf die ganze Woche
  const wochenende = $derived(abend && jetzt.getDay() === 0);
  let fehler = $state(false);
  interface Notiz {
    id: string;
    text: string;
    bezug_name: string | null;
    angeheftet: boolean | number;
    erstellt: string;
  }
  let notizen = $state<Notiz[]>([]);
  let neueNotiz = $state('');
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

  function notizenLaden() {
    api
      .get<Notiz[]>('/api/daten/notizen?sort=-erstellt&limit=100')
      .then((n) => (notizen = n.filter((x) => !!x.angeheftet).slice(0, 8)))
      .catch(() => (notizen = []));
  }
  $effect(() => {
    // Neue Notiz aus der Befehlspalette sofort zeigen
    window.addEventListener('pihub:notizen', notizenLaden);
    return () => window.removeEventListener('pihub:notizen', notizenLaden);
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
    notizenLaden();
    api
      .get<{ teile: BriefingTeil[] }>(abend ? `/api/abendbericht${wochenende ? '?zeitraum=woche' : ''}` : '/api/briefing')
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

  async function notizAnheften(e: SubmitEvent) {
    e.preventDefault();
    const text = neueNotiz.trim();
    if (!text) return;
    try {
      const n = await api.post<Notiz>('/api/daten/notizen', { text, angeheftet: true });
      notizen = [n, ...notizen].slice(0, 8);
      neueNotiz = '';
    } catch {
      melden('Notiz konnte nicht gespeichert werden', 'ausfall');
    }
  }
  async function notizLoesen(n: Notiz) {
    try {
      await api.put(`/api/daten/notizen/${n.id}`, { angeheftet: false });
      notizen = notizen.filter((x) => x.id !== n.id);
      melden('Notiz gelöst, sie bleibt unter Notizen');
    } catch {
      melden('Notiz konnte nicht geändert werden', 'ausfall');
    }
  }

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

  // Anpassbare Startseite, pro Gerät
  let layout = $state<StartLayout>(lesen('start.layout', LEERES_LAYOUT));
  let anpassen = $state(false);
  function layoutSetzen(neu: StartLayout) {
    layout = neu;
    schreiben('start.layout', neu);
  }
  const versteckt = (id: string) => layout.versteckt.includes(id);
  const geordnet = $derived(ordnen(daten?.module ?? [], layout.reihenfolge));
  function schieben(id: string, richtung: -1 | 1) {
    layoutSetzen({ ...layout, reihenfolge: verschieben(geordnet.map((m) => m.id), id, richtung) });
  }
  function zeigen(id: string) {
    layoutSetzen({ ...layout, versteckt: umschalten(layout.versteckt, id) });
  }

  const sichtbareModule = $derived(
    geordnet.filter((m) => {
      if (anpassen) return true;
      if (versteckt(m.id)) return false;
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

  {#if rettungAktiv && !ansicht.fokus && !versteckt('abschnitt.rettung')}
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

  {#if briefing?.teile.length && !versteckt('abschnitt.briefing')}
    <section class="briefing">
      <h2><Icon name={abend ? 'mond' : 'sonne'} groesse={18} /> {wochenende ? 'Wochenrückblick' : abend ? 'Tagesrückblick' : 'Briefing'}</h2>
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

  {#if !ansicht.fokus && !ansicht.kiosk && daten && !versteckt('abschnitt.notizen')}
    <section class="notizen">
      <div class="zeile-zwischen">
        <h2><Icon name="notiz" groesse={18} /> Angeheftet</h2>
        <a class="klein" href="/notizen" onclick={(e) => { e.preventDefault(); navigieren('/notizen'); }}>Alle Notizen</a>
      </div>
      <div class="notiz-raster">
        {#each notizen as n (n.id)}
          <div class="notiz panel">
            <p>{n.text}</p>
            <div class="zeile-zwischen sehr-klein gedaempft">
              <span>{n.bezug_name ? `${n.bezug_name} · ` : ''}{relativ(n.erstellt)}</span>
              <button class="klein" aria-label="Notiz lösen" onclick={() => notizLoesen(n)}>Lösen</button>
            </div>
          </div>
        {/each}
        <form class="notiz neu panel" onsubmit={notizAnheften}>
          <textarea bind:value={neueNotiz} rows="2" placeholder="Schnell etwas notieren…" aria-label="Neue Notiz" onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}></textarea>
          <div class="zeile-zwischen sehr-klein gedaempft">
            <span>Ctrl Enter speichert</span>
            <button class="klein primaer" type="submit" disabled={!neueNotiz.trim()}>Anheften</button>
          </div>
        </form>
      </div>
    </section>
  {/if}

  <section>
    {#if ansicht.fokus}
      <div class="zeile-zwischen"><h2>Fokus: nur was Aufmerksamkeit braucht</h2></div>
    {:else if !ansicht.kiosk && daten}
      <div class="zeile-zwischen anpassen-kopf">
        <span class="sehr-klein gedaempft">{anpassen ? 'Reihenfolge mit den Pfeilen, Auge blendet aus. Gilt nur auf diesem Gerät.' : ''}</span>
        <span class="zeile">
          {#if anpassen && (layout.reihenfolge.length || layout.versteckt.length)}
            <button class="klein" onclick={() => layoutSetzen(LEERES_LAYOUT)}>Zurücksetzen</button>
          {/if}
          <button class="klein" class:primaer={anpassen} onclick={() => (anpassen = !anpassen)}>{anpassen ? 'Fertig' : 'Startseite anpassen'}</button>
        </span>
      </div>
      {#if anpassen}
        <div class="zeile abschnitte">
          {#if rettungAktiv}
            <label class="zeile klein"><input type="checkbox" checked={!versteckt('abschnitt.rettung')} onchange={() => zeigen('abschnitt.rettung')} /> Rettung jetzt</label>
          {/if}
          <label class="zeile klein"><input type="checkbox" checked={!versteckt('abschnitt.briefing')} onchange={() => zeigen('abschnitt.briefing')} /> Briefing und Tagesrückblick</label>
          <label class="zeile klein"><input type="checkbox" checked={!versteckt('abschnitt.notizen')} onchange={() => zeigen('abschnitt.notizen')} /> Angeheftete Notizen</label>
        </div>
      {/if}
    {/if}
    <div class="raster kacheln">
      {#each sichtbareModule as m, i (m.id)}
        {#if anpassen}
          <div class="kachel-huelle" class:aus={versteckt(m.id)}>
            <KachelAnsicht modul={m} kachel={daten?.kacheln[m.id]} />
            <div class="kachel-steuer">
              <button class="klein" aria-label="{m.name} nach vorne" disabled={i === 0} onclick={() => schieben(m.id, -1)}>‹</button>
              <button class="klein" aria-label={versteckt(m.id) ? `${m.name} einblenden` : `${m.name} ausblenden`} onclick={() => zeigen(m.id)}>{versteckt(m.id) ? 'Einblenden' : 'Ausblenden'}</button>
              <button class="klein" aria-label="{m.name} nach hinten" disabled={i === sichtbareModule.length - 1} onclick={() => schieben(m.id, 1)}>›</button>
            </div>
          </div>
        {:else}
          <KachelAnsicht modul={m} kachel={daten?.kacheln[m.id]} />
        {/if}
      {:else}
        {#if daten}<p class="leer">{ansicht.fokus ? 'Nichts zu tun. Alles läuft.' : 'Keine Module aktiv.'}</p>{/if}
      {/each}
    </div>
  </section>
</div>

<style>
  .notiz-raster {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  .notiz {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 14px;
    border-left: 3px solid var(--warnung);
  }
  .notiz p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .notiz.neu {
    border-left-color: var(--rand-hell);
  }
  .notiz textarea {
    width: 100%;
    resize: vertical;
    min-height: 52px;
  }
  .anpassen-kopf {
    margin-bottom: 8px;
    min-height: 32px;
  }
  .abschnitte {
    gap: 16px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .abschnitte input {
    width: auto;
  }
  .kachel-huelle {
    position: relative;
    display: grid;
    border-radius: 14px;
    outline: 1px dashed var(--rand-hell);
    outline-offset: 3px;
  }
  .kachel-huelle > :global(.kachel) {
    pointer-events: none;
  }
  .kachel-huelle.aus > :global(.kachel) {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .kachel-steuer {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    gap: 4px;
  }
  .kachel-steuer button {
    min-height: 0;
    padding: 4px 10px;
    background: var(--flaeche-3);
  }
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
