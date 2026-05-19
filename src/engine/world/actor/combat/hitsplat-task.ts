import { Task } from '@engine/task/task';
import type { Actor } from '@engine/world/actor/actor';
import type { Npc } from '@engine/world/actor/npc';
import { Skill } from '@engine/world/actor/skills';
import type { DamageType } from '@engine/world/actor/update-flags';
import { isNpc, isPlayer } from '@engine/world/actor/util';
import { animationIds } from '@engine/world/config/animation-ids';
import { logger } from '@runejs/common';
import { handleDeath } from './death';

/**
 * A one-shot task that lands a hit on a defender after `delay` ticks.
 *
 * Used by {@link Actor.applyHit} to model projectile travel time (ranged / magic).
 * For melee, `delay` is 0 and the task fires on the same tick it is enqueued.
 *
 * Spec deviation: the SPEC's quoted constructor signature in §4 was
 * `(target, damage, type, attacker)` but {@link Actor.applyHit} forwards a
 * `hitDelay` argument. We carry the delay explicitly so projectile/spell
 * travel time works end-to-end. The SPEC has been updated to reflect this.
 */
export class HitsplatTask extends Task {
    private readonly target: Actor;
    private readonly damage: number;
    private readonly type: DamageType;
    private readonly attacker: Actor;

    constructor(target: Actor, damage: number, type: DamageType, attacker: Actor, delay: number = 0) {
        super({
            interval: Math.max(1, delay),
            repeat: false,
            immediate: delay === 0,
        });

        this.target = target;
        this.damage = damage;
        this.type = type;
        this.attacker = attacker;
    }

    public execute(): void {
        try {
            this.executeInner();
        } catch (err) {
            logger.error(`HitsplatTask.execute crashed. ${(err as Error)?.stack ?? err}`);
        }
    }

    private executeInner(): void {
        const target = this.target;
        const skills = target.skills;

        const currentHp = skills.hitpoints.level;
        if (currentHp <= 0) {
            // Already dead — no double-tap.
            return;
        }

        const result = skills.damage(this.damage);
        const maxHp = skills.getMaxLevel('hitpoints');

        // Sync the new HP level to the client UI (HP orb / stats panel).
        // `Skills.damage` calls `setLevel` directly and does not push an
        // updateSkill packet — without this the client UI stays at full HP
        // even though the hitsplat displays the correct value.
        if (isPlayer(target)) {
            const hpValue = skills.get('hitpoints');
            target.outgoingPackets.updateSkill(Skill.HITPOINTS, result.remaining, hpValue.exp);
        }

        target.updateFlags.addDamage(this.damage, this.type, result.remaining, maxHp);

        // Defender block animation
        if (isNpc(target)) {
            const npc = target as Npc;
            const defendAnim = npc.animations?.defend ?? animationIds.combat.armBlock;
            target.playAnimation(defendAnim);
        } else {
            target.playAnimation(animationIds.combat.armBlock);
        }

        if (result.dead) {
            handleDeath(target, this.attacker);
        }
    }
}
