import { Task } from '@engine/task/task';
import { TaskStackType } from '@engine/task/types';
import type { Actor } from '@engine/world/actor/actor';
import type { Player } from '@engine/world/actor/player/player';
import { isPlayer } from '@engine/world/actor/util';
import type { CombatStrategy } from './combat-strategy';
import { engageRetaliation } from './retaliation';

/**
 * The shared per-tick combat loop.
 *
 * Each tick this task:
 *   1. Validates that attacker and defender are still alive and in the world.
 *   2. If out of attack-range but within tracking-range (16 tiles) the
 *      attacker is walked toward the defender.
 *   3. Otherwise the strategy is invoked to play animations, roll a hit,
 *      apply damage (deferred for projectile travel), and route XP.
 *   4. The defender is engaged for retaliation.
 *
 * Lifecycle contract for downstream plugins:
 *   - This task SETS `attacker.metadata.combatTarget = defender` in its
 *     constructor, and CLEARS it on `stop()`/`onStop()`.
 *   - Plugins SHOULD NOT mutate `metadata.combatTarget` themselves.
 *
 * Stack semantics: this task uses {@link TaskStackType.NEVER} so a fresh
 * attack order cancels any in-flight combat task on the same actor.
 */
export class CombatTask extends Task {
    constructor(
        private readonly attacker: Actor,
        private readonly defender: Actor,
        private readonly strategy: CombatStrategy,
    ) {
        super({
            interval: strategy.attackSpeedTicks,
            repeat: true,
            immediate: true,
            stackType: TaskStackType.NEVER,
        });

        attacker.metadata.combatTarget = defender;
    }

    /**
     * Called by {@link Task.stop} on every termination path. Clears the
     * combat-target flag so retaliation / aggression scans see this actor
     * as idle on the next tick.
     */
    public onStop(): void {
        if (this.attacker.metadata.combatTarget === this.defender) {
            this.attacker.metadata.combatTarget = undefined;
        }
    }

    public execute(): void {
        const attacker = this.attacker;
        const defender = this.defender;

        // 1. liveness checks
        if (!attacker || !defender) {
            this.stop();
            return;
        }
        if ((attacker as any).active === false || (defender as any).active === false) {
            this.stop();
            return;
        }
        if (attacker.skills.hitpoints.level <= 0 || defender.skills.hitpoints.level <= 0) {
            this.stop();
            return;
        }
        if (attacker.position.level !== defender.position.level) {
            this.stop();
            return;
        }

        const distance = Math.floor(attacker.position.distanceBetween(defender.position));

        // 2. way too far → drop combat entirely
        if (distance > 16) {
            this.stop();
            return;
        }

        // 3. out of attack range — walk toward defender, don't attack this tick
        if (distance > this.strategy.attackRange) {
            attacker.pathfinding.walkTo(defender.position, {
                pathingSearchRadius: 5,
                ignoreDestination: true,
            });
            return;
        }

        // 4. in range — face, stop, validate, attack
        attacker.face(defender, false, false, false);
        attacker.walkingQueue.clear();

        const canActivate = this.strategy.canActivate(attacker, defender);
        if (!canActivate.ok) {
            if (isPlayer(attacker)) {
                (attacker as Player).outgoingPackets.chatboxMessage(canActivate.reason);
            }
            this.stop();
            return;
        }

        if (!this.strategy.consumeResources(attacker)) {
            this.stop();
            return;
        }

        const { hitDelay } = this.strategy.play(attacker, defender);
        const { damage, type } = this.strategy.rollHit(attacker, defender);

        attacker.applyHit(defender, damage, type, hitDelay);

        // XP awards — only routed for Player attackers.
        if (isPlayer(attacker)) {
            const player = attacker as Player;
            const awards = this.strategy.xpAwards(damage);
            for (const award of awards) {
                if (award.exp > 0) {
                    player.skills.addExp(award.skill, award.exp);
                }
            }
        }

        // 5. engage retaliation on the defender
        engageRetaliation(defender, attacker);
    }
}
