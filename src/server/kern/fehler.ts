// Fehler mit Meldung, die gefahrlos in der Oberfläche angezeigt werden darf.
export class HubFehler extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export function fehlerText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
