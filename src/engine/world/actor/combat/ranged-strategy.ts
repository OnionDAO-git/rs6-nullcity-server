import { findItem, findNpc } from '@engine/config/config-handler';
import { equipmentIndex } from '@engine/config/item-config';
import type { EquipmentSlot, ItemDetails, WeaponInfo, WeaponStyle } from '@engine/config/item-config';
import type { Actor } from '@engine/world/actor/actor';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { DamageType } from '@engine/world/actor/update-flags';
import { isNpc, isPlayer } from '@engine/world/actor/util';
import type { Item } from '@engine/world/items/item';
import {
    ammoIsCompatible,
    defensiveStyleBonus,
    rangedXpAwards,
    selectedCombatStyle,
    weaponAttackRange,
    weaponAttackSpeed,
} from './combat-data';
import type { CombatStrategy } from './combat-strategy';
import { defenseRoll, rangedAttackRoll, rangedMaxHit, rollAccuracy, rollDamage } from './formulas';
import { applyCombatModifier, resolveCombatModifiers } from './modifiers';

/**
 * Ranged weapon style families this strategy handles. We treat all four with
 * the same projectile pipeline; range and attack-speed tables live below.
 */
type RangedStyle = 'bow' | 'crossbow' | 'darts' | 'gun';

const RANGED_STYLES: ReadonlySet<WeaponStyle> = new Set<WeaponStyle>(['bow', 'crossbow', 'darts', 'gun']);

/** Tiles within which a ranged attack can fire. */
const RANGE_BY_STYLE: Record<RangedStyle, number> = {
    bow: 7,
    crossbow: 7,
    darts: 4,
    gun: 7,
};

/** Ticks between consecutive attacks. */
const ATTACK_SPEED_BY_STYLE: Record<RangedStyle, number> = {
    bow: 4,
    crossbow: 5,
    darts: 3,
    gun: 4,
};

/**
 * Default projectile graphic ids if the bow's config omits `projectile_id`.
 * Bronze arrow (10) for bows, bronze bolt (27) for crossbows / guns,
 * and a generic dart fallback for darts.
 */
const DEFAULT_PROJECTILE_BY_STYLE: Record<RangedStyle, number> = {
    bow: 10,
    crossbow: 27,
    darts: 220,
    gun: 27,
};

/** Bow firing animation. Crossbow uses a different draw. */
const ANIM_DRAW_BOW = 426;
const ANIM_DRAW_CROSSBOW = 427;

interface RangedWeaponBinding {
    style: RangedStyle;
    weaponItem: ItemDetails;
    weaponInfo: WeaponInfo;
    /** Slot the consumed projectile lives in: quiver for bow/crossbow/gun, main_hand for darts. */
    ammoSlot: EquipmentSlot;
    /** Projectile graphic id to send on each fired attack. */
    projectileId: number;
}

/**
 * Read the equipped main-hand weapon and, if it's ranged, package up everything
 * the strategy needs to fire. Returns null for non-ranged or unequipped.
 */
function readRangedWeapon(player: Player): RangedWeaponBinding | null {
    const mainHand = player.getEquippedItem('main_hand');
    if (!mainHand) {
        return null;
    }

    const weaponItem = findItem(mainHand.itemId);
    if (!weaponItem) {
        return null;
    }

    const weaponInfo = weaponItem.equipmentData?.weaponInfo;
    if (!weaponInfo) {
        return null;
    }

    if (!RANGED_STYLES.has(weaponInfo.style)) {
        return null;
    }

    const style = weaponInfo.style as RangedStyle;
    const projectileId = typeof weaponInfo.projectile_id === 'number' ? weaponInfo.projectile_id : DEFAULT_PROJECTILE_BY_STYLE[style];

    return {
        style,
        weaponItem,
        weaponInfo,
        ammoSlot: style === 'darts' ? 'main_hand' : 'quiver',
        projectileId,
    };
}

/**
 * Build a ranged combat strategy for `player`. Returns `null` if the player
 * doesn't have a ranged weapon equipped — the dispatcher should fall back to
 * melee in that case.
 */
export function createPlayerRangedStrategy(player: Player): CombatStrategy | null {
    const binding = readRangedWeapon(player);
    if (!binding) {
        return null;
    }

    const { style, weaponInfo, ammoSlot, weaponItem } = binding;
    const attackAnim = style === 'crossbow' ? ANIM_DRAW_CROSSBOW : ANIM_DRAW_BOW;
    const selectedStyle = selectedCombatStyle(player, style);
    const baseAttackSpeed = weaponAttackSpeed(weaponItem, ATTACK_SPEED_BY_STYLE[style]);
    const attackSpeedTicks = Math.max(1, baseAttackSpeed + (selectedStyle?.speed_modifier ?? 0));

    /**
     * Read the current ammo item for this binding (re-read each tick — the
     * player could swap quivers mid-combat).
     */
    const readAmmoItem = (attacker: Actor): Item | null => {
        if (!isPlayer(attacker)) {
            return null;
        }
        return (attacker as Player).getEquippedItem(ammoSlot);
    };

    const readAmmoDetails = (ammoItem: Item | null): ItemDetails | null => {
        if (!ammoItem) {
            return null;
        }
        return findItem(ammoItem.itemId);
    };

    const readProjectileId = (attacker: Actor): number => {
        const ammoProjectile = readAmmoDetails(readAmmoItem(attacker))?.equipmentData?.weaponInfo?.projectile_id;
        if (typeof ammoProjectile === 'number') {
            return ammoProjectile;
        }
        const weaponProjectile = isPlayer(attacker) ? readRangedWeapon(attacker as Player)?.projectileId : binding.projectileId;
        return weaponProjectile ?? DEFAULT_PROJECTILE_BY_STYLE[style];
    };

    /**
     * Check that the ammo present in `ammoSlot` is acceptable for this weapon.
     * For darts, the ammo IS the weapon itself, so this always passes if
     * main_hand is populated (which it must be — the binding wouldn't exist
     * otherwise on this tick).
     */
    const equippedAmmoIsCompatible = (ammoDetails: ItemDetails | null): boolean => {
        if (!ammoDetails) {
            return false;
        }
        return ammoIsCompatible(weaponInfo.ammo_type, ammoDetails.equipmentData?.weaponInfo?.ammo_type, style === 'darts');
    };

    return {
        kind: 'ranged',
        attackRange: weaponAttackRange(weaponItem, RANGE_BY_STYLE[style]),
        attackSpeedTicks,

        canActivate(attacker: Actor): { ok: true } | { ok: false; reason: string } {
            // Defensive: the factory only returns a strategy when a ranged weapon
            // is equipped, but the player could unequip mid-combat.
            const liveBinding = isPlayer(attacker) ? readRangedWeapon(attacker as Player) : null;
            if (!liveBinding || liveBinding.style !== style) {
                return { ok: false, reason: 'You have no ranged weapon equipped.' };
            }

            const ammoItem = readAmmoItem(attacker);
            if (!ammoItem || ammoItem.amount <= 0) {
                return { ok: false, reason: 'You have no ammo equipped.' };
            }

            const ammoDetails = readAmmoDetails(ammoItem);
            if (!equippedAmmoIsCompatible(ammoDetails)) {
                return { ok: false, reason: "You can't use that ammo with your weapon." };
            }

            return { ok: true };
        },

        consumeResources(attacker: Actor): boolean {
            if (!isPlayer(attacker)) {
                return true;
            }
            const player = attacker as Player;
            const slotIndex = equipmentIndex(ammoSlot);
            const ammoItem = player.equipment.items[slotIndex];
            if (!ammoItem || ammoItem.amount <= 0) {
                return false;
            }

            if (ammoItem.amount > 1) {
                player.equipment.set(slotIndex, { itemId: ammoItem.itemId, amount: ammoItem.amount - 1 });
            } else {
                player.equipment.remove(slotIndex);
            }
            // Refresh the equipment widget + bonuses panel for the player.
            player.equipmentChanged();
            return true;
        },

        play(attacker: Actor, defender: Actor): { hitDelay: number } {
            if (attackAnim > 0) {
                attacker.playAnimation(attackAnim);
            }
            if (!isPlayer(attacker)) {
                return { hitDelay: 2 };
            }
            const player = attacker as Player;

            // Coords follow the same `victimY - attackerY`, `victimX - attackerX`
            // pattern as `magic-attack.plugin.ts`. The lockon target id for an
            // NPC is `worldIndex + 1`; for a player target it's `-(worldIndex + 1)`.
            const attackerX = player.position.x;
            const attackerY = player.position.y;
            const victimX = defender.position.x;
            const victimY = defender.position.y;
            const offsetX = victimY - attackerY;
            const offsetY = victimX - attackerX;
            const lockon = isNpc(defender) ? defender.worldIndex + 1 : -(defender.worldIndex + 1);

            // startHeight 40, endHeight 36, speed 100, delay 11 ticks — mirrors
            // the existing magic projectile defaults until per-style tuning lands.
            player.outgoingPackets.sendProjectile(player.position, offsetX, offsetY, readProjectileId(attacker), 40, 36, 100, lockon, 11);

            return { hitDelay: 2 };
        },

        rollHit(attacker: Actor, defender: Actor): { damage: number; type: DamageType } {
            const attackerModifiers = resolveCombatModifiers(attacker);
            const defenderModifiers = resolveCombatModifiers(defender);
            const rangedLevel = applyCombatModifier(attacker.skills.getLevel('ranged'), attackerModifiers.ranged);
            const attackBonus = attacker.bonuses?.offensive?.ranged ?? 0;
            const liveStyle = isPlayer(attacker) ? selectedCombatStyle(attacker as Player, style) : selectedStyle;
            const rangedStyleBonus = liveStyle?.stance === 'accurate' ? 3 : 0;

            // Ranged strength comes from the ammo, not the weapon. Darts roll on
            // the equipped weapon's own ranged_strength field.
            const ammoItem = readAmmoItem(attacker);
            const ammoDetails = readAmmoDetails(ammoItem);
            const strengthBonus = ammoDetails?.equipmentData?.offensiveBonuses?.ranged_strength ?? 0;

            const atk = rangedAttackRoll({
                rangedLevel,
                styleBonus: rangedStyleBonus,
                attackBonus,
            });

            // Defender defence + ranged-defensive bonus. NPCs fall back to their
            // configured defensive_stats.ranged; players use their bonuses panel.
            let defenseBonus = defender.bonuses?.defensive?.ranged ?? 0;
            if (isNpc(defender)) {
                try {
                    const details = findNpc((defender as Npc).id);
                    if (details?.defensiveStats?.ranged != null) {
                        defenseBonus = details.defensiveStats.ranged;
                    }
                } catch {
                    // ignore — fall back to zero / actor bonus
                }
            }

            const def = defenseRoll({
                defenseLevel: applyCombatModifier(defender.skills.getLevel('defence'), defenderModifiers.defence),
                styleBonus: defensiveStyleBonus(defender),
                defenseBonus,
            });

            if (!rollAccuracy(atk, def)) {
                return { damage: 0, type: DamageType.NO_DAMAGE };
            }

            const max = rangedMaxHit({
                rangedLevel,
                styleBonus: rangedStyleBonus,
                strengthBonus,
            });
            const damage = rollDamage(max);
            return {
                damage,
                type: damage > 0 ? DamageType.DAMAGE : DamageType.NO_DAMAGE,
            };
        },

        xpAwards(damage: number) {
            if (damage <= 0) {
                return [];
            }
            return rangedXpAwards(damage, selectedCombatStyle(player, style));
        },
    };
}
