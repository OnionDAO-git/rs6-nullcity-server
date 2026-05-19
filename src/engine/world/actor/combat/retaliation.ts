import type { Actor } from '@engine/world/actor/actor';
import type { Npc } from '@engine/world/actor/npc';
import { isNpc } from '@engine/world/actor/util';
import { CombatTask } from './combat-task';
import { createNpcMeleeStrategy } from './npc-melee-strategy';

/**
 * Engages a defender's retaliation against `attacker`.
 *
 * For NPC defenders, enqueues a new {@link CombatTask} using a melee strategy
 * derived from the NPC's offensive stats and combat animations.
 *
 * For Player defenders this is currently a no-op — v1 does not auto-retaliate
 * for players (see SPEC §13).
 *
 * If the defender is already engaged in combat (their `metadata.combatTarget`
 * is set and active), this function does nothing.
 */
export function engageRetaliation(defender: Actor, attacker: Actor): void {
    if (!defender || !attacker) {
        return;
    }

    // Already in combat? leave them alone.
    const existing = defender.metadata.combatTarget;
    if (existing) {
        return;
    }

    if (isNpc(defender)) {
        const npc = defender as Npc;
        const strategy = createNpcMeleeStrategy(npc);
        npc.enqueueBaseTask(new CombatTask(npc, attacker, strategy));
        return;
    }

    // Player defenders — no auto-retaliation in v1.
}
