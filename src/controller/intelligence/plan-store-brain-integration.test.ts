/**
 * RIQ-3-2: Unit tests for maybeTriggerPlannerPass.
 *
 * All tests are pure (no filesystem, no LLM calls). The PlanStore and
 * runPlannerPass are mocked so we can assert trigger conditions without
 * running real inference.
 */

import { jest } from '@jest/globals';

// ---- Mocks must be declared before any imports that use them. ----

// Mock runPlannerPass so tests control success/failure without LLM calls.
jest.mock('./planner-pass', () => ({
    runPlannerPass: jest.fn(),
    currentStage: jest.requireActual<typeof import('./planner-pass')>('./planner-pass').currentStage,
}));

import { maybeTriggerPlannerPass } from '../thinking/hybrid-agent-helpers';
import { runPlannerPass } from './planner-pass';
import type { Plan } from './planner-pass';
import type { HelperContext } from '../thinking/hybrid-agent-helpers';

const mockRunPlannerPass = runPlannerPass as jest.MockedFunction<typeof runPlannerPass>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActivePlan(overrides: Partial<Plan> = {}): Plan {
    return {
        goalId: 'test-goal',
        goalDescription: 'become the best woodcutter',
        stages: [
            { id: 's1', subgoal: 'get axe', requirements: [], successCriteria: 'axe in inventory', status: 'active' },
            { id: 's2', subgoal: 'chop logs', requirements: ['axe'], successCriteria: 'logs in inventory', status: 'pending' },
            {
                id: 's3',
                subgoal: 'reach level 99',
                requirements: ['logs', 'time'],
                successCriteria: 'woodcutting level 99',
                status: 'pending',
            },
        ],
        currentStageIndex: 0,
        status: 'active',
        createdAtTick: 0,
        ...overrides,
    };
}

function makePlanStore(plan: Plan | null): {
    load: jest.MockedFunction<() => Plan | null>;
    save: jest.MockedFunction<(id: string, p: Plan) => void>;
    clear: jest.MockedFunction<(id: string) => void>;
    has: jest.MockedFunction<(id: string) => boolean>;
} {
    return {
        load: jest.fn(() => plan),
        save: jest.fn(),
        clear: jest.fn(),
        has: jest.fn(() => plan !== null),
    };
}

function makeCtx(overrides: {
    planStore?: ReturnType<typeof makePlanStore> | null;
    orientationGoal?: { id: string; description: string } | null;
    plannerProfile?: object | null;
    residentId?: string;
}): HelperContext {
    const { planStore = null, orientationGoal = null, plannerProfile = null, residentId = 'res:test' } = overrides;

    const complete = jest.fn(async () => ({ text: '{"stages":[]}', nooped: false }));

    return {
        options: {
            soul: {
                frontmatter: {
                    display: 'Test Resident',
                    residentId,
                    orientationGoal: orientationGoal ?? undefined,
                } as any,
            } as any,
            state: {
                resident: residentId,
                tick: 100,
                attention: 5000,
                legacy: { kind: 'test', progress: {}, complete: false },
                budgets: {
                    minuteStartedAt: '',
                    dayStartedAt: '',
                    requestsThisMinute: 0,
                    requestsToday: 0,
                },
            },
            memory: {},
            llm: {},
            planStore: planStore ?? undefined,
        },
        cognition: () => ({}),
        commandPrefix: () => 'test',
        activeGoal: () => undefined,
        pickupCooldowns: () => ({}),
        explorationCooldowns: () => ({}),
        clearGoalMomentum: jest.fn(),
        rememberBodyAction: jest.fn(),
        rememberActiveMove: jest.fn(),
        isRepeatedAction: () => false,
        behavior: () =>
            ({
                kind: 'hybrid-agent',
                ...(plannerProfile ? { planner: plannerProfile } : {}),
            }) as any,
        heroLandmarkAnchor: () => undefined,
        visibilityAnchor: () => undefined,
        endpointFor: jest.fn((_p: any) => 'planner-endpoint'),
        temperatureFor: jest.fn((_p: any, fallback: number) => fallback),
        timeoutFor: jest.fn((_p: any, fallback?: number) => fallback),
        maxTokensFor: jest.fn(() => undefined),
        modelFor: jest.fn(() => 'planner-model'),
        complete,
        cancelledResult: () => undefined,
        promptMemories: () => [],
        promptMemorySection: () => '',
        visibilityStatus: () => ({ returnDue: false }),
        deferVisibilityAnchorReturn: jest.fn(),
        suppressRepeatedActions: (actions: any[]) => actions,
        combatReaction: () => undefined,
        tradeReaction: () => undefined,
    } as unknown as HelperContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
    jest.clearAllMocks();
    mockRunPlannerPass.mockResolvedValue({
        success: true,
        plan: makeActivePlan(),
        toolCallsMade: 0,
        fellBackToRag: false,
        elapsedMs: 100,
    });
});

describe('maybeTriggerPlannerPass — no-op conditions', () => {
    it('does nothing when planStore is absent', async () => {
        const ctx = makeCtx({
            planStore: null,
            orientationGoal: { id: 'g1', description: 'test goal' },
            plannerProfile: { endpoint: 'p' },
        });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).not.toHaveBeenCalled();
    });

    it('does nothing when soul has no orientationGoal', async () => {
        const planStore = makePlanStore(null);
        const ctx = makeCtx({ planStore, orientationGoal: null, plannerProfile: { endpoint: 'p' } });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).not.toHaveBeenCalled();
    });

    it('does nothing when behavior has no planner profile', async () => {
        const planStore = makePlanStore(null);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'g1', description: 'test goal' }, plannerProfile: null });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).not.toHaveBeenCalled();
    });

    it('does nothing when an active healthy plan exists (stage active, plan active)', async () => {
        const plan = makeActivePlan();
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'g1', description: 'test goal' }, plannerProfile: { endpoint: 'p' } });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).not.toHaveBeenCalled();
    });
});

describe('maybeTriggerPlannerPass — trigger conditions', () => {
    it('triggers when no plan exists (null from store)', async () => {
        const planStore = makePlanStore(null);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'wc', description: 'master woodcutting' },
            plannerProfile: { endpoint: 'haiku' },
        });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
        expect(mockRunPlannerPass).toHaveBeenCalledWith(expect.objectContaining({ goalId: 'wc', goalDescription: 'master woodcutting' }));
    });

    it('saves the plan returned by PlannerPass', async () => {
        const newPlan = makeActivePlan({ goalId: 'wc' });
        mockRunPlannerPass.mockResolvedValueOnce({ success: true, plan: newPlan, toolCallsMade: 0, fellBackToRag: false, elapsedMs: 50 });
        const planStore = makePlanStore(null);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'wc', description: 'master woodcutting' },
            plannerProfile: { endpoint: 'haiku' },
        });
        await maybeTriggerPlannerPass(ctx);
        expect(planStore.save).toHaveBeenCalledWith('res:test', newPlan);
    });

    it('triggers when plan status is completed', async () => {
        const plan = makeActivePlan({ status: 'completed' });
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'g1', description: 'test' }, plannerProfile: { endpoint: 'p' } });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
    });

    it('triggers when plan status is abandoned', async () => {
        const plan = makeActivePlan({ status: 'abandoned' });
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'g1', description: 'test' }, plannerProfile: { endpoint: 'p' } });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
    });

    it('triggers when the current stage is blocked', async () => {
        const plan = makeActivePlan({
            stages: [
                { id: 's1', subgoal: 'get axe', requirements: [], successCriteria: 'has axe', status: 'blocked' },
                { id: 's2', subgoal: 'chop', requirements: [], successCriteria: 'has logs', status: 'pending' },
                { id: 's3', subgoal: 'craft', requirements: [], successCriteria: 'done', status: 'pending' },
            ],
            currentStageIndex: 0,
        });
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'g1', description: 'test' }, plannerProfile: { endpoint: 'p' } });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
    });
});

describe('maybeTriggerPlannerPass — failure handling', () => {
    it('does not throw when PlannerPass returns success=false', async () => {
        mockRunPlannerPass.mockResolvedValueOnce({
            success: false,
            error: 'parse failed',
            toolCallsMade: 0,
            fellBackToRag: false,
            elapsedMs: 10,
        });
        const planStore = makePlanStore(null);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'g1', description: 'test' }, plannerProfile: { endpoint: 'p' } });
        await expect(maybeTriggerPlannerPass(ctx)).resolves.toBeUndefined();
        expect(planStore.save).not.toHaveBeenCalled();
    });

    it('does not throw when runPlannerPass throws', async () => {
        mockRunPlannerPass.mockRejectedValueOnce(new Error('network error'));
        const planStore = makePlanStore(null);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'g1', description: 'test' }, plannerProfile: { endpoint: 'p' } });
        await expect(maybeTriggerPlannerPass(ctx)).resolves.toBeUndefined();
        expect(planStore.save).not.toHaveBeenCalled();
    });

    it('allows a second trigger after the first pass finishes', async () => {
        const planStore = makePlanStore(null);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'g1', description: 'test' }, plannerProfile: { endpoint: 'p' } });
        await maybeTriggerPlannerPass(ctx);
        // After first pass completes, planStore.load now returns the saved plan.
        // Simulate: plan is now active after the first pass.
        (planStore.load as jest.Mock).mockReturnValue(makeActivePlan());
        await maybeTriggerPlannerPass(ctx);
        // Second call should not trigger because the plan is now healthy.
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
    });
});
