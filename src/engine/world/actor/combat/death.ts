import { activeWorld } from '@engine/world';
import type { Actor } from '@engine/world/actor/actor';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { isNpc, isPlayer } from '@engine/world/actor/util';
import { World } from '@engine/world/world';

/**
 * Disengage every actor in the world whose `metadata.combatTarget` is
 * `dyingActor` by firing their `actionsCancelled` subject. Combined with the
 * `CombatTask` subscription to that subject, this terminates the combat loop
 * on the next tick boundary instead of waiting for the attacker's next
 * attack-speed tick (which could be up to 4 ticks away — that's the bug we
 * are fixing here).
 */
function disengageAttackers(dyingActor: Actor): void {
    for (const player of activeWorld.playerList) {
        if (!player) {
            continue;
        }
        if (player.metadata.combatTarget === dyingActor) {
            try {
                player.actionsCancelled.next('target-died' as never);
            } catch {
                /* ignore — observable may already be complete */
            }
        }
    }
    for (const npc of activeWorld.npcList) {
        if (!npc) {
            continue;
        }
        if (npc.metadata.combatTarget === dyingActor) {
            try {
                npc.actionsCancelled.next('target-died' as never);
            } catch {
                /* ignore — observable may already be complete */
            }
        }
    }
}

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
    // Disengage every actor in the world that was targeting the dying actor.
    // This is what makes combat stop INSTANTLY (next tick) instead of on the
    // attacker's next attack-speed interval. Works in both directions:
    // a dying player triggers NPCs to stop swinging, a dying NPC triggers the
    // player to stop swinging.
    disengageAttackers(target);

    // Clear any in-flight combat target on the dying actor.
    target.metadata.combatTarget = undefined;
    // Best-effort: cancel any pending actions on the target. `actionsCancelled`
    // is the legacy signal used elsewhere in the engine. CombatTask now
    // subscribes to this signal, so the dying actor's own combat loop (if any)
    // will terminate on the next tick.
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
