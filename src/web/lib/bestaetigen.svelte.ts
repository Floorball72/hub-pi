// Bestätigungsdialog für Aktionen, die etwas verändern.
interface Anfrage {
  titel: string;
  text: string;
  knopf: string;
  gefahr: boolean;
  aufloesen: (ok: boolean) => void;
}

export const dialog = $state<{ offen: Anfrage | null }>({ offen: null });

export function bestaetigen(
  titel: string,
  text: string,
  knopf = 'Bestätigen',
  gefahr = false,
): Promise<boolean> {
  return new Promise((aufloesen) => {
    dialog.offen = { titel, text, knopf, gefahr, aufloesen };
  });
}

export function schliessen(ok: boolean) {
  dialog.offen?.aufloesen(ok);
  dialog.offen = null;
}
