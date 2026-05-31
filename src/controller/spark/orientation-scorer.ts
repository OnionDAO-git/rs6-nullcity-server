/**
 * S-GOAL-2: Rule-based OrientationScorer + OrientationStallTracker.
 *
 * Detects when a resident is making progress toward their soul-level orientation
 * goal (SoulOrientationGoal from S-GOAL-1) and tracks stall windows so the runtime
 * can emit `orientation_progress` and `orientation_stalled` Library events.
 *
 * Pure / no I/O. The LibraryUpdater (library-updater.ts) owns the timeline
 * write via `observeOrientationProgress` / `observeOrientationStalled`.
 * The resident runtime (S-GOAL-3) calls this module per tick.
 */

/** Consecutive non-progress ticks before a new stall is signalled. */
export const ORIENTATION_STALL_WINDOW = 100;

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

/** How the scorer determined that progress occurred. */
export type OrientationProgressReason = 'goal_id_match' | 'action_tag_match';

export interface OrientationScorerInput {
    /** `SoulOrientationGoal.id` from the resident's soul YAML. */
    orientationGoalId: string;
    /**
     * The goal id the resident was actively pursuing when the action executed
     * (e.g. `cognition.activeGoal?.id`). Progress is detected when this equals
     * `orientationGoalId` — meaning the needs-hierarchy ranker elected the
     * orientation candidate this tick.
     */
    currentGoalId?: string;
    /**
     * Tags on the executed action (module tags, routine tags, or explicit goal
     * ids attached by the action result). Progress is also detected when a tag
     * equals `orientationGoalId` or starts with `${orientationGoalId}:`.
     */
    actionTags?: string[];
}

export interface OrientationProgressResult {
    progressDetected: boolean;
    reason?: OrientationProgressReason;
}

/**
 * Pure, stateless scorer. Returns `progressDetected: true` when the action
 * constitutes evidence of progress toward the orientation goal.
 *
 * Detection priority (first match wins):
 * 1. `currentGoalId === orientationGoalId` — the ranker chose the orientation
 *    candidate; the resident acted directly on their goal.
 * 2. Any `actionTag` exactly equals or starts with `orientationGoalId:` —
 *    the action carries an explicit orientation tag.
 */
export function scoreOrientationAction(input: OrientationScorerInput): OrientationProgressResult {
    const { orientationGoalId, currentGoalId, actionTags } = input;

    if (currentGoalId !== undefined && currentGoalId === orientationGoalId) {
        return { progressDetected: true, reason: 'goal_id_match' };
    }

    if (actionTags) {
        for (const tag of actionTags) {
            if (tag === orientationGoalId || tag.startsWith(`${orientationGoalId}:`)) {
                return { progressDetected: true, reason: 'action_tag_match' };
            }
        }
    }

    return { progressDetected: false };
}

// ---------------------------------------------------------------------------
// Stall tracker
// ---------------------------------------------------------------------------

export interface StallTrackResult {
    /** Consecutive ticks without detected orientation progress. */
    nonProgressTicks: number;
    /**
     * `true` exactly on the tick when the stall window is first crossed.
     * The caller should emit `orientation_stalled` when this is `true`.
     */
    newStall: boolean;
    /**
     * `true` on subsequent ticks that remain stalled after `newStall` fired.
     * No additional Library event is emitted until progress resets the tracker.
     */
    alreadyStalled: boolean;
}

/**
 * Stateful per-resident tracker. Counts consecutive non-progress ticks and
 * signals when the resident has crossed the stall threshold.
 *
 * The tracker fires `newStall` exactly once per stall episode. Progress resets
 * both the counter and the `stallEmitted` flag so a fresh stall can be detected
 * later if the resident regresses.
 *
 * Instantiate one tracker per resident that has an `orientationGoal`.
 * Discard and recreate when the resident's orientation goal changes.
 */
export class OrientationStallTracker {
    private nonProgressTicks_ = 0;
    private stallEmitted_ = false;

    constructor(private readonly stallWindow: number = ORIENTATION_STALL_WINDOW) {}

    /**
     * Record one tick result. Pass `true` when `scoreOrientationAction` returned
     * `progressDetected: true`; pass `false` otherwise.
     */
    record(progressDetected: boolean): StallTrackResult {
        if (progressDetected) {
            this.nonProgressTicks_ = 0;
            this.stallEmitted_ = false;
            return { nonProgressTicks: 0, newStall: false, alreadyStalled: false };
        }

        this.nonProgressTicks_++;
        const crossed = this.nonProgressTicks_ >= this.stallWindow;

        if (crossed && !this.stallEmitted_) {
            this.stallEmitted_ = true;
            return {
                nonProgressTicks: this.nonProgressTicks_,
                newStall: true,
                alreadyStalled: false,
            };
        }

        return {
            nonProgressTicks: this.nonProgressTicks_,
            newStall: false,
            alreadyStalled: crossed && this.stallEmitted_,
        };
    }

    /**
     * Reset without a progress event (e.g. the resident's orientation goal
     * changed via an operator nudge). Allows a fresh stall episode.
     */
    reset(): void {
        this.nonProgressTicks_ = 0;
        this.stallEmitted_ = false;
    }

    get nonProgressTicks(): number {
        return this.nonProgressTicks_;
    }
}

// ---------------------------------------------------------------------------
// Library event types (written by LibraryUpdater in S-GOAL-3 wire-up)
// ---------------------------------------------------------------------------

/**
 * Timeline event appended when an action advances the resident's orientation
 * goal. Only emitted when `scoreOrientationAction` returns `progressDetected:
 * true` — never on stale-state or inventory-only observations.
 */
export interface OrientationProgressLibraryEvent {
    kind: 'orientation_progress';
    ts: string;
    tick: number;
    /** SoulOrientationGoal.id — allows cross-referencing the soul YAML. */
    orientationGoalId: string;
    /** SoulOrientationGoal.description — human-readable label for the Storyteller. */
    orientationGoalDescription: string;
    /** Reason the scorer detected progress. */
    reason: OrientationProgressReason;
}

/**
 * Timeline event appended when a resident reaches ORIENTATION_STALL_WINDOW
 * consecutive ticks without orientation progress. Emitted at most once per
 * stall episode; resets on the next `progressDetected: true` tick.
 */
export interface OrientationStalledLibraryEvent {
    kind: 'orientation_stalled';
    ts: string;
    tick: number;
    orientationGoalId: string;
    orientationGoalDescription: string;
    /** Total consecutive non-progress ticks when the stall was detected. */
    nonProgressTicks: number;
}
