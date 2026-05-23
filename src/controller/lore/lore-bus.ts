import { z } from 'zod';

/** A coord triple `[x, y, level]`. */
type Coord3 = readonly [number, number, number];

const coord3Schema = z.tuple([z.number(), z.number(), z.number().int().min(0)]);

const loreVisibilitySchema = z.object({
    sourceCoord: coord3Schema,
    radiusTiles: z.number().int().nonnegative(),
});

/**
 * A cross-resident lore event. Examples: `fire_lit` when a resident
 * successfully lights a fire near another resident; `log_chopped` for a
 * shared woodcutting moment; `quest_completed` for civic celebration.
 *
 * Event shape is intentionally open under `payload` so new event kinds can
 * land without breaking the schema. Subscribers filter by `kind` and by
 * proximity.
 */
export interface LoreEvent {
    kind: string;
    ts: string;
    /** Resident that emitted the event. */
    source: string;
    payload: Record<string, unknown>;
    /** Optional proximity hint for radius gating. */
    visibility?: {
        sourceCoord: Coord3;
        radiusTiles: number;
    };
}

/** Same as {@link LoreEvent} but `ts` is filled in by the bus if omitted. */
export interface LoreEventInput {
    kind: string;
    ts?: string;
    source: string;
    payload: Record<string, unknown>;
    visibility?: {
        sourceCoord: Coord3;
        radiusTiles: number;
    };
}

export const loreEventSchema = z.object({
    kind: z.string().min(1),
    ts: z.string().min(1),
    source: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
    visibility: loreVisibilitySchema.optional(),
});

export type LoreSubscriber = (event: LoreEvent) => void;

export interface LoreSubscribeOptions {
    /** If set, the subscriber only receives events whose `kind` matches. */
    kindFilter?: string;
    /**
     * If set, the subscriber represents a resident at `observerCoord` and
     * only receives events whose visibility hint puts them within
     * `min(event.visibility.radiusTiles, this.maxDistanceTiles)` and on the
     * same `level`. Events without a `visibility` hint are always delivered.
     */
    proximityFilter?: {
        observerCoord: Coord3;
        maxDistanceTiles: number;
    };
}

export interface LoreBusOptions {
    now?: () => Date;
    /** How many events to keep in the recent log. Defaults to 1000. */
    maxEventsRetained?: number;
}

interface SubscriberEntry {
    subscriber: LoreSubscriber;
    options: LoreSubscribeOptions;
}

const DEFAULT_MAX_EVENTS = 1000;

/**
 * In-memory cross-resident event bus. Persistence layer (file-backed log)
 * is L-α-2 / L-α-3 territory; this is the substrate.
 *
 * One resident emitting `fire_lit` near another lets the latter receive
 * the event into their perception layer and react. See L spec for the
 * planned event vocabulary.
 */
export class LoreBus {
    private readonly subscribers = new Set<SubscriberEntry>();
    private readonly eventLog: LoreEvent[] = [];
    private readonly now: () => Date;
    private readonly maxEventsRetained: number;

    constructor(options: LoreBusOptions = {}) {
        this.now = options.now ?? (() => new Date());
        this.maxEventsRetained = options.maxEventsRetained ?? DEFAULT_MAX_EVENTS;
    }

    publish(input: LoreEventInput): LoreEvent {
        const event: LoreEvent = {
            kind: input.kind,
            ts: input.ts ?? this.now().toISOString(),
            source: input.source,
            payload: input.payload,
            visibility: input.visibility,
        };
        // Validate at the boundary. Throws on malformed event.
        loreEventSchema.parse(event);

        this.eventLog.push(event);
        if (this.eventLog.length > this.maxEventsRetained) {
            this.eventLog.splice(0, this.eventLog.length - this.maxEventsRetained);
        }

        for (const entry of this.subscribers) {
            if (entry.options.kindFilter && entry.options.kindFilter !== event.kind) {
                continue;
            }
            if (entry.options.proximityFilter && event.visibility) {
                const { observerCoord, maxDistanceTiles } = entry.options.proximityFilter;
                const { sourceCoord, radiusTiles } = event.visibility;
                if (observerCoord[2] !== sourceCoord[2]) {
                    continue;
                }
                const effective = Math.min(radiusTiles, maxDistanceTiles);
                const dx = observerCoord[0] - sourceCoord[0];
                const dy = observerCoord[1] - sourceCoord[1];
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > effective) {
                    continue;
                }
            }
            try {
                entry.subscriber(event);
            } catch {
                // Subscriber-side errors must not break sibling subscribers
                // or the publisher. Future slice (L-α-2) can wire a
                // structured logger here.
            }
        }

        return event;
    }

    subscribe(subscriber: LoreSubscriber, options: LoreSubscribeOptions = {}): () => void {
        const entry: SubscriberEntry = { subscriber, options };
        this.subscribers.add(entry);
        return () => {
            this.subscribers.delete(entry);
        };
    }

    /** Returns a frozen view of the retained event log (chronological). */
    recentEvents(): readonly LoreEvent[] {
        return Object.freeze(this.eventLog.map(event => ({ ...event })));
    }
}
