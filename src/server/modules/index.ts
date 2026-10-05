// Manifest: alle Module des Hubs. Der Kern lädt sie in dieser Liste.
import type { ModulDef } from '../kern/modul.ts';
import { analyse } from './analyse/index.ts';
import { smarthome } from './smarthome/index.ts';
import { aufgaben } from './aufgaben/index.ts';
import { finanzen } from './finanzen/index.ts';
import { auffaelligkeiten } from './auffaelligkeiten/index.ts';
import { abrufe } from './abrufe/index.ts';
import { abhaengigkeiten } from './abhaengigkeiten/index.ts';
import { aenderungen } from './aenderungen/index.ts';
import { content } from './content/index.ts';
import { dienste } from './dienste/index.ts';
import { drehwetter } from './drehwetter/index.ts';
import { drohne } from './drohne/index.ts';
import { events } from './events/index.ts';
import { mobilitaet } from './mobilitaet/index.ts';
import { parken } from './parken/index.ts';
import { rettung } from './rettung/index.ts';
import { scont } from './scont/index.ts';
import { selbstheilung } from './selbstheilung/index.ts';
import { sicherheit } from './sicherheit/index.ts';
import { swissunihockey } from './swissunihockey/index.ts';
import { veranstaltungen } from './veranstaltungen/index.ts';
import { teams } from './teams/index.ts';
import { updates } from './updates/index.ts';
import { unihockey } from './unihockey/index.ts';
import { wetter } from './wetter/index.ts';
import { zentrale } from './zentrale/index.ts';

export const MODULE: ModulDef[] = [
  zentrale,
  wetter,
  scont,
  rettung,
  drohne,
  drehwetter,
  events,
  content,
  veranstaltungen,
  parken,
  dienste,
  sicherheit,
  abhaengigkeiten,
  aenderungen,
  teams,
  abrufe,
  auffaelligkeiten,
  selbstheilung,
  updates,
  swissunihockey,
  unihockey,
  analyse,
  smarthome,
  aufgaben,
  finanzen,
  mobilitaet,
];
