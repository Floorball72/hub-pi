// Manifest: alle Module des Hubs. Der Kern lädt sie in dieser Liste.
import type { ModulDef } from '../kern/modul.ts';
import { drohne } from './drohne/index.ts';
import { scont } from './scont/index.ts';
import { wetter } from './wetter/index.ts';
import { zentrale } from './zentrale/index.ts';

export const MODULE: ModulDef[] = [zentrale, wetter, scont, drohne];
