import fs from 'fs';
import os from 'os';
import path from 'path';
import { EvidenceStore } from './evidence-store';
import { TrajectoryBuilder } from './trajectory-builder';

describe('TrajectoryBuilder', () => {
    it('writes begin/end tick lines with perception fingerprints', () => {
        const { builder, session } = testBuilder();

        builder.beginTick(7, { tick: 99, resident: { position: { x: 1, y: 2, level: 0 } } });
        builder.endTick('tick_complete');

        const lines = readJsonl(session.trajectoryPath);
        expect(lines).toEqual([
            expect.objectContaining({
                schemaVersion: 1,
                ts: '2026-05-21T08:15:00.000Z',
                tick: 7,
                sessionId: 'session-a',
                kind: 'begin_tick',
                perceptionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                perceptionBytes: expect.any(Number),
            }),
            expect.objectContaining({
                tick: 7,
                sessionId: 'session-a',
                kind: 'end_tick',
                reason: 'tick_complete',
            }),
        ]);
    });

    it('records hook, decision, action, action result, and legacy lines', () => {
        const { builder, session } = testBuilder();
        builder.beginTick(3, { tick: 3 });

        builder.recordHook({ id: 'chat', priority: 80, cause: 'chat', hook: { id: 'chat', priority: 80, condition: { kind: 'always' } } });
        builder.recordDecision({
            cause: 'chat',
            moduleId: 'onion.runescape.standard',
            moduleVersion: '0.1.0',
            promptHash: 'prompt-hash',
            completionHash: 'completion-hash',
            actionKinds: ['say'],
        });
        builder.recordAction({ kind: 'say', text: 'I am learning.' }, 'request-1');
        builder.recordActionResult('request-1', { status: 'success', reason: 'success', evidence: [{ source: 'derived', detail: 'chat_observed' }] });
        builder.recordLegacy({ cause: 'attention_exhausted', complete: true });
        builder.endTick('legacy_complete_post_action');

        const kinds = readJsonl(session.trajectoryPath).map((line: { kind: string }) => line.kind);
        expect(kinds).toEqual(['begin_tick', 'hook', 'decision', 'say', 'action_result', 'legacy_event', 'end_tick']);
        expect(readJsonl(session.trajectoryPath)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'hook', winnerId: 'chat', priority: 80, cause: 'chat' }),
                expect.objectContaining({
                    kind: 'decision',
                    moduleId: 'onion.runescape.standard',
                    promptHash: 'prompt-hash',
                    completionHash: 'completion-hash',
                    actionKinds: ['say'],
                }),
                expect.objectContaining({
                    kind: 'say',
                    requestId: 'request-1',
                    actionKind: 'say',
                    text: 'I am learning.',
                }),
                expect.objectContaining({
                    kind: 'action_result',
                    requestId: 'request-1',
                    status: 'success',
                    reason: 'success',
                }),
                expect.objectContaining({
                    kind: 'legacy_event',
                    event: { cause: 'attention_exhausted', complete: true },
                }),
            ]),
        );
    });

    it('requires an active evidence session before recording lines', () => {
        const store = new EvidenceStore('res:agent', fs.mkdtempSync(path.join(os.tmpdir(), 'trajectory-no-session-')));
        const builder = new TrajectoryBuilder(store);

        expect(() => builder.beginTick(1, { tick: 1 })).toThrow('Evidence session has not started');
    });
});

function testBuilder(): {
    builder: TrajectoryBuilder;
    session: ReturnType<EvidenceStore['beginSession']>;
} {
    const store = new EvidenceStore('res:agent', fs.mkdtempSync(path.join(os.tmpdir(), 'trajectory-builder-')), {
        now: () => new Date('2026-05-21T08:00:00.000Z'),
    });
    const session = store.beginSession('session-a', 'soul-v1');
    return {
        builder: new TrajectoryBuilder(store, { now: () => new Date('2026-05-21T08:15:00.000Z') }),
        session,
    };
}

function readJsonl(filePath: string): unknown[] {
    return fs
        .readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
}
