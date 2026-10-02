// Erzeugt einen Passwort Hash für ADMIN_PASSWORT_HASH. Aufruf: npm run passwort
import { createInterface } from 'node:readline/promises';
import { passwortHash } from '../src/server/kern/auth.ts';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const pw = await rl.question('Neues Passwort (mindestens 10 Zeichen): ');
rl.close();
if (pw.length < 10) {
  console.error('Zu kurz.');
  process.exit(1);
}
console.log(`\nIn die .env eintragen:\nADMIN_PASSWORT_HASH=${passwortHash(pw)}`);
