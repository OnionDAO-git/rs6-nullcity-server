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

/**
 * Inputs for the pure timing predicate underlying the presence-beacon reflex.
 * The monolith's `presenceBeaconAction` method mixes this predicate with
 * cognition mutation and speech assembly; Plan R-γ extracts the predicate.
 */
export interface PresenceBeaconTiming {
    /** Current world tick. */
    tick: number;
    /** Whether the agent has an active goal (no goal = no beacon). */
    hasActiveGoal: boolean;
    /** Tick when the last presence beacon was emitted (if any). */
    lastBeaconTick: number | undefined;
    /** Fallback: tick when the agent last shared its goal (any channel). */
    lastGoalShareTick: number | undefined;
    /** Configured beacon interval in ticks; <= 0 means "always due". */
    interval: number;
}

/**
 * Pure timing predicate: returns true when the orchestrator should emit a
 * presence-beacon this tick. Mirrors the gating logic inside the monolith's
 * `presenceBeaconAction` method (no goal → false; no reference tick → false;
 * interval not yet elapsed → false; otherwise → true).
 *
 * Extracted verbatim from the monolith (R-γ).
 */
export function shouldEmitPresenceBeacon(input: PresenceBeaconTiming): boolean {
    if (!input.hasActiveGoal) {
        return false;
    }

    const last = input.lastBeaconTick ?? input.lastGoalShareTick;
    if (last === undefined) {
        return false;
    }

    if (input.interval > 0 && input.tick - last < input.interval) {
        return false;
    }

    return true;
}

/**
 * Stuck-recovery escalation: when stuck-move-recovery itself has been
 * unable to make progress, emit a 'say' help-request directed at any
 * watching player. The active-move's cause must already be
 * `stuck_move_recovery` for this to fire — otherwise stuck-recovery is
 * not yet in the escalated stage.
 *
 * Moved verbatim from the monolith (R-γ).
 */
export function stuckHelpRequestAction(here: BodyPos, active: NervousActiveMoveState): AgentAction | undefined {
    if (active.cause !== 'stuck_move_recovery') {
        return undefined;
    }

    return {
        kind: 'say',
        text: `I am stuck near ${here.x},${here.y} trying to reach ${active.target.x},${active.target.y}. Can someone lead me or open a route?`,
        cause: 'stuck_help_request',
    };
}
