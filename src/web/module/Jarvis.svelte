<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { type JarvisEreignis, jarvisChat } from '../lib/jarvisChat.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { navigieren } from '../lib/router.svelte.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';

  interface Status {
    schluessel: boolean;
    demo: boolean;
    modell: string;
    vollmacht: string;
    tokensHeute: number;
    tageslimit: number;
    erinnerungen: number;
    werkzeuge: number;
  }
  interface Einstellung {
    vollmacht: string;
    tageslimit: number;
    persoenlichkeit: string;
    modell: 'standard' | 'schnell';
    web: boolean;
    morgenpush: boolean;
    vollmachten?: string[];
    persoenlichkeiten?: string[];
  }
  interface Gespraech { id: string; titel: string }
  interface Schritt {
    id: string;
    name: string;
    beschreibung: string;
    ok?: boolean;
    kurz?: string;
    bestaetigung?: string;
    entschieden?: string;
  }
  interface Eintrag { rolle: 'user' | 'assistant'; text: string; schritte: Schritt[]; laeuft?: boolean }

  const VOLLMACHT_NAMEN: Record<string, string> = {
    nur_lesen: 'Nur lesen',
    fragen: 'Alles fragen',
    autonom: 'Autonom',
    voll: 'Voll',
  };
  const VOLLMACHT_HILFE: Record<string, string> = {
    nur_lesen: 'Jarvis schaut nach und merkt sich Dinge, ändert aber nichts.',
    fragen: 'Jede Änderung muss bestätigt werden.',
    autonom: 'Jarvis erledigt Anlegen und Ändern selbst. Löschen, Module schalten, Neustart und Update bestätigst du.',
    voll: 'Jarvis führt alles ohne Rückfrage aus. Nur für Vertrauensmenschen und eigene Netze.',
  };
  const PERS_NAMEN: Record<string, string> = { butler: 'Butler', sachlich: 'Sachlich', locker: 'Locker' };
  const VORSCHLAEGE = [
    'Was steht heute an?',
    'Gib mir das Briefing',
    'Wie geht es dem Pi?',
    'Merk dir: ',
    'Welche Rechnungen sind bald fällig?',
  ];

  let tab = $state('Jarvis');
  let status = $state<Status | null>(null);
  let einst = $state<Einstellung | null>(null);
  let gespraeche = $state<Gespraech[]>([]);
  let gespraechId = $state<string | undefined>(undefined);
  let eintraege = $state<Eintrag[]>([]);
  let eingabe = $state('');
  let laeuft = $state(false);
  let zustand = $state<'ruhe' | 'hoert' | 'denkt' | 'spricht'>('ruhe');
  let verlaufEl = $state<HTMLDivElement | null>(null);
  let abbruch: AbortController | null = null;

  // Sprache
  const SR: any = (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;
  const spracheOk = !!SR && 'speechSynthesis' in globalThis;
  let weckwort = $state(lesen('jarvis.weckwort', false));
  let vorlesen = $state(lesen('jarvis.vorlesen', false));
  let diktat = $state(false);
  let zuhoerer: any = null;
  let hoertZu = false;
  let sprichtGerade = $state(false);
  let zwischen = $state('');

  const WECK = /\b(?:hey|hallo|hi|ok|okay)[\s,.!]*(?:jarvis|dscharvis|jarvis's)\b[\s,.!:]*/i;

  const prozent = $derived(status ? Math.min(100, Math.round((status.tokensHeute / status.tageslimit) * 100)) : 0);

  async function ladenStatus() {
    try {
      status = await api.get<Status>('/api/m/jarvis/status');
      einst = await api.get<Einstellung>('/api/m/jarvis/einstellungen');
      gespraeche = await api.get<Gespraech[]>('/api/m/jarvis/gespraeche');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  async function scrollen() {
    await tick();
    verlaufEl?.scrollTo({ top: verlaufEl.scrollHeight, behavior: 'smooth' });
  }

  async function oeffnen(id: string) {
    try {
      const z = await api.get<{ rolle: 'user' | 'assistant'; text: string; werkzeuge: string[] }[]>(
        `/api/m/jarvis/gespraeche/${id}`,
      );
      gespraechId = id;
      eintraege = z.map((m) => ({
        rolle: m.rolle,
        text: m.text,
        schritte: (m.werkzeuge ?? []).map((n, i) => ({ id: `${id}-${i}`, name: String(n), beschreibung: String(n), ok: true })),
      }));
      tab = 'Jarvis';
      scrollen();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  function neu() {
    gespraechId = undefined;
    eintraege = [];
  }

  async function loeschen(g: Gespraech) {
    if (!(await bestaetigen('Gespräch löschen', `«${g.titel}» wird gelöscht.`, 'Löschen', true))) return;
    try {
      await api.del(`/api/m/jarvis/gespraeche/${g.id}?bestaetigt=ja`);
      if (gespraechId === g.id) neu();
      gespraeche = gespraeche.filter((x) => x.id !== g.id);
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  /** Markdown Zeichen entfernen, damit das Vorlesen sauber klingt. */
  function fuerSprache(t: string) {
    return t.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  }

  function sprechen(text: string) {
    if (!vorlesen || !spracheOk || !text.trim()) {
      zustand = 'ruhe';
      return;
    }
    const u = new SpeechSynthesisUtterance(fuerSprache(text));
    u.lang = 'de-CH';
    const stimmen = speechSynthesis.getVoices();
    const stimme = stimmen.find((s) => s.lang === 'de-CH') ?? stimmen.find((s) => s.lang.startsWith('de'));
    if (stimme) u.voice = stimme;
    u.rate = 1.03;
    u.onstart = () => {
      sprichtGerade = true;
      zustand = 'spricht';
      zuhoerenPausieren();
    };
    const ende = () => {
      sprichtGerade = false;
      zustand = 'ruhe';
      zuhoerenStarten();
    };
    u.onend = ende;
    u.onerror = ende;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function stumm() {
    if (spracheOk) speechSynthesis.cancel();
    sprichtGerade = false;
    if (zustand === 'spricht') zustand = 'ruhe';
  }

  async function senden(text = eingabe) {
    const t = text.trim();
    if (!t || laeuft) return;
    stumm();
    eingabe = '';
    laeuft = true;
    zustand = 'denkt';
    eintraege.push({ rolle: 'user', text: t, schritte: [] });
    const antwort: Eintrag = $state({ rolle: 'assistant', text: '', schritte: [], laeuft: true });
    eintraege.push(antwort);
    scrollen();
    abbruch = new AbortController();
    let ziel = '';
    try {
      await jarvisChat(t, gespraechId, abbruch.signal, (e) => {
        if (e.art === 'navigation') ziel = String(e.ziel);
        else ereignis(antwort, e);
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') antwort.text ||= `Das hat nicht geklappt: ${fehlerText(e)}`;
    } finally {
      antwort.laeuft = false;
      laeuft = false;
      abbruch = null;
      if (zustand === 'denkt') zustand = 'ruhe';
      sprechen(antwort.text);
      if (ziel) navigieren(ziel);
      api.get<Status>('/api/m/jarvis/status').then((s) => (status = s)).catch(() => undefined);
      api.get<Gespraech[]>('/api/m/jarvis/gespraeche').then((g) => (gespraeche = g)).catch(() => undefined);
    }
  }

  function ereignis(a: Eintrag, e: JarvisEreignis & Record<string, any>) {
    if (e.art === 'gespraech') gespraechId = e.id;
    else if (e.art === 'text') a.text += e.text;
    else if (e.art === 'werkzeug') a.schritte.push({ id: e.id, name: e.name, beschreibung: e.beschreibung });
    else if (e.art === 'ergebnis') {
      const s = a.schritte.find((x) => x.id === e.id);
      if (s) {
        s.ok = e.ok;
        s.kurz = e.kurz;
      }
    } else if (e.art === 'bestaetigung') {
      const s = [...a.schritte].reverse().find((x) => x.name === e.werkzeug && !x.bestaetigung);
      if (s) s.bestaetigung = e.id;
    } else if (e.art === 'fehler') a.text += (a.text ? '\n' : '') + e.text;
  }

  async function entscheiden(s: Schritt, ja: boolean) {
    if (!s.bestaetigung) return;
    const id = s.bestaetigung;
    try {
      const r = await api.post<{ ok: boolean; text: string }>('/api/m/jarvis/bestaetigen', { id, ja });
      s.entschieden = ja ? (r.ok ? 'Ausgeführt' : 'Fehlgeschlagen') : 'Verworfen';
      s.kurz = r.text.slice(0, 160);
      s.bestaetigung = undefined;
      if (ja && r.ok) melden('Erledigt', 'ok');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  function stoppen() {
    abbruch?.abort();
  }

  // Spracherkennung mit Weckwort. Die Seite muss offen sein, der Browser fragt einmal nach dem Mikrofon.
  function zuhoerenStarten() {
    if (!spracheOk || (!weckwort && !diktat) || hoertZu || sprichtGerade || laeuft) return;
    zuhoerer ??= (() => {
      const z = new SR();
      z.lang = 'de-CH';
      z.continuous = true;
      z.interimResults = true;
      z.onresult = (ev: any) => {
        let fest = '';
        let vorlaeufig = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) fest += r[0].transcript;
          else vorlaeufig += r[0].transcript;
        }
        zwischen = vorlaeufig;
        if (!fest.trim()) return;
        zwischen = '';
        if (diktat) {
          diktat = false;
          zuhoerenPausieren();
          senden(fest);
          return;
        }
        const m = fest.match(WECK);
        if (!m) return;
        const befehl = fest.slice((m.index ?? 0) + m[0].length).trim();
        if (befehl) senden(befehl);
        else {
          diktat = true;
          zustand = 'hoert';
        }
      };
      z.onstart = () => {
        hoertZu = true;
        if (zustand === 'ruhe') zustand = weckwort || diktat ? 'hoert' : 'ruhe';
      };
      z.onend = () => {
        hoertZu = false;
        if (zustand === 'hoert' && !diktat) zustand = 'ruhe';
        if (weckwort || diktat) setTimeout(zuhoerenStarten, 400);
      };
      z.onerror = (ev: any) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          weckwort = false;
          diktat = false;
          schreiben('jarvis.weckwort', false);
          melden('Kein Zugriff aufs Mikrofon. Erlaube es im Browser und HTTPS ist nötig.', 'ausfall');
        }
      };
      return z;
    })();
    try {
      zuhoerer.start();
    } catch {
      // läuft bereits
    }
  }

  function zuhoerenPausieren() {
    try {
      zuhoerer?.stop();
    } catch {
      // egal
    }
    hoertZu = false;
  }

  function weckwortSchalten() {
    weckwort = !weckwort;
    schreiben('jarvis.weckwort', weckwort);
    if (weckwort) zuhoerenStarten();
    else if (!diktat) zuhoerenPausieren();
  }

  function mikro() {
    if (!spracheOk) return melden('Dieser Browser kann keine Spracherkennung. Chrome oder Safari probieren.', 'info');
    stumm();
    diktat = !diktat;
    if (diktat) {
      zustand = 'hoert';
      zuhoerenPausieren();
      setTimeout(zuhoerenStarten, 150);
    } else {
      zustand = 'ruhe';
      if (!weckwort) zuhoerenPausieren();
    }
  }

  function vorlesenSchalten() {
    vorlesen = !vorlesen;
    schreiben('jarvis.vorlesen', vorlesen);
    if (!vorlesen) stumm();
  }

  async function speichern(teil: Partial<Einstellung>) {
    try {
      einst = await api.put<Einstellung>('/api/m/jarvis/einstellungen', teil);
      status = await api.get<Status>('/api/m/jarvis/status');
      melden('Gespeichert', 'ok');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  let kacheln = $state<Record<string, any>>({});
  async function ladenKacheln() {
    try {
      const s = await api.get<{ kacheln?: Record<string, any> }>('/api/start');
      kacheln = s.kacheln ?? {};
    } catch {
      // HUD bleibt ohne Kacheln
    }
  }
  const kachelListe = $derived(
    Object.entries(kacheln)
      .filter(([k]) => k !== 'jarvis')
      .slice(0, 6),
  );

  let erinnerungen = $state<any[]>([]);

  onMount(() => {
    ladenStatus();
    ladenKacheln();
    if (spracheOk) speechSynthesis.getVoices();
    if (weckwort) zuhoerenStarten();
  });
  onDestroy(() => {
    weckwort = false;
    diktat = false;
    zuhoerenPausieren();
    if (spracheOk) speechSynthesis.cancel();
    abbruch?.abort();
  });
</script>

<ModulRahmen modulId="jarvis" tabs={['Jarvis', 'Gedächtnis', 'Einstellungen']} bind:tab>
  {#if tab === 'Jarvis'}
    <div class="jarvis">
      <section class="hud panel" aria-label="Jarvis Anzeige">
        <div class="kern {zustand}" aria-hidden="true">
          <span class="ring r1"></span>
          <span class="ring r2"></span>
          <span class="ring r3"></span>
          <span class="mitte"></span>
        </div>
        <div class="hudtext">
          <strong>Jarvis</strong>
          <span class="zustand">
            {#if zustand === 'hoert'}Ich höre zu{:else if zustand === 'denkt'}Ich überlege{:else if zustand === 'spricht'}Ich spreche{:else if status && !status.schluessel && !status.demo}Kein API Schlüssel{:else if weckwort}Wartet auf «Hey Jarvis»{:else}Bereit{/if}
          </span>
          {#if zwischen}<em class="zwischen">{zwischen}</em>{/if}
        </div>
        {#if status}
          <div class="masse">
            <span title="Tokens heute im Verhältnis zum Tageslimit">
              <i class="balken"><b style="width:{prozent}%"></b></i>
              {prozent}% Tageslimit
            </span>
            <span>{status.erinnerungen} Erinnerungen</span>
            <span>{VOLLMACHT_NAMEN[status.vollmacht] ?? status.vollmacht}</span>
            {#if status.demo}<span class="demo">Demo</span>{/if}
          </div>
        {/if}
        {#if kachelListe.length}
          <div class="kacheln">
            {#each kachelListe as [id, k]}
              <span class="kachel" title={id}>{k.titel ?? id}: <b>{k.wert ?? ''}</b></span>
            {/each}
          </div>
        {/if}
      </section>

      <section class="chat panel">
        <div class="kopf">
          <select
            aria-label="Gespräch wählen"
            value={gespraechId ?? ''}
            onchange={(e) => (e.currentTarget.value ? oeffnen(e.currentTarget.value) : neu())}
          >
            <option value="">Neues Gespräch</option>
            {#each gespraeche as g}<option value={g.id}>{g.titel}</option>{/each}
          </select>
          {#if gespraechId}
            {@const g = gespraeche.find((x) => x.id === gespraechId)}
            {#if g}<button onclick={() => loeschen(g)} aria-label="Gespräch löschen">Löschen</button>{/if}
          {/if}
        </div>

        <div class="verlauf" bind:this={verlaufEl} aria-live="polite">
          {#if !eintraege.length}
            <div class="leer">
              <p>Frag mich etwas oder gib mir eine Aufgabe. Ich habe Zugriff auf alle Daten im Hub und merke mir, was wichtig ist.</p>
              <div class="vorschlaege">
                {#each VORSCHLAEGE as v}
                  <button class="chip" onclick={() => (v.endsWith(': ') ? (eingabe = v) : senden(v))}>{v}</button>
                {/each}
              </div>
            </div>
          {/if}
          {#each eintraege as e}
            <div class="blase {e.rolle}">
              {#each e.schritte as s}
                <div class="schritt" class:fehler={s.ok === false}>
                  <span class="punkt" class:wartet={s.ok === undefined || !!s.bestaetigung}></span>
                  <span class="sname">{s.beschreibung}</span>
                  {#if s.entschieden}<span class="ende">{s.entschieden}</span>{/if}
                  {#if s.bestaetigung}
                    <span class="aktionen">
                      <button class="primaer" onclick={() => entscheiden(s, true)}>Ausführen</button>
                      <button onclick={() => entscheiden(s, false)}>Verwerfen</button>
                    </span>
                  {/if}
                </div>
              {/each}
              {#if e.text}<p>{e.text}</p>{:else if e.laeuft && !e.schritte.length}<p class="tippt"><i></i><i></i><i></i></p>{/if}
            </div>
          {/each}
        </div>

        <form class="eingabe" onsubmit={(ev) => { ev.preventDefault(); senden(); }}>
          <button type="button" class="knopf mikro" class:an={diktat} onclick={mikro} aria-label="Sprechen" title="Sprechen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
          <input
            class="wachsen"
            bind:value={eingabe}
            placeholder="Nachricht an Jarvis"
            maxlength="4000"
            aria-label="Nachricht an Jarvis"
            disabled={laeuft}
          />
          {#if laeuft}
            <button type="button" class="gefahr" onclick={stoppen}>Stopp</button>
          {:else}
            <button class="primaer" disabled={!eingabe.trim()}>Senden</button>
          {/if}
        </form>
        <div class="leiste">
          <label class="schalter">
            <input type="checkbox" checked={vorlesen} onchange={vorlesenSchalten} disabled={!spracheOk} />
            Antworten vorlesen
          </label>
          <label class="schalter">
            <input type="checkbox" checked={weckwort} onchange={weckwortSchalten} disabled={!spracheOk} />
            Weckwort «Hey Jarvis»
          </label>
          {#if sprichtGerade}<button class="chip" onclick={stumm}>Stumm</button>{/if}
        </div>
        {#if weckwort}
          <p class="hinweis">Das Weckwort funktioniert, solange diese Seite offen ist. Dafür braucht der Browser das Mikrofon und eine HTTPS Adresse.</p>
        {/if}
      </section>
    </div>
  {:else if tab === 'Gedächtnis'}
    <div class="stapel">
      <p class="hinweis">Das ist das zweite Gehirn von Jarvis. Er ergänzt es selbst, du kannst Erinnerungen hier prüfen, ändern oder löschen. Wichtigkeit 1 bis 5, höhere kommen immer ins Profil.</p>
      <TabellenEditor tabelle="jarvis_gedaechtnis" spalten={['kategorie', 'inhalt', 'wichtigkeit', 'quelle']} sort="-wichtigkeit" neuText="Erinnerung" bind:zeilen={erinnerungen} />
    </div>
  {:else}
    <div class="stapel">
      {#if !einst || !status}
        <div class="laedt">Lädt …</div>
      {:else}
        {#if !status.schluessel && !status.demo}
          <div class="panel warnung">
            Es ist noch kein Schlüssel hinterlegt. Trage <code>ANTHROPIC_API_KEY</code> in die <code>.env</code> auf dem Pi ein und starte den Hub neu.
          </div>
        {/if}
        <div class="panel form">
          <h3>Vollmacht</h3>
          <div class="optionen">
            {#each einst.vollmachten ?? [] as v}
              <label class="option" class:gewaehlt={einst.vollmacht === v}>
                <input type="radio" name="vollmacht" checked={einst.vollmacht === v} onchange={() => speichern({ vollmacht: v })} />
                <strong>{VOLLMACHT_NAMEN[v] ?? v}</strong>
                <span>{VOLLMACHT_HILFE[v] ?? ''}</span>
              </label>
            {/each}
          </div>
        </div>
        <div class="panel form">
          <h3>Verhalten</h3>
          <label>
            Persönlichkeit
            <select value={einst.persoenlichkeit} onchange={(e) => speichern({ persoenlichkeit: e.currentTarget.value })}>
              {#each einst.persoenlichkeiten ?? [] as p}<option value={p}>{PERS_NAMEN[p] ?? p}</option>{/each}
            </select>
          </label>
          <label>
            Modell
            <select value={einst.modell} onchange={(e) => speichern({ modell: e.currentTarget.value as 'standard' | 'schnell' })}>
              <option value="standard">Standard (klüger)</option>
              <option value="schnell">Schnell (günstiger)</option>
            </select>
          </label>
          <label>
            Tageslimit in Tokens
            <input type="number" min="10000" step="10000" value={einst.tageslimit} onchange={(e) => speichern({ tageslimit: Number(e.currentTarget.value) })} />
          </label>
          <label class="schalter">
            <input type="checkbox" checked={einst.web} onchange={(e) => speichern({ web: e.currentTarget.checked })} />
            Jarvis darf Webseiten lesen und im Web suchen
          </label>
          <label class="schalter">
            <input type="checkbox" checked={einst.morgenpush} onchange={(e) => speichern({ morgenpush: e.currentTarget.checked })} />
            Morgenbericht als Push um 07:10 Uhr
          </label>
        </div>
        <div class="panel form">
          <h3>Stand</h3>
          <p class="hinweis">Modell {status.modell}. {status.werkzeuge} Werkzeuge. Heute {status.tokensHeute.toLocaleString('de-CH')} von {status.tageslimit.toLocaleString('de-CH')} Tokens.</p>
        </div>
      {/if}
    </div>
  {/if}
</ModulRahmen>

<style>
  .jarvis {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(0, 1fr);
  }
  @media (min-width: 900px) {
    .jarvis {
      grid-template-columns: 300px minmax(0, 1fr);
      align-items: start;
    }
  }
  .panel {
    background: var(--flaeche);
    border: 1px solid var(--rand);
    border-radius: var(--radius);
    padding: 14px;
  }
  .hud {
    display: grid;
    gap: 12px;
    justify-items: center;
    text-align: center;
    background: radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--akzent) 12%, var(--flaeche)), var(--flaeche));
  }
  .kern {
    position: relative;
    width: 128px;
    height: 128px;
    display: grid;
    place-items: center;
  }
  .ring {
    position: absolute;
    border-radius: 50%;
    border: 2px solid var(--akzent);
    opacity: 0.8;
  }
  .r1 {
    inset: 0;
    border-style: dashed;
    animation: dreh 24s linear infinite;
  }
  .r2 {
    inset: 14px;
    border-color: var(--akzent-2);
    border-top-color: transparent;
    border-bottom-color: transparent;
    animation: dreh 9s linear infinite reverse;
  }
  .r3 {
    inset: 30px;
    border-width: 3px;
    animation: puls 3.2s ease-in-out infinite;
  }
  .mitte {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--akzent);
    box-shadow: 0 0 22px 6px color-mix(in srgb, var(--akzent) 60%, transparent);
    animation: puls 3.2s ease-in-out infinite;
  }
  .kern.hoert .mitte {
    background: var(--ok);
    box-shadow: 0 0 26px 8px color-mix(in srgb, var(--ok) 60%, transparent);
    animation-duration: 1.1s;
  }
  .kern.hoert .r3 {
    border-color: var(--ok);
    animation-duration: 1.1s;
  }
  .kern.denkt .r1 {
    animation-duration: 3s;
  }
  .kern.denkt .r2 {
    animation-duration: 1.6s;
  }
  .kern.spricht .mitte,
  .kern.spricht .r3 {
    animation-duration: 0.7s;
  }
  @keyframes dreh {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes puls {
    50% {
      transform: scale(1.15);
      opacity: 0.7;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring,
    .mitte {
      animation: none !important;
    }
  }
  .hudtext {
    display: grid;
    gap: 2px;
  }
  .zustand {
    color: var(--text-2);
    font-size: 0.9rem;
  }
  .zwischen {
    color: var(--akzent);
    font-size: 0.85rem;
  }
  .masse,
  .kacheln {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .masse span,
  .kachel {
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .kachel b {
    color: var(--text);
    font-weight: 600;
  }
  .demo {
    color: var(--warnung);
  }
  .balken {
    display: inline-block;
    width: 36px;
    height: 5px;
    background: var(--flaeche-3);
    border-radius: 3px;
    margin-right: 6px;
    vertical-align: middle;
    overflow: hidden;
  }
  .balken b {
    display: block;
    height: 100%;
    background: var(--akzent);
  }
  .chat {
    display: grid;
    gap: 10px;
    min-height: 60vh;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
  }
  .kopf {
    display: flex;
    gap: 8px;
  }
  .kopf select {
    flex: 1;
    min-width: 0;
  }
  .verlauf {
    overflow-y: auto;
    max-height: 62vh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px;
  }
  .leer {
    margin: auto;
    text-align: center;
    color: var(--text-2);
    display: grid;
    gap: 12px;
  }
  .vorschlaege {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }
  .chip {
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 0.85rem;
  }
  .blase {
    max-width: 88%;
    padding: 9px 13px;
    border-radius: 14px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
    display: grid;
    gap: 6px;
  }
  .blase p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .blase.user {
    align-self: flex-end;
    background: color-mix(in srgb, var(--akzent) 16%, var(--flaeche-2));
    border-color: color-mix(in srgb, var(--akzent) 40%, var(--rand));
  }
  .blase.assistant {
    align-self: flex-start;
  }
  .schritt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .schritt.fehler .sname {
    color: var(--ausfall);
  }
  .punkt {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }
  .schritt.fehler .punkt {
    background: var(--ausfall);
  }
  .punkt.wartet {
    background: var(--warnung);
  }
  .aktionen {
    display: flex;
    gap: 6px;
  }
  .aktionen button {
    padding: 3px 10px;
    font-size: 0.8rem;
  }
  .ende {
    color: var(--akzent);
  }
  .tippt {
    display: flex;
    gap: 4px;
  }
  .tippt i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-2);
    animation: puls 1s ease-in-out infinite;
  }
  .tippt i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .tippt i:nth-child(3) {
    animation-delay: 0.3s;
  }
  .eingabe {
    display: flex;
    gap: 8px;
  }
  .eingabe .wachsen {
    flex: 1;
    min-width: 0;
  }
  .mikro.an {
    background: var(--ok);
    color: #000;
  }
  .leiste {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: center;
    font-size: 0.85rem;
    color: var(--text-2);
  }
  .schalter {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .hinweis {
    color: var(--text-2);
    font-size: 0.85rem;
    margin: 0;
  }
  .stapel {
    display: grid;
    gap: 14px;
  }
  .form {
    display: grid;
    gap: 12px;
  }
  .form h3 {
    margin: 0;
  }
  .form label {
    display: grid;
    gap: 4px;
  }
  .form label.schalter {
    display: inline-flex;
  }
  .optionen {
    display: grid;
    gap: 8px;
  }
  .option {
    border: 1px solid var(--rand);
    border-radius: var(--radius);
    padding: 10px 12px;
    cursor: pointer;
    gap: 2px;
  }
  .option span {
    color: var(--text-2);
    font-size: 0.85rem;
  }
  .option input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .option.gewaehlt {
    border-color: var(--akzent);
    background: color-mix(in srgb, var(--akzent) 10%, var(--flaeche));
  }
  .option:focus-within {
    outline: 2px solid var(--akzent);
  }
  .warnung {
    border-color: var(--warnung);
  }
  .laedt {
    color: var(--text-2);
    padding: 20px;
  }
</style>
