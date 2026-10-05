// Offen Zustand der Befehlspalette, damit Knöpfe überall sie öffnen können.
export const palette = $state({ offen: false, eingabe: '' });

export function paletteOeffnen(eingabe = '') {
  palette.eingabe = eingabe;
  palette.offen = true;
}
