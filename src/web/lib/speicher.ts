// Kleine Einstellungen im Browser (Fokusmodus, Kiosk, Kartenauswahl als Rückfall).
export function lesen<T>(schluessel: string, standard: T): T {
  try {
    const w = localStorage.getItem(`pihub.${schluessel}`);
    return w === null ? standard : (JSON.parse(w) as T);
  } catch {
    return standard;
  }
}

export function schreiben(schluessel: string, wert: unknown) {
  try {
    localStorage.setItem(`pihub.${schluessel}`, JSON.stringify(wert));
  } catch {
    // privat oder voll
  }
}
