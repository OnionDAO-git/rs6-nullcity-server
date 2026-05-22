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
import {
    distance,
    explorationObjectCooldownKey,
    isExplorationOnCooldown,
    type BodyActor,
    type BodyPos,
} from './runescape-body-routines';

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
        combatTarget?: BodyActor | null;
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

// --- Local typing helpers (moved verbatim from the monolith). ---

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positionLike(value: unknown): BodyPos | undefined {
    if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
        return undefined;
    }
    return { x: value.x, y: value.y, level: typeof value.level === 'number' ? value.level : 0 };
}

function actorLike(value: unknown): BodyActor | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') {
        return undefined;
    }
    const position = positionLike(value.position);
    if (!position || !['player', 'npc', 'resident'].includes(value.kind)) {
        return undefined;
    }
    return {
        id: value.id,
        kind: value.kind as BodyActor['kind'],
        name: typeof value.name === 'string' ? value.name : undefined,
        key: typeof value.key === 'string' ? value.key : undefined,
        position,
        hpFraction: typeof value.hpFraction === 'number' ? value.hpFraction : undefined,
    };
}

// --- Reflex helpers moved verbatim from the monolith. ---

/**
 * Scans the perception event log (newest → oldest) for the most recent
 * combat-style event (`hit_taken`, `hit`, `attacked`) and extracts the
 * attacker. Used by the survival-priority combat reflex.
 *
 * Moved verbatim from the monolith (R-γ).
 */
export function latestCombatAttacker(perception: NervousHybridPerception): BodyActor | undefined {
    for (const event of [...(perception.events || [])].reverse()) {
        if (!['hit_taken', 'hit', 'attacked'].includes(String(event.kind || ''))) {
            continue;
        }
        const attacker = actorLike(event.from);
        if (attacker) {
            return attacker;
        }
    }

    return undefined;
}

/**
 * Compute a retreat position that moves the resident away from the latest
 * known threat. Falls back to a default east-shifted target when no threat
 * is identifiable. Mirrors the monolith's escape-vector heuristic
 * (Chebyshev step of 4 tiles in the away-from-threat direction).
 *
 * Moved verbatim from the monolith (R-γ).
 */
export function fleeTarget(perception: NervousHybridPerception): BodyPos {
    const here = perception.resident?.position || { x: 0, y: 0, level: 0 };
    const threat = latestCombatAttacker(perception) || perception.resident?.combatTarget;
    if (!threat) {
        return { x: here.x + 4, y: here.y, level: here.level };
    }

    return {
        x: here.x + Math.sign(here.x - threat.position.x || 1) * 4,
        y: here.y + Math.sign(here.y - threat.position.y || 1) * 4,
        level: here.level,
    };
}


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
    explorationCooldowns?: Record<string, number>,
    currentTick = perception.tick ?? 0,
): AgentAction | undefined {
    const obstacle = (perception.nearby?.objects || [])
        .filter(
            object =>
                OPENABLE_OBSTACLE_IDS.has(object.objectId) &&
                distance(here, object.position) <= STUCK_OBSTACLE_RANGE &&
                !isExplorationOnCooldown(explorationObjectCooldownKey(object), explorationCooldowns, currentTick),
        )
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
