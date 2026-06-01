import type { InferenceHealthResult } from '../llm/inference-health';
import { classifyDecisionCause } from '../admin/inference-health-audit';

/**
 * Resident Observatory — StatusAggregator (Phase 1).
 *
 * Pure, disk-free core: turns raw per-resident inputs (parsed runtime-state +
 * recent trajectory rows + the latest inference-health probe) into a compact,
 * human-legible CityStatus. The disk-reading + CLI layers sit on top of this and
 * inject the inputs, so the state machine is fully unit-testable without fs.
 *
 * Design rationale (see docs/superpowers/specs/2026-06-01-resident-observability-design.md):
 * lead with LIVENESS (ticksSinceAction), not the brain's latest thought — the
 * brain fires ~22x less often than the body, so a stale thought must never read
 * as "frozen". The 400-storm that was invisible tonight surfaces two ways: a red
 * health probe (global, <10s, cadence-independent) AND a per-resident run of
 * unusable brain decisions.
 */

export type ResidentState = 'ALIVE_ACTING' | 'THINKING' | 'STUCK' | 'ERRORING' | 'OFFLINE';

/** A trimmed trajectory row — only the fields the aggregator reads. */
export interface TrajectoryRowLite {
    kind: string; // 'action' | 'say' | 'decision' | ...
    tick?: number;
    cause?: string; // decision rows
    goalId?: string;
}

/** Per-resident raw input assembled by the disk layer. */
export interface ResidentRawInput {
    resident: string;
    /** Derived by the disk layer from runtime-state.json mtime freshness. */
    online: boolean;
    /** A brain call is currently in flight (runtime-state thinking telemetry). */
    thinking: boolean;
    state: {
        attention?: number;
        tick?: number;
        cognition?: {
            activeGoal?: { description?: string };
            lastBrainTick?: number;
        };
        stuckSince?: number;
        deceased?: { cause?: string };
    } | null;
    /** Most-recent trajectory rows (newest-last is fine; we scan all). */
    recentTrajectory: TrajectoryRowLite[];
}

export type CityHealthState = 'ok' | 'error' | 'timeout' | 'not_configured' | 'unknown';

export interface CityHealth {
    state: CityHealthState;
    detail: string;
    model?: string;
    endpoint?: string;
    latencyMs?: number;
}

export interface ResidentStatusRow {
    resident: string;
    online: boolean;
    state: ResidentState;
    /** Primary heartbeat: ticks since the last body/nervous action (not brain). */
    ticksSinceAction: number | null;
    currentGoal: string | null;
    storyLine: string;
    attention: number | null;
    lastInferenceCause: string | null;
    /** Share of recent brain decisions that were NOT usable (0..1), or null. */
    inferenceErrorRate: number | null;
    /** Ticks since the last brain decision — label thoughts honestly. */
    thoughtAgeTicks: number | null;
}

export interface CityStatus {
    health: CityHealth;
    residents: ResidentStatusRow[];
    erroringResidents: number;
    generatedAt: string;
}

/** Minimum recent decisions before a per-resident error rate is trusted. */
const MIN_DECISIONS_FOR_ERROR = 2;
const ERROR_RATE_THRESHOLD = 0.5;

export function healthFromProbe(probe: InferenceHealthResult | null): CityHealth {
    if (!probe) {
        return { state: 'unknown', detail: 'no inference-health probe has run yet' };
    }
    const base = { model: probe.model, endpoint: probe.endpoint, latencyMs: probe.latencyMs };
    if (probe.ok) {
        return { state: 'ok', detail: `probe ok (${probe.latencyMs ?? '?'}ms)`, ...base };
    }
    if (probe.status === 'not_configured') {
        return { state: 'not_configured', detail: 'inference endpoint is not configured', ...base };
    }
    if (probe.status === 'health_timeout') {
        return { state: 'timeout', detail: probe.error || 'inference health probe timed out', ...base };
    }
    // error, nooped_completion, empty_completion, unexpected_completion, cancelled → degraded/outage.
    return { state: 'error', detail: probe.error || `inference probe ${probe.status}`, ...base };
}

export function buildCityStatus(input: {
    health: InferenceHealthResult | null;
    residents: ResidentRawInput[];
    generatedAt: string;
}): CityStatus {
    const health = healthFromProbe(input.health);
    const healthRed = health.state === 'error' || health.state === 'timeout';
    const residents = input.residents.map(r => buildResidentRow(r, healthRed));
    return {
        health,
        residents,
        erroringResidents: residents.filter(r => r.state === 'ERRORING').length,
        generatedAt: input.generatedAt,
    };
}

function buildResidentRow(input: ResidentRawInput, healthRed: boolean): ResidentStatusRow {
    const state = input.state;
    const currentTick = numberOrNull(state?.tick);
    const currentGoal = state?.cognition?.activeGoal?.description ?? null;
    const attention = numberOrNull(state?.attention);

    const lastActionTick = latestActionTick(input.recentTrajectory);
    const ticksSinceAction = currentTick !== null && lastActionTick !== null ? Math.max(0, currentTick - lastActionTick) : null;

    const lastBrainTick = numberOrNull(state?.cognition?.lastBrainTick);
    const thoughtAgeTicks = currentTick !== null && lastBrainTick !== null ? Math.max(0, currentTick - lastBrainTick) : null;

    const { errorRate, decisions, lastCause } = inferenceErrorSummary(input.recentTrajectory);
    const selfErroring = decisions >= MIN_DECISIONS_FOR_ERROR && errorRate >= ERROR_RATE_THRESHOLD;

    const residentState = deriveState({
        online: input.online,
        deceased: Boolean(state?.deceased),
        healthRed,
        selfErroring,
        stuck: state?.stuckSince !== undefined && state?.stuckSince !== null,
        thinking: input.thinking,
    });

    return {
        resident: input.resident,
        online: input.online,
        state: residentState,
        ticksSinceAction,
        currentGoal,
        storyLine: composeStoryLine(input.resident, residentState, currentGoal, ticksSinceAction),
        attention,
        lastInferenceCause: lastCause,
        inferenceErrorRate: decisions > 0 ? round4(errorRate) : null,
        thoughtAgeTicks,
    };
}

function deriveState(s: {
    online: boolean;
    deceased: boolean;
    healthRed: boolean;
    selfErroring: boolean;
    stuck: boolean;
    thinking: boolean;
}): ResidentState {
    if (!s.online || s.deceased) return 'OFFLINE';
    if (s.healthRed || s.selfErroring) return 'ERRORING';
    if (s.stuck) return 'STUCK';
    if (s.thinking) return 'THINKING';
    return 'ALIVE_ACTING';
}

function latestActionTick(rows: TrajectoryRowLite[]): number | null {
    let best: number | null = null;
    for (const row of rows) {
        if ((row.kind === 'action' || row.kind === 'say') && typeof row.tick === 'number') {
            if (best === null || row.tick > best) best = row.tick;
        }
    }
    return best;
}

function inferenceErrorSummary(rows: TrajectoryRowLite[]): { errorRate: number; decisions: number; lastCause: string | null } {
    let decisions = 0;
    let unusable = 0;
    let lastCause: string | null = null;
    let lastTick = -Infinity;
    for (const row of rows) {
        if (row.kind !== 'decision') continue;
        decisions += 1;
        const cls = classifyDecisionCause(row.cause);
        if (cls !== 'clean' && cls !== 'recovered') unusable += 1;
        const tick = typeof row.tick === 'number' ? row.tick : -Infinity;
        if (tick >= lastTick) {
            lastTick = tick;
            lastCause = row.cause ?? null;
        }
    }
    return { errorRate: decisions > 0 ? unusable / decisions : 0, decisions, lastCause };
}

function composeStoryLine(resident: string, state: ResidentState, goal: string | null, ticksSinceAction: number | null): string {
    const goalShort = goal ? truncate(goal, 48) : 'no active goal';
    switch (state) {
        case 'OFFLINE':
            return `${resident} — offline`;
        case 'ERRORING':
            return `${resident} — ERRORING (inference) — goal: ${goalShort}`;
        case 'STUCK':
            return `${resident} — STUCK — goal: ${goalShort}`;
        case 'THINKING':
            return `${resident} — thinking — goal: ${goalShort}`;
        case 'ALIVE_ACTING':
        default: {
            const acted = ticksSinceAction === null ? 'acted recently' : `acted ${ticksSinceAction}t ago`;
            return `${resident} — ${goalShort} — ${acted}`;
        }
    }
}

function numberOrNull(value: number | undefined | null): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
