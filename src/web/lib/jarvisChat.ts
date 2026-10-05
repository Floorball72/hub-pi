// Gemeinsamer Chat Client für die Jarvis Seite und die Leiste: POST und Server Sent Events lesen.
export interface JarvisEreignis {
  art: 'gespraech' | 'text' | 'werkzeug' | 'ergebnis' | 'bestaetigung' | 'navigation' | 'fertig' | 'fehler';
  [schluessel: string]: unknown;
}

export async function jarvisChat(
  nachricht: string,
  gespraechId: string | undefined,
  signal: AbortSignal | undefined,
  beiEreignis: (e: JarvisEreignis) => void,
): Promise<void> {
  const r = await fetch('/api/m/jarvis/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-pihub': '1' },
    body: JSON.stringify({ nachricht, gespraechId }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => null))?.fehler ?? `Fehler ${r.status}`);
  const leser = r.body.getReader();
  const dec = new TextDecoder();
  let rest = '';
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    rest += dec.decode(value, { stream: true });
    let i = rest.indexOf('\n\n');
    while (i >= 0) {
      const zeile = rest.slice(0, i);
      rest = rest.slice(i + 2);
      if (zeile.startsWith('data:')) {
        try {
          beiEreignis(JSON.parse(zeile.slice(5)));
        } catch {
          // kaputte Zeile überspringen
        }
      }
      i = rest.indexOf('\n\n');
    }
  }
}
