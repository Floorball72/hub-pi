// Manifest: alle Module des Hubs. Der Kern lädt sie in dieser Liste.
import type { ModulDef } from '../kern/modul.ts';
import { scont } from './scont/index.ts';
import { zentrale } from './zentrale/index.ts';

export const MODULE: ModulDef[] = [zentrale, scont];
