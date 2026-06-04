import path from 'path';
import {
    parsePlannerSoakArgs,
    parsePlannerSoakEvents,
    plannerSoakPlanFilePath,
    plannerSoakTimelinePath,
    verifyPlannerSoak,
    PLANNER_SOAK_DEFAULT_OBSERVE_MS,
    PLANNER_SOAK_DEFAULT_POLL_MS,
    PLANNER_SOAK_DEFAULT_RESIDENT,
    PLANNER_SOAK_MIN_STAGES_DONE,
} from './planner-soak';

// ── Path helpers ────────────────────────────────────────────────────────────

describe('plannerSoakTimelinePath', () => {
    it('builds the correct Library timeline path', () => {
        const p = plannerSoakTimelinePath('/data/memory', 'res:qa-firemaker');
        expect(p).toBe(path.join('/data/memory', 'library', 'res-qa-firemaker', 'timeline.jsonl'));
    });

    it('uses residentSlug to coerce colons to hyphens', () => {
        expect(plannerSoakTimelinePath('/m', 'res:agent')).toContain('res-agent');
    });
});

describe('plannerSoakPlanFilePath', () => {
    it('builds the correct active-plan path', () => {
        const p = plannerSoakPlanFilePath('/data/memory', 'res:qa-firemaker');
        expect(p).toBe(path.join('/data/memory', 'res-qa-firemaker', 'active-plan.json'));
    });
});

// ── Event parsing ───────────────────────────────────────────────────────────

describe('parsePlannerSoakEvents', () => {
    it('parses valid JSONL lines', () => {
        const jsonl = [
            JSON.stringify({ kind: 'plan_created', ts: '2026-06-04T17:00:00Z', tick: 100, stageCount: 3 }),
            JSON.stringify({ kind: 'plan_stage_done', tick: 200, stageId: 'gather-logs' }),
        ].join('\n');
        const events = parsePlannerSoakEvents(jsonl);
        expect(events).toHaveLength(2);
        expect(events[0].kind).toBe('plan_created');
        expect(events[1].stageId).toBe('gather-logs');
    });

    it('skips malformed lines without throwing', () => {
        const jsonl = 'not-json\n' + JSON.stringify({ kind: 'plan_created', tick: 1 });
        const events = parsePlannerSoakEvents(jsonl);
        expect(events).toHaveLength(1);
    });

    it('skips lines that parse but lack a kind field', () => {
        const jsonl = JSON.stringify({ ts: '2026-06-04T17:00:00Z', noKind: true });
        expect(parsePlannerSoakEvents(jsonl)).toHaveLength(0);
    });

    it('returns empty array for empty string', () => {
        expect(parsePlannerSoakEvents('')).toHaveLength(0);
    });
});

// ── Verification ─────────────────────────────────────────────────────────────

import type { PlannerSoakEvent } from './planner-soak';

const planCreatedEvent: PlannerSoakEvent = { kind: 'plan_created', stageCount: 3 };
const stageDoneEvent = (id: string): PlannerSoakEvent => ({ kind: 'plan_stage_done', stageId: id });
const revivalEvent: PlannerSoakEvent = { kind: 'revival' };
const xpFiremakingEvent: PlannerSoakEvent = { kind: 'first_xp', skill: 'firemaking' };
const validPlan = { stages: [{}, {}, {}], status: 'active' };

describe('verifyPlannerSoak — pass conditions', () => {
    it('passes with score 1.0 when all A1 criteria met including XP', () => {
        const outcome = verifyPlannerSoak({
            resident: 'res:qa-firemaker',
            observeMs: 1_800_000,
            newEvents: [planCreatedEvent, stageDoneEvent('gather-logs'), stageDoneEvent('light-fires'), xpFiremakingEvent],
            finalPlan: validPlan,
        });
        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1.0);
        expect(outcome.metrics.stagesDone).toBe(2);
        expect(outcome.metrics.xpFiremakingEvents).toBe(1);
        expect(outcome.metrics.deaths).toBe(0);
    });

    it('passes with score 0.9 when stages done and no deaths but no XP event', () => {
        const outcome = verifyPlannerSoak({
            resident: 'res:qa-firemaker',
            observeMs: 1_800_000,
            newEvents: [planCreatedEvent, stageDoneEvent('s1'), stageDoneEvent('s2')],
            finalPlan: validPlan,
        });
        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(0.9);
    });

    it(`passes when exactly ${PLANNER_SOAK_MIN_STAGES_DONE} stages done`, () => {
        const events: PlannerSoakEvent[] = [planCreatedEvent];
        for (let i = 0; i < PLANNER_SOAK_MIN_STAGES_DONE; i++) {
            events.push(stageDoneEvent(`stage-${i}`));
        }
        events.push(xpFiremakingEvent);
        const outcome = verifyPlannerSoak({
            resident: 'res:qa-firemaker',
            observeMs: 100_000,
            newEvents: events,
            finalPlan: validPlan,
        });
        expect(outcome.status).toBe('passed');
    });
});

describe('verifyPlannerSoak — failure conditions', () => {
    it('fails with score 0 when no plan file', () => {
        const outcome = verifyPlannerSoak({
            resident: 'res:qa-firemaker',
            observeMs: 60_000,
            newEvents: [planCreatedEvent, stageDoneEvent('s1'), stageDoneEvent('s2')],
            finalPlan: null,
        });
        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0);
        expect(outcome.failureReason).toContain('active-plan.json');
    });

    it('fails with score 0.2 when deaths > 0', () => {
        const outcome = verifyPlannerSoak({
            resident: 'res:qa-firemaker',
            observeMs: 60_000,
            newEvents: [planCreatedEvent, stageDoneEvent('s1'), stageDoneEvent('s2'), revivalEvent],
            finalPlan: validPlan,
        });
        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.2);
        expect(outcome.failureReason).toContain('death');
        expect(outcome.metrics.deaths).toBe(1);
    });

    it('fails with score 0.3 when plan exists but no plan_created event', () => {
        const outcome = verifyPlannerSoak({
            resident: 'res:qa-firemaker',
            observeMs: 60_000,
            newEvents: [stageDoneEvent('s1'), stageDoneEvent('s2')],
            finalPlan: validPlan,
        });
        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.3);
        expect(outcome.failureReason).toContain('plan_created');
    });

    it('fails when fewer than MIN stages done', () => {
        const outcome = verifyPlannerSoak({
            resident: 'res:qa-firemaker',
            observeMs: 60_000,
            newEvents: [planCreatedEvent, stageDoneEvent('s1')],
            finalPlan: validPlan,
        });
        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('stages done');
        expect(outcome.metrics.stagesDone).toBe(1);
    });

    it('accumulates stage counts from multiple stage_done events', () => {
        const outcome = verifyPlannerSoak({
            resident: 'res:qa-firemaker',
            observeMs: 60_000,
            newEvents: [planCreatedEvent],
            finalPlan: validPlan,
        });
        expect(outcome.metrics.stagesDone).toBe(0);
    });
});

// ── CLI arg parsing ───────────────────────────────────────────────────────────

describe('parsePlannerSoakArgs', () => {
    it('returns defaults when no args', () => {
        const opts = parsePlannerSoakArgs([]);
        expect(opts.resident).toBe(PLANNER_SOAK_DEFAULT_RESIDENT);
        expect(opts.observeMs).toBe(PLANNER_SOAK_DEFAULT_OBSERVE_MS);
        expect(opts.pollMs).toBe(PLANNER_SOAK_DEFAULT_POLL_MS);
    });

    it('parses --resident', () => {
        const opts = parsePlannerSoakArgs(['--resident', 'res:hans']);
        expect(opts.resident).toBe('res:hans');
    });

    it('parses --observe-ms', () => {
        const opts = parsePlannerSoakArgs(['--observe-ms', '60000']);
        expect(opts.observeMs).toBe(60_000);
    });

    it('parses --poll-ms', () => {
        const opts = parsePlannerSoakArgs(['--poll-ms', '2000']);
        expect(opts.pollMs).toBe(2_000);
    });

    it('ignores invalid (non-positive) --observe-ms and keeps default', () => {
        const opts = parsePlannerSoakArgs(['--observe-ms', '-1']);
        expect(opts.observeMs).toBe(PLANNER_SOAK_DEFAULT_OBSERVE_MS);
    });

    it('sets outputDir from --output-dir', () => {
        const opts = parsePlannerSoakArgs(['--output-dir', '/tmp/planner-test']);
        expect(opts.outputDir).toBe('/tmp/planner-test');
    });

    it('includes a dated outputDir by default', () => {
        const now = new Date('2026-06-04T17:00:00Z');
        const opts = parsePlannerSoakArgs([], now);
        expect(opts.outputDir).toContain('planner-soak-2026-06-04');
    });
});
