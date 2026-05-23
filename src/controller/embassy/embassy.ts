/**
 * Embassy region definition (Workstream N — Embassy / Event).
 *
 * The IRL OnionDAO Chicago event needs a virtual "embassy" tile cluster where
 * residents congregate, patrons enter, and the event runs. This module
 * defines the canonical placement + helpers; the perception field wiring +
 * reception NPC + plaque board + faction kiosks follow in N-α-2 / N-β.
 *
 * Default placement: **Lumbridge churchyard** (3238..3248, 3204..3214, level 0).
 * Per N spec § 1 "Maintainer decision needed: pick a RuneScape location" —
 * the churchyard is one of the listed candidates (central, graveyard
 * adjacency for the death-loop, building present, walkable from spawn in
 * <1 min). Maintainer can override by passing an explicit {@link EmbassyRegion}
 * to the helpers below, or by future env-config wiring.
 *
 * See:
 *   docs/superpowers/specs/2026-05-22-embassy-and-event-design.md
 *   docs/null-city-foundation-audit.md § N-α
 */

/** A coord triple matching engine convention. */
export interface Coord3 {
    x: number;
    y: number;
    level: number;
}

export interface EmbassyRegion {
    /** Human-readable identifier; logged + surfaced in dashboard. */
    id: string;
    /** Map level (ground=0, upper floors 1+). */
    level: number;
    /** Inclusive x-range. */
    x: { min: number; max: number };
    /** Inclusive y-range. */
    y: { min: number; max: number };
}

/**
 * Default embassy region. 11×11 tiles (inclusive) covering Lumbridge
 * churchyard, centred near the church door (3242,3208). Large enough for
 * the spec's required components (reception NPC + plaque board + 4 faction
 * kiosks + graveyard adjacency).
 */
export const EMBASSY_REGION: EmbassyRegion = {
    id: 'lumbridge-churchyard',
    level: 0,
    x: { min: 3238, max: 3248 },
    y: { min: 3204, max: 3214 },
};

/** Inclusive boundary check on x/y/level. */
export function isInsideEmbassy(coord: Coord3, region: EmbassyRegion = EMBASSY_REGION): boolean {
    return (
        coord.level === region.level &&
        coord.x >= region.x.min &&
        coord.x <= region.x.max &&
        coord.y >= region.y.min &&
        coord.y <= region.y.max
    );
}

/** Geometric centre of the region, rounded to the nearest tile. */
export function embassyCenter(region: EmbassyRegion = EMBASSY_REGION): Coord3 {
    return {
        x: Math.round((region.x.min + region.x.max) / 2),
        y: Math.round((region.y.min + region.y.max) / 2),
        level: region.level,
    };
}

/** True when any of the supplied coords falls inside the region. */
export function embassyContainsAny(coords: readonly Coord3[], region: EmbassyRegion = EMBASSY_REGION): boolean {
    for (const coord of coords) {
        if (isInsideEmbassy(coord, region)) {
            return true;
        }
    }
    return false;
}

/**
 * The derived embassy view the Brain sees in its prompt. `isInside` is
 * computed from the resident's current position; `eventActive` is read
 * from the optional `eventActive` flag attached to perception (set by the
 * OnionDAO event scheduler — defaults false until N-β event-day wiring).
 */
export interface EmbassyContext {
    isInside: boolean;
    eventActive: boolean;
    /** The region the resident is being checked against (for log/debug). */
    regionId: string;
}

/**
 * Compute the embassy context from a perception payload. Tolerant of the
 * loose Perception shape (key/value bag); reads `resident.position` if
 * present, returns `isInside=false` defensively otherwise.
 *
 * `eventActive` reads `perception.embassyEventActive` (or
 * `perception.eventActive` for older shape compatibility) as a top-level
 * boolean. Both default to false.
 */
export function deriveEmbassyContext(perception: unknown, region: EmbassyRegion = EMBASSY_REGION): EmbassyContext {
    const out: EmbassyContext = { isInside: false, eventActive: false, regionId: region.id };
    if (!perception || typeof perception !== 'object') {
        return out;
    }
    const root = perception as Record<string, unknown>;

    const eventActive = root.embassyEventActive ?? root.eventActive;
    if (typeof eventActive === 'boolean') {
        out.eventActive = eventActive;
    }

    const resident = root.resident;
    if (!resident || typeof resident !== 'object') {
        return out;
    }
    const position = (resident as Record<string, unknown>).position;
    if (!position || typeof position !== 'object') {
        return out;
    }
    const pos = position as Record<string, unknown>;
    if (typeof pos.x !== 'number' || typeof pos.y !== 'number') {
        return out;
    }
    const level = typeof pos.level === 'number' ? pos.level : 0;
    out.isInside = isInsideEmbassy({ x: pos.x, y: pos.y, level }, region);
    return out;
}
