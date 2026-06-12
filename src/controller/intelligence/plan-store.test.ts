/**
 * RIQ-3-1: PlanStore unit tests.
 *
 * Tests cover:
 *   A. save + load round-trip
 *   B. load returns null when no file exists
 *   C. File path uses residentSlug (slug-based isolation)
 *   D. Restart survival — new PlanStore instance, same memoryRoot
 *   E. Corrupt file quarantine
 *   F. clear() removes the file; subsequent load() returns null
 *   G. Two residents do not collide
 *   H. has() reflects presence correctly
 *   I. Plan helpers (advancePlan, blockCurrentStage) work through the store
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { PlanStore } from './plan-store';
import { advancePlan, blockCurrentStage, currentStage } from './planner-pass';
import type { Plan } from './planner-pass';

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-store-test-'));
}

function makePlan(goalId = 'test-goal', tick = 0): Plan {
    return {
        goalId,
        goalDescription: `Achieve ${goalId}`,
        stages: [
            {
                id: 'stage-1',
                subgoal: 'First step',
                requirements: ['item-a'],
                successCriteria: 'item-a obtained',
                status: 'active',
            },
            {
                id: 'stage-2',
                subgoal: 'Second step',
                requirements: ['item-b'],
                successCriteria: 'item-b obtained',
                status: 'pending',
            },
            {
                id: 'stage-3',
                subgoal: 'Final step',
                requirements: [],
                successCriteria: 'goal achieved',
                status: 'pending',
            },
        ],
        currentStageIndex: 0,
        status: 'active',
        createdAtTick: tick,
    };
}

// ---------------------------------------------------------------------------
// A. save + load round-trip
// ---------------------------------------------------------------------------

describe('A. save + load round-trip', () => {
    it('saves and loads an identical plan', () => {
        const store = new PlanStore(tmpDir());
        const plan = makePlan('firemaking');
        store.save('res:qa-woodcutter', plan);
        const loaded = store.load('res:qa-woodcutter');
        expect(loaded).toEqual(plan);
    });

    it('overwrites an existing plan on second save', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        store.save('res:qa-woodcutter', makePlan('old-goal'));
        const updated = makePlan('new-goal', 42);
        store.save('res:qa-woodcutter', updated);
        expect(store.load('res:qa-woodcutter')).toEqual(updated);
    });
});

// ---------------------------------------------------------------------------
// B. load returns null when no file exists
// ---------------------------------------------------------------------------

describe('B. load returns null when absent', () => {
    it('returns null for an unknown resident', () => {
        const store = new PlanStore(tmpDir());
        expect(store.load('res:nobody')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// C. File path uses residentSlug
// ---------------------------------------------------------------------------

describe('C. file path uses residentSlug', () => {
    it('stores the file at <memoryRoot>/<slug>/active-plan.json', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        store.save('res:qa-woodcutter', makePlan());
        const expectedPath = path.join(dir, 'res-qa-woodcutter', 'active-plan.json');
        expect(fs.existsSync(expectedPath)).toBe(true);
    });

    it('handles resident IDs with colons and mixed case', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        store.save('Res:QA-Hans', makePlan());
        const expectedPath = path.join(dir, 'res-qa-hans', 'active-plan.json');
        expect(fs.existsSync(expectedPath)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// D. Restart survival — new PlanStore instance
// ---------------------------------------------------------------------------

describe('D. restart survival', () => {
    it('loads the plan from a new PlanStore pointed at the same memoryRoot', () => {
        const dir = tmpDir();
        const original = makePlan('survive-restart', 100);
        new PlanStore(dir).save('res:agent', original);

        // Simulate a controller restart — fresh instance, same dir
        const reloaded = new PlanStore(dir).load('res:agent');
        expect(reloaded).toEqual(original);
    });
});

// ---------------------------------------------------------------------------
// E. Corrupt file quarantine
// ---------------------------------------------------------------------------

describe('E. corrupt file quarantine', () => {
    it('returns null and quarantines the file when JSON is invalid', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        // Write a valid plan first to create the directory
        store.save('res:agent', makePlan());
        // Overwrite with garbage
        const planPath = path.join(dir, 'res-agent', 'active-plan.json');
        fs.writeFileSync(planPath, 'not valid JSON!!!', 'utf8');

        const result = store.load('res:agent');
        expect(result).toBeNull();

        // Original file should be gone (quarantined)
        expect(fs.existsSync(planPath)).toBe(false);

        // A .corrupt-<timestamp> file should exist
        const files = fs.readdirSync(path.join(dir, 'res-agent'));
        expect(files.some(f => f.startsWith('active-plan.json.corrupt-'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// F. clear() removes the file
// ---------------------------------------------------------------------------

describe('F. clear removes the plan', () => {
    it('clears an existing plan; subsequent load returns null', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        store.save('res:agent', makePlan());
        expect(store.load('res:agent')).not.toBeNull();

        store.clear('res:agent');
        expect(store.load('res:agent')).toBeNull();
    });

    it('clear on a non-existent plan is a no-op', () => {
        const store = new PlanStore(tmpDir());
        expect(() => store.clear('res:nobody')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// G. Two residents do not collide
// ---------------------------------------------------------------------------

describe('G. two residents do not collide', () => {
    it('stores plans independently by resident', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        const planA = makePlan('goal-a', 1);
        const planB = makePlan('goal-b', 2);
        store.save('res:alice', planA);
        store.save('res:bob', planB);

        expect(store.load('res:alice')).toEqual(planA);
        expect(store.load('res:bob')).toEqual(planB);

        store.clear('res:alice');
        expect(store.load('res:alice')).toBeNull();
        expect(store.load('res:bob')).toEqual(planB);
    });
});

// ---------------------------------------------------------------------------
// H. has() reflects presence
// ---------------------------------------------------------------------------

describe('H. has() reflects presence', () => {
    it('returns false before save and true after', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        expect(store.has('res:agent')).toBe(false);
        store.save('res:agent', makePlan());
        expect(store.has('res:agent')).toBe(true);
    });

    it('returns false after clear', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        store.save('res:agent', makePlan());
        store.clear('res:agent');
        expect(store.has('res:agent')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// I. Plan helpers work through the store (integration with planner-pass)
// ---------------------------------------------------------------------------

describe('I. plan helpers work through the store', () => {
    it('advancePlan round-trips correctly', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        const plan = makePlan('firemaking', 0);
        store.save('res:agent', plan);

        const loaded = store.load('res:agent')!;
        expect(currentStage(loaded)?.id).toBe('stage-1');

        const advanced = advancePlan(loaded);
        store.save('res:agent', advanced);

        const reloaded = store.load('res:agent')!;
        expect(reloaded.currentStageIndex).toBe(1);
        expect(currentStage(reloaded)?.id).toBe('stage-2');
        expect(reloaded.stages[0].status).toBe('done');
        expect(reloaded.stages[1].status).toBe('active');
    });

    it('blockCurrentStage persists correctly', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        const plan = makePlan('master-woodcutting');
        store.save('res:qa-woodcutter', plan);

        const loaded = store.load('res:qa-woodcutter')!;
        const blocked = blockCurrentStage(loaded);
        store.save('res:qa-woodcutter', blocked);

        const reloaded = store.load('res:qa-woodcutter')!;
        expect(reloaded.stages[0].status).toBe('blocked');
        expect(reloaded.status).toBe('active');
    });

    it('advancing through all stages marks plan completed', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        let plan = makePlan('short-plan', 0);
        store.save('res:agent', plan);

        plan = store.load('res:agent')!;
        plan = advancePlan(plan); // → stage 2
        plan = advancePlan(plan); // → stage 3
        plan = advancePlan(plan); // → completed
        store.save('res:agent', plan);

        const final = store.load('res:agent')!;
        expect(final.status).toBe('completed');
    });
});

// ---------------------------------------------------------------------------
// J. listAll() returns plans for all residents
// ---------------------------------------------------------------------------

describe('J. listAll()', () => {
    it('returns empty array when memoryRoot does not exist', () => {
        const store = new PlanStore('/tmp/does-not-exist-plan-store-test-xyz');
        expect(store.listAll()).toEqual([]);
    });

    it('excludes subdirectories that have no active-plan.json', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        // Create a directory with no plan file
        fs.mkdirSync(path.join(dir, 'orphan-dir'));
        expect(store.listAll()).toEqual([]);
    });

    it('returns one entry per resident with a saved plan', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        const planA = makePlan('goal-a', 1);
        const planB = makePlan('goal-b', 2);
        store.save('res:alice', planA);
        store.save('res:bob', planB);

        const all = store.listAll();
        expect(all).toHaveLength(2);
        const slugs = all.map(e => e.slug).sort();
        expect(slugs).toEqual(['res-alice', 'res-bob']);
        const aliceEntry = all.find(e => e.slug === 'res-alice')!;
        expect(aliceEntry.plan).toEqual(planA);
    });
});

// ---------------------------------------------------------------------------
// J. onPlanCompleted hook (LB-LOOP-7e31)
// ---------------------------------------------------------------------------

describe('J. onPlanCompleted hook', () => {
    it('fires when a completed plan is saved', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        const calls: Array<{ residentId: string; plan: Plan }> = [];
        store.onPlanCompleted = (residentId, plan) => calls.push({ residentId, plan });

        const completedPlan: Plan = { ...makePlan('g1'), status: 'completed' };
        store.save('res:alice', completedPlan);

        expect(calls).toHaveLength(1);
        expect(calls[0].residentId).toBe('res:alice');
        expect(calls[0].plan.status).toBe('completed');
    });

    it('does NOT fire for an active plan', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        const calls: Array<unknown> = [];
        store.onPlanCompleted = () => calls.push(true);

        store.save('res:alice', makePlan('g1'));
        expect(calls).toHaveLength(0);
    });

    it('does NOT fire for an abandoned plan', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        const calls: Array<unknown> = [];
        store.onPlanCompleted = () => calls.push(true);

        const abandoned: Plan = { ...makePlan('g1'), status: 'abandoned' };
        store.save('res:alice', abandoned);
        expect(calls).toHaveLength(0);
    });

    it('fires once when advancePlan advances through all stages', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        const calls: Array<{ residentId: string; plan: Plan }> = [];
        store.onPlanCompleted = (residentId, plan) => calls.push({ residentId, plan });

        // Advance through two stages — only the final save (status='completed') fires.
        let plan = makePlan('g1'); // 3 stages: active, pending, pending
        plan = advancePlan(plan); // stage-1 done → stage-2 active
        store.save('res:alice', plan);
        expect(calls).toHaveLength(0);

        plan = advancePlan(plan); // stage-2 done → stage-3 active
        store.save('res:alice', plan);
        expect(calls).toHaveLength(0);

        plan = advancePlan(plan); // stage-3 done → status='completed'
        store.save('res:alice', plan);
        expect(calls).toHaveLength(1);
        expect(calls[0].plan.status).toBe('completed');
    });

    it('is not required — saving completed plan without hook is silent', () => {
        const dir = tmpDir();
        const store = new PlanStore(dir);
        const completedPlan: Plan = { ...makePlan('g1'), status: 'completed' };
        expect(() => store.save('res:alice', completedPlan)).not.toThrow();
    });
});
