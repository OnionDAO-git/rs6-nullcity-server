import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ResidentBody } from './body';
import { writeBirthSoulFile } from './city-integration/service';
import { EvidenceStore, LibraryUpdater, TrajectoryBuilder } from './evidence';
import type { LlmClient } from './llm/llm-client';
import type { ActionLog } from './logging/action-log';
import type { InferenceLog } from './logging/inference-log';
import type { MemoryStore } from './memory/memory-store';
import { RuntimeStateStore, residentSlug } from './memory/runtime-state';
import { ResidentRuntime, type ResidentRuntimeEvidence } from './resident-runtime';
import { SoulLoader } from './soul/soul-loader';
import type { Soul } from './soul/soul-schema';
import type { ThinkingModule } from './thinking';
import type { GatewayClient } from './transport/gateway-client';

// Death processing broadcasts epitaphs to configured patrons via
// loadControllerConfig() — keep the test hermetic (no real controller.yml).
jest.mock('./config', () => ({
    loadControllerConfig: jest.fn(() => ({
        patrons: [],
    })),
}));

/**
 * REAL MORTALITY integration (maintainer decision 2026-06-11: "We should
 * make agents actually die so new SOULs can be born").
 *
 * Exercises the full loop against the REAL starter-soul roster (not inline
 * fixtures), so it would fail if anyone re-adds `attentionProfile.floor`
 * or `respawnPolicy: on_restart` to a cohort soul:
 *
 *   1. a roster soul's attention exhausts → markDeceased('attention_exhausted')
 *   2. the Library seals: index currentState flips to 'ended', host onDeath fires
 *   3. a controller restart does NOT resurrect it (no respawnPolicy left)
 *   4. a NEW soul is born (writeBirthSoulFile → SoulLoader → runtime) while
 *      the first is dead — death does not block the birth path
 *   5. both library states coexist on disk: one 'ended', one 'living'
 */
describe('real mortality → new-soul birth (integration)', () => {
    const starterSoulsDir = path.join(__dirname, 'soul', 'starter-souls');

    function thinkingStub(): ThinkingModule {
        return {
            think: jest.fn(async () => ({ actions: [], cause: 'noop', nooped: true })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
    }

    function bodyStub(): ResidentBody {
        return {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-1' })),
        } as unknown as ResidentBody;
    }

    function memoryStub(dir: string): MemoryStore {
        return { ensureResident: jest.fn(() => dir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore;
    }

    function evidenceFor(residentName: string, root: string): ResidentRuntimeEvidence {
        const store = new EvidenceStore(residentName, root);
        const session = store.beginSession(`mortality-test-${residentSlug(residentName)}`, 'soul-v1');
        return {
            store,
            sessionId: session.sessionId,
            trajectory: new TrajectoryBuilder(store),
            library: new LibraryUpdater(residentName, root),
        };
    }

    function runtimeFor(
        soul: Soul,
        root: string,
        stateStore: RuntimeStateStore,
        extras: { onDeath?: (name: string, cause: string) => void } = {},
    ): ResidentRuntime {
        return new ResidentRuntime({
            soul,
            gateway: {} as GatewayClient,
            memory: memoryStub(root),
            stateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingStub(),
            body: bodyStub(),
            evidence: evidenceFor(soul.frontmatter.name, root),
            onDeath: extras.onDeath,
        });
    }

    function perception(tick: number) {
        return {
            tick,
            resident: { position: { x: 3222, y: 3218, level: 0 }, inventory: [], skills: {} },
            nearby: { players: [], npcs: [], worldItems: [], objects: [] },
            events: [],
            availableActions: [],
        };
    }

    function libraryState(root: string, residentName: string): string {
        const indexPath = path.join(root, 'library', residentSlug(residentName), 'index.json');
        return (JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { currentState: string }).currentState;
    }

    it('a roster soul dies for real, stays dead across restart, and a new soul is born beside the grave', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-mortality-rebirth-'));
        const loader = new SoulLoader(starterSoulsDir);
        const stateStore = new RuntimeStateStore(root);
        const onDeath = jest.fn();

        // --- 1. Life: the REAL res:agent soul (previously respawnPolicy:
        // on_restart) starts living, then its attention runs out.
        const agentSoul = loader.load('res:agent');
        const runtime = runtimeFor(agentSoul, root, stateStore, { onDeath });
        const state = runtime.getState();
        expect(state.deceased).toBeUndefined();

        // Drain to the brink (admin drain — does NOT mark deceased), then a
        // single perception tick of ordinary idle decay finishes the job.
        runtime.decrementAttention(state.attention - 0.5);
        await runtime.onPerception(perception(1));

        // --- 2. Death is real and fully processed on the same tick.
        expect(state.attention).toBe(0);
        expect(state.deceased?.cause).toBe('attention_exhausted');
        expect(state.deceased?.processed).toBe(true);
        expect(onDeath).toHaveBeenCalledWith('res:agent', 'attention_exhausted');
        // The Library seals the life: portrait/tombstone state is 'ended'.
        expect(libraryState(root, 'res:agent')).toBe('ended');

        // --- 3. Controller restart: a fresh runtime over the persisted state
        // must NOT resurrect (the roster no longer carries respawnPolicy).
        const restarted = runtimeFor(loader.load('res:agent'), root, stateStore);
        expect(restarted.getState().deceased?.cause).toBe('attention_exhausted');
        expect(stateStore.isAlive('res:agent')).toBe(false);
        expect(libraryState(root, 'res:agent')).toBe('ended');

        // --- 4. Birth while dead: a brand-new soul is written, loaded, and
        // incarnated. The dead resident does not block the path.
        const bornSoulsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-mortality-born-souls-'));
        const newbornMarkdown = [
            '---',
            'name: res:newborn',
            'archetype: endurer',
            'attentionProfile:',
            '  startingAttention: 15000',
            '  decayCurve: standard',
            '---',
            '# Newborn',
            '',
            'Born after res:agent ended; sponsored by a patron.',
        ].join('\n');
        writeBirthSoulFile(bornSoulsDir, { residentName: 'res:newborn', soulMarkdown: newbornMarkdown });
        const newbornSoul = new SoulLoader(bornSoulsDir).load('res:newborn');
        const newbornRuntime = runtimeFor(newbornSoul, root, stateStore);
        await newbornRuntime.onPerception(perception(2));

        // --- 5. Both states coexist: one life sealed 'ended', one 'living'.
        const newbornState = newbornRuntime.getState();
        expect(newbornState.deceased).toBeUndefined();
        expect(newbornState.attention).toBeGreaterThan(0);
        expect(stateStore.isAlive('res:newborn')).toBe(true);
        expect(libraryState(root, 'res:newborn')).toBe('living');
        expect(libraryState(root, 'res:agent')).toBe('ended');

        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(bornSoulsDir, { recursive: true, force: true });
    });
});
