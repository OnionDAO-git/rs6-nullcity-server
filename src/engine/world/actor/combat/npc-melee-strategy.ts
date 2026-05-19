import { findNpc } from '@engine/config/config-handler';
import type { Actor } from '@engine/world/actor/actor';
import type { Npc } from '@engine/world/actor/npc';
import { DamageType } from '@engine/world/actor/update-flags';
import type { CombatStrategy } from './combat-strategy';
import { defenseRoll, meleeAttackRoll, meleeMaxHit, rollAccuracy, rollDamage } from './formulas';

/**
 * Build a melee strategy that mirrors how an NPC swings back at an attacker.
 *
 * Pulls accuracy/strength from `offensive_stats`, defence from `defensive_stats`,
 * and animation from `combatAnimations.attack` (first element if an array).
 *
 * NPCs do not award XP, so {@link CombatStrategy.xpAwards} returns an empty list.
 */
export function createNpcMeleeStrategy(npc: Npc): CombatStrategy {
    let details: ReturnType<typeof findNpc> | undefined;
    try {
        details = findNpc(npc.id);
    } catch {
        details = undefined;
    }

    const attackStat = Math.max(1, details?.offensiveStats?.attack ?? 1);
    const strengthStat = Math.max(1, details?.offensiveStats?.strength ?? 1);
    const attackBonus = 0;
    const strengthBonus = 0;

    const attackAnim = (() => {
        const raw = npc.animations?.attack;
        if (Array.isArray(raw)) {
            return raw[0];
        }
        return raw;
    })();

    return {
        kind: 'melee',
        attackRange: 1,
        attackSpeedTicks: 4,

        canActivate(): { ok: true } | { ok: false; reason: string } {
            return { ok: true };
        },

        consumeResources(): boolean {
            return true;
        },

        play(attacker: Actor): { hitDelay: number } {
            if (typeof attackAnim === 'number' && attackAnim > 0) {
                attacker.playAnimation(attackAnim);
            }
            return { hitDelay: 0 };
        },

        rollHit(attacker: Actor, defender: Actor): { damage: number; type: DamageType } {
            const atk = meleeAttackRoll({
                attackLevel: attackStat,
                styleBonus: 0,
                attackBonus,
            });
            const def = defenseRoll({
                defenseLevel: defender.skills.getLevel('defence'),
                styleBonus: 0,
                defenseBonus: defender.bonuses?.defensive?.crush ?? 0,
            });

            if (!rollAccuracy(atk, def)) {
                return { damage: 0, type: DamageType.NO_DAMAGE };
            }

            const max = meleeMaxHit({
                strengthLevel: strengthStat,
                styleBonus: 0,
                strengthBonus,
            });
            const damage = rollDamage(max);
            return {
                damage,
                type: damage > 0 ? DamageType.DAMAGE : DamageType.NO_DAMAGE,
            };
        },

        xpAwards(): { skill: never; exp: number }[] {
            return [];
        },
    } as CombatStrategy;
}

/**
 * Re-export type so callers can type their bindings without importing it
 * directly from `npc-config`.
 */
export type NpcMeleeStrategyOptions = {
    attackBonus?: number;
    strengthBonus?: number;
};
