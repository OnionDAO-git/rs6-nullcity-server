import { z } from 'zod';

/**
 * Status of a routine run.
 *
 * - `completed` — completion predicate fired before maxTicks elapsed.
 * - `stuck`     — 3 consecutive ticks without meaningful progress.
 * - `timeout`   — maxTicks elapsed without completion.
 * - `preempted` — caller aborted, OR Nervous System reflex took the slot.
 * - `rejected`  — request was invalid (resident, routine, params, maxTicks,
 *                 auth, or rate limit). Never started.
 */
export type RoutineRunStatus = 'completed' | 'stuck' | 'preempted' | 'timeout' | 'rejected';

export type RoutineRejectionReason =
    | 'resident_not_found'
    | 'routine_not_whitelisted'
    | 'params_invalid'
    | 'maxticks_out_of_range'
    | 'unauthorized'
    | 'rate_limited';

export type RoutinePreemptionReason =
    | 'aborted'
    | 'nervous_eat_when_hurt'
    | 'nervous_flee_when_outmatched'
    | 'nervous_death'
    | 'nervous_help_request';

/** Result returned to the caller (and to the MCP server in later slices). */
export interface RunRoutineResponse {
    status: RoutineRunStatus;
    ticksUsed: number;
    effectEvidenceCount: number;
    trajectoryHints?: string[];
    lastError?: RoutineRejectionReason | RoutinePreemptionReason;
}

/** Per-tick context the impl receives. Kept tiny so future runtime swaps are cheap. */
export interface RoutineContext {
    /** Tick index within the routine run, starting at 0. */
    tickIndex: number;
    /** Caller's AbortSignal; impl should respect it. */
    signal: AbortSignal;
    /** Total maxTicks budget. */
    maxTicks: number;
}

/**
 * Outcome of one tick of a routine impl. The runner switches on this:
 * - 'completed'   → success
 * - 'progress'    → keep going; reset stuck counter
 * - 'no_progress' → keep going; increment stuck counter (3 → status=stuck)
 * - { preempted: <reason> } → status=preempted with reason
 *
 * Real impls will wrap ActionCoordinator + ProgressTracker. Tests use mocks
 * with this exact sentinel-string contract.
 */
export type RoutineTickOutcome = 'completed' | 'progress' | 'no_progress' | { preempted: RoutinePreemptionReason };

/**
 * The runtime handle the runner needs. Real ResidentRuntime will implement
 * `tick(ctx)` by pushing an intent into ActionCoordinator (producer:
 * 'active-routine', priority 2, already in PRODUCER_PRIORITY) and polling
 * ProgressTracker / events.
 *
 * For RB-MCP-α the runtime is mocked; RB-MCP-γ wires the real path.
 */
export interface RoutineCapableRuntime {
    tick(ctx: RoutineContext): Promise<RoutineTickOutcome>;
    /** Optional per-tick hints the runner accumulates into trajectoryHints. */
    _lastHints?: string[];
}

export interface RoutineEntry<Params = unknown> {
    id: string;
    paramSchema: z.ZodType<Params>;
    impl: (runtime: RoutineCapableRuntime, params: Params, ctx: RoutineContext) => Promise<RoutineTickOutcome>;
}

/** Whitelisted routine catalog. Adding a routine requires a code change + tests. */
export const ROUTINE_CATALOG: Record<string, RoutineEntry> = {
    make_fire: {
        id: 'make_fire',
        paramSchema: z.object({}).strict(),
        impl: async (runtime, _params, ctx) => runtime.tick(ctx),
    },
};

export type RoutineId = keyof typeof ROUTINE_CATALOG;

export interface RunRoutineRequest {
    resident: string;
    routine: RoutineId | string;
    params?: unknown;
    maxTicks?: number;
    signal?: AbortSignal;
}

export interface RoutineRunnerOptions {
    runtimes: Map<string, RoutineCapableRuntime>;
}

const DEFAULT_MAX_TICKS = 200;
const MAX_TICKS_HARD_LIMIT = 1200;
const STUCK_THRESHOLD = 3;

/**
 * Whitelisted-routine execution kernel. RB-MCP-α exposes this directly to
 * tests; RB-MCP-γ wires it behind the MCP `run_routine` tool.
 */
export class RoutineRunner {
    constructor(private readonly options: RoutineRunnerOptions) {}

    async run(request: RunRoutineRequest): Promise<RunRoutineResponse> {
        const runtime = this.options.runtimes.get(request.resident);
        if (!runtime) {
            return reject('resident_not_found');
        }

        const entry = ROUTINE_CATALOG[request.routine];
        if (!entry) {
            return reject('routine_not_whitelisted');
        }

        const maxTicks = request.maxTicks ?? DEFAULT_MAX_TICKS;
        if (!Number.isInteger(maxTicks) || maxTicks < 1 || maxTicks > MAX_TICKS_HARD_LIMIT) {
            return reject('maxticks_out_of_range');
        }

        const parsedParams = entry.paramSchema.safeParse(request.params ?? {});
        if (!parsedParams.success) {
            return reject('params_invalid');
        }

        const signal = request.signal ?? new AbortController().signal;
        const hints: string[] = [];
        let stuckCounter = 0;
        let effectEvidenceCount = 0;

        for (let tickIndex = 0; tickIndex < maxTicks; tickIndex += 1) {
            if (signal.aborted) {
                return preempted(tickIndex, 'aborted', hints, effectEvidenceCount);
            }

            const ctx: RoutineContext = { tickIndex, signal, maxTicks };
            let outcome: RoutineTickOutcome;
            try {
                outcome = await entry.impl(runtime, parsedParams.data, ctx);
            } catch (_err) {
                // Treat any thrown error as a preemption with a generic reason.
                return preempted(tickIndex + 1, 'aborted', hints, effectEvidenceCount);
            }

            if (runtime._lastHints && runtime._lastHints.length > 0) {
                for (const hint of runtime._lastHints) {
                    if (!hints.includes(hint)) {
                        hints.push(hint);
                    }
                }
            }

            if (typeof outcome === 'object' && outcome !== null && 'preempted' in outcome) {
                return preempted(tickIndex + 1, outcome.preempted, hints, effectEvidenceCount);
            }

            if (outcome === 'completed') {
                effectEvidenceCount += 1;
                return {
                    status: 'completed',
                    ticksUsed: tickIndex + 1,
                    effectEvidenceCount,
                    trajectoryHints: hints.length > 0 ? hints : undefined,
                };
            }

            if (outcome === 'no_progress') {
                stuckCounter += 1;
                if (stuckCounter >= STUCK_THRESHOLD) {
                    return {
                        status: 'stuck',
                        ticksUsed: tickIndex + 1,
                        effectEvidenceCount,
                        trajectoryHints: hints.length > 0 ? hints : undefined,
                    };
                }
            } else {
                // 'progress' resets the stuck counter and counts as effect evidence.
                stuckCounter = 0;
                effectEvidenceCount += 1;
            }
        }

        return {
            status: 'timeout',
            ticksUsed: maxTicks,
            effectEvidenceCount,
            trajectoryHints: hints.length > 0 ? hints : undefined,
        };
    }
}

function reject(reason: RoutineRejectionReason): RunRoutineResponse {
    return { status: 'rejected', ticksUsed: 0, effectEvidenceCount: 0, lastError: reason };
}

function preempted(ticksUsed: number, reason: RoutinePreemptionReason, hints: string[], effectEvidenceCount: number): RunRoutineResponse {
    return {
        status: 'preempted',
        ticksUsed,
        effectEvidenceCount,
        lastError: reason,
        trajectoryHints: hints.length > 0 ? hints : undefined,
    };
}
