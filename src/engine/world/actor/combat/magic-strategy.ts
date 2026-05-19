import { findItem } from '@engine/config/config-handler';
import type { Actor } from '@engine/world/actor/actor';
import type { Spell } from '@engine/world/actor/magic';
import type { Player } from '@engine/world/actor/player/player';
import { DamageType } from '@engine/world/actor/update-flags';
import { World } from '@engine/world/world';
import { logger } from '@runejs/common';
import { defensiveStyleBonus } from './combat-data';
import type { CanActivateResult, CombatStrategy } from './combat-strategy';
import { magicDefenseRoll, magicAttackRoll, magicMaxHit, rollAccuracy, rollDamage } from './formulas';
import { applyCombatModifier, resolveCombatModifiers } from './modifiers';

/**
 * Number of ticks between the cast firing and the spell impacting the target.
 * Roughly mirrors projectile travel time used elsewhere (magic/ranged in v1).
 */
const MAGIC_HIT_DELAY_TICKS = 2;

/**
 * Resolve a spell rune's `item_key` to its in-game `gameId` once. We cache
 * resolutions on the strategy instance to avoid hitting `findItem(...)` on
 * every tick.
 */
interface ResolvedRune {
    itemKey: string;
    itemId: number;
    amount: number;
}

export function providedRuneKeys(player: Player): Set<string> {
    const equipped = player.getEquippedItem('main_hand');
    if (!equipped) {
        return new Set();
    }
    const item = findItem(equipped.itemId);
    const provided = item?.metadata?.provided_runes;
    return new Set(Array.isArray(provided) ? provided.filter((key): key is string => typeof key === 'string') : []);
}

export function runeCostAfterStaffSubstitution(runes: ResolvedRune[], providedRunes: ReadonlySet<string>): ResolvedRune[] {
    return runes.filter(rune => !providedRunes.has(rune.itemKey));
}

function resolveRunes(spell: Spell): ResolvedRune[] {
    const resolved: ResolvedRune[] = [];
    for (const rune of spell.runes) {
        const item = findItem(rune.item_key);
        if (!item) {
            logger.warn(`Spell "${spell.name}" references unknown rune item_key "${rune.item_key}".`);
            continue;
        }
        resolved.push({ itemKey: rune.item_key, itemId: item.gameId, amount: rune.amount });
    }
    return resolved;
}

/**
 * Build a magic CombatStrategy that lets `player` cast `spell` at a defender.
 *
 * The strategy:
 *   - validates magic level and rune inventory in `canActivate`
 *   - consumes runes in `consumeResources` (called before `play`, so a splash
 *     still drains runes per SPEC §7.2)
 *   - plays the cast animation + projectile in `play`
 *   - rolls accuracy/damage and schedules the impact/splash gfx on the
 *     defender to land on the same tick as the hit splat
 *   - returns XP awards (base xp on splash, base xp + damage scaling on hit)
 */
export function createPlayerMagicStrategy(player: Player, spell: Spell): CombatStrategy {
    const runes = resolveRunes(spell);

    const requiredRunes = (attacker: Actor): ResolvedRune[] => {
        return runeCostAfterStaffSubstitution(runes, providedRuneKeys(attacker as Player));
    };

    return {
        kind: 'magic',
        attackRange: 10,
        attackSpeedTicks: 5,

        canActivate(attacker: Actor): CanActivateResult {
            const magicLevel = attacker.skills.getLevel('magic');
            if (magicLevel < spell.level_required) {
                return {
                    ok: false,
                    reason: `You need a magic level of ${spell.level_required} to cast this spell.`,
                };
            }

            const inventory = (attacker as Player).inventory;
            if (!inventory) {
                // Non-Player castors aren't supported in v1; bail cleanly.
                return { ok: false, reason: 'You cannot cast that spell.' };
            }

            for (const rune of requiredRunes(attacker)) {
                if (inventory.amount(rune.itemId) < rune.amount) {
                    return {
                        ok: false,
                        reason: 'You do not have enough runes to cast this spell.',
                    };
                }
            }

            return { ok: true };
        },

        consumeResources(attacker: Actor): boolean {
            const inventory = (attacker as Player).inventory;
            if (!inventory) {
                return false;
            }

            for (const rune of requiredRunes(attacker)) {
                const slot = inventory.findIndex(rune.itemId);
                if (slot < 0) {
                    return false;
                }
                const current = inventory.amount(rune.itemId);
                const next = current - rune.amount;
                if (next < 0) {
                    return false;
                }
                if (next === 0) {
                    inventory.remove(slot);
                } else {
                    inventory.set(slot, { itemId: rune.itemId, amount: next });
                }
            }

            // Refresh inventory widget for the player so the rune counter ticks down.
            if ((attacker as Player).outgoingPackets) {
                const player = attacker as Player;
                // `widgets.inventory` is the standard inventory widget; the
                // `containerUpdated` subscription on Player already calls
                // `sendUpdateAllWidgetItems`, but the direct mutations above
                // bypass that subject, so we re-send explicitly here.
                try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { widgets } = require('@engine/config/config-handler');
                    player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
                } catch {
                    // best-effort UI refresh; combat shouldn't fail because of it.
                }
            }

            return true;
        },

        play(attacker: Actor, defender: Actor): { hitDelay: number } {
            attacker.playAnimation(spell.cast_anim);

            const attackerX = attacker.position.x;
            const attackerY = attacker.position.y;
            const victimX = defender.position.x;
            const victimY = defender.position.y;
            // Match the offset convention used by the original magic-attack
            // plugin: offsetX = victimY - attackerY, offsetY = victimX - attackerX.
            const offsetX = victimY - attackerY;
            const offsetY = victimX - attackerX;

            // Players have outgoingPackets; NPCs do not. v1 only fires magic from
            // a player so we only need this branch.
            if ((attacker as Player).outgoingPackets) {
                (attacker as Player).outgoingPackets.sendProjectile(
                    attacker.position,
                    offsetX,
                    offsetY,
                    spell.projectile_id,
                    40,
                    36,
                    100,
                    defender.worldIndex + 1,
                    11,
                );
            }

            return { hitDelay: MAGIC_HIT_DELAY_TICKS };
        },

        rollHit(attacker: Actor, defender: Actor): { damage: number; type: DamageType } {
            const attackerModifiers = resolveCombatModifiers(attacker);
            const defenderModifiers = resolveCombatModifiers(defender);
            const magicLevel = applyCombatModifier(attacker.skills.getLevel('magic'), attackerModifiers.magic);
            const magicBonus = attacker.bonuses?.offensive?.magic ?? 0;

            const atk = magicAttackRoll({ magicLevel, magicBonus });
            const def = magicDefenseRoll({
                magicLevel: applyCombatModifier(defender.skills.getLevel('magic'), defenderModifiers.magic),
                defenseLevel: applyCombatModifier(defender.skills.getLevel('defence'), defenderModifiers.defence),
                styleBonus: defensiveStyleBonus(defender),
                magicDefenseBonus: defender.bonuses?.defensive?.magic ?? 0,
            });

            const hit = rollAccuracy(atk, def);

            // Schedule the on-target graphic so it lands at the same time as
            // the hit splat (which itself is delayed by MAGIC_HIT_DELAY_TICKS
            // in `play`). We use a real-time timer here rather than the task
            // scheduler to keep this strategy stateless.
            const gfxId = hit ? spell.impact_gfx : spell.splash_gfx;
            const gfxDelayMs = MAGIC_HIT_DELAY_TICKS * World.TICK_LENGTH;
            setTimeout(() => {
                try {
                    defender.playGraphics({ id: gfxId, height: 100, delay: 0 });
                } catch {
                    // defender may have been destroyed between cast and impact.
                }
            }, gfxDelayMs);

            if (!hit) {
                return { damage: 0, type: DamageType.NO_DAMAGE };
            }

            const max = magicMaxHit(spell.base_damage, magicBonus);
            const damage = rollDamage(max);
            return {
                damage,
                type: damage > 0 ? DamageType.DAMAGE : DamageType.NO_DAMAGE,
            };
        },

        xpAwards(damage: number) {
            if (damage > 0) {
                return [
                    { skill: 'magic' as const, exp: spell.base_xp + damage * 2 },
                    { skill: 'hitpoints' as const, exp: damage * 1.33 },
                ];
            }
            // Splash / 0-damage hit still grants the base magic xp.
            return [{ skill: 'magic' as const, exp: spell.base_xp }];
        },
    };
}
