/**
 * S-GOAL-3: integration tests for OrientationStallTracker wire-up in ResidentRuntime.
 *
 * Verifies that `maybeRecordOrientationProgress` fires the correct Library events
 * each time `onPerception` completes.  Pure mock I/O — no disk, no gateway.
 */

import type { ResidentBody } from './body';
import type { LlmClient } from './llm/llm-client';
import type { ActionLog } from './logging/action-log';
import type { InferenceLog } from './logging/inference-log';
import type { RuntimeState, RuntimeStateStore } from './memory/runtime-state';
import type { MemoryStore } from './memory/memory-store';
import { ResidentRuntime, type ResidentRuntimeEvidence } from './resident-runtime';
import type { Soul } from './soul/soul-schema';
import type { LibraryUpdater } from './evidence';
import type { ThinkingModule } from './thinking';
import type { GatewayClient } from './transport/gateway-client';
import { ORIENTATION_STALL_WINDOW } from './spark/orientation-scorer';

jest.mock('./config', () => ({
    loadControllerConfig: jest.fn(() => ({ patrons: [] })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateFor(resident: string, overrides: Partial<RuntimeState> = {}): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident,
        attention: 99_999,
        tick: 0,
        legacy: { kind: 'mentor', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
        ...overrides,
    };
}

function soul(name: string, extra: Partial<Soul['frontmatter']> = {}): Soul {
    return {
        frontmatter: {
            name,
            archetype: 'mentor',
            legacy: { kind: 'mentor', parameters: { targetMenteeCount: 1 } },
            attentionProfile: { startingAttention: 99_999, decayCurve: 'standard' },
            ...extra,
        },
        body: '# Test soul',
        sourcePath: '/tmp/soul.md',
    };
}

function thinkingModule(): ThinkingModule {
    return {
        think: jest.fn(async () => ({ actions: [], nooped: true })),
        considerInterrupt: jest.fn(() => false),
        stop: jest.fn(),
    };
}

function makeLibraryMock() {
    return {
        observeOrientationProgress: jest.fn(),
        observeOrientationStalled: jest.fn(),
        observeTrajectory: jest.fn(),
    } as unknown as LibraryUpdater;
}

function makeRuntime(
    residentName: string,
    state: RuntimeState,
    library: LibraryUpdater,
    soulFrontmatterExtra: Partial<Soul['frontmatter']> = {},
) {
    const evidence: ResidentRuntimeEvidence = {
        store: {} as any,
        sessionId: 'session-test',
        trajectory: { recordAction: jest.fn(), recordDecision: jest.fn(), recordActionResult: jest.fn() } as any,
        library,
    };
    return new ResidentRuntime({
        soul: soul(residentName, soulFrontmatterExtra),
        gateway: {} as GatewayClient,
        memory: {
            ensureResident: jest.fn(() => '/tmp'),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
        } as unknown as MemoryStore,
        stateStore: {
            load: jest.fn(() => state),
            save: jest.fn(),
        } as unknown as RuntimeStateStore,
        llm: {} as LlmClient,
        actionLog: {} as ActionLog,
        inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
        thinking: thinkingModule(),
        body: {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true })),
        } as unknown as ResidentBody,
        evidence,
    });
}

const TICK = {
    tick: 1,
    resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
    events: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S-GOAL-3: ResidentRuntime orientation progress/stall wire-up', () => {
    it('emits orientation_progress when activeGoal.id matches orientationGoal.id', async () => {
        const goalId = 'master-woodcutting';
        const library = makeLibraryMock();
        const state = stateFor('res:test', {
            cognition: {
                activeGoal: { id: goalId, description: 'Master woodcutting', ttlTicks: 100 },
            } as any,
        });

        const runtime = makeRuntime('res:test', state, library, {
            orientationGoal: { id: goalId, description: 'Master woodcutting' },
        });

        await runtime.onPerception(TICK);

        expect(library.observeOrientationProgress).toHaveBeenCalledTimes(1);
        const call = (library.observeOrientationProgress as jest.Mock).mock.calls[0][0];
        expect(call.kind).toBe('orientation_progress');
        expect(call.orientationGoalId).toBe(goalId);
        expect(call.reason).toBe('goal_id_match');
        expect(library.observeOrientationStalled).not.toHaveBeenCalled();
    });

    it('does not emit orientation_progress when activeGoal.id does not match', async () => {
        const library = makeLibraryMock();
        const state = stateFor('res:test', {
            cognition: {
                activeGoal: { id: 'earn-gp', description: 'Earn GP', ttlTicks: 100 },
            } as any,
        });

        const runtime = makeRuntime('res:test', state, library, {
            orientationGoal: { id: 'master-woodcutting', description: 'Master woodcutting' },
        });

        await runtime.onPerception(TICK);

        expect(library.observeOrientationProgress).not.toHaveBeenCalled();
        expect(library.observeOrientationStalled).not.toHaveBeenCalled();
    });

    it('does not emit orientation events when soul has no orientationGoal', async () => {
        const library = makeLibraryMock();
        const state = stateFor('res:test', {
            cognition: {
                activeGoal: { id: 'earn-gp', description: 'Earn GP', ttlTicks: 100 },
            } as any,
        });

        const runtime = makeRuntime('res:test', state, library, {
            // no orientationGoal field
        });

        await runtime.onPerception(TICK);

        expect(library.observeOrientationProgress).not.toHaveBeenCalled();
        expect(library.observeOrientationStalled).not.toHaveBeenCalled();
    });

    it('emits orientation_stalled exactly once after ORIENTATION_STALL_WINDOW consecutive non-matching ticks', async () => {
        const library = makeLibraryMock();
        const state = stateFor('res:test', {
            cognition: {
                activeGoal: { id: 'earn-gp', description: 'Earn GP', ttlTicks: 9999 },
            } as any,
        });

        const runtime = makeRuntime('res:test', state, library, {
            orientationGoal: { id: 'master-woodcutting', description: 'Master woodcutting' },
        });

        for (let i = 0; i < ORIENTATION_STALL_WINDOW; i++) {
            await runtime.onPerception({ ...TICK, tick: i + 1 });
        }

        expect(library.observeOrientationStalled).toHaveBeenCalledTimes(1);
        const call = (library.observeOrientationStalled as jest.Mock).mock.calls[0][0];
        expect(call.kind).toBe('orientation_stalled');
        expect(call.orientationGoalId).toBe('master-woodcutting');
        expect(call.nonProgressTicks).toBe(ORIENTATION_STALL_WINDOW);
        expect(library.observeOrientationProgress).not.toHaveBeenCalled();

        // A subsequent non-matching tick after stall fires does NOT emit another stall
        await runtime.onPerception({ ...TICK, tick: ORIENTATION_STALL_WINDOW + 1 });
        expect(library.observeOrientationStalled).toHaveBeenCalledTimes(1);
    });

    it('does not emit orientation events when resident is deceased', async () => {
        const library = makeLibraryMock();
        const state = stateFor('res:test', {
            // processed=true skips epitaph dispatch so the test doesn't need a full library mock
            deceased: { cause: 'attention_exhausted', processed: true } as any,
            cognition: {
                activeGoal: { id: 'master-woodcutting', description: 'Master woodcutting', ttlTicks: 100 },
            } as any,
        });

        const runtime = makeRuntime('res:test', state, library, {
            orientationGoal: { id: 'master-woodcutting', description: 'Master woodcutting' },
        });

        await runtime.onPerception(TICK);

        expect(library.observeOrientationProgress).not.toHaveBeenCalled();
        expect(library.observeOrientationStalled).not.toHaveBeenCalled();
    });

    it('resets stall counter and fires fresh progress after a matching tick', async () => {
        const goalId = 'master-woodcutting';
        const library = makeLibraryMock();
        // Start with non-matching active goal; will switch to matching mid-run
        const state = stateFor('res:test', {
            cognition: {
                activeGoal: { id: 'earn-gp', description: 'Earn GP', ttlTicks: 9999 },
            } as any,
        });

        const runtime = makeRuntime('res:test', state, library, {
            orientationGoal: { id: goalId, description: 'Master woodcutting' },
        });

        // Run ORIENTATION_STALL_WINDOW - 1 ticks with non-matching goal (no stall yet)
        for (let i = 0; i < ORIENTATION_STALL_WINDOW - 1; i++) {
            await runtime.onPerception({ ...TICK, tick: i + 1 });
        }
        expect(library.observeOrientationStalled).not.toHaveBeenCalled();

        // Switch active goal to matching → progress detected, stall counter resets
        state.cognition!.activeGoal = { id: goalId, description: 'Master woodcutting', ttlTicks: 100, createdAtTick: 0 };
        await runtime.onPerception({ ...TICK, tick: ORIENTATION_STALL_WINDOW });

        expect(library.observeOrientationProgress).toHaveBeenCalledTimes(1);
        expect(library.observeOrientationStalled).not.toHaveBeenCalled();
    });
});
