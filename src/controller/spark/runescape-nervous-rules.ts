/**
 * RuneScape nervous-system reflex helpers (Plan R-γ extraction).
 *
 * Hosts the survival-priority interrupt and stuck-recovery reflex helpers
 * extracted from `src/controller/thinking/hybrid-agent-thinking-module.ts`.
 * These are pure functions of `(perception, ...)` → `AgentAction | undefined`;
 * they are the Nervous half of the Brain/Body/Nervous decomposition documented
 * in `docs/superpowers/specs/2026-05-22-spark-module-extraction-design.md`.
 *
 * Per the SPARK module extraction spec (Plan γ): each helper is moved
 * verbatim from the monolith — no semantic edits. The accompanying test
 * suite is the contract. Helpers extracted here continue to be imported
 * back into the monolith until the orchestrator slim-down (Plan ε).
 *
 * Note: stuck-recovery occupies the boundary between Body and Nervous (Open
 * Question #5 in the spec). They live here because they short-circuit the
 * Body's normal control flow with a survival-style override, even though
 * they are invoked from inside the Body routine.
 */

import { objectIds } from '@engine/world/config/object-ids';
import type { AgentAction } from '../transport/message-codecs';
import { distance, type BodyPos } from './runescape-body-routines';

// --- Shared structural types matching the monolith's local definitions. ---

/** Active move tracker — matches monolith's `ActiveMoveState` shape (subset used by stuck-recovery reflexes). */
export type NervousActiveMoveState = {
    target: BodyPos;
    range?: number;
    cause?: string;
    startedAtTick: number;
    lastTick: number;
    lastPositionKey?: string;
    stationaryCount?: number;
};

/** Perception bundle — matches monolith's local `HybridPerception` shape (subset used by nervous reflexes). */
export type NervousHybridPerception = {
    tick?: number;
    resident?: {
        id?: string;
        position?: BodyPos;
    };
    nearby?: {
        objects?: Array<{ objectId: number; position: BodyPos; orientation?: number }>;
    };
    events?: Array<Record<string, unknown>>;
};

// --- Constants moved verbatim from the monolith. ---

/** Object IDs for doors/gates the stuck-recovery reflex may attempt to open. */
export const OPENABLE_OBSTACLE_IDS: ReadonlySet<number> = new Set([
    1530, 11707, 1533, 1516, 1519, 1536, 11993, 13001, 1551, 1553, 12986, 12987,
]);

/** Object IDs for fence-style blockers that the stuck-recovery reflex reports rather than tries to open. */
export const FENCE_OBSTACLE_IDS: ReadonlySet<number> = new Set([objectIds.shortCuts.fenceNearKharidCows]);

/** Maximum tile range the stuck-recovery reflex considers when scanning for nearby obstacles. */
export const STUCK_OBSTACLE_RANGE = 2;

// --- Reflex helpers moved verbatim from the monolith. ---

/**
 * Stuck-recovery: when the resident is wedged near an openable door/gate,
 * emit an interact-open action targeted at the nearest one. Ties are broken
 * by distance to the active-move target so we pick the obstacle on the way
 * to where we are trying to go.
 *
 * Moved verbatim from the monolith (R-γ).
 */
export function stuckOpenObstacleAction(
    perception: NervousHybridPerception,
    here: BodyPos,
    active: NervousActiveMoveState,
): AgentAction | undefined {
    const obstacle = (perception.nearby?.objects || [])
        .filter(object => OPENABLE_OBSTACLE_IDS.has(object.objectId) && distance(here, object.position) <= STUCK_OBSTACLE_RANGE)
        .sort((a, b) => {
            const nearest = distance(here, a.position) - distance(here, b.position);
            return nearest !== 0 ? nearest : distance(active.target, a.position) - distance(active.target, b.position);
        })[0];

    return obstacle ? { kind: 'interact', target: obstacle, option: 'open', cause: 'stuck_open_obstacle' } : undefined;
}

/**
 * Stuck-recovery: when the resident is wedged near a fence-style blocker
 * (one we cannot open), emit a 'say' announcement so observers know the
 * agent is stuck. The active-move target informs tie-breaking on which
 * fence to point at, but the say-text is fence-agnostic.
 *
 * Moved verbatim from the monolith (R-γ).
 */
export function stuckBlockerReportAction(
    perception: NervousHybridPerception,
    here: BodyPos,
    active: NervousActiveMoveState,
): AgentAction | undefined {
    const blocker = (perception.nearby?.objects || [])
        .filter(object => FENCE_OBSTACLE_IDS.has(object.objectId) && distance(here, object.position) <= STUCK_OBSTACLE_RANGE)
        .sort((a, b) => {
            const nearest = distance(here, a.position) - distance(here, b.position);
            return nearest !== 0 ? nearest : distance(active.target, a.position) - distance(active.target, b.position);
        })[0];

    if (!blocker) {
        return undefined;
    }

    return { kind: 'say', text: 'I am stuck near a fence. I will step away and try another route.', cause: 'stuck_blocker_report' };
}
