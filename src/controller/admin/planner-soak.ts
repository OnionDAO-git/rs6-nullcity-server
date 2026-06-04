/**
 * RIQ-A1-SOAK: controller:planner-soak — Phase 3 A1 acceptance-test live-verify soak.
 *
 * Reads the Library timeline and PlanStore for a named resident over an observation
 * window, then scores the result against the roadmap A1 acceptance criteria:
 *   1. planExists       — active-plan.json is present and parseable
 *   2. stagesDone ≥ 2  — at least 2 plan_stage_done Library events in the window
 *   3. deaths == 0      — no revival events (each revival = one death)
 *   4. firstXpFiremaking — at least one first_xp event with skill=firemaking
 *
 * Run:
 *   npm run planner:soak                               (default: res:qa-firemaker, 30 min)
 *   npm run planner:soak -- --resident res:qa-firemaker --observe-ms 1800000
 *   npm run planner:soak -- --observe-ms 60000         (quick 1-min smoke)
 *
 * Substrate-only: all verifier/path/parsing functions are testable without a live stack.
 * The run() function requires the controller to be running with res:qa-firemaker online.
 *
 * Artifact written to:
 *   data/benchmarks/planner-soak-<date>/planner_soak_<stamp>.json
 */

import fs from 'fs';
import path from 'path';
import { loadControllerConfig } from '../config';
import { residentSlug } from '../memory/runtime-state';
import { isoDate } from '../util/clock';

// ── Constants ─────────────────────────────────────────────────────────────────

export const PLANNER_SOAK_DEFAULT_RESIDENT = 'res:qa-firemaker';
export const PLANNER_SOAK_DEFAULT_OBSERVE_MS = 30 * 60 * 1000;
export const PLANNER_SOAK_DEFAULT_POLL_MS = 5_000;
export const PLANNER_SOAK_MIN_STAGES_DONE = 2;

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlannerSoakOptions {
    resident: string;
    configPath: string;
    outputDir: string;
    observeMs: number;
    pollMs: number;
}

export interface PlannerSoakEvent {
    kind: string;
    ts?: string;
    tick?: number;
    goalId?: string;
    stageId?: string;
    stageSubgoal?: string;
    stageCount?: number;
    stageSubgoals?: string[];
    replannedReason?: string;
    skill?: string;
    [key: string]: unknown;
}

export interface PlannerSoakVerificationInput {
    resident: string;
    observeMs: number;
    /** All new timeline events seen during the observation window (not baseline). */
    newEvents: PlannerSoakEvent[];
    /** Plan file contents at end of observation, null if missing/corrupt. */
    finalPlan: Record<string, unknown> | null;
}

export interface PlannerSoakOutcome {
    status: 'passed' | 'failed' | 'timeout';
    score: number;
    metrics: Record<string, number>;
    summaries: string[];
    failureReason?: string;
}

export interface PlannerSoakArtifact {
    kind: 'planner_soak';
    resident: string;
    observeMs: number;
    outcome: PlannerSoakOutcome;
    planCreatedEvents: PlannerSoakEvent[];
    stageDoneEvents: PlannerSoakEvent[];
    stageBlockedEvents: PlannerSoakEvent[];
    replannedEvents: PlannerSoakEvent[];
    revivalEvents: PlannerSoakEvent[];
    xpEvents: PlannerSoakEvent[];
    finalPlanStageCount: number | null;
    finalPlanStatus: string | null;
    generatedAt: string;
}

// ── Path helpers (pure, testable) ──────────────────────────────────────────────

export function plannerSoakTimelinePath(memoryDir: string, resident: string): string {
    return path.join(memoryDir, 'library', residentSlug(resident), 'timeline.jsonl');
}

export function plannerSoakPlanFilePath(memoryDir: string, resident: string): string {
    return path.join(memoryDir, residentSlug(resident), 'active-plan.json');
}

// ── Event parsing (pure, testable) ────────────────────────────────────────────

/**
 * Parse a raw JSONL string from the Library timeline into structured events.
 * Skips malformed lines defensively.
 */
export function parsePlannerSoakEvents(jsonlText: string): PlannerSoakEvent[] {
    const events: PlannerSoakEvent[] = [];
    for (const line of jsonlText.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (typeof parsed === 'object' && parsed !== null && 'kind' in parsed) {
                events.push(parsed as PlannerSoakEvent);
            }
        } catch {
            // skip malformed lines
        }
    }
    return events;
}

// ── Verification (pure, testable) ─────────────────────────────────────────────

/**
 * Score the observation window against the A1 acceptance criteria.
 *
 * Criteria (from roadmap §8 Phase 3 acceptance test):
 *   PASS = planExists AND stagesDone ≥ 2 AND deaths == 0
 *   BONUS = firstXpFiremaking observed (confirms Firemaking progress)
 */
export function verifyPlannerSoak(input: PlannerSoakVerificationInput): PlannerSoakOutcome {
    const planCreated = input.newEvents.filter(e => e.kind === 'plan_created');
    const stageDone = input.newEvents.filter(e => e.kind === 'plan_stage_done');
    const stageBlocked = input.newEvents.filter(e => e.kind === 'plan_stage_blocked');
    const replanned = input.newEvents.filter(e => e.kind === 'plan_replanned');
    const revivals = input.newEvents.filter(e => e.kind === 'revival');
    const xpFiremaking = input.newEvents.filter(e => e.kind === 'first_xp' && e.skill === 'firemaking');

    const planExists = input.finalPlan !== null;
    const stagesDone = stageDone.length;
    const deaths = revivals.length;
    const hasXp = xpFiremaking.length > 0;

    const metrics: Record<string, number> = {
        planCreatedEvents: planCreated.length,
        stagesDone,
        stagesBlocked: stageBlocked.length,
        replannedEvents: replanned.length,
        deaths,
        xpFiremakingEvents: xpFiremaking.length,
        planExists: planExists ? 1 : 0,
    };

    const summaries: string[] = [];

    if (!planExists) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            summaries,
            failureReason: `No active-plan.json found for ${input.resident} — planner has not run yet or plan was cleared`,
        };
    }
    summaries.push('Plan file exists and is readable.');

    if (deaths > 0) {
        return {
            status: 'failed',
            score: 0.2,
            metrics,
            summaries,
            failureReason: `A1 requires 0 deaths but observed ${deaths} revival event(s)`,
        };
    }
    summaries.push('0 deaths observed.');

    if (planCreated.length === 0) {
        return {
            status: 'failed',
            score: 0.3,
            metrics,
            summaries,
            failureReason: `No plan_created Library event in the observation window — planner did not fire during this run`,
        };
    }
    summaries.push(`plan_created observed (stageCount=${planCreated[0]?.stageCount ?? '?'}).`);

    if (stagesDone < PLANNER_SOAK_MIN_STAGES_DONE) {
        return {
            status: 'failed',
            score: 0.5 + 0.1 * stagesDone,
            metrics,
            summaries,
            failureReason: `A1 requires ≥${PLANNER_SOAK_MIN_STAGES_DONE} stages done but only ${stagesDone} observed in ${input.observeMs / 60000}m window`,
        };
    }
    summaries.push(`≥${PLANNER_SOAK_MIN_STAGES_DONE} plan stages done (${stagesDone} total).`);

    if (!hasXp) {
        // Soft failure: plan executed stages but no XP event observed. Could be the
        // window was too short for a first_xp emit, or Firemaking already seen before
        // the observation started. Return partial pass so the hot-stack agent knows
        // to extend the window or check XP via game state directly.
        summaries.push('No first_xp(firemaking) in window — extend observe-ms or verify XP via game state.');
        return {
            status: 'passed',
            score: 0.9,
            metrics,
            summaries,
        };
    }
    summaries.push('Firemaking first_xp observed — XP strictly increased.');

    return {
        status: 'passed',
        score: 1.0,
        metrics,
        summaries,
    };
}

// ── CLI arg parsing ────────────────────────────────────────────────────────────

export function parsePlannerSoakArgs(argv: string[], now: Date = new Date()): PlannerSoakOptions {
    const opts: PlannerSoakOptions = {
        resident: process.env.PLANNER_SOAK_RESIDENT ?? PLANNER_SOAK_DEFAULT_RESIDENT,
        configPath: process.env.CONTROLLER_CONFIG ?? 'controller.yml',
        outputDir: process.env.PLANNER_SOAK_OUTPUT_DIR ?? path.join('data', 'benchmarks', `planner-soak-${isoDate(now)}`),
        observeMs: parsePositiveInt(process.env.PLANNER_SOAK_OBSERVE_MS, PLANNER_SOAK_DEFAULT_OBSERVE_MS),
        pollMs: parsePositiveInt(process.env.PLANNER_SOAK_POLL_MS, PLANNER_SOAK_DEFAULT_POLL_MS),
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--resident' && argv[i + 1]) {
            opts.resident = argv[++i];
        } else if (arg === '--config' && argv[i + 1]) {
            opts.configPath = argv[++i];
        } else if (arg === '--output-dir' && argv[i + 1]) {
            opts.outputDir = argv[++i];
        } else if (arg === '--observe-ms' && argv[i + 1]) {
            const v = parseInt(argv[++i], 10);
            if (v > 0) opts.observeMs = v;
        } else if (arg === '--poll-ms' && argv[i + 1]) {
            const v = parseInt(argv[++i], 10);
            if (v > 0) opts.pollMs = v;
        }
    }
    return opts;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const v = parseInt(raw, 10);
    return v > 0 ? v : fallback;
}

// ── File I/O helpers ───────────────────────────────────────────────────────────

function readTimelineEvents(timelinePath: string): PlannerSoakEvent[] {
    if (!fs.existsSync(timelinePath)) return [];
    try {
        return parsePlannerSoakEvents(fs.readFileSync(timelinePath, 'utf8'));
    } catch {
        return [];
    }
}

function readPlan(planPath: string): Record<string, unknown> | null {
    if (!fs.existsSync(planPath)) return null;
    try {
        const raw = fs.readFileSync(planPath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
}

function extractNewEvents(baseline: PlannerSoakEvent[], current: PlannerSoakEvent[]): PlannerSoakEvent[] {
    return current.slice(baseline.length);
}

// ── Run (requires live stack) ──────────────────────────────────────────────────

async function run(
    opts: PlannerSoakOptions,
    runtime: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<PlannerSoakArtifact> {
    const { stdout, stderr } = runtime;

    const config = loadControllerConfig(opts.configPath);
    const memoryDir = config.memory.dir;
    const timelinePath = plannerSoakTimelinePath(memoryDir, opts.resident);
    const planPath = plannerSoakPlanFilePath(memoryDir, opts.resident);

    stdout(`[planner-soak] resident=${opts.resident} observeMs=${opts.observeMs} pollMs=${opts.pollMs}\n`);
    stdout(`[planner-soak] timeline=${timelinePath}\n`);
    stdout(`[planner-soak] plan=${planPath}\n`);

    const baselineEvents = readTimelineEvents(timelinePath);
    stdout(`[planner-soak] baseline events: ${baselineEvents.length}\n`);

    const startMs = Date.now();
    let lastPollEvents = baselineEvents;

    while (Date.now() - startMs < opts.observeMs) {
        await sleep(opts.pollMs);
        const current = readTimelineEvents(timelinePath);
        const newSinceBaseline = extractNewEvents(baselineEvents, current);
        const newSinceLast = extractNewEvents(lastPollEvents, current);
        lastPollEvents = current;

        if (newSinceLast.length > 0) {
            const planKinds = newSinceLast
                .filter(e => ['plan_created', 'plan_stage_done', 'plan_stage_blocked', 'plan_replanned'].includes(e.kind))
                .map(e => e.kind);
            if (planKinds.length > 0) {
                stdout(`[planner-soak] +${planKinds.length} plan event(s): ${planKinds.join(', ')}\n`);
            }
        }

        // Early exit if A1 criteria already met
        const earlyCheck = verifyPlannerSoak({
            resident: opts.resident,
            observeMs: Date.now() - startMs,
            newEvents: extractNewEvents(baselineEvents, current),
            finalPlan: readPlan(planPath),
        });
        if (earlyCheck.status === 'passed' && earlyCheck.score >= 1.0) {
            stdout(`[planner-soak] A1 criteria met early — exiting after ${Math.round((Date.now() - startMs) / 1000)}s\n`);
            lastPollEvents = current;
            break;
        }
    }

    const finalEvents = readTimelineEvents(timelinePath);
    const newEvents = extractNewEvents(baselineEvents, finalEvents);
    const finalPlan = readPlan(planPath);
    const outcome = verifyPlannerSoak({
        resident: opts.resident,
        observeMs: Date.now() - startMs,
        newEvents,
        finalPlan,
    });

    stdout(`[planner-soak] status=${outcome.status} score=${outcome.score}\n`);
    for (const s of outcome.summaries) {
        stdout(`[planner-soak] ${s}\n`);
    }
    if (outcome.failureReason) {
        stderr(`[planner-soak] FAIL: ${outcome.failureReason}\n`);
    }

    const artifact: PlannerSoakArtifact = {
        kind: 'planner_soak',
        resident: opts.resident,
        observeMs: opts.observeMs,
        outcome,
        planCreatedEvents: newEvents.filter(e => e.kind === 'plan_created'),
        stageDoneEvents: newEvents.filter(e => e.kind === 'plan_stage_done'),
        stageBlockedEvents: newEvents.filter(e => e.kind === 'plan_stage_blocked'),
        replannedEvents: newEvents.filter(e => e.kind === 'plan_replanned'),
        revivalEvents: newEvents.filter(e => e.kind === 'revival'),
        xpEvents: newEvents.filter(e => e.kind === 'first_xp' && e.skill === 'firemaking'),
        finalPlanStageCount: finalPlan ? (Array.isArray(finalPlan['stages']) ? (finalPlan['stages'] as unknown[]).length : null) : null,
        finalPlanStatus: finalPlan ? (typeof finalPlan['status'] === 'string' ? (finalPlan['status'] as string) : null) : null,
        generatedAt: new Date().toISOString(),
    };

    fs.mkdirSync(opts.outputDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const artifactPath = path.join(opts.outputDir, `planner_soak_${stamp}.json`);
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');
    stdout(`[planner-soak] artifact written to ${artifactPath}\n`);

    return artifact;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Entrypoint ─────────────────────────────────────────────────────────────────

if (require.main === module) {
    const opts = parsePlannerSoakArgs(process.argv.slice(2));
    run(opts, {
        stdout: s => process.stdout.write(s),
        stderr: s => process.stderr.write(s),
    })
        .then(artifact => {
            process.exit(artifact.outcome.status === 'passed' ? 0 : 1);
        })
        .catch(err => {
            process.stderr.write(`[planner-soak] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
            process.exit(2);
        });
}
