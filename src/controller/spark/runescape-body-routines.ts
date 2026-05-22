/**
 * RuneScape body-routine action helpers (Plan R-β extraction).
 *
 * Hosts the deterministic per-tick action selection functions extracted from
 * `src/controller/thinking/hybrid-agent-thinking-module.ts`. These are pure
 * functions of `(perception, ...)` → `AgentAction | undefined`; they are the
 * Body half of the Brain/Body/Nervous decomposition documented in
 * `docs/superpowers/specs/2026-05-22-spark-module-extraction-design.md`.
 *
 * Per the SPARK module extraction spec (Plan β): each helper is moved
 * verbatim from the monolith — no semantic edits. The accompanying test
 * suite is the contract. Action helpers extracted here continue to be
 * imported back into the monolith until the orchestrator slim-down (Plan ε).
 *
 * Shared primitives (`distance`, `findSlot`, etc.) live here too — they
 * have no callers outside the Body unit's needs, and centralizing them
 * avoids the monolith re-defining them.
 */

import { objectIds } from '@engine/world/config/object-ids';
import type { AgentAction } from '../transport/message-codecs';
import {
    HUMAN_BONE_SOURCE_PATTERN,
    LOW_RISK_BONE_SOURCE_PATTERN,
    MEDIUM_RISK_BONE_SOURCE_PATTERN,
    hasSmallFishingNet,
    hasWoodcuttingAxe,
    isBones,
    isFiremakingLog,
    isFishingSpot,
    isSafeBoneSource,
    isStarterRawFish,
    isTinderbox,
} from './runescape-workflows';

// --- Shared structural types matching the monolith's local definitions. ---

/** Position type — matches monolith's local `Pos`. */
export type BodyPos = { x: number; y: number; level: number };

/** Inventory item — matches monolith's local `Item`. */
export type BodyItem = { itemId: number; key?: string; amount: number };

/** Ground-world item — matches monolith's local `WorldItem`. */
export type BodyWorldItem = BodyItem & { position: BodyPos; ownerId?: string };

/** Actor (player / npc / resident) — matches monolith's local `Actor`. */
export type BodyActor = {
    id: string;
    kind: 'player' | 'npc' | 'resident';
    name?: string;
    key?: string;
    position: BodyPos;
    hpFraction?: number;
};

/** Perception bundle — matches monolith's local `HybridPerception` shape (subset used by body routines). */
export type BodyHybridPerception = {
    tick?: number;
    resident?: {
        id?: string;
        position?: BodyPos;
        hp?: { current?: number; max?: number };
        inCombat?: boolean;
        combatTarget?: BodyActor | null;
        busy?: boolean;
        inventory?: Array<BodyItem | null>;
    };
    nearby?: {
        players?: BodyActor[];
        npcs?: BodyActor[];
        worldItems?: BodyWorldItem[];
        objects?: Array<{ objectId: number; position: BodyPos; orientation?: number }>;
    };
    events?: Array<Record<string, unknown>>;
};

// --- Constants moved verbatim from the monolith. ---

/** Grid range within which an actor counts as "adjacent" for body-routine interactions. */
export const INTERACTION_APPROACH_RADIUS = 1;

/** Object IDs that count as a nearby fire suppressing repeated firemaking. */
export const FIRE_OBJECT_IDS: ReadonlySet<number> = new Set([objectIds.fire]);

/** Object IDs for level-1 tree species the woodcutting routine may chop. */
export const LEVEL_ONE_TREE_IDS: ReadonlySet<number> = new Set([
    ...objectIds.tree.normal.map(tree => tree.default),
    ...objectIds.tree.dead.map(tree => tree.default),
]);

/** Object IDs that can be used as cooking heat sources by the fishing routine. */
export const COOKING_HEAT_OBJECT_IDS: ReadonlySet<number> = new Set([
    objectIds.fire,
    114,
    2728,
    2729,
    2730,
    2731,
    2859,
    4172,
    9682,
]);

/** Max number of inventory slots considered "free" by the pickup routine. */
export const MAX_INVENTORY_SLOTS = 28;

/** Ticks before a pickup target is considered eligible again after a recent attempt. */
export const PICKUP_TARGET_COOLDOWN_TICKS = 120;

/** Item IDs treated as coins by the pickup routine. */
export const COIN_ITEM_IDS: ReadonlySet<number> = new Set([995]);

/** Item-key pattern matched against food-shaped ground items by the pickup routine. */
export const FOOD_KEY_PATTERN =
    /(food|shrimp|anchovies|sardine|herring|trout|salmon|tuna|lobster|bass|swordfish|monkfish|shark|manta|karambwan|bread|cake|meat|chicken)/i;

/** Range (in tiles) within which a prayer-training waypoint is considered reached. */
export const PRAYER_TRAINING_WAYPOINT_RANGE = 6;

/** Fixed waypoints the prayer/combat routines walk between when no safe target is in sight. */
export const PRAYER_TRAINING_WAYPOINTS: ReadonlyArray<BodyPos> = [
    { x: 3222, y: 3218, level: 0 },
    { x: 3249, y: 3238, level: 0 },
];

// --- Shared primitive helpers (moved verbatim from the monolith). ---

/**
 * Chebyshev distance — matches the monolith's `distance(a, b)` helper.
 * Body routines compare grid distances using max(|dx|, |dy|).
 */
export function distance(a: BodyPos, b: BodyPos): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Linear inventory scan returning the first slot index whose contents
 * match the predicate. Mirrors the monolith's `findSlot` helper.
 */
export function findSlot(items: Array<BodyItem | null>, predicate: (item: BodyItem) => boolean): number | undefined {
    for (let i = 0; i < items.length; i += 1) {
        const candidate = items[i];
        if (candidate && predicate(candidate)) {
            return i;
        }
    }
    return undefined;
}

/**
 * Returns a shallow clone of the action with its `cause` rewritten.
 * Mirrors the monolith's `actionWithCause` helper.
 */
export function actionWithCause(action: AgentAction, cause: string): AgentAction {
    return { ...action, cause };
}

/**
 * True when there is a fire object within Chebyshev distance 1 of the
 * resident's current position. Mirrors the monolith helper.
 */
export function hasNearbyFire(perception: BodyHybridPerception): boolean {
    const here = perception.resident?.position;
    if (!here) {
        return false;
    }
    return (perception.nearby?.objects || []).some(
        object => FIRE_OBJECT_IDS.has(object.objectId) && distance(here, object.position) <= 1,
    );
}

// --- Body-routine action helpers (moved verbatim from the monolith). ---

/**
 * Use the tinderbox on logs from inventory unless a fire is already nearby.
 * Moved verbatim from `hybrid-agent-thinking-module.ts` (R-β).
 */
export function firemakingAction(perception: BodyHybridPerception): AgentAction | undefined {
    if (hasNearbyFire(perception)) {
        return undefined;
    }

    const inventory = perception.resident?.inventory || [];
    const tinderboxSlot = findSlot(inventory, isTinderbox);
    const logSlot = findSlot(inventory, isFiremakingLog);
    if (tinderboxSlot !== undefined && logSlot !== undefined) {
        return { kind: 'use_item_on_item', itemSlot: tinderboxSlot, targetSlot: logSlot, cause: 'firemaking_fallback' };
    }

    return undefined;
}

/**
 * Approach and chop the nearest level-1 tree when the resident is carrying
 * a woodcutting axe. Moved verbatim from the monolith (R-β slice 2).
 */
export function levelOneWoodcuttingAction(perception: BodyHybridPerception): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }
    if (!hasWoodcuttingAxe(perception)) {
        return undefined;
    }

    const target = (perception.nearby?.objects || [])
        .filter(object => LEVEL_ONE_TREE_IDS.has(object.objectId))
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (!target) {
        return undefined;
    }

    if (distance(here, target.position) > INTERACTION_APPROACH_RADIUS) {
        return { kind: 'move_to', target: target.position, range: INTERACTION_APPROACH_RADIUS, cause: 'woodcutting_level1_routine' };
    }

    return { kind: 'interact', target, option: 'chop down', cause: 'woodcutting_level1_routine' };
}

/**
 * Find the nearest fishing spot and interact with the "net" option when
 * carrying a small fishing net. Moved verbatim from the monolith (R-β
 * slice 3).
 */
export function starterFishingAction(perception: BodyHybridPerception): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here || !hasSmallFishingNet(perception)) {
        return undefined;
    }

    const target = (perception.nearby?.npcs || [])
        .filter(isFishingSpot)
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (!target) {
        return undefined;
    }

    return { kind: 'interact', target, option: 'net', cause: 'starter_fishing_net' };
}

/**
 * Bury bones from inventory or pick up the nearest set of bones on the
 * ground. Returns undefined when neither path is available. Moved
 * verbatim from the monolith (R-β slice 4).
 */
export function buryBonesAction(perception: BodyHybridPerception): AgentAction | undefined {
    const inventory = perception.resident?.inventory || [];
    const bonesSlot = findSlot(inventory, isBones);
    if (bonesSlot !== undefined) {
        return { kind: 'item_action', slot: bonesSlot, option: 'bury', cause: 'prayer_bury_bones' };
    }

    const bones = (perception.nearby?.worldItems || [])
        .filter(isBones)
        .sort(
            (a, b) =>
                distance(perception.resident?.position || a.position, a.position) -
                distance(perception.resident?.position || b.position, b.position),
        )[0];
    if (bones) {
        return { kind: 'interact', target: bones, option: 'pick-up', cause: 'prayer_pickup_bones' };
    }

    return undefined;
}

/**
 * Cook starter raw fish on a nearby heat source; if none in sight,
 * fall back to lighting a cooking fire via firemakingAction; otherwise
 * say what's missing. Moved verbatim from the monolith (R-β slice 5).
 */
export function starterFishingCookingAction(perception: BodyHybridPerception): AgentAction | undefined {
    const rawFishSlot = findSlot(perception.resident?.inventory || [], isStarterRawFish);
    if (rawFishSlot === undefined) {
        return undefined;
    }

    const here = perception.resident?.position;
    const heatSource = (perception.nearby?.objects || [])
        .filter(object => COOKING_HEAT_OBJECT_IDS.has(object.objectId))
        .sort((a, b) => distance(here || a.position, a.position) - distance(here || b.position, b.position))[0];
    if (heatSource) {
        return { kind: 'use_item_on', itemSlot: rawFishSlot, target: heatSource, cause: 'starter_fishing_cook_catch' };
    }

    const fireAction = firemakingAction(perception);
    if (fireAction) {
        return actionWithCause(fireAction, 'starter_fishing_make_cooking_fire');
    }

    return { kind: 'say', text: 'I have raw fish now. I need a fire or range to cook it.', cause: 'starter_fishing_missing_heat' };
}

// --- Opportunistic-pickup support helpers (moved verbatim from the monolith). ---

/** True when the inventory has at least one free slot. */
export function inventoryHasFreeSlot(inventory: Array<BodyItem | null>): boolean {
    return inventory.length < MAX_INVENTORY_SLOTS || inventory.some(slot => slot === null);
}

/** True when the ground item is worth picking up. */
export function isUsefulGroundItem(item: BodyItem): boolean {
    return (
        COIN_ITEM_IDS.has(item.itemId) ||
        /coins?/i.test(item.key || '') ||
        isFiremakingLog(item) ||
        isBones(item) ||
        FOOD_KEY_PATTERN.test(item.key || '')
    );
}

/** Lower number = higher priority for opportunistic pickup. */
export function usefulGroundItemPriority(item: BodyItem): number {
    if (COIN_ITEM_IDS.has(item.itemId) || /coins?/i.test(item.key || '')) {
        return 0;
    }
    if (FOOD_KEY_PATTERN.test(item.key || '')) {
        return 1;
    }
    if (isFiremakingLog(item)) {
        return 2;
    }
    if (isBones(item)) {
        return 3;
    }
    return 4;
}

/** Normalizes ids like `player:X` / `resident:X` to bare `x` for owner comparison. */
export function normalizeActorId(id: string): string {
    return id
        .toLowerCase()
        .replace(/^player:/, '')
        .replace(/^resident:/, '');
}

/** True when the ground item belongs to a different actor than the resident. */
export function isOwnedByAnotherActor(item: BodyWorldItem, residentId?: string, perceptionResidentId?: string): boolean {
    if (!item.ownerId) {
        return false;
    }
    const owner = normalizeActorId(item.ownerId);
    const residentIds = [residentId, perceptionResidentId].filter((id): id is string => Boolean(id)).map(normalizeActorId);
    return !residentIds.includes(owner);
}

/** Stable key uniquely identifying a ground-pickup target for cooldown tracking. */
export function pickupItemKey(item: BodyWorldItem): string {
    return `${item.itemId}:${item.key || ''}:${item.position.x},${item.position.y},${item.position.level}`;
}

/** True when the ground item is still inside its pickup-cooldown window. */
export function isPickupOnCooldown(item: BodyWorldItem, cooldowns: Record<string, number> | undefined, currentTick: number): boolean {
    const last = cooldowns?.[pickupItemKey(item)];
    return last !== undefined && currentTick - last < PICKUP_TARGET_COOLDOWN_TICKS;
}

/**
 * Scan for the nearest useful ground item, approach it, then pick it up.
 * Respects firemaking-fire suppression, ownership filters, and pickup
 * cooldowns. Moved verbatim from the monolith (R-β slice 6).
 */
export function opportunisticPickupAction(
    perception: BodyHybridPerception,
    residentId?: string,
    maxDistance?: number,
    pickupCooldowns?: Record<string, number>,
    currentTick = perception.tick ?? 0,
): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here || !inventoryHasFreeSlot(perception.resident?.inventory || [])) {
        return undefined;
    }

    const suppressFiremakingLogPickup = hasNearbyFire(perception);
    const item = (perception.nearby?.worldItems || [])
        .filter(candidate => {
            if (
                (suppressFiremakingLogPickup && isFiremakingLog(candidate)) ||
                !isUsefulGroundItem(candidate) ||
                isOwnedByAnotherActor(candidate, residentId, perception.resident?.id) ||
                isPickupOnCooldown(candidate, pickupCooldowns, currentTick)
            ) {
                return false;
            }
            return maxDistance === undefined || distance(here, candidate.position) <= maxDistance;
        })
        .sort((a, b) => {
            const priority = usefulGroundItemPriority(a) - usefulGroundItemPriority(b);
            return priority !== 0 ? priority : distance(here, a.position) - distance(here, b.position);
        })[0];
    if (!item) {
        return undefined;
    }

    if (distance(here, item.position) > INTERACTION_APPROACH_RADIUS) {
        return { kind: 'move_to', target: item.position, range: INTERACTION_APPROACH_RADIUS, cause: 'opportunistic_pickup' };
    }

    return { kind: 'interact', target: item, option: 'pick-up', cause: 'opportunistic_pickup' };
}

// --- Prayer/combat support helpers (moved verbatim from the monolith). ---

/** True when the resident's current HP fraction is at or below 0.4 of max. */
export function isLowHealth(perception: BodyHybridPerception): boolean {
    const hp = perception.resident?.hp;
    const max = Number(hp?.max || 0);
    return max > 0 && Number(hp?.current || 0) / max <= 0.4;
}

/** Returns the nearest fixed prayer-training waypoint to the given position. */
export function nearestPrayerTrainingWaypoint(here: BodyPos): BodyPos {
    return [...PRAYER_TRAINING_WAYPOINTS].sort((a, b) => distance(here, a) - distance(here, b))[0];
}

/** Lower number = higher-priority NPC kill choice for prayer (bone) sourcing. */
export function boneSourcePriority(actor: BodyActor): number {
    const label = [actor.name, actor.key, actor.id].filter(Boolean).join(' ');
    if (LOW_RISK_BONE_SOURCE_PATTERN.test(label)) {
        return 0;
    }
    if (MEDIUM_RISK_BONE_SOURCE_PATTERN.test(label)) {
        return 1;
    }
    if (HUMAN_BONE_SOURCE_PATTERN.test(label)) {
        return 2;
    }
    return 3;
}

/** Closest safe bone-source NPC, picked by priority then distance. */
export function safeBoneSourceTarget(perception: BodyHybridPerception): BodyActor | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }
    return (perception.nearby?.npcs || []).filter(isSafeBoneSource).sort((a, b) => {
        const priority = boneSourcePriority(a) - boneSourcePriority(b);
        return priority !== 0 ? priority : distance(here, a.position) - distance(here, b.position);
    })[0];
}

/**
 * Train Prayer by burying carried bones, picking up nearby ones, or
 * killing a safe bone-source NPC. Moves toward a fixed waypoint when
 * nothing is in sight. Aborts when low on health. Moved verbatim from
 * the monolith (R-β slice 7).
 */
export function prayerTrainingAction(perception: BodyHybridPerception): AgentAction | undefined {
    const bonesAction = buryBonesAction(perception);
    if (bonesAction) {
        return bonesAction;
    }
    if (isLowHealth(perception)) {
        return undefined;
    }

    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const target = safeBoneSourceTarget(perception);
    if (!target) {
        const waypoint = nearestPrayerTrainingWaypoint(here);
        return distance(here, waypoint) > PRAYER_TRAINING_WAYPOINT_RANGE
            ? { kind: 'move_to', target: waypoint, range: PRAYER_TRAINING_WAYPOINT_RANGE, cause: 'prayer_seek_safe_bone_source' }
            : undefined;
    }

    if (distance(here, target.position) > INTERACTION_APPROACH_RADIUS) {
        return { kind: 'move_to', target: target.position, range: INTERACTION_APPROACH_RADIUS, cause: 'prayer_approach_safe_bone_source' };
    }

    return { kind: 'attack', target, cause: 'prayer_attack_safe_bone_source' };
}
