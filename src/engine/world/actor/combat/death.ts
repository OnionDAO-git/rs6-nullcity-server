import type { Actor } from '@engine/world/actor/actor';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { isNpc, isPlayer } from '@engine/world/actor/util';
import { World } from '@engine/world/world';

/**
 * Death handler for an arbitrary {@link Actor}.
 *
 * For NPCs: emits the existing `'death'` event (which fires the drop logic
 * registered in `npc.ts`), then schedules `npc.kill(true)` after 3 ticks so the
 * death animation has time to play.
 *
 * For Players: delegates to `Player.handleDeath`.
 */
export function handleDeath(target: Actor, attacker: Actor): void {
    // Clear any in-flight combat target on the dying actor.
    target.metadata.combatTarget = undefined;
    // Best-effort: cancel any pending actions on the target. `actionsCancelled`
    // is the legacy signal used elsewhere in the engine.
    try {
        target.actionsCancelled.next('death' as never);
    } catch {
        /* ignore — observable may already be complete */
    }
    target.walkingQueue.clear();

    if (isNpc(target)) {
        const npc = target as Npc;

        // Trigger drops + death animation via the existing listener registered
        // in `npc.ts`. Listener signature is `processDeath(assailant, defender)`.
        npc.npcEvents.emit('death', attacker, npc);

        // Despawn + respawn after 3 ticks so the death anim can play.
        const deathDelayMs = 3 * World.TICK_LENGTH;
        setTimeout(() => {
            try {
                npc.kill(true);
            } catch {
                /* ignore — npc may already have been removed */
            }
        }, deathDelayMs);
        return;
    }

    if (isPlayer(target)) {
        (target as Player).handleDeath(attacker);
    }
}
