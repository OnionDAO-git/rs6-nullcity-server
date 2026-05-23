import type { LoreBus, LoreEvent } from './lore-bus';

/**
 * Multi-resident whisper substrate (workstream L-β).
 *
 * A whisper is a quiet 1:1 message between residents. Unlike chat (which
 * any nearby actor can hear) a whisper targets a single recipient and
 * carries the speaker's position as the proximity hint — the bus's
 * radius gate keeps a whisper from reaching the receiver if they are
 * far away or on the wrong level.
 *
 * Design notes:
 *   - Lives on the existing {@link LoreBus} so subscribers can filter by
 *     kind=`whisper` and gate by proximity for free.
 *   - The recipient id is in `payload.to` rather than a header field;
 *     {@link whisperInboxFor} wraps that filter so callers don't repeat it.
 *   - Substrate only: this commit does not wire whispers into the runtime
 *     perception merge. That follow-on slice will subscribe an inbox per
 *     resident and surface drained whispers in the next-tick perception.
 *
 * See docs/null-city-foundation-audit.md § L and the L-β spec note.
 */
export const WHISPER_LORE_KIND = 'whisper';

/**
 * Default proximity radius (tiles) attached to whispers. Tighter than
 * fire_lit (10) because whispers are intimate by definition — a half-room
 * range. Callers can override per-whisper via {@link WhisperInput.radiusTiles}.
 */
export const WHISPER_DEFAULT_RADIUS_TILES = 6;

/** Argument to {@link publishWhisper}. */
export interface WhisperInput {
    /** Speaker resident id. */
    from: string;
    /** Recipient resident id. Must differ from `from`. */
    to: string;
    /** Whisper text. Trimmed; empty text is rejected. */
    text: string;
    /** Where the speaker is standing. Used as the proximity hint. */
    position: { x: number; y: number; level: number };
    /** Optional per-whisper radius override. */
    radiusTiles?: number;
}

/**
 * Publish a whisper to the bus. Returns the published {@link LoreEvent}
 * or `null` when the whisper is rejected (self-whisper or empty text).
 *
 * Pure boundary helper — no I/O beyond the bus call.
 */
export function publishWhisper(bus: LoreBus, input: WhisperInput): LoreEvent | null {
    if (input.from === input.to) {
        return null;
    }
    const trimmed = input.text.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const radius = input.radiusTiles ?? WHISPER_DEFAULT_RADIUS_TILES;
    return bus.publish({
        kind: WHISPER_LORE_KIND,
        source: input.from,
        payload: {
            to: input.to,
            text: trimmed,
        },
        visibility: {
            sourceCoord: [input.position.x, input.position.y, input.position.level],
            radiusTiles: radius,
        },
    });
}

/** A delivered whisper, ready to be surfaced in a recipient's perception. */
export interface DeliveredWhisper {
    from: string;
    text: string;
    position: { x: number; y: number; level: number };
    ts: string;
}

export interface WhisperInbox {
    /** Drain pending whispers in FIFO order. Empties the buffer. */
    drain(): DeliveredWhisper[];
    /** Stop receiving further whispers. Idempotent. */
    unsubscribe(): void;
}

export interface WhisperInboxOptions {
    /** Observer's own position; required if proximity gating should apply. */
    observerCoord?: readonly [number, number, number];
    /** Hard cap on whisper range from the observer's side (tiles). */
    maxDistanceTiles?: number;
}

/**
 * Open a whisper inbox for `residentId`. Subscribes to the bus, filters
 * by `kind='whisper'` and `payload.to === residentId`, and buffers
 * matching whispers until {@link WhisperInbox.drain} is called.
 *
 * Optional `observerCoord` + `maxDistanceTiles` enable subscriber-side
 * proximity gating in addition to the publisher's radius hint.
 */
export function whisperInboxFor(bus: LoreBus, residentId: string, options: WhisperInboxOptions = {}): WhisperInbox {
    const buffer: DeliveredWhisper[] = [];
    const unsubscribe = bus.subscribe(
        (event: LoreEvent) => {
            const payload = event.payload as { to?: unknown; text?: unknown };
            if (payload.to !== residentId) {
                return;
            }
            if (typeof payload.text !== 'string') {
                return;
            }
            const visibility = event.visibility;
            if (!visibility) {
                // Whispers without a visibility hint shouldn't happen via
                // publishWhisper, but be defensive: drop them rather than
                // accept an un-gated whisper.
                return;
            }
            buffer.push({
                from: event.source,
                text: payload.text,
                position: {
                    x: visibility.sourceCoord[0],
                    y: visibility.sourceCoord[1],
                    level: visibility.sourceCoord[2],
                },
                ts: event.ts,
            });
        },
        {
            kindFilter: WHISPER_LORE_KIND,
            proximityFilter: options.observerCoord
                ? {
                      observerCoord: options.observerCoord,
                      maxDistanceTiles: options.maxDistanceTiles ?? Number.POSITIVE_INFINITY,
                  }
                : undefined,
        },
    );
    return {
        drain(): DeliveredWhisper[] {
            const out = buffer.slice();
            buffer.length = 0;
            return out;
        },
        unsubscribe,
    };
}
