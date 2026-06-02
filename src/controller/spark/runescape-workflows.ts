/**
 * RuneScape workflow dispatch surface (Plan R-α extraction).
 *
 * Hosts the leaf predicates and helper constants that classify items, actors,
 * and inventory state for the per-workflow body routines. The monolith
 * (`src/controller/thinking/hybrid-agent-thinking-module.ts`) and any future
 * extracted body-routine / brain-planner units import from here.
 *
 * Per the SPARK module extraction spec (Plan α): this file owns the workflow
 * dispatch surface. The `WorkflowCard` / `SUPPORTED_WORKFLOWS` constants
 * continue to live in `runebench-playbook.ts` and are re-exported here so
 * downstream code has a single import point.
 *
 * IMPORTANT: predicate behavior is moved verbatim from the monolith — no
 * semantic edits. The accompanying test suite is the contract.
 */

import { SUPPORTED_WORKFLOWS, type WorkflowCard } from '../thinking/runebench-playbook';

/** Minimal item shape the predicates consume. Matches the local `Item` type in the monolith. */
export interface WorkflowItem {
    itemId: number;
    key?: string;
    amount: number;
}

/** Minimal actor shape the predicates consume. Matches the local `Actor` type in the monolith. */
export interface WorkflowActor {
    id: string;
    kind: 'player' | 'npc' | 'resident';
    name?: string;
    key?: string;
    position?: { x: number; y: number; level: number };
    hpFraction?: number;
}

/** Inventory carrier used by `hasX` helpers. Matches `HybridPerception.resident.inventory`. */
export interface WorkflowInventoryCarrier {
    resident?: {
        inventory?: Array<WorkflowItem | null>;
        equipment?: Array<WorkflowItem | null>;
    };
}

// --- Item-id sets and key patterns (moved verbatim from the monolith) ---

export const TINDERBOX_ITEM_IDS: ReadonlySet<number> = new Set([590]);
export const FIREMAKING_LOG_ITEM_IDS: ReadonlySet<number> = new Set([1511, 2862, 1521, 1519, 6333, 1517, 6332, 1515, 1513]);
export const FIREMAKING_LOG_KEY_PATTERN = /^rs:(logs|.*_logs)$/i;
export const WOODCUTTING_AXE_ITEM_IDS: ReadonlySet<number> = new Set([1351, 1349, 1353, 1361, 1355, 1357, 1359]);
export const PICKAXE_ITEM_IDS: ReadonlySet<number> = new Set([1265, 1267, 1269, 1273, 1271, 1275]);
export const SMALL_FISHING_NET_ITEM_IDS: ReadonlySet<number> = new Set([303]);
export const STARTER_RAW_FISH_ITEM_IDS: ReadonlySet<number> = new Set([317, 321]);
export const STARTER_RAW_FISH_KEY_PATTERN = /^rs:raw_(shrimp|anchovies)$/i;
export const FISHING_SPOT_PATTERN = /\bfishing\s+spot\b/i;
export const BONE_ITEM_IDS: ReadonlySet<number> = new Set([
    526, 528, 530, 532, 534, 536, 2859, 3123, 3125, 3179, 3180, 3181, 3182, 3183, 3185, 3186, 4812, 4813, 4814, 6729, 6812,
]);
export const BONE_KEY_PATTERN = /^rs:(bones|bones_.+|.+_bones)$/i;
export const SAFE_BONE_SOURCE_PATTERN = /\b(chicken|cow|goblin|rat|giant rat|spider|man|woman)\b/i;
export const LOW_RISK_BONE_SOURCE_PATTERN = /\b(chicken|cow|rat|giant rat)\b/i;
export const MEDIUM_RISK_BONE_SOURCE_PATTERN = /\b(goblin|spider)\b/i;
export const HUMAN_BONE_SOURCE_PATTERN = /\b(man|woman)\b/i;
export const SAFE_COMBAT_TARGET_PATTERN = /\b(chicken|cow|rat|giant rat|goblin|man|woman)\b/i;
/** Starter ore item IDs (clay, copper ore, tin ore) — the mined products. */
export const STARTER_ORE_ITEM_IDS: ReadonlySet<number> = new Set([434, 436, 438]);
export const STARTER_ORE_KEY_PATTERN = /^rs:(clay|copper_ore|tin_ore)$/i;
/** Starter cooked fish safe to eat (cooked shrimp, cooked anchovies). */
export const STARTER_COOKED_FISH_ITEM_IDS: ReadonlySet<number> = new Set([315, 319]);
export const STARTER_COOKED_FISH_KEY_PATTERN = /^rs:cooked_(shrimp|anchovies)$/i;

// --- Item-type predicates (moved verbatim from the monolith) ---

export function isTinderbox(item: WorkflowItem): boolean {
    return TINDERBOX_ITEM_IDS.has(item.itemId) || /tinderbox/i.test(item.key || '');
}

export function isFiremakingLog(item: WorkflowItem): boolean {
    return FIREMAKING_LOG_ITEM_IDS.has(item.itemId) || FIREMAKING_LOG_KEY_PATTERN.test(item.key || '');
}

export function isWoodcuttingAxe(item: WorkflowItem): boolean {
    return WOODCUTTING_AXE_ITEM_IDS.has(item.itemId) || /\b(axe|hatchet)\b/i.test(item.key || '');
}

export function isPickaxe(item: WorkflowItem): boolean {
    return PICKAXE_ITEM_IDS.has(item.itemId) || /(^|[:_\s-])pickaxe([:_\s-]|$)/i.test(item.key || '');
}

export function isSmallFishingNet(item: WorkflowItem): boolean {
    return SMALL_FISHING_NET_ITEM_IDS.has(item.itemId) || /\bsmall(_|\s)?fishing(_|\s)?net\b|\bsmall(_|\s)?net\b/i.test(item.key || '');
}

export function isStarterRawFish(item: WorkflowItem): boolean {
    return STARTER_RAW_FISH_ITEM_IDS.has(item.itemId) || STARTER_RAW_FISH_KEY_PATTERN.test(item.key || '');
}

export function isBones(item: WorkflowItem): boolean {
    return BONE_ITEM_IDS.has(item.itemId) || BONE_KEY_PATTERN.test(item.key || '');
}

export function isStarterOre(item: WorkflowItem): boolean {
    return STARTER_ORE_ITEM_IDS.has(item.itemId) || STARTER_ORE_KEY_PATTERN.test(item.key || '');
}

export function isStarterCookedFish(item: WorkflowItem): boolean {
    return STARTER_COOKED_FISH_ITEM_IDS.has(item.itemId) || STARTER_COOKED_FISH_KEY_PATTERN.test(item.key || '');
}

// --- Inventory-scan helpers (moved verbatim from the monolith) ---

export function hasWoodcuttingAxe(perception: WorkflowInventoryCarrier): boolean {
    return carriedAndEquippedItems(perception).some(item => isWoodcuttingAxe(item));
}

export function hasPickaxe(perception: WorkflowInventoryCarrier): boolean {
    return carriedAndEquippedItems(perception).some(item => isPickaxe(item));
}

export function hasSmallFishingNet(perception: WorkflowInventoryCarrier): boolean {
    return carriedAndEquippedItems(perception).some(item => isSmallFishingNet(item));
}

/** True when inventory contains at least one firemaking log (plan stage: gather-logs done). */
export function hasFiremakingLogsInInventory(perception: WorkflowInventoryCarrier): boolean {
    return inventoryItems(perception).some(item => isFiremakingLog(item));
}

/** True when inventory contains at least one starter raw fish (plan stage: fish done). */
export function hasStarterRawFishInInventory(perception: WorkflowInventoryCarrier): boolean {
    return inventoryItems(perception).some(item => isStarterRawFish(item));
}

/** True when inventory contains at least one starter cooked fish (plan stage: cook done). */
export function hasStarterCookedFishInInventory(perception: WorkflowInventoryCarrier): boolean {
    return inventoryItems(perception).some(item => isStarterCookedFish(item));
}

/** True when inventory contains at least one starter ore (plan stage: mine done). */
export function hasStarterOreInInventory(perception: WorkflowInventoryCarrier): boolean {
    return inventoryItems(perception).some(item => isStarterOre(item));
}

/** True when inventory contains at least one bone item (plan stage: bury-bones NOT yet done). */
export function hasBonesInInventory(perception: WorkflowInventoryCarrier): boolean {
    return inventoryItems(perception).some(item => isBones(item));
}

function inventoryItems(perception: WorkflowInventoryCarrier): WorkflowItem[] {
    return (perception.resident?.inventory || []).filter((item): item is WorkflowItem => Boolean(item));
}

function carriedAndEquippedItems(perception: WorkflowInventoryCarrier): WorkflowItem[] {
    return [...(perception.resident?.inventory || []), ...(perception.resident?.equipment || [])].filter((item): item is WorkflowItem =>
        Boolean(item),
    );
}

// --- Actor predicates (moved verbatim from the monolith) ---

export function isFishingSpot(actor: WorkflowActor): boolean {
    return [actor.name, actor.key, actor.id]
        .filter((value): value is string => Boolean(value))
        .some(value => FISHING_SPOT_PATTERN.test(value));
}

export function isSafeBoneSource(actor: WorkflowActor): boolean {
    if (actor.kind !== 'npc' || actor.hpFraction === 0) {
        return false;
    }
    return SAFE_BONE_SOURCE_PATTERN.test([actor.name, actor.key, actor.id].filter(Boolean).join(' '));
}

export function isSafeCombatTarget(actor: WorkflowActor): boolean {
    if (actor.kind !== 'npc' || actor.hpFraction === 0) {
        return false;
    }
    return SAFE_COMBAT_TARGET_PATTERN.test([actor.name, actor.key, actor.id].filter(Boolean).join(' '));
}

// --- WorkflowCard surface re-export (per spec: single import point) ---

export { SUPPORTED_WORKFLOWS, type WorkflowCard };
