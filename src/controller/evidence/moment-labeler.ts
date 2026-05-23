import type { TrajectoryLine } from './schemas';

/**
 * Trajectory moment-labels (RB-MOMENTS).
 *
 * The Library of Souls is most readable when raw trajectory entries are
 * supplemented by named milestones — moments a future reader (LLM or
 * human) can scan to understand "what mattered this session". The four
 * canonical labels were drawn from the RuneBench technique audit and the
 * Null City portrait template:
 *   - first_log              — first time we successfully chop a log
 *   - fire_lit               — successful firemaking (matches LoreBus kind)
 *   - stuck_recovery         — we were stuck and we got unstuck
 *   - unsafe_combat_avoided  — a nervous rule saved us from a bad fight
 *
 * This module is pure substrate: it owns the per-session dedup state and
 * writes typed lines through a small builder interface. Runtime wiring
 * (resident-runtime.ts subscribing to body-routine outcomes + the
 * fire-lit-reflex bus subscription) is a follow-on slice so this commit
 * can land safely without touching the live tick.
 *
 * See docs/strategic-review-2026-05-23.md § "Trajectory moment-labels".
 */
export const MOMENT_KINDS = ['first_log', 'fire_lit', 'stuck_recovery', 'unsafe_combat_avoided'] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

/**
 * Shape of the `moment` field inside a trajectory line.
 *
 * The schema (`trajectoryLineSchema` in schemas.ts) is intentionally
 * `passthrough()` so per-kind fields like `moment` are not enumerated at
 * the schema layer. This typed view documents the contract for
 * downstream consumers (portrait template, library timeline reader).
 */
export interface MomentLine extends TrajectoryLine {
    kind: 'moment';
    moment: {
        kind: MomentKind;
        detail: Record<string, unknown>;
    };
}

/**
 * Minimal append-only interface the labeler needs from a trajectory
 * sink. The real `TrajectoryBuilder` already exposes a `private append`;
 * a thin public wrapper / adapter (or direct call from runtime wiring)
 * will satisfy this in the integration slice.
 */
export interface MomentTrajectoryBuilder {
    append(kind: 'moment', fields: Record<string, unknown>): TrajectoryLine;
}

export interface MomentLabelerOptions {
    builder: MomentTrajectoryBuilder;
    /**
     * Stuck duration (ticks) at-or-above which {@link MomentLabeler.noteStuckResolved}
     * actually emits a stuck_recovery moment. Defaults to 3 — anything
     * shorter is transient noise, not a story beat.
     */
    stuckThresholdTicks?: number;
}

const DEFAULT_STUCK_THRESHOLD = 3;

/**
 * Records named moments to the trajectory. Once-per-session moments
 * (first_log) are deduplicated internally; per-event moments (fire_lit,
 * unsafe_combat_avoided) fire on every call because the upstream source
 * — the fire-lit reflex or a nervous-rule preempt — already handles
 * dedup. {@link reset} re-arms once-per-session moments at session
 * boundaries.
 */
export class MomentLabeler {
    private readonly builder: MomentTrajectoryBuilder;
    private readonly stuckThresholdTicks: number;
    private firstLogEmitted = false;

    constructor(options: MomentLabelerOptions) {
        this.builder = options.builder;
        this.stuckThresholdTicks = options.stuckThresholdTicks ?? DEFAULT_STUCK_THRESHOLD;
    }

    noteLogChopped(detail: { logItemId: number }): TrajectoryLine | undefined {
        if (this.firstLogEmitted) {
            return undefined;
        }
        this.firstLogEmitted = true;
        return this.emit('first_log', { logItemId: detail.logItemId });
    }

    noteFireLit(detail: { position: { x: number; y: number; level: number } }): TrajectoryLine {
        return this.emit('fire_lit', { position: { ...detail.position } });
    }

    noteStuckResolved(detail: { durationTicks: number; reason: string }): TrajectoryLine | undefined {
        if (detail.durationTicks < this.stuckThresholdTicks) {
            return undefined;
        }
        return this.emit('stuck_recovery', {
            durationTicks: detail.durationTicks,
            reason: detail.reason,
        });
    }

    noteUnsafeCombatAvoided(detail: { ruleId: string; targetName: string }): TrajectoryLine {
        return this.emit('unsafe_combat_avoided', {
            ruleId: detail.ruleId,
            targetName: detail.targetName,
        });
    }

    reset(): void {
        this.firstLogEmitted = false;
    }

    private emit(kind: MomentKind, detail: Record<string, unknown>): TrajectoryLine {
        return this.builder.append('moment', { moment: { kind, detail } });
    }
}
