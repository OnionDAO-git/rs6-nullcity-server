/**
 * RIQ-4-3: Success predicate evaluator for open-goal plan stages.
 *
 * `evaluateSuccessPredicate` is called by `routeActivePlanStage` when an open-goal
 * stage's authored steps are exhausted. It inspects the current game state and
 * returns true (stage_done) or false (stage_blocked / force re-plan).
 */

import type { SuccessPredicate } from './planner-pass';

/** Minimal perception shape needed by the predicate evaluator. */
type PredicatePerception = {
    tick?: number;
    nearby?: {
        objects?: ReadonlyArray<{ objectId: number }>;
    };
};

/**
 * Evaluates whether an open-goal stage's successPredicate is satisfied.
 *
 * Returns true  → caller emits stage_done  (advance plan).
 * Returns false → caller emits stage_blocked (force re-plan or wait).
 *
 * When pred is undefined, all authored steps have completed → done by default.
 *
 * @param pred              SuccessPredicate from the stage, or undefined.
 * @param perception        Current world perception snapshot.
 * @param stageStartedAtTick  Tick the stage first routed an action (for ticks_elapsed).
 * @param libraryTimeline   Resident's Library timeline entries (for library_event_count).
 */
export function evaluateSuccessPredicate(
    pred: SuccessPredicate | undefined,
    perception: PredicatePerception,
    stageStartedAtTick?: number,
    libraryTimeline?: ReadonlyArray<Record<string, unknown>>,
): boolean {
    if (!pred) {
        // No predicate: steps exhausted is sufficient for completion.
        return true;
    }

    switch (pred.kind) {
        case 'library_event_count': {
            const count = (libraryTimeline ?? []).filter(
                entry => typeof entry.kind === 'string' && entry.kind.includes(pred.eventPattern),
            ).length;
            return count >= pred.threshold;
        }

        case 'items_at_tiles': {
            const targetIds = new Set(pred.objectIds);
            const matched = (perception.nearby?.objects ?? []).filter(obj => targetIds.has(obj.objectId));
            return matched.length >= pred.tileCount;
        }

        case 'ticks_elapsed': {
            if (stageStartedAtTick == null || perception.tick == null) return false;
            return perception.tick - stageStartedAtTick >= pred.ticks;
        }

        case 'self_assessment':
            // Never auto-closes — forces a re-plan so the Brain can judge progress.
            return false;
    }
}
