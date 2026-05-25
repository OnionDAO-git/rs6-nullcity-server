import type { PatronRegistry } from '../patron/patron-registry';
import { EMBASSY_REGION, type EmbassyRegion, isInsideEmbassy } from './embassy';

/**
 * Embassy reception greeting reflex (workstream EVENT-D3).
 *
 * When a registered patron's chat event arrives while a hero resident
 * is standing inside the embassy region, this pure evaluator decides
 * whether the resident should emit a "Welcome, {name}" greeting and
 * fire a `witnessAt` event for the patron loop. The wiring layer
 * (a nervous rule or a dedicated runtime hook) consumes the returned
 * {@link ReceptionGreeting}; this module owns the policy, not the
 * dispatch.
 *
 * Design choices, per docs/strategic-review-2026-05-23-pm.md:
 *   - Pure function. No I/O, no clock, no side effects.
 *   - The runtime selects WHICH hero greets (by faction or by
 *     proximity); this module just executes the greeting policy for
 *     the one hero the caller named via `residentName`.
 *   - Multiple patron chats per tick: the LAST one wins (most-recent
 *     speaker). Earlier chats from this tick are treated as already
 *     greeted by an earlier tick's reflex firing.
 *   - Defensive against malformed perception bags.
 *   - Display names are optional: when `displayNames[handle]` is set,
 *     we greet by display name; otherwise we use the raw handle.
 */
export interface ReceptionGreetingInput {
    /** Perception bag (loose shape, matches engine convention). */
    perception: Record<string, unknown> | null | undefined;
    /** Embassy region geometry. Defaults to the canonical Lumbridge churchyard. */
    region?: EmbassyRegion;
    /** Resident who would emit the greeting. The caller picks which hero. */
    residentName: string;
    /** Patron registry — only chats from known patrons trigger the reflex. */
    registry: PatronRegistry;
    /** Optional handle → display-name map for friendlier greetings. */
    displayNames?: Record<string, string>;
}

/** A say action the runtime should emit. Matches the AgentAction shape. */
export interface ReceptionGreetingAction {
    kind: 'say';
    text: string;
    cause: 'embassy_reception_greeting';
}

/** A witness intent the runtime should fan out to PatronGateway.witnessAt(...). */
export interface ReceptionWitnessIntent {
    patronHandle: string;
    landmarkId: 'embassy';
    residentName: string;
}

export interface ReceptionGreeting {
    action: ReceptionGreetingAction;
    witness: ReceptionWitnessIntent;
}

/**
 * Evaluate whether to greet a patron entering the embassy.
 *
 * Returns a {@link ReceptionGreeting} when:
 *   1. The resident's position is inside the embassy region.
 *   2. The perception bag has at least one chat event whose `from.name`
 *      is in the {@link PatronRegistry}.
 *
 * Returns `null` otherwise (no greeting this tick).
 */
export function evaluateReceptionGreeting(input: ReceptionGreetingInput): ReceptionGreeting | null {
    if (!input.perception || typeof input.perception !== 'object') {
        return null;
    }
    const region = input.region ?? EMBASSY_REGION;

    // Gate 1: resident must be inside the embassy.
    const resident = input.perception.resident;
    if (!resident || typeof resident !== 'object') {
        return null;
    }
    const position = (resident as Record<string, unknown>).position;
    if (!position || typeof position !== 'object') {
        return null;
    }
    const pos = position as Record<string, unknown>;
    if (typeof pos.x !== 'number' || typeof pos.y !== 'number') {
        return null;
    }
    const level = typeof pos.level === 'number' ? pos.level : 0;
    if (!isInsideEmbassy({ x: pos.x, y: pos.y, level }, region)) {
        return null;
    }

    // Gate 2: find the most-recent chat event from a known patron.
    const events = input.perception.events;
    if (!Array.isArray(events)) {
        return null;
    }
    let lastPatronHandle: string | undefined;
    for (const event of events) {
        if (!event || typeof event !== 'object') {
            continue;
        }
        const e = event as Record<string, unknown>;
        if (e.kind !== 'chat') {
            continue;
        }
        // Synthetic operator asks have their own acknowledgement path; D3 is for in-world patron chat.
        if (e.source === 'patron:ask') {
            continue;
        }
        const from = e.from;
        if (!from || typeof from !== 'object') {
            continue;
        }
        const handle = (from as Record<string, unknown>).name;
        if (typeof handle !== 'string' || handle.length === 0) {
            continue;
        }
        if (input.registry.isPatron(handle)) {
            lastPatronHandle = handle;
        }
    }
    if (!lastPatronHandle) {
        return null;
    }

    const display = input.displayNames?.[lastPatronHandle] ?? lastPatronHandle;

    return {
        action: {
            kind: 'say',
            text: `Welcome to the embassy, ${display}.`,
            cause: 'embassy_reception_greeting',
        },
        witness: {
            patronHandle: lastPatronHandle,
            landmarkId: 'embassy',
            residentName: input.residentName,
        },
    };
}
