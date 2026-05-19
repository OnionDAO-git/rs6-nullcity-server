import type { Actor } from './actor';
import type { Npc } from './npc';
import type { Player } from './player/player';
import type { Resident } from './resident/resident';

const RESIDENT_BRAND = Symbol.for('nullcity.resident');

export const isPlayer = (actor: Actor): actor is Player => actor.type === 'player';
export const isNpc = (actor: Actor): actor is Npc => actor.type === 'npc';
export const isResident = (actor: Actor): actor is Resident => isPlayer(actor) && Boolean((actor as any)[RESIDENT_BRAND]);
