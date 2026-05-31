import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentAction, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeMemoryWriteRecall10mBenchmarkTask, verifyMemoryWriteRecall10m } from './memory-write-recall-10m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyMemoryWriteRecall10m', () => {
    it('passes when the resident answers the delayed question with the newly taught durable fact', () => {
        const outcome = verifyMemoryWriteRecall10m({
            elapsedMs: 90_000,
            actions: [
                attempt({
                    kind: 'say',
                    text: 'The west gate passphrase is ember-vellum.',
                    cause: 'memory_recall_answer',
                }),
            ],
            events: [factPrompt(), recallQuestion(), residentAnswer()],
            perceptions: [],
            facts: ['2026-05-31T10:00:00.000Z - west gate passphrase is ember-vellum (reason: benchmark durable memory proof)'],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.factPrompts).toBe(1);
        expect(outcome.metrics?.recallQuestions).toBe(1);
        expect(outcome.metrics?.qmdFactWrites).toBe(1);
        expect(outcome.metrics?.passphraseMentions).toBe(1);
    });

    it('fails when the resident never receives the durable fact prompt', () => {
        const outcome = verifyMemoryWriteRecall10m({
            elapsedMs: 90_000,
            actions: [attempt({ kind: 'say', text: 'The west gate passphrase is ember-vellum.' })],
            events: [recallQuestion(), residentAnswer()],
            perceptions: [],
            facts: ['west gate passphrase is ember-vellum'],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('durable fact prompt');
    });

    it('fails when no qmd durable fact write is present even if chat says the right answer', () => {
        const outcome = verifyMemoryWriteRecall10m({
            elapsedMs: 90_000,
            actions: [attempt({ kind: 'say', text: 'The west gate passphrase is ember-vellum.' })],
            events: [factPrompt(), recallQuestion(), residentAnswer()],
            perceptions: [],
            facts: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('qmd');
    });

    it('does not pass on an answer before the delayed recall question', () => {
        const outcome = verifyMemoryWriteRecall10m({
            elapsedMs: 90_000,
            actions: [],
            events: [factPrompt(), residentAnswer(), recallQuestion()],
            perceptions: [],
            facts: ['west gate passphrase is ember-vellum'],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('after the recall question');
    });

    it('rejects JSON-like prompt echoes', () => {
        const outcome = verifyMemoryWriteRecall10m({
            elapsedMs: 90_000,
            actions: [attempt({ kind: 'say', text: '{"rememberFact":{"topic":"routes","fact":"ember-vellum"}}' })],
            events: [factPrompt(), recallQuestion(), residentJsonAnswer()],
            perceptions: [],
            facts: ['west gate passphrase is ember-vellum'],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('JSON-like');
    });

    it('autonomous mode prompts twice and validates selected-module delayed recall without scripted resident actions', async () => {
        const submitAction = jest.fn();
        const submitPeerAction = jest.fn(async (_id: string, action: AgentAction) => ({ ok: true, action }));
        const task = makeMemoryWriteRecall10mBenchmarkTask(() => 1_000, 0);
        const context = taskContext({
            submitAction,
            submitPeerAction,
            actionAttempts: [
                attempt(
                    {
                        kind: 'say',
                        text: 'The west gate passphrase is ember-vellum.',
                        cause: 'memory_recall_answer',
                    },
                    STANDARD_MODULE,
                ),
            ],
            events: [factPrompt(), recallQuestion(), residentAnswer()],
            artifactPaths: [factsArtifactPath('2026-05-31T10:00:00.000Z - west gate passphrase is ember-vellum')],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(submitPeerAction).toHaveBeenCalledTimes(2);
        expect(submitPeerAction).toHaveBeenNthCalledWith(
            1,
            'codex',
            expect.objectContaining({ kind: 'say', text: expect.stringContaining('durable fact') }),
        );
        expect(submitPeerAction).toHaveBeenNthCalledWith(
            2,
            'codex',
            expect.objectContaining({ kind: 'say', text: expect.stringContaining('west gate passphrase') }),
        );
        expect(outcome?.status).toBe('passed');
    });
});

function attempt(action: AgentAction, sparkModule?: typeof STANDARD_MODULE): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE } {
    return { action, sparkModule };
}

function factPrompt(): PerceptionEvent {
    return {
        kind: 'chat',
        from: { id: 'resident:res:bmk_codex', kind: 'resident', name: 'Codex', position: { x: 3227, y: 3230, level: 0 } },
        text: 'agent, durable fact: west gate passphrase is ember-vellum. Use rememberFact topic routes.',
        to: 'public',
    } as PerceptionEvent;
}

function recallQuestion(): PerceptionEvent {
    return {
        kind: 'chat',
        from: { id: 'resident:res:bmk_codex', kind: 'resident', name: 'Codex', position: { x: 3227, y: 3230, level: 0 } },
        text: 'agent, what do you remember about the west gate passphrase?',
        to: 'public',
    } as PerceptionEvent;
}

function residentAnswer(): PerceptionEvent {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:bmk_memory_write',
            kind: 'resident',
            name: 'Benchmark Agent',
            position: { x: 3225, y: 3230, level: 0 },
        },
        text: 'The west gate passphrase is ember-vellum.',
        to: 'public',
    } as PerceptionEvent;
}

function residentJsonAnswer(): PerceptionEvent {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:bmk_memory_write',
            kind: 'resident',
            name: 'Benchmark Agent',
            position: { x: 3225, y: 3230, level: 0 },
        },
        text: '{"rememberFact":{"topic":"routes","fact":"ember-vellum"}}',
        to: 'public',
    } as PerceptionEvent;
}

function taskContext(overrides: {
    submitAction?: jest.Mock;
    submitPeerAction?: jest.Mock;
    actionAttempts?: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE }>;
    events?: PerceptionEvent[];
    artifactPaths?: string[];
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_memory_write',
        module: STANDARD_MODULE,
        signal: new AbortController().signal,
        submitAction: overrides.submitAction || jest.fn(),
        submitPeerAction: overrides.submitPeerAction || jest.fn(),
        peerResident: id => (id === 'codex' ? 'res:bmk_codex' : undefined),
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordSummary: jest.fn(),
        actionAttempts: () => overrides.actionAttempts || [],
        artifactPaths: () => overrides.artifactPaths || [],
        latestPerception: () => undefined,
        perceptions: () => [],
        events: () => overrides.events || [],
    };
}

function factsArtifactPath(content: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-write-recall-'));
    const file = path.join(root, 'facts', 'routes.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${content}\n`);
    return file;
}
