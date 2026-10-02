// Kurze Rückmeldungen unten am Bildschirm.
export const meldungen = $state<{ liste: { id: number; text: string; art: 'ok' | 'ausfall' | 'info' }[] }>({
  liste: [],
});
let zaehler = 0;

export function melden(text: string, art: 'ok' | 'ausfall' | 'info' = 'ok') {
  const id = ++zaehler;
  meldungen.liste.push({ id, text, art });
  setTimeout(() => {
    meldungen.liste = meldungen.liste.filter((m) => m.id !== id);
  }, 4000);
}
