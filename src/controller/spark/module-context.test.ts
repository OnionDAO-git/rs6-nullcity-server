import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import {
    createSafeSparkModuleContext,
    createSoulPublicView,
    createSparkModulePerceptionFacade,
    createSparkModuleStateFacade,
} from './module-context';
import { noopSparkModuleTelemetry } from './module-telemetry';

describe('SPARK safe module context facades', () => {
    it('returns frozen state snapshots without exposing the live RuntimeState object', () => {
        const state = runtimeState();
        const facade = createSparkModuleStateFacade(state);

        const snapshot = facade.snapshot();
        expect(snapshot).toEqual(state);
        expect(snapshot).not.toBe(state);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.budgets)).toBe(true);

        expect(() => {
            (snapshot as RuntimeState).attention = 1;
        }).toThrow();
        expect(() => {
            (snapshot as RuntimeState).budgets.requestsToday = 99;
        }).toThrow();
        expect(state.attention).toBe(100);
        expect(state.budgets.requestsToday).toBe(0);
    });

    it('returns frozen perception snapshots without exposing live perception objects', () => {
        const perception: Perception = {
            tick: 7,
            resident: { id: 'player:res:test', position: { x: 3222, y: 3222, level: 0 } },
            events: [{ kind: 'public_chat', from: 'Codex', text: 'status?' }],
        };
        const facade = createSparkModulePerceptionFacade(perception);

        const snapshot = facade.snapshot();
        expect(snapshot).toEqual(perception);
        expect(snapshot).not.toBe(perception);
        expect(Object.isFrozen(snapshot.events)).toBe(true);

        expect(() => {
            ((snapshot as unknown as { events: unknown[] }).events as unknown[]).push({
                kind: 'public_chat',
                from: 'Agent',
                text: 'mutated',
            });
        }).toThrow();
        expect(perception.events).toHaveLength(1);
    });

    it('freezes safe context identity and config data', () => {
        const memory = { read: jest.fn(), write: jest.fn(), retrieve: jest.fn() };
        const inference = { complete: jest.fn(), budget: jest.fn() };
        const context = createSafeSparkModuleContext({
            module: { id: 'onion.test', version: '0.1.0' },
            config: { mode: 'careful', nested: { enabled: true } },
            soul: soul(),
            state: runtimeState(),
            memory,
            inference,
            telemetry: noopSparkModuleTelemetry,
        });

        expect(context.module).toEqual({ id: 'onion.test', version: '0.1.0' });
        expect(Object.isFrozen(context.module)).toBe(true);
        expect(Object.isFrozen(context.config)).toBe(true);
        expect(Object.isFrozen(context.config.nested)).toBe(true);
        expect(context.soul).toEqual({
            name: 'res:test',
            display: 'Test Resident',
            archetype: 'endurer',
            voice: { register: 'plain' },
            fears: ['fences'],
            loves: ['fires'],
            body: '# Test soul',
        });
        expect(Object.isFrozen(context.soul?.voice)).toBe(true);
        expect(context.memory).toBe(memory);
        expect(context.inference).toBe(inference);
        expect(context.state.snapshot().resident).toBe('res:test');

        expect(() => {
            (context.config as Record<string, unknown>).mode = 'reckless';
        }).toThrow();
    });

    it('exposes only a public SOUL view without source path or model endpoint', () => {
        const view = createSoulPublicView(soul());

        expect(view.name).toBe('res:test');
        expect(view.body).toBe('# Test soul');
        expect('sourcePath' in view).toBe(false);
        expect('model' in view).toBe(false);
        expect(Object.isFrozen(view)).toBe(true);
    });

    it('exposes goals, alignment, and aesthetic on the public soul view', () => {
        const soulWithExtras: Soul = {
            sourcePath: '/tmp/secret-soul.md',
            body: '# Soul with extras',
            frontmatter: {
                name: 'res:rich',
                display: 'Rich Resident',
                archetype: 'achiever',
                goals: ['become a master firemaker', 'find a lost friend'],
                alignment: 'loyal to Codex but suspicious of strangers',
                aesthetic: 'rust and cold iron',
            },
        };

        const view = createSoulPublicView(soulWithExtras);

        expect(view.goals).toEqual(['become a master firemaker', 'find a lost friend']);
        expect(view.alignment).toBe('loyal to Codex but suspicious of strangers');
        expect(view.aesthetic).toBe('rust and cold iron');
        expect(Object.isFrozen(view.goals)).toBe(true);
    });

    it('propagates evidence-layer progress fields (lastMeaningfulProgressAt, stuckSince) through the state snapshot', () => {
        const state = runtimeState();
        state.lastMeaningfulProgressAt = 42;
        state.stuckSince = 47;

        const facade = createSparkModuleStateFacade(state);
        const snapshot = facade.snapshot();

        expect(snapshot.lastMeaningfulProgressAt).toBe(42);
        expect(snapshot.stuckSince).toBe(47);
        expect(Object.isFrozen(snapshot)).toBe(true);

        // Mutation attempts on the snapshot fail; live state is unchanged.
        expect(() => {
            (snapshot as RuntimeState).stuckSince = 999;
        }).toThrow();
        expect(state.stuckSince).toBe(47);
    });

    it('omits evidence-layer progress fields from the snapshot when they are unset', () => {
        const facade = createSparkModuleStateFacade(runtimeState());
        const snapshot = facade.snapshot();

        expect(snapshot.lastMeaningfulProgressAt).toBeUndefined();
        expect(snapshot.stuckSince).toBeUndefined();
    });
});

function soul(): Soul {
    return {
        sourcePath: '/tmp/secret-soul.md',
        body: '# Test soul',
        frontmatter: {
            name: 'res:test',
            display: 'Test Resident',
            archetype: 'endurer',
            voice: { register: 'plain' },
            fears: ['fences'],
            loves: ['fires'],
            model: { endpoint: 'private-endpoint', temperature: 0.2 },
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
            behavior: { kind: 'hybrid-agent' },
        },
    };
}

function runtimeState(): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: 'res:test',
        attention: 100,
        tick: 0,
        legacy: { kind: 'endurer', progress: { fires: 1 }, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}
