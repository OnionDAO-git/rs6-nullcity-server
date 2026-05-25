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
    isSafeCombatTarget,
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
    combatLevel?: number;
};

/** Perception bundle — matches monolith's local `HybridPerception` shape (subset used by body routines). */
export type BodyHybridPerception = {
    tick?: number;
    resident?: {
        id?: string;
        position?: BodyPos;
        hp?: { current?: number; max?: number };
        combatLevel?: number;
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

/** Tree object IDs that are useful as scouting landmarks, even when the resident cannot chop them yet. */
export const SCOUTING_TREE_IDS: ReadonlySet<number> = new Set(
    Object.values(objectIds.tree).flatMap(trees => trees.map(tree => tree.default)),
);

/** Object IDs that can be used as cooking heat sources by the fishing routine. */
export const COOKING_HEAT_OBJECT_IDS: ReadonlySet<number> = new Set([objectIds.fire, 114, 2728, 2729, 2730, 2731, 2859, 4172, 9682]);

/** Door/gate IDs worth trying during exploration before generic landmark patrol. */
export const EXPLORATION_OPENABLE_OBJECT_IDS: ReadonlySet<number> = new Set([
    1530, 11707, 1533, 1516, 1519, 1536, 11993, 13001, 1551, 1553, 12986, 12987,
]);

/** Lumbridge Castle kitchen range fallback for raw starter fish when no local fire is available. */
export const LUMBRIDGE_CASTLE_RANGE: BodyPos = { x: 3208, y: 3213, level: 0 };

/** Canonical level-1 net fishing spot in this server's npc-spawns/fishing config. */
export const LUMBRIDGE_STARTER_FISHING_SPOT: BodyPos = { x: 3241, y: 3242, level: 0 };

/** Secondary fixed net/bait spot in this server's Lumbridge fishing spawn config. */
export const LUMBRIDGE_STARTER_FISHING_SPOTS: ReadonlyArray<BodyPos> = [LUMBRIDGE_STARTER_FISHING_SPOT, { x: 3239, y: 3244, level: 0 }];

/** Reachable castle entry used when west-side kitchen doors are visible but not pathable. */
export const LUMBRIDGE_CASTLE_KITCHEN_ENTRY: BodyPos = { x: 3217, y: 3218, level: 0 };

/** Closed double-door IDs for the south Lumbridge Castle entrance. */
export const LUMBRIDGE_CASTLE_KITCHEN_ENTRY_CLOSED_DOOR_IDS: ReadonlySet<number> = new Set([1516, 1519]);

/** Open double-door IDs for the south Lumbridge Castle entrance. */
export const LUMBRIDGE_CASTLE_KITCHEN_ENTRY_OPEN_DOOR_IDS: ReadonlySet<number> = new Set([1517, 1520]);

/** Range close enough for a raw-fish use action against the fallback kitchen range. */
export const COOKING_RANGE_APPROACH_RADIUS = 1;

/** Route radius for getting close enough to reveal Lumbridge river Fishing spots. */
// Resident perception currently sees NPCs inside a 15x15 box, so dx=8 can
// still be invisible. Stop at dx<=7 and let the next tick click the spot.
export const STARTER_FISHING_SPOT_DISCOVERY_RANGE = 7;

/** Conservative guard so the Lumbridge waypoint only claims nearby starter-area anglers. */
export const STARTER_FISHING_ROUTE_MAX_DISTANCE = 128;

/** Visible door/gate radius considered useful for reaching a cooking heat source. */
export const COOKING_ROUTE_OPENABLE_MAX_DISTANCE = 8;

/** Visible radius for clicking the large Lumbridge Castle entry instead of walking onto its blocked tile. */
export const LUMBRIDGE_CASTLE_KITCHEN_ENTRY_OPENABLE_MAX_DISTANCE = 18;

/** Farthest nearby log the cooking routine will grab to make its own fire. */
export const COOKING_LOG_PICKUP_MAX_DISTANCE = 8;

/** Max number of inventory slots considered "free" by the pickup routine. */
export const MAX_INVENTORY_SLOTS = 28;

/** Ticks before a pickup target is considered eligible again after a recent attempt. */
export const PICKUP_TARGET_COOLDOWN_TICKS = 120;

/** Item IDs treated as coins by the pickup routine. */
export const COIN_ITEM_IDS: ReadonlySet<number> = new Set([995]);

/** Item-key pattern matched against food-shaped ground items by the pickup routine. */
export const FOOD_KEY_PATTERN =
    /(food|shrimp|anchovies|sardine|herring|trout|salmon|tuna|lobster|bass|swordfish|monkfish|shark|manta|karambwan|bread|cake|meat|chicken)/i;

/** Item-key pattern for raw food that must be cooked before it can heal. */
export const RAW_FOOD_KEY_PATTERN = /(^|[:_-])raw([:_-]|$)/i;

/** Maximum tile distance considered for opportunistic loot pickup during combat. */
export const COMBAT_LOOT_MAX_DISTANCE = 6;

/** Default body tick cadence; participates in the patrol-direction hash. Mirrors the monolith constant. */
export const DEFAULT_BODY_EVERY_TICKS = 8;

/** Ticks before an exploration target is considered eligible again after a recent visit or blocked approach. */
export const EXPLORATION_TARGET_COOLDOWN_TICKS = 600;

/** Patrol step distance (tiles) for the local exploration patroller. */
export const EXPLORATION_PATROL_STEP_DISTANCE = 3;

/** Farthest exploratory patrol step tried before reusing a recent patrol target. */
export const EXPLORATION_PATROL_MAX_DISTANCE = 12;

/** Range (in tiles) within which a prayer-training waypoint is considered reached. */
export const PRAYER_TRAINING_WAYPOINT_RANGE = 6;

/** Fixed waypoints the prayer/combat routines walk between when no safe target is in sight. */
export const PRAYER_TRAINING_WAYPOINTS: ReadonlyArray<BodyPos> = [
    { x: 3222, y: 3218, level: 0 },
    { x: 3249, y: 3238, level: 0 },
];

/** Safe low-traffic recovery spots to wait for healing or food after unsafe combat. */
export const LOW_HEALTH_RECOVERY_WAYPOINTS: ReadonlyArray<BodyPos> = [{ x: 3222, y: 3218, level: 0 }];

/** How close a resident should get before treating the recovery spot as reached. */
export const LOW_HEALTH_RECOVERY_WAYPOINT_RANGE = 6;

/** Visible hostile radius that triggers retreat to a recovery waypoint. */
const LOW_HEALTH_RECOVERY_THREAT_RADIUS = 24;

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

/** True when an item is ready-to-eat food rather than a raw ingredient. */
export function isEdibleFood(item: BodyItem): boolean {
    const key = item.key || '';
    return FOOD_KEY_PATTERN.test(key) && !RAW_FOOD_KEY_PATTERN.test(key) && !isStarterRawFish(item);
}

/** Returns the first inventory slot containing ready-to-eat food, or undefined. */
export function firstFoodSlot(inventory: Array<BodyItem | null>): number | undefined {
    return findSlot(inventory, isEdibleFood);
}

/** Returns the nearest low-health recovery waypoint to the given position. */
export function nearestLowHealthRecoveryWaypoint(here: BodyPos): BodyPos {
    return [...LOW_HEALTH_RECOVERY_WAYPOINTS].sort((a, b) => distance(here, a) - distance(here, b))[0];
}

function starterFishingCookingRouteAction(perception: BodyHybridPerception, target: BodyPos): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const openable = (perception.nearby?.objects || [])
        .filter(
            candidate =>
                EXPLORATION_OPENABLE_OBJECT_IDS.has(candidate.objectId) &&
                candidate.position.level === target.level &&
                distance(here, candidate.position) <= COOKING_ROUTE_OPENABLE_MAX_DISTANCE &&
                distance(candidate.position, target) < distance(here, target),
        )
        .sort(
            (a, b) =>
                distance(here, a.position) + distance(a.position, target) - (distance(here, b.position) + distance(b.position, target)),
        )[0];

    if (!openable) {
        return undefined;
    }

    return openCookingRouteAction(here, openable);
}

function starterFishingLumbridgeKitchenRouteAction(perception: BodyHybridPerception, target: BodyPos): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const adjacentOpenable = (perception.nearby?.objects || [])
        .filter(
            candidate =>
                EXPLORATION_OPENABLE_OBJECT_IDS.has(candidate.objectId) &&
                candidate.position.level === target.level &&
                distance(here, candidate.position) <= INTERACTION_APPROACH_RADIUS &&
                distance(candidate.position, target) <= distance(here, target),
        )
        .sort((a, b) => distance(a.position, target) - distance(b.position, target))[0];
    if (adjacentOpenable) {
        return openCookingRouteAction(here, adjacentOpenable);
    }

    if (!shouldRouteViaLumbridgeKitchenEntry(here, target)) {
        return undefined;
    }

    if (isLumbridgeCastleKitchenEntryOpen(perception)) {
        return undefined;
    }

    const castleEntranceOpenable = (perception.nearby?.objects || [])
        .filter(
            candidate =>
                EXPLORATION_OPENABLE_OBJECT_IDS.has(candidate.objectId) &&
                candidate.position.level === LUMBRIDGE_CASTLE_KITCHEN_ENTRY.level &&
                distance(candidate.position, LUMBRIDGE_CASTLE_KITCHEN_ENTRY) <= 1 &&
                distance(here, candidate.position) <= LUMBRIDGE_CASTLE_KITCHEN_ENTRY_OPENABLE_MAX_DISTANCE,
        )
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (castleEntranceOpenable) {
        return openCookingRouteAction(here, castleEntranceOpenable);
    }

    if (distance(here, LUMBRIDGE_CASTLE_KITCHEN_ENTRY) > 0) {
        return {
            kind: 'move_to',
            target: LUMBRIDGE_CASTLE_KITCHEN_ENTRY,
            range: 0,
            cause: 'starter_fishing_reach_castle_entrance',
        };
    }

    return undefined;
}

function openCookingRouteAction(here: BodyPos, openable: { objectId: number; position: BodyPos; orientation?: number }): AgentAction {
    if (distance(here, openable.position) > INTERACTION_APPROACH_RADIUS) {
        return {
            kind: 'move_to',
            target: openable.position,
            range: INTERACTION_APPROACH_RADIUS,
            cause: 'starter_fishing_open_cooking_route',
        };
    }

    return {
        kind: 'interact',
        target: openable,
        option: 'open',
        cause: 'starter_fishing_open_cooking_route',
    };
}

function isLumbridgeKitchenTarget(target: BodyPos): boolean {
    return target.level === 0 && target.x >= 3208 && target.x <= 3213 && target.y >= 3211 && target.y <= 3216;
}

function shouldRouteViaLumbridgeKitchenEntry(here: BodyPos, target: BodyPos): boolean {
    return (
        isLumbridgeKitchenTarget(target) &&
        here.level === LUMBRIDGE_CASTLE_KITCHEN_ENTRY.level &&
        here.x <= LUMBRIDGE_CASTLE_KITCHEN_ENTRY.x &&
        here.y <= LUMBRIDGE_CASTLE_KITCHEN_ENTRY.y &&
        distance(here, LUMBRIDGE_CASTLE_KITCHEN_ENTRY) <= LUMBRIDGE_CASTLE_KITCHEN_ENTRY_OPENABLE_MAX_DISTANCE
    );
}

function isLumbridgeCastleKitchenEntryOpen(perception: BodyHybridPerception): boolean {
    const objects = perception.nearby?.objects || [];
    const closedEntryVisible = objects.some(
        candidate =>
            LUMBRIDGE_CASTLE_KITCHEN_ENTRY_CLOSED_DOOR_IDS.has(candidate.objectId) &&
            candidate.position.level === LUMBRIDGE_CASTLE_KITCHEN_ENTRY.level &&
            distance(candidate.position, LUMBRIDGE_CASTLE_KITCHEN_ENTRY) <= 1,
    );
    if (closedEntryVisible) {
        return false;
    }
    return objects.some(
        candidate =>
            LUMBRIDGE_CASTLE_KITCHEN_ENTRY_OPEN_DOOR_IDS.has(candidate.objectId) &&
            candidate.position.level === LUMBRIDGE_CASTLE_KITCHEN_ENTRY.level &&
            distance(candidate.position, LUMBRIDGE_CASTLE_KITCHEN_ENTRY) <= 2,
    );
}

function isVisibleCombatThreat(actor: BodyActor): boolean {
    const name = `${actor.key || ''} ${actor.name || ''}`;
    const combatLevel = Number(actor.combatLevel || 0);
    const alive = actor.hpFraction === undefined || actor.hpFraction > 0;
    return alive && (combatLevel > 1 || /\b(goblin|spider|zombie|skeleton|guard)\b/i.test(name));
}

function hasNearbyRecoveryThreat(perception: BodyHybridPerception, here: BodyPos): boolean {
    return (perception.nearby?.npcs || []).some(
        actor => isVisibleCombatThreat(actor) && distance(here, actor.position) <= LOW_HEALTH_RECOVERY_THREAT_RADIUS,
    );
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
    return (perception.nearby?.objects || []).some(object => FIRE_OBJECT_IDS.has(object.objectId) && distance(here, object.position) <= 1);
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
 * Continue the starter fishing loop even when the spot has fallen out of
 * perception after cooking. The visible-spot action remains authoritative;
 * this only routes Lumbridge-area anglers back toward the server river
 * spot so they can rediscover a net-capable NPC instead of generic patrolling.
 */
export function starterFishingRouteAction(perception: BodyHybridPerception): AgentAction | undefined {
    const visibleSpotAction = starterFishingAction(perception);
    if (visibleSpotAction) {
        return visibleSpotAction;
    }

    const here = perception.resident?.position;
    if (!here || !hasSmallFishingNet(perception)) {
        return undefined;
    }

    const target = nextStarterFishingSearchPoint(here);
    const routeDistance = target ? distance(here, target) : Number.POSITIVE_INFINITY;
    if (!target || here.level !== target.level || routeDistance > STARTER_FISHING_ROUTE_MAX_DISTANCE) {
        return undefined;
    }

    if (routeDistance > STARTER_FISHING_SPOT_DISCOVERY_RANGE) {
        return {
            kind: 'move_to',
            target,
            range: STARTER_FISHING_SPOT_DISCOVERY_RANGE,
            cause: 'starter_fishing_seek_spot',
        };
    }

    return {
        kind: 'say',
        text: 'I am at the Lumbridge fishing water and looking for a net spot.',
        cause: 'starter_fishing_seek_spot',
    };
}

function nextStarterFishingSearchPoint(here: BodyPos): BodyPos | undefined {
    const candidates = LUMBRIDGE_STARTER_FISHING_SPOTS.filter(position => position.level === here.level).sort(
        (a, b) => distance(here, a) - distance(here, b),
    );
    return (
        candidates.find(position => distance(here, position) > STARTER_FISHING_SPOT_DISCOVERY_RANGE) ||
        candidates.find(position => distance(here, position) > 0) ||
        candidates[0]
    );
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
    const inventory = perception.resident?.inventory || [];
    const rawFishSlot = findSlot(inventory, isStarterRawFish);
    if (rawFishSlot === undefined) {
        return undefined;
    }

    const here = perception.resident?.position;
    const heatSource = (perception.nearby?.objects || [])
        .filter(object => COOKING_HEAT_OBJECT_IDS.has(object.objectId))
        .sort((a, b) => distance(here || a.position, a.position) - distance(here || b.position, b.position))[0];
    if (heatSource) {
        if (here && distance(here, heatSource.position) > COOKING_RANGE_APPROACH_RADIUS) {
            const lumbridgeEntryOpen =
                shouldRouteViaLumbridgeKitchenEntry(here, heatSource.position) && isLumbridgeCastleKitchenEntryOpen(perception);
            const lumbridgeRouteAction = starterFishingLumbridgeKitchenRouteAction(perception, heatSource.position);
            if (lumbridgeRouteAction) {
                return lumbridgeRouteAction;
            }
            if (!lumbridgeEntryOpen) {
                const routeAction = starterFishingCookingRouteAction(perception, heatSource.position);
                if (routeAction) {
                    return routeAction;
                }
            }
            return {
                kind: 'move_to',
                target: heatSource.position,
                range: COOKING_RANGE_APPROACH_RADIUS,
                cause: 'starter_fishing_find_range',
            };
        }
        return { kind: 'use_item_on', itemSlot: rawFishSlot, target: heatSource, cause: 'starter_fishing_cook_catch' };
    }

    const fireAction = firemakingAction(perception);
    if (fireAction) {
        return actionWithCause(fireAction, 'starter_fishing_make_cooking_fire');
    }

    const tinderboxSlot = findSlot(inventory, isTinderbox);
    if (here && tinderboxSlot !== undefined && inventoryHasFreeSlot(inventory)) {
        const logs = (perception.nearby?.worldItems || [])
            .filter(
                candidate =>
                    isFiremakingLog(candidate) &&
                    !isOwnedByAnotherActor(candidate, undefined, perception.resident?.id) &&
                    distance(here, candidate.position) <= COOKING_LOG_PICKUP_MAX_DISTANCE,
            )
            .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
        if (logs) {
            return { kind: 'interact', target: logs, option: 'pick-up', cause: 'starter_fishing_pickup_cooking_logs' };
        }
    }

    if (tinderboxSlot !== undefined && hasWoodcuttingAxe(perception)) {
        const woodcuttingAction = levelOneWoodcuttingAction(perception);
        if (woodcuttingAction) {
            return actionWithCause(woodcuttingAction, 'starter_fishing_chop_cooking_logs');
        }
    }

    if (here && distance(here, LUMBRIDGE_CASTLE_RANGE) > COOKING_RANGE_APPROACH_RADIUS) {
        const lumbridgeEntryOpen =
            shouldRouteViaLumbridgeKitchenEntry(here, LUMBRIDGE_CASTLE_RANGE) && isLumbridgeCastleKitchenEntryOpen(perception);
        const lumbridgeRouteAction = starterFishingLumbridgeKitchenRouteAction(perception, LUMBRIDGE_CASTLE_RANGE);
        if (lumbridgeRouteAction) {
            return lumbridgeRouteAction;
        }
        if (!lumbridgeEntryOpen) {
            const routeAction = starterFishingCookingRouteAction(perception, LUMBRIDGE_CASTLE_RANGE);
            if (routeAction) {
                return routeAction;
            }
        }
        return {
            kind: 'move_to',
            target: LUMBRIDGE_CASTLE_RANGE,
            range: COOKING_RANGE_APPROACH_RADIUS,
            cause: 'starter_fishing_find_range',
        };
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

/** True when the ground item belongs to the resident. */
export function isOwnedByResident(item: BodyWorldItem, residentId?: string, perceptionResidentId?: string): boolean {
    if (!item.ownerId) {
        return false;
    }
    const owner = normalizeActorId(item.ownerId);
    const residentIds = [residentId, perceptionResidentId].filter((id): id is string => Boolean(id)).map(normalizeActorId);
    return residentIds.includes(owner);
}

/**
 * Self-owned logs commonly appear for a tick after lighting a fire, but
 * the pickup target is already gone by the time the action reaches the
 * engine. Chopping a fresh tree is more reliable than chasing them.
 */
export function isStaleSelfOwnedLog(item: BodyWorldItem, residentId?: string, perceptionResidentId?: string): boolean {
    return isFiremakingLog(item) && isOwnedByResident(item, residentId, perceptionResidentId);
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
    explorationCooldowns?: Record<string, number>,
): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here || !inventoryHasFreeSlot(perception.resident?.inventory || [])) {
        return undefined;
    }

    const suppressFiremakingLogPickup = hasNearbyFire(perception);
    const suppressNonFoodPickup = isLowHealth(perception);
    const item = (perception.nearby?.worldItems || [])
        .filter(candidate => {
            if (
                (suppressFiremakingLogPickup && isFiremakingLog(candidate)) ||
                (suppressNonFoodPickup && !isEdibleFood(candidate)) ||
                isStaleSelfOwnedLog(candidate, residentId, perception.resident?.id) ||
                !isUsefulGroundItem(candidate) ||
                isOwnedByAnotherActor(candidate, residentId, perception.resident?.id) ||
                isPickupOnCooldown(candidate, pickupCooldowns, currentTick) ||
                isExplorationOnCooldown(explorationItemCooldownKey(candidate), explorationCooldowns, currentTick)
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

    return { kind: 'interact', target: item, option: 'pick-up', cause: 'opportunistic_pickup' };
}

// --- Prayer/combat support helpers (moved verbatim from the monolith). ---

/** True when the resident's current HP fraction is at or below 0.4 of max. */
export function isLowHealth(perception: BodyHybridPerception): boolean {
    const hp = perception.resident?.hp;
    const max = Number(hp?.max || 0);
    return max > 0 && Number(hp?.current || 0) / max <= 0.4;
}

/** Eat carried food or pick up visible food when hurt outside combat routines. */
export function lowHealthRecoveryAction(
    perception: BodyHybridPerception,
    residentId?: string,
    pickupCooldowns?: Record<string, number>,
    currentTick = perception.tick ?? 0,
): AgentAction | undefined {
    if (!isLowHealth(perception)) {
        return undefined;
    }

    const inventory = perception.resident?.inventory || [];
    const foodSlot = firstFoodSlot(inventory);
    if (foodSlot !== undefined) {
        return { kind: 'eat', slot: foodSlot, cause: 'low_health_eat' };
    }

    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }
    const nearbyThreat = hasNearbyRecoveryThreat(perception, here);

    const cookingAction = starterFishingCookingAction(perception);
    if (cookingAction && !nearbyThreat) {
        return actionWithCause(cookingAction, 'low_health_cook_food');
    }

    const fishingAction = nearbyThreat ? undefined : starterFishingAction(perception);
    if (fishingAction) {
        return actionWithCause(fishingAction, 'low_health_fish_food');
    }

    if (!inventoryHasFreeSlot(inventory)) {
        const recoveryWaypoint = nearestLowHealthRecoveryWaypoint(here);
        return nearbyThreat && distance(here, recoveryWaypoint) > LOW_HEALTH_RECOVERY_WAYPOINT_RANGE
            ? {
                  kind: 'move_to',
                  target: recoveryWaypoint,
                  range: LOW_HEALTH_RECOVERY_WAYPOINT_RANGE,
                  cause: 'low_health_seek_safe_recovery',
              }
            : undefined;
    }

    const food = (perception.nearby?.worldItems || [])
        .filter(
            candidate =>
                isEdibleFood(candidate) &&
                !isOwnedByAnotherActor(candidate, residentId, perception.resident?.id) &&
                !isPickupOnCooldown(candidate, pickupCooldowns, currentTick),
        )
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];

    if (food) {
        return { kind: 'interact', target: food, option: 'pick-up', cause: 'low_health_pickup_food' };
    }

    const recoveryWaypoint = nearestLowHealthRecoveryWaypoint(here);
    return nearbyThreat && distance(here, recoveryWaypoint) > LOW_HEALTH_RECOVERY_WAYPOINT_RANGE
        ? {
              kind: 'move_to',
              target: recoveryWaypoint,
              range: LOW_HEALTH_RECOVERY_WAYPOINT_RANGE,
              cause: 'low_health_seek_safe_recovery',
          }
        : undefined;
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

    return { kind: 'attack', target, cause: 'prayer_attack_safe_bone_source' };
}

/**
 * Bury bones looted during combat, or opportunistically pick up nearby
 * useful items within the combat-loot radius. Moved verbatim from the
 * monolith (R-β slice 8).
 */
export function combatLootOrPrayerAction(
    perception: BodyHybridPerception,
    pickupCooldowns?: Record<string, number>,
    currentTick?: number,
): AgentAction | undefined {
    const bonesSlot = findSlot(perception.resident?.inventory || [], isBones);
    if (bonesSlot !== undefined) {
        return { kind: 'item_action', slot: bonesSlot, option: 'bury', cause: 'combat_bury_looted_bones' };
    }

    const pickup = opportunisticPickupAction(perception, undefined, COMBAT_LOOT_MAX_DISTANCE, pickupCooldowns, currentTick);
    return pickup ? actionWithCause(pickup, 'combat_loot_pickup') : undefined;
}

/** Lower number = higher-priority NPC kill choice for combat training. */
export function combatTargetPriority(actor: BodyActor): number {
    const label = [actor.name, actor.key, actor.id].filter(Boolean).join(' ');
    if (LOW_RISK_BONE_SOURCE_PATTERN.test(label)) {
        return 0;
    }
    if (MEDIUM_RISK_BONE_SOURCE_PATTERN.test(label)) {
        return 1;
    }
    return 2;
}

/** Closest safe combat-target NPC, picked by priority then distance. */
export function safeCombatTarget(perception: BodyHybridPerception): BodyActor | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }
    return (perception.nearby?.npcs || []).filter(isSafeCombatTarget).sort((a, b) => {
        const priority = combatTargetPriority(a) - combatTargetPriority(b);
        return priority !== 0 ? priority : distance(here, a.position) - distance(here, b.position);
    })[0];
}

/**
 * Train combat against safe NPCs, eating food when low on HP and
 * looting bones/items between fights. Moves toward a fixed waypoint
 * when nothing is in sight. Moved verbatim from the monolith (R-β
 * slice 9).
 */
export function combatTrainingAction(
    perception: BodyHybridPerception,
    pickupCooldowns?: Record<string, number>,
    currentTick?: number,
): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    if (isLowHealth(perception)) {
        const foodSlot = firstFoodSlot(perception.resident?.inventory || []);
        return foodSlot === undefined
            ? { kind: 'say', text: 'I am too hurt to start combat without food. I need to heal or get food first.' }
            : { kind: 'eat', slot: foodSlot, cause: 'combat_eat_before_training' };
    }

    if (!perception.resident?.inCombat) {
        const loot = combatLootOrPrayerAction(perception, pickupCooldowns, currentTick);
        if (loot) {
            return loot;
        }
    }

    const target = safeCombatTarget(perception);
    if (!target) {
        const waypoint = nearestPrayerTrainingWaypoint(here);
        return distance(here, waypoint) > PRAYER_TRAINING_WAYPOINT_RANGE
            ? { kind: 'move_to', target: waypoint, range: PRAYER_TRAINING_WAYPOINT_RANGE, cause: 'combat_seek_safe_target' }
            : undefined;
    }

    return { kind: 'attack', target, cause: 'combat_attack_safe_target' };
}

// --- Exploration helpers (moved verbatim from the monolith). ---

/** Speech helper used by exploration to approach and talk to a nearby NPC. */
export function npcTalkAction(perception: BodyHybridPerception, target: BodyActor, cause: string): AgentAction {
    const here = perception.resident?.position;
    if (here && distance(here, target.position) > 2) {
        return { kind: 'move_to', target: target.position, range: 1, cause };
    }
    return { kind: 'interact', target, option: 'talk-to', cause };
}

/** Human-readable label for inventory/world items. Strips the `rs:` prefix and underscores. */
export function itemLabel(item: BodyItem): string {
    return (item.key || `item ${item.itemId}`).replace(/^rs:/i, '').replace(/_/g, ' ').trim();
}

/** True when the given exploration cooldown key is still inside its cooldown window. */
export function isExplorationOnCooldown(key: string, cooldowns: Record<string, number> | undefined, currentTick: number): boolean {
    const last = cooldowns?.[key];
    return last !== undefined && currentTick - last < EXPLORATION_TARGET_COOLDOWN_TICKS;
}

/** Stable cooldown key for an NPC the exploration routine just visited. */
export function explorationActorCooldownKey(actor: BodyActor): string {
    return actor.id
        ? `npc:${actor.id}`
        : `npc:${actor.key || actor.name || `${actor.position.x},${actor.position.y},${actor.position.level}`}`;
}

/** Broader cooldown key for an NPC family the exploration routine just sampled. */
export function explorationActorFamilyCooldownKey(actor: BodyActor): string {
    const family = actor.key || actor.name;
    return family ? `npc-key:${family.toLowerCase()}` : explorationActorCooldownKey(actor);
}

/** Stable cooldown key for a world object the exploration routine just visited. */
export function explorationObjectCooldownKey(object: { objectId: number; position: BodyPos }): string {
    return `object:${object.objectId}:${object.position.x},${object.position.y},${object.position.level}`;
}

/** Stable cooldown key for a ground item the exploration routine just visited. */
export function explorationItemCooldownKey(item: BodyWorldItem): string {
    return `item:${pickupItemKey(item)}`;
}

/** Stable cooldown key for a local patrol tile the exploration routine just visited. */
export function explorationPatrolCooldownKey(position: BodyPos): string {
    return `patrol:${position.x},${position.y},${position.level}`;
}

/** Patrol-step direction set used by both exploration patrol and stuck recovery. */
export function localPatrolDirections(step: number): Array<{ dx: number; dy: number }> {
    return [
        { dx: step, dy: 0 },
        { dx: 0, dy: step },
        { dx: -step, dy: 0 },
        { dx: 0, dy: -step },
    ];
}

/** Stable pseudo-random direction index derived from position + tick bucket. */
export function patrolDirectionIndex(here: BodyPos, currentTick: number, length: number): number {
    if (length <= 1) {
        return 0;
    }
    const tickBucket = Math.floor(currentTick / Math.max(1, DEFAULT_BODY_EVERY_TICKS));
    return Math.abs(here.x * 31 + here.y * 17 + tickBucket) % length;
}

/** Returns the next patrol step away from `here`. The anchor parameter is currently ignored. */
export function explorationPatrolTarget(
    here: BodyPos,
    _anchor?: BodyPos,
    currentTick = 0,
    explorationCooldowns?: Record<string, number>,
    blockedTiles?: ReadonlySet<string>,
): BodyPos {
    let fallback: BodyPos | undefined;
    for (let step = EXPLORATION_PATROL_STEP_DISTANCE; step <= EXPLORATION_PATROL_MAX_DISTANCE; step += EXPLORATION_PATROL_STEP_DISTANCE) {
        const directions = localPatrolDirections(step);
        const startIndex = patrolDirectionIndex(here, currentTick, directions.length);
        const candidates = directions.map(direction => ({ x: here.x + direction.dx, y: here.y + direction.dy, level: here.level }));
        for (let offset = 0; offset < candidates.length; offset += 1) {
            const candidate = candidates[(startIndex + offset) % candidates.length];
            if (blockedTiles?.has(bodyPositionKey(candidate))) {
                continue;
            }
            fallback ??= candidate;
            if (!isExplorationOnCooldown(explorationPatrolCooldownKey(candidate), explorationCooldowns, currentTick)) {
                return candidate;
            }
        }
    }
    return fallback || here;
}

/** Returns a patrol step that increases distance from the blocked target. Used by stuck recovery. */
export function stuckRecoveryPatrolTarget(here: BodyPos, blockedTarget: BodyPos, currentTick: number, anchor?: BodyPos): BodyPos {
    const candidates = localPatrolDirections(EXPLORATION_PATROL_STEP_DISTANCE)
        .map(direction => ({ x: here.x + direction.dx, y: here.y + direction.dy, level: here.level }))
        .filter(candidate => distance(candidate, blockedTarget) > distance(here, blockedTarget));
    if (candidates.length > 0) {
        return candidates[patrolDirectionIndex(here, currentTick, candidates.length)];
    }
    return explorationPatrolTarget(here, anchor, currentTick + 1);
}

/**
 * Pick up nearby loot, then talk to a nearby NPC, then move toward an
 * uncooldowned object, then a world item, then patrol. Respects per-actor,
 * per-object, and per-item exploration cooldowns. Moved verbatim from the
 * monolith (R-β slice 10).
 */
export function explorationAction(
    perception: BodyHybridPerception,
    anchor?: BodyPos,
    residentId?: string,
    pickupCooldowns?: Record<string, number>,
    currentTick = perception.tick ?? 0,
    explorationCooldowns?: Record<string, number>,
    options?: { interactWithNpcs?: boolean; interactWithOpenables?: boolean },
): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }
    const blockedPatrolTiles = objectOccupiedTiles(perception);

    const pickup = opportunisticPickupAction(perception, residentId, undefined, pickupCooldowns, currentTick, explorationCooldowns);
    if (pickup) {
        return pickup;
    }

    if (options?.interactWithNpcs ?? true) {
        const npc = (perception.nearby?.npcs || [])
            .filter(
                candidate =>
                    !isFishingSpot(candidate) &&
                    !isExplorationOnCooldown(explorationActorCooldownKey(candidate), explorationCooldowns, currentTick) &&
                    !isExplorationOnCooldown(explorationActorFamilyCooldownKey(candidate), explorationCooldowns, currentTick),
            )
            .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
        if (npc) {
            return npcTalkAction(perception, npc, 'explore_talk_to_npc');
        }
    }

    if (options?.interactWithOpenables ?? true) {
        const openableObject = (perception.nearby?.objects || [])
            .filter(
                candidate =>
                    EXPLORATION_OPENABLE_OBJECT_IDS.has(candidate.objectId) &&
                    !isExplorationOnCooldown(explorationObjectCooldownKey(candidate), explorationCooldowns, currentTick),
            )
            .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
        if (openableObject) {
            if (distance(here, openableObject.position) > 1) {
                return { kind: 'move_to', target: openableObject.position, range: 1, cause: 'explore_open_obstacle' };
            }
            return { kind: 'interact', target: openableObject, option: 'open', cause: 'explore_open_obstacle' };
        }
    }

    const object = (perception.nearby?.objects || [])
        .filter(
            candidate =>
                !FIRE_OBJECT_IDS.has(candidate.objectId) &&
                !SCOUTING_TREE_IDS.has(candidate.objectId) &&
                !EXPLORATION_OPENABLE_OBJECT_IDS.has(candidate.objectId) &&
                !isExplorationOnCooldown(explorationObjectCooldownKey(candidate), explorationCooldowns, currentTick),
        )
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (object) {
        if (distance(here, object.position) > 2) {
            return { kind: 'move_to', target: object.position, range: 2, cause: 'explore_visible_object' };
        }

        const patrol = explorationPatrolTarget(here, anchor, currentTick, explorationCooldowns, blockedPatrolTiles);
        if (distance(here, patrol) > 1) {
            return { kind: 'move_to', target: patrol, range: 1, cause: 'explore_patrol' };
        }

        return {
            kind: 'say',
            text: `I am checking the landmark at ${object.position.x},${object.position.y}.`,
            cause: 'explore_visible_object',
        };
    }

    const treeStand = (perception.nearby?.objects || [])
        .filter(
            candidate =>
                SCOUTING_TREE_IDS.has(candidate.objectId) &&
                distance(here, candidate.position) > 2 &&
                !isExplorationOnCooldown(explorationObjectCooldownKey(candidate), explorationCooldowns, currentTick),
        )
        .sort((a, b) => distance(here, b.position) - distance(here, a.position))[0];
    if (treeStand) {
        return { kind: 'move_to', target: treeStand.position, range: 2, cause: 'explore_tree_stand' };
    }

    const item = (perception.nearby?.worldItems || [])
        .filter(candidate => !isExplorationOnCooldown(explorationItemCooldownKey(candidate), explorationCooldowns, currentTick))
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (item) {
        if (distance(here, item.position) > 1) {
            return { kind: 'move_to', target: item.position, range: 1, cause: 'explore_visible_item' };
        }
        return { kind: 'say', text: `I see ${itemLabel(item)} on the ground.`, cause: 'explore_visible_item' };
    }

    const patrol = explorationPatrolTarget(here, anchor, currentTick, explorationCooldowns, blockedPatrolTiles);
    if (distance(here, patrol) > 1) {
        return { kind: 'move_to', target: patrol, range: 1, cause: 'explore_patrol' };
    }

    return { kind: 'say', text: `I am scouting near ${here.x},${here.y} and staying findable.`, cause: 'explore_patrol' };
}

function objectOccupiedTiles(perception: BodyHybridPerception): ReadonlySet<string> | undefined {
    const objects = perception.nearby?.objects || [];
    if (objects.length === 0) {
        return undefined;
    }
    return new Set(objects.map(object => bodyPositionKey(object.position)));
}

function bodyPositionKey(position: BodyPos): string {
    return `${position.x},${position.y},${position.level}`;
}
