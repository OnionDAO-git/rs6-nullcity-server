/**
 * prompt-budget.ts — S-INFER-3
 *
 * The live brain prompt was ~18 KB per call and the *upstream* compressed
 * perception blob it was sliced from was ~110-113 KB (598+ floor objects in a
 * dense embassy scene). A local thinking model (Qwen, 20s timeout) could not
 * ingest + reason + answer that within the window, so brain decisions came back
 * as request_timeout / empty.
 *
 * The root cause was NOT parsing (S-INFER-1/2 own that) — it was that the brain
 * prompt's "Perception" section was a blind char-slice of stringified JSON,
 * front-loaded almost entirely with `nearby.objects` (floor decorations the
 * brain does not need), crowding out the survival-critical context (resident
 * HP/AP/inventory, nearby NPCs, ground items, chat/combat events).
 *
 * This module produces a *bounded, structured* perception summary for the brain
 * prompt: it keeps the resident's own state and recent events intact and caps
 * each nearby-entity list to the N closest by distance, prioritising entities a
 * decision actually needs (NPCs/players/items) over floor objects. Caps are
 * named constants with sane defaults and can be overridden per call.
 */

const DEFAULT_MAX_NEARBY_NPCS = 16; // closest NPCs/players matter for combat/chat/social.
const DEFAULT_MAX_NEARBY_PLAYERS = 12; // humans + residents worth greeting/answering.
const DEFAULT_MAX_NEARBY_ITEMS = 16; // closest ground items worth picking up.
const DEFAULT_MAX_NEARBY_OBJECTS = 20; // closest interactable/scenery objects; a scene has 500+.
const DEFAULT_MAX_EVENTS = 12; // most recent perception events (chat/hit/trade/etc.).
const DEFAULT_MAX_INVENTORY = 28; // a full RuneScape inventory is 28 slots.

/**
 * Hard ceiling on the rendered perception summary string for the brain prompt.
 * The structured per-list caps above are the primary trim; this is a last-resort
 * safety net for pathological input (e.g. one enormous event payload). A dense
 * 598-object embassy scene renders to ~5 KB after the structured caps, so 6500
 * leaves headroom without letting the section balloon back toward the old 12 KB.
 */
export const DEFAULT_PERCEPTION_SUMMARY_BUDGET_CHARS = 6500;

export interface PerceptionBudgetCaps {
    maxNearbyNpcs: number;
    maxNearbyPlayers: number;
    maxNearbyItems: number;
    maxNearbyObjects: number;
    maxEvents: number;
    maxInventory: number;
    summaryBudgetChars: number;
}

export const DEFAULT_PERCEPTION_BUDGET_CAPS: PerceptionBudgetCaps = {
    maxNearbyNpcs: DEFAULT_MAX_NEARBY_NPCS,
    maxNearbyPlayers: DEFAULT_MAX_NEARBY_PLAYERS,
    maxNearbyItems: DEFAULT_MAX_NEARBY_ITEMS,
    maxNearbyObjects: DEFAULT_MAX_NEARBY_OBJECTS,
    maxEvents: DEFAULT_MAX_EVENTS,
    maxInventory: DEFAULT_MAX_INVENTORY,
    summaryBudgetChars: DEFAULT_PERCEPTION_SUMMARY_BUDGET_CHARS,
};

type Pos = { x: number; y: number; level?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positionOf(value: unknown): Pos | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const pos = isRecord(value.position) ? value.position : value;
    if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        return { x: pos.x, y: pos.y, level: typeof pos.level === 'number' ? pos.level : 0 };
    }
    return undefined;
}

function manhattan(a: Pos | undefined, b: Pos | undefined): number {
    if (!a || !b) {
        return Number.POSITIVE_INFINITY;
    }
    const levelPenalty = (a.level ?? 0) === (b.level ?? 0) ? 0 : 10_000;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + levelPenalty;
}

/**
 * Keep the `limit` entries closest to `origin` (by Manhattan distance), preserving
 * relative order for ties. Entries without a usable position sort last.
 */
function nearest<T>(entries: readonly T[] | undefined, origin: Pos | undefined, limit: number): T[] {
    if (!Array.isArray(entries) || entries.length === 0 || limit <= 0) {
        return [];
    }
    if (entries.length <= limit) {
        return [...entries];
    }
    return entries
        .map((entry, index) => ({ entry, index, distance: manhattan(positionOf(entry), origin) }))
        .sort((a, b) => (a.distance === b.distance ? a.index - b.index : a.distance - b.distance))
        .slice(0, limit)
        .map(item => item.entry);
}

function takeLast<T>(entries: readonly T[] | undefined, limit: number): T[] {
    if (!Array.isArray(entries) || entries.length === 0 || limit <= 0) {
        return [];
    }
    return entries.slice(Math.max(0, entries.length - limit));
}

/**
 * Build a bounded structured summary of a perception for the brain/body prompt.
 *
 * Survival spine kept intact: resident state (position, HP, AP/combat, inventory,
 * active trade, quests) and recent events. Breadth trimmed: nearby NPCs, players,
 * world items and objects are each capped to the closest N to the resident.
 *
 * Returns a plain object safe to JSON.stringify; never throws on odd input.
 */
export function summarizePerceptionForBudget(perception: unknown, caps: Partial<PerceptionBudgetCaps> = {}): Record<string, unknown> {
    const c = { ...DEFAULT_PERCEPTION_BUDGET_CAPS, ...caps };
    if (!isRecord(perception)) {
        return {};
    }

    const resident = isRecord(perception.resident) ? { ...perception.resident } : undefined;
    if (resident && Array.isArray(resident.inventory)) {
        resident.inventory = resident.inventory.slice(0, c.maxInventory);
    }
    const origin = positionOf(resident);

    const summary: Record<string, unknown> = {};
    if (typeof perception.tick === 'number') {
        summary.tick = perception.tick;
    }
    if (resident) {
        summary.resident = resident;
    }

    const nearby = isRecord(perception.nearby) ? perception.nearby : undefined;
    if (nearby) {
        const trimmedNearby: Record<string, unknown> = {};
        const npcs = nearest(nearby.npcs as unknown[] | undefined, origin, c.maxNearbyNpcs);
        const players = nearest(nearby.players as unknown[] | undefined, origin, c.maxNearbyPlayers);
        const worldItems = nearest(nearby.worldItems as unknown[] | undefined, origin, c.maxNearbyItems);
        const objects = nearest(nearby.objects as unknown[] | undefined, origin, c.maxNearbyObjects);
        if (players.length > 0) {
            trimmedNearby.players = players;
        }
        if (npcs.length > 0) {
            trimmedNearby.npcs = npcs;
        }
        if (worldItems.length > 0) {
            trimmedNearby.worldItems = worldItems;
        }
        if (objects.length > 0) {
            trimmedNearby.objects = objects;
        }
        // Surface how much was elided so the brain knows the scene is denser than shown.
        const elided = countElided(nearby, { npcs, players, worldItems, objects });
        if (elided > 0) {
            trimmedNearby.elidedCount = elided;
        }
        if (Object.keys(trimmedNearby).length > 0) {
            summary.nearby = trimmedNearby;
        }
    }

    const events = takeLast(perception.events as unknown[] | undefined, c.maxEvents);
    if (events.length > 0) {
        summary.events = events;
    }

    return summary;
}

function countElided(
    nearby: Record<string, unknown>,
    kept: { npcs: unknown[]; players: unknown[]; worldItems: unknown[]; objects: unknown[] },
): number {
    const total = (key: string) => (Array.isArray(nearby[key]) ? (nearby[key] as unknown[]).length : 0);
    const before = total('npcs') + total('players') + total('worldItems') + total('objects');
    const after = kept.npcs.length + kept.players.length + kept.worldItems.length + kept.objects.length;
    return Math.max(0, before - after);
}

/**
 * Render a perception into a bounded JSON string fit for a prompt. Trims nearby
 * entities first; if the structured summary is still over the char budget (very
 * long single events, huge inventory keys), applies a final hard char cap so the
 * brain prompt can never blow past the budget.
 */
export function renderBudgetedPerception(perception: unknown, caps: Partial<PerceptionBudgetCaps> = {}): string {
    const c = { ...DEFAULT_PERCEPTION_BUDGET_CAPS, ...caps };
    const summary = summarizePerceptionForBudget(perception, c);
    // Compact JSON (no pretty-print indent): the brain reads it fine and it costs
    // ~20% fewer chars/tokens than 2-space-indented output.
    const text = JSON.stringify(summary);
    if (text.length <= c.summaryBudgetChars) {
        return text;
    }
    return `${text.slice(0, c.summaryBudgetChars)}\n[perception truncated to ${c.summaryBudgetChars} chars]`;
}
