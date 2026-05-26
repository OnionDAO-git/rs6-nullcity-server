import type { LoreBus, LoreEvent } from './lore-bus';

/**
 * Cross-resident lore event kind emitted when a resident successfully
 * lights a fire next to them. Other residents subscribed to this kind on
 * the {@link LoreBus} can react (chat reaction, memo, approach).
 *
 * Workstream L-α-2 — see docs/null-city-foundation-audit.md § L.
 */
export const FIRE_LIT_LORE_KIND = 'fire_lit';

/**
 * Default proximity radius (tiles) attached to the published event's
 * visibility hint. Picked at ~10 because a fresh fire is a strong visual
 * cue for nearby residents but should not flood the whole map. Callers
 * can override via {@link FireLitReflexOptions.radiusTiles}.
 */
export const FIRE_LIT_DEFAULT_RADIUS_TILES = 10;

/** Object IDs that count as a fire for the reflex. Matches body-routines. */
const FIRE_OBJECT_IDS: ReadonlySet<number> = new Set<number>([
    26185, // standard fire (RuneScape canonical firemaking output)
]);

/** Loose perception shape we read defensively. */
interface ReflexPerception {
    resident?: {
        position?: { x: number; y: number; level: number };
    };
    nearby?: {
        objects?: ReadonlyArray<{ objectId: number; position: { x: number; y: number; level: number } }>;
    };
}

export interface FireLitReflexOptions {
    bus: LoreBus;
    /** Proximity radius attached to published events. Defaults to {@link FIRE_LIT_DEFAULT_RADIUS_TILES}. */
    radiusTiles?: number;
}

interface PerResidentState {
    /** True once we have seen any observation for this resident (cold-start guard). */
    initialized: boolean;
    /** Whether a fire was at-or-adjacent on the previous observation. */
    fireWasPresent: boolean;
}

/**
 * Detects the no-fire → fire transition at a resident's tile and publishes
 * a `fire_lit` {@link LoreEvent}. The reflex is per-source so multiple
 * residents share one detector without cross-talk.
 *
 * Cold-start safety: the first observation never publishes — we cannot
 * attribute a pre-existing fire to the resident, so the first tick simply
 * records baseline state.
 *
 * Re-arm safety: once a fire goes out (no-fire observation), the reflex
 * re-arms so a later relight publishes again.
 */
export class FireLitReflex {
    private readonly bus: LoreBus;
    private readonly radiusTiles: number;
    private readonly state = new Map<string, PerResidentState>();

    constructor(options: FireLitReflexOptions) {
        this.bus = options.bus;
        this.radiusTiles = options.radiusTiles ?? FIRE_LIT_DEFAULT_RADIUS_TILES;
    }

    observe(perception: ReflexPerception | null | undefined, source: string): LoreEvent | undefined {
        const here = perception?.resident?.position;
        if (!here || typeof here.x !== 'number' || typeof here.y !== 'number' || typeof here.level !== 'number') {
            return undefined;
        }

        const nearbyFire = findNearbyFire(perception, here);
        const fireNow = nearbyFire !== undefined;
        const prior = this.state.get(source);

        if (!prior) {
            // Cold start: baseline only, never publish.
            this.state.set(source, { initialized: true, fireWasPresent: fireNow });
            return undefined;
        }

        const shouldEmit = fireNow && !prior.fireWasPresent;
        prior.fireWasPresent = fireNow;

        if (!shouldEmit || !nearbyFire) {
            return undefined;
        }

        return this.bus.publish({
            kind: FIRE_LIT_LORE_KIND,
            source,
            payload: {
                position: { x: here.x, y: here.y, level: here.level },
                fireObjectId: nearbyFire.objectId,
            },
            visibility: {
                sourceCoord: [nearbyFire.position.x, nearbyFire.position.y, nearbyFire.position.level],
                radiusTiles: this.radiusTiles,
            },
        });
    }
}

function findNearbyFire(
    perception: ReflexPerception | null | undefined,
    here: { x: number; y: number; level: number },
): { objectId: number; position: { x: number; y: number; level: number } } | undefined {
    const objects = perception?.nearby?.objects;
    if (!objects) {
        return undefined;
    }
    for (const object of objects) {
        if (!FIRE_OBJECT_IDS.has(object.objectId)) {
            continue;
        }
        if (object.position.level !== here.level) {
            continue;
        }
        const dx = Math.abs(object.position.x - here.x);
        const dy = Math.abs(object.position.y - here.y);
        // Chebyshev distance ≤ 1 == same tile or adjacent (matches body-routines).
        if (Math.max(dx, dy) <= 1) {
            return object;
        }
    }
    return undefined;
}
