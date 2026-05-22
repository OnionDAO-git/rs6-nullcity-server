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
import { hasSmallFishingNet, hasWoodcuttingAxe, isBones, isFiremakingLog, isFishingSpot, isTinderbox } from './runescape-workflows';

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
