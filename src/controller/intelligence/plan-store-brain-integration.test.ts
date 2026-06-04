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
    advancePlan: jest.requireActual<typeof import('./planner-pass')>('./planner-pass').advancePlan,
    blockCurrentStage: jest.requireActual<typeof import('./planner-pass')>('./planner-pass').blockCurrentStage,
}));

import { maybeTriggerPlannerPass, runBody, STAGE_TICK_BUDGET, PLANNER_FAILURE_BACKOFF_TICKS } from '../thinking/hybrid-agent-helpers';
import { runPlannerPass } from './planner-pass';
import type { Plan } from './planner-pass';
import type { HelperContext } from '../thinking/hybrid-agent-helpers';
import type { LibraryUpdater } from '../evidence/library-updater';

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

function makeLibraryUpdaterMock(): jest.Mocked<
    Pick<LibraryUpdater, 'observePlanCreated' | 'observePlanReplanned' | 'observePlanStageBlocked' | 'observePlanStageDone'>
> {
    return {
        observePlanCreated: jest.fn(),
        observePlanReplanned: jest.fn(),
        observePlanStageBlocked: jest.fn(),
        observePlanStageDone: jest.fn(),
    };
}

function makeCtx(overrides: {
    planStore?: ReturnType<typeof makePlanStore> | null;
    orientationGoal?: { id: string; description: string } | null;
    plannerProfile?: object | null;
    residentId?: string;
    tick?: number;
    libraryUpdater?: ReturnType<typeof makeLibraryUpdaterMock> | null;
}): HelperContext {
    const {
        planStore = null,
        orientationGoal = null,
        plannerProfile = null,
        residentId = 'res:test',
        tick = 100,
        libraryUpdater = null,
    } = overrides;

    const complete = jest.fn(async () => ({ text: '{"stages":[]}', nooped: false }));

    return {
        options: {
            soul: {
                frontmatter: {
                    display: 'Test Resident',
                    name: residentId,
                    orientationGoal: orientationGoal ?? undefined,
                } as any,
            } as any,
            state: {
                resident: residentId,
                tick,
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
            libraryUpdater: libraryUpdater ?? undefined,
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

describe('runBody — durable plan stage routing (RIQ-3-2B)', () => {
    it('advances an already-satisfied axe acquisition stage without calling the body LLM', async () => {
        const plan = makeActivePlan({
            stages: [
                { id: 's1', subgoal: 'Acquire a woodcutting axe', requirements: [], successCriteria: 'has axe', status: 'active' },
                { id: 's2', subgoal: 'Chop logs', requirements: ['axe'], successCriteria: 'logs gained', status: 'pending' },
                { id: 's3', subgoal: 'Light a fire', requirements: ['logs'], successCriteria: 'fire lit', status: 'pending' },
            ],
        });
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'firemaking', description: 'learn firemaking' } });

        const result = await runBody(ctx, {
            tick: 100,
            resident: { inventory: [{ itemId: 1351, amount: 1 }] },
            nearby: { objects: [], npcs: [], worldItems: [], players: [] },
            events: [],
        } as any);

        expect(ctx.complete).not.toHaveBeenCalled();
        expect(planStore.save).toHaveBeenCalledWith(
            'res:test',
            expect.objectContaining({
                currentStageIndex: 1,
                status: 'active',
            }),
        );
        expect(result).toEqual({
            actions: [],
            cause: 'plan_stage_done:s1',
            envelopeTokens: 0,
            nooped: true,
            planChange: { goalId: 'test-goal', stageId: 's1', signal: 'stage_done' },
        });
    });

    it('routes the current stage to a deterministic body action before body LLM inference', async () => {
        const plan = makeActivePlan({
            stages: [
                {
                    id: 's1',
                    subgoal: 'Chop logs from nearby trees',
                    requirements: ['axe'],
                    successCriteria: 'logs gained',
                    status: 'active',
                },
                { id: 's2', subgoal: 'Light a fire', requirements: ['logs'], successCriteria: 'fire lit', status: 'pending' },
                { id: 's3', subgoal: 'Cook food', requirements: ['fire'], successCriteria: 'food cooked', status: 'pending' },
            ],
        });
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'firemaking', description: 'learn firemaking' } });
        const tree = { objectId: 1276, position: { x: 100, y: 100, level: 0 } };

        const result = await runBody(ctx, {
            tick: 100,
            resident: {
                position: { x: 100, y: 100, level: 0 },
                inventory: [{ itemId: 1351, amount: 1 }],
            },
            nearby: { objects: [tree], npcs: [], worldItems: [], players: [] },
            events: [],
        } as any);

        expect(ctx.complete).not.toHaveBeenCalled();
        expect(planStore.save).not.toHaveBeenCalled();
        expect(result.actions).toEqual([
            {
                kind: 'interact',
                target: tree,
                option: 'chop down',
                cause: 'woodcutting_level1_routine',
            },
        ]);
        expect(result.cause).toBe('plan_stage:s1');
        expect(result.planChange).toEqual({ goalId: 'test-goal', stageId: 's1', routed: true });
    });

    it('marks the current stage blocked and saves the plan when the router signals stage_blocked', async () => {
        const plan = makeActivePlan({
            stages: [
                {
                    id: 's1',
                    subgoal: 'Chop logs from nearby trees',
                    requirements: ['axe'],
                    successCriteria: 'logs gained',
                    status: 'active',
                },
                { id: 's2', subgoal: 'Light a fire', requirements: ['logs'], successCriteria: 'fire lit', status: 'pending' },
                { id: 's3', subgoal: 'Cook food', requirements: ['fire'], successCriteria: 'food cooked', status: 'pending' },
            ],
        });
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'firemaking', description: 'learn firemaking' } });

        // No tree nearby, no logs in inventory → stage_blocked
        const result = await runBody(ctx, {
            tick: 100,
            resident: {
                position: { x: 100, y: 100, level: 0 },
                inventory: [{ itemId: 1351, amount: 1 }],
            },
            nearby: { objects: [], npcs: [], worldItems: [], players: [] },
            events: [],
        } as any);

        expect(ctx.complete).not.toHaveBeenCalled();
        expect(planStore.save).toHaveBeenCalledWith(
            'res:test',
            expect.objectContaining({
                stages: expect.arrayContaining([expect.objectContaining({ id: 's1', status: 'blocked' })]),
            }),
        );
        expect(result).toEqual({
            actions: [],
            cause: 'plan_stage_blocked:s1',
            envelopeTokens: 0,
            nooped: true,
            planChange: { goalId: 'test-goal', stageId: 's1', signal: 'stage_blocked' },
        });
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

    it('does nothing when an active healthy plan exists (stage active, plan active, goalId matches)', async () => {
        // makeActivePlan() has goalId:'test-goal'; orientationGoal must match to not trigger.
        const plan = makeActivePlan();
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'test-goal', description: 'test goal' },
            plannerProfile: { endpoint: 'p' },
        });
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
        // Use matching goalId so blocked stage is the only trigger reason.
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'test-goal', description: 'test' }, plannerProfile: { endpoint: 'p' } });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
    });

    // RIQ-5-4: goal-mismatch trigger.
    it('triggers when plan goalId does not match the current orientationGoal (operator edited the soul)', async () => {
        // Active plan was made for 'old-goal'; soul now has 'new-goal'.
        const plan = makeActivePlan({ goalId: 'old-goal' });
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'new-goal', description: 'a changed goal' },
            plannerProfile: { endpoint: 'p' },
        });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
        // Planner is invoked with the *new* goal.
        expect(mockRunPlannerPass).toHaveBeenCalledWith(expect.objectContaining({ goalId: 'new-goal' }));
    });

    it('does not trigger when active plan goalId matches orientationGoal', async () => {
        const plan = makeActivePlan({ goalId: 'firemaking', status: 'active' });
        const planStore = makePlanStore(plan);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'firemaking', description: 'master firemaking' },
            plannerProfile: { endpoint: 'p' },
        });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).not.toHaveBeenCalled();
    });

    it('emits observePlanReplanned with replannedReason=goal_changed when goal-mismatch triggers', async () => {
        const oldPlan = makeActivePlan({ goalId: 'old-goal' });
        const newPlan = makeActivePlan({ goalId: 'new-goal' });
        mockRunPlannerPass.mockResolvedValueOnce({ success: true, plan: newPlan, toolCallsMade: 0, fellBackToRag: false, elapsedMs: 50 });
        const planStore = makePlanStore(oldPlan);
        const library = makeLibraryUpdaterMock();
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'new-goal', description: 'a changed goal' },
            plannerProfile: { endpoint: 'p' },
            libraryUpdater: library,
        });
        await maybeTriggerPlannerPass(ctx);
        expect(library.observePlanReplanned).toHaveBeenCalledTimes(1);
        expect(library.observePlanReplanned).toHaveBeenCalledWith(expect.objectContaining({ replannedReason: 'goal_changed' }));
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
        const ctx = makeCtx({ planStore, orientationGoal: { id: 'test-goal', description: 'test' }, plannerProfile: { endpoint: 'p' } });
        await maybeTriggerPlannerPass(ctx);
        // After first pass completes, planStore.load now returns the saved plan.
        // Simulate: plan is now active after the first pass. Must use matching goalId to avoid
        // triggering a re-plan for goal-change (RIQ-5-4).
        (planStore.load as jest.Mock).mockReturnValue(makeActivePlan({ goalId: 'test-goal' }));
        await maybeTriggerPlannerPass(ctx);
        // Second call should not trigger because the plan is now healthy.
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
    });
});

describe('maybeTriggerPlannerPass — failure backoff (RIQ-5-2)', () => {
    it('sets plannerFailureBackoffUntilTick on success=false result', async () => {
        mockRunPlannerPass.mockResolvedValueOnce({
            success: false,
            error: 'parse failed',
            toolCallsMade: 0,
            fellBackToRag: false,
            elapsedMs: 10,
        });
        const planStore = makePlanStore(null);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'g1', description: 'test' },
            plannerProfile: { endpoint: 'p' },
            tick: 500,
        });
        await maybeTriggerPlannerPass(ctx);
        expect(ctx.options.state.cognition?.plannerFailureBackoffUntilTick).toBe(500 + PLANNER_FAILURE_BACKOFF_TICKS);
    });

    it('sets plannerFailureBackoffUntilTick when runPlannerPass throws', async () => {
        mockRunPlannerPass.mockRejectedValueOnce(new Error('network error'));
        const planStore = makePlanStore(null);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'g1', description: 'test' },
            plannerProfile: { endpoint: 'p' },
            tick: 300,
        });
        await maybeTriggerPlannerPass(ctx);
        expect(ctx.options.state.cognition?.plannerFailureBackoffUntilTick).toBe(300 + PLANNER_FAILURE_BACKOFF_TICKS);
    });

    it('skips PlannerPass when backoff is active (tick < backoffUntil)', async () => {
        const planStore = makePlanStore(null);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'g1', description: 'test' },
            plannerProfile: { endpoint: 'p' },
            tick: 100,
        });
        // Inject an active backoff
        ctx.options.state.cognition = { ...ctx.options.state.cognition, plannerFailureBackoffUntilTick: 250 };
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).not.toHaveBeenCalled();
    });

    it('clears plannerFailureBackoffUntilTick on a successful plan', async () => {
        const newPlan = makeActivePlan({ goalId: 'wc' });
        mockRunPlannerPass.mockResolvedValueOnce({ success: true, plan: newPlan, toolCallsMade: 0, fellBackToRag: false, elapsedMs: 50 });
        const planStore = makePlanStore(null);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'wc', description: 'master woodcutting' },
            plannerProfile: { endpoint: 'p' },
            tick: 400,
        });
        // Pre-set a stale backoff
        ctx.options.state.cognition = { ...ctx.options.state.cognition, plannerFailureBackoffUntilTick: 99 };
        await maybeTriggerPlannerPass(ctx);
        expect(ctx.options.state.cognition?.plannerFailureBackoffUntilTick).toBeUndefined();
        expect(planStore.save).toHaveBeenCalledWith('res:test', newPlan);
    });

    it('fires again once the backoff tick window expires', async () => {
        const planStore = makePlanStore(null);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'g1', description: 'test' },
            plannerProfile: { endpoint: 'p' },
            tick: 300,
        });
        // Inject an expired backoff
        ctx.options.state.cognition = { ...ctx.options.state.cognition, plannerFailureBackoffUntilTick: 200 };
        await maybeTriggerPlannerPass(ctx);
        // tick(300) >= backoffUntil(200) → should proceed
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
    });
});

describe('maybeTriggerPlannerPass — Library events (RIQ-3-3)', () => {
    it('emits observePlanCreated when no prior plan exists', async () => {
        const planStore = makePlanStore(null);
        const library = makeLibraryUpdaterMock();
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'master-firemaking', description: 'Become a master of Firemaking' },
            plannerProfile: { endpoint: 'p' },
            libraryUpdater: library,
        });

        await maybeTriggerPlannerPass(ctx);

        expect(library.observePlanCreated).toHaveBeenCalledTimes(1);
        expect(library.observePlanReplanned).not.toHaveBeenCalled();
        const call = library.observePlanCreated.mock.calls[0][0];
        expect(call.kind).toBe('plan_created');
        expect(call.goalId).toBe('test-goal'); // from makeActivePlan()
        expect(call.stageCount).toBe(3);
        expect(call.stageSubgoals).toEqual(['get axe', 'chop logs', 'reach level 99']);
    });

    it('emits observePlanReplanned with "completed" when prior plan was completed', async () => {
        const completedPlan = makeActivePlan({ status: 'completed' });
        const planStore = makePlanStore(completedPlan);
        const library = makeLibraryUpdaterMock();
        // orientationGoal.id must match plan.goalId so the replannedReason reflects 'completed'
        // not 'goal_changed' (RIQ-5-4).
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'test-goal', description: 'Become a master of Firemaking' },
            plannerProfile: { endpoint: 'p' },
            libraryUpdater: library,
        });

        await maybeTriggerPlannerPass(ctx);

        expect(library.observePlanCreated).not.toHaveBeenCalled();
        expect(library.observePlanReplanned).toHaveBeenCalledTimes(1);
        const call = library.observePlanReplanned.mock.calls[0][0];
        expect(call.kind).toBe('plan_replanned');
        expect(call.replannedReason).toBe('completed');
    });

    it('emits observePlanReplanned with "abandoned" when prior plan was abandoned', async () => {
        const abandonedPlan = makeActivePlan({ status: 'abandoned' });
        const planStore = makePlanStore(abandonedPlan);
        const library = makeLibraryUpdaterMock();
        // orientationGoal.id must match so 'abandoned' is the replannedReason, not 'goal_changed'.
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'test-goal', description: 'test' },
            plannerProfile: { endpoint: 'p' },
            libraryUpdater: library,
        });

        await maybeTriggerPlannerPass(ctx);

        expect(library.observePlanReplanned).toHaveBeenCalledTimes(1);
        expect(library.observePlanReplanned.mock.calls[0][0].replannedReason).toBe('abandoned');
    });

    it('emits observePlanReplanned with "stage_blocked:<id>" when active plan has a blocked stage', async () => {
        const blockedPlan = makeActivePlan({
            status: 'active',
            stages: [
                { id: 'acquire-axe', subgoal: 'get axe', requirements: [], successCriteria: 'axe in inventory', status: 'blocked' },
                { id: 'chop-logs', subgoal: 'chop logs', requirements: ['axe'], successCriteria: 'logs', status: 'pending' },
                { id: 'light-fires', subgoal: 'light fires', requirements: ['logs'], successCriteria: 'level 99', status: 'pending' },
            ],
            currentStageIndex: 0,
        });
        const planStore = makePlanStore(blockedPlan);
        const library = makeLibraryUpdaterMock();
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'test-goal', description: 'test' },
            plannerProfile: { endpoint: 'p' },
            libraryUpdater: library,
        });

        await maybeTriggerPlannerPass(ctx);

        expect(library.observePlanReplanned).toHaveBeenCalledTimes(1);
        expect(library.observePlanReplanned.mock.calls[0][0].replannedReason).toBe('stage_blocked:acquire-axe');
    });

    it('does not emit library events when PlannerPass fails', async () => {
        mockRunPlannerPass.mockResolvedValueOnce({
            success: false,
            error: 'parse failed',
            toolCallsMade: 0,
            fellBackToRag: false,
            elapsedMs: 10,
        });
        const planStore = makePlanStore(null);
        const library = makeLibraryUpdaterMock();
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'g1', description: 'test' },
            plannerProfile: { endpoint: 'p' },
            libraryUpdater: library,
        });

        await maybeTriggerPlannerPass(ctx);

        expect(library.observePlanCreated).not.toHaveBeenCalled();
        expect(library.observePlanReplanned).not.toHaveBeenCalled();
    });

    it('does not throw when libraryUpdater is absent (backward-compatible)', async () => {
        const planStore = makePlanStore(null);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'g1', description: 'test' },
            plannerProfile: { endpoint: 'p' },
            // no libraryUpdater
        });

        await expect(maybeTriggerPlannerPass(ctx)).resolves.toBeUndefined();
        expect(planStore.save).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Survival-preserves-plan invariant (RIQ-3-2B)
//
// The spec guarantees: a Nervous-system interrupt (eat-when-low-HP, flee-on-attack)
// must NOT call planStore.clear(), blockCurrentStage(), or advancePlan().
//
// At the maybeTriggerPlannerPass level this means:
//   1. Only planStore.save() is ever called — never planStore.clear().
//   2. The original plan object is not mutated (only atomically replaced via save).
//   3. When the plan is healthy (active stage), nothing modifies the plan at all.
//   4. When no planStore is present (Nervous path short-circuits before Brain),
//      no plan state changes can occur.
//
// The structural guarantee is: maybeTriggerPlannerPass is called only from runBrain;
// the Nervous system never calls runBrain (or this function). These tests prove the
// maybeTriggerPlannerPass contract is sound so the structural guarantee is sufficient.
// ---------------------------------------------------------------------------

describe('survival-preserves-plan invariant (RIQ-3-2B)', () => {
    it('never calls planStore.clear() even when triggering a new plan', async () => {
        const planStore = makePlanStore(null);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'g1', description: 'master woodcutting' },
            plannerProfile: { endpoint: 'p' },
        });
        await maybeTriggerPlannerPass(ctx);
        expect(planStore.clear).not.toHaveBeenCalled();
        expect(mockRunPlannerPass).toHaveBeenCalledTimes(1);
    });

    it('never calls planStore.clear() when replacing a completed plan', async () => {
        const completedPlan = makeActivePlan({ status: 'completed' });
        const planStore = makePlanStore(completedPlan);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'g1', description: 'master firemaking' },
            plannerProfile: { endpoint: 'p' },
        });
        await maybeTriggerPlannerPass(ctx);
        expect(planStore.clear).not.toHaveBeenCalled();
        expect(planStore.save).toHaveBeenCalledTimes(1);
    });

    it('does not mutate the existing plan object — replacement is atomic via save', async () => {
        const completedPlan = makeActivePlan({ status: 'completed' });
        const originalStatus = completedPlan.status;
        const originalStagesLength = completedPlan.stages.length;
        const planStore = makePlanStore(completedPlan);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'g1', description: 'test' },
            plannerProfile: { endpoint: 'p' },
        });
        await maybeTriggerPlannerPass(ctx);
        // The original plan object is not mutated
        expect(completedPlan.status).toBe(originalStatus);
        expect(completedPlan.stages.length).toBe(originalStagesLength);
        // A new plan was saved (not the old plan modified in place)
        expect(planStore.save).toHaveBeenCalledWith('res:test', expect.not.objectContaining({ status: 'completed' }));
    });

    it('does not modify the plan when it is healthy (active stage — normal body execution)', async () => {
        const healthyPlan = makeActivePlan();
        const planStore = makePlanStore(healthyPlan);
        const ctx = makeCtx({
            planStore,
            orientationGoal: { id: 'test-goal', description: 'test' },
            plannerProfile: { endpoint: 'p' },
        });
        await maybeTriggerPlannerPass(ctx);
        // Healthy plan: no trigger, no save, no clear
        expect(mockRunPlannerPass).not.toHaveBeenCalled();
        expect(planStore.save).not.toHaveBeenCalled();
        expect(planStore.clear).not.toHaveBeenCalled();
    });

    it('no plan state changes when planStore is absent (structural Nervous-path guarantee)', async () => {
        // When no planStore is wired (the Nervous system never sets one up),
        // maybeTriggerPlannerPass is a no-op — nothing can touch plan state.
        const ctx = makeCtx({
            planStore: null,
            orientationGoal: { id: 'g1', description: 'test' },
            plannerProfile: { endpoint: 'p' },
        });
        await maybeTriggerPlannerPass(ctx);
        expect(mockRunPlannerPass).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Stage tick-budget timeout (RIQ-3-6)
//
// A stage that routes actions continuously without completing should be
// force-blocked after STAGE_TICK_BUDGET ticks so the Planner can replan.
//
// Each test uses a unique residentId + plan.createdAtTick to avoid Map key
// collisions between test runs in the same Jest process.
// ---------------------------------------------------------------------------

describe('runBody — stage tick-budget timeout (RIQ-3-6)', () => {
    // Shared setup: "chop logs" stage + axe + tree → planStageRouter returns action.
    const tree = { objectId: 1276, position: { x: 100, y: 100, level: 0 } };
    const chopLogPerception = {
        tick: 5,
        resident: {
            position: { x: 100, y: 100, level: 0 },
            inventory: [{ itemId: 1351, amount: 1 }], // bronze axe — has woodcutting axe
        },
        nearby: { objects: [tree], npcs: [], worldItems: [], players: [] },
        events: [],
    } as any;

    function makeChopLogPlan(overrides: Partial<Plan> = {}): Plan {
        return {
            goalId: 'master-woodcutting',
            goalDescription: 'Master woodcutting',
            stages: [
                {
                    id: 'chop-logs',
                    subgoal: 'Chop logs from nearby trees',
                    requirements: ['axe'],
                    successCriteria: 'logs gained',
                    status: 'active',
                },
                { id: 'light-fires', subgoal: 'Light a fire', requirements: ['logs'], successCriteria: 'fire lit', status: 'pending' },
                { id: 'repeat', subgoal: 'Repeat to target level', requirements: [], successCriteria: 'level 99', status: 'pending' },
            ],
            currentStageIndex: 0,
            status: 'active',
            createdAtTick: 5000, // unique per this describe block
            ...overrides,
        };
    }

    it('routes action normally while under the tick budget', async () => {
        const plan = makeChopLogPlan({ createdAtTick: 5001 });
        const planStore = makePlanStore(plan);
        const library = makeLibraryUpdaterMock();
        const ctx = makeCtx({ planStore, tick: 5, residentId: 'res:budget-under-5001', libraryUpdater: library });

        const result = await runBody(ctx, chopLogPerception);

        // Not blocked — action should be routed
        expect(result.cause).toBe('plan_stage:chop-logs');
        expect(result.actions).toHaveLength(1);
        expect(planStore.save).not.toHaveBeenCalled();
        expect(library.observePlanStageBlocked).not.toHaveBeenCalled();
    });

    it('force-blocks the stage once STAGE_TICK_BUDGET ticks have elapsed', async () => {
        const plan = makeChopLogPlan({ createdAtTick: 5002 });
        const planStore = makePlanStore(plan);
        const library = makeLibraryUpdaterMock();
        const residentId = 'res:budget-exceed-5002';

        // First call: tick=5 → sets the budget start in the Map.
        const ctx1 = makeCtx({ planStore, tick: 5, residentId, libraryUpdater: library });
        await runBody(ctx1, chopLogPerception);
        expect(planStore.save).not.toHaveBeenCalled();

        // Second call: tick has advanced by STAGE_TICK_BUDGET → budget exhausted.
        const ctx2 = makeCtx({ planStore, tick: 5 + STAGE_TICK_BUDGET, residentId, libraryUpdater: library });
        const result = await runBody(ctx2, chopLogPerception);

        expect(result.cause).toBe('plan_stage_blocked:chop-logs');
        expect(result.actions).toHaveLength(0);
        expect(result.nooped).toBe(true);
        expect(planStore.save).toHaveBeenCalledTimes(1);
        expect(planStore.save).toHaveBeenCalledWith(
            residentId,
            expect.objectContaining({
                stages: expect.arrayContaining([expect.objectContaining({ id: 'chop-logs', status: 'blocked' })]),
            }),
        );
        expect(library.observePlanStageBlocked).toHaveBeenCalledTimes(1);
        expect(library.observePlanStageBlocked).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'plan_stage_blocked',
                goalId: 'master-woodcutting',
                stageId: 'chop-logs',
            }),
        );
    });

    it('budget resets for each new plan (different createdAtTick)', async () => {
        const residentId = 'res:budget-replan-5003';
        // Plan A: reach budget exhaustion.
        const planA = makeChopLogPlan({ createdAtTick: 5003 });
        const storeA = makePlanStore(planA);
        const libA = makeLibraryUpdaterMock();
        const ctxA1 = makeCtx({ planStore: storeA, tick: 5, residentId, libraryUpdater: libA });
        await runBody(ctxA1, chopLogPerception);
        const ctxA2 = makeCtx({ planStore: storeA, tick: 5 + STAGE_TICK_BUDGET, residentId, libraryUpdater: libA });
        const resultA = await runBody(ctxA2, chopLogPerception);
        expect(resultA.cause).toBe('plan_stage_blocked:chop-logs'); // Plan A: blocked

        // Plan B: fresh plan (different createdAtTick) — budget resets.
        const planB = makeChopLogPlan({ createdAtTick: 5004 }); // different createdAtTick
        const storeB = makePlanStore(planB);
        const libB = makeLibraryUpdaterMock();
        const ctxB = makeCtx({
            planStore: storeB,
            tick: 5 + STAGE_TICK_BUDGET, // same high tick as Plan A exhaustion
            residentId,
            libraryUpdater: libB,
        });
        const resultB = await runBody(ctxB, chopLogPerception);

        // Plan B has a fresh budget (different createdAtTick key) → routes action, not blocked.
        expect(resultB.cause).toBe('plan_stage:chop-logs');
        expect(libB.observePlanStageBlocked).not.toHaveBeenCalled();
    });

    it('does not force-block when stage completes normally before the budget', async () => {
        const plan = makeChopLogPlan({ createdAtTick: 5005 });
        // Seed an axe + logs in inventory so the stage is immediately "done".
        const planStore = makePlanStore(plan);
        const library = makeLibraryUpdaterMock();
        const ctx = makeCtx({ planStore, tick: 5, residentId: 'res:budget-done-5005', libraryUpdater: library });

        const result = await runBody(ctx, {
            tick: 5,
            resident: {
                position: { x: 100, y: 100, level: 0 },
                inventory: [
                    { itemId: 1351, amount: 1 }, // axe
                    { itemId: 1511, amount: 1 }, // logs
                ],
            },
            nearby: { objects: [tree], npcs: [], worldItems: [], players: [] },
            events: [],
        } as any);

        // stage_done (logs in inventory) — not a budget-triggered block.
        expect(result.cause).toBe('plan_stage_done:chop-logs');
        expect(library.observePlanStageBlocked).not.toHaveBeenCalled();
        expect(library.observePlanStageDone).toHaveBeenCalledTimes(1);
    });
});
