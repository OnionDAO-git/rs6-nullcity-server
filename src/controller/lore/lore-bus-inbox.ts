import { WHISPER_LORE_KIND } from './whisper';
import type { LoreBus, LoreEvent } from './lore-bus';

/**
 * A lore event delivered to a resident's world-event inbox. Includes a
 * sourcePosition when the publisher attached a visibility hint.
 */
export interface DeliveredLoreEvent {
    kind: string;
    source: string;
    payload: Record<string, unknown>;
    ts: string;
    /** Position of the event source, if the publisher included a visibility hint. */
    sourcePosition?: { x: number; y: number; level: number };
}

export interface LoreBusInboxOptions {
    /**
     * Maximum number of events buffered before the oldest is dropped.
     * Defaults to 50. Events are delivered in FIFO order.
     */
    maxBufferSize?: number;
}

export interface LoreBusInbox {
    /**
     * Drain buffered world events in FIFO order. When `observerPos` is
     * provided, events with a visibility hint are position-gated: only
     * events whose source is within `event.visibility.radiusTiles` of the
     * observer are returned. Events without a visibility hint are always
     * returned. Events that fail the gate are discarded (not retained for
     * a future drain).
     */
    drain(observerPos?: { x: number; y: number; level: number }): DeliveredLoreEvent[];
    /** Stop receiving further events. Idempotent. */
    unsubscribe(): void;
}

const DEFAULT_MAX_BUFFER = 50;

/**
 * Open a world-event inbox for `residentId`. Subscribes to the LoreBus,
 * skipping events originating from this resident and whisper events
 * (which are handled by WhisperInbox). Buffers matching events until
 * drain() is called.
 *
 * Position filtering happens at drain time so that the observer's current
 * position is used rather than a stale subscription-time position.
 *
 * Workstream L3 — cross-resident world events entering resident perception.
 */
export function loreBusInboxFor(bus: LoreBus, residentId: string, options: LoreBusInboxOptions = {}): LoreBusInbox {
    const maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER;
    const buffer: LoreEvent[] = [];

    const unsubscribe = bus.subscribe((event: LoreEvent) => {
        if (event.source === residentId) return;
        if (event.kind === WHISPER_LORE_KIND) return;
        if (buffer.length >= maxBufferSize) {
            buffer.shift();
        }
        buffer.push(event);
    });

    return {
        drain(observerPos?: { x: number; y: number; level: number }): DeliveredLoreEvent[] {
            const all = buffer.splice(0);
            return all.filter(event => isEventVisibleFrom(event, observerPos)).map(toDeliveredLoreEvent);
        },
        unsubscribe,
    };
}

function isEventVisibleFrom(event: LoreEvent, observerPos: { x: number; y: number; level: number } | undefined): boolean {
    if (!observerPos || !event.visibility) {
        // No position or no visibility hint — always deliver.
        return true;
    }
    const [ex, ey, el] = event.visibility.sourceCoord;
    if (el !== observerPos.level) {
        return false;
    }
    const dx = ex - observerPos.x;
    const dy = ey - observerPos.y;
    const distSquared = dx * dx + dy * dy;
    const radius = event.visibility.radiusTiles;
    return distSquared <= radius * radius;
}

function toDeliveredLoreEvent(event: LoreEvent): DeliveredLoreEvent {
    const vis = event.visibility;
    return {
        kind: event.kind,
        source: event.source,
        payload: event.payload,
        ts: event.ts,
        sourcePosition: vis ? { x: vis.sourceCoord[0], y: vis.sourceCoord[1], level: vis.sourceCoord[2] } : undefined,
    };
}
