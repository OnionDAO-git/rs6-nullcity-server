import type { PerceptionEvent } from '../transport/message-codecs';
import {
    parseNamedMemoryRecallSoakArgs,
    verifyNamedMemoryRecallSoakEvidence,
    type NamedMemoryRecallSoakLogEntry,
} from './named-memory-recall-soak';

describe('named memory recall soak verifier', () => {
    it('passes when a named resident writes the taught qmd fact and answers naturally after the delayed question', () => {
        const outcome = verifyNamedMemoryRecallSoakEvidence({
            resident: 'res:hans',
            commandPeer: 'res:codex-smem4',
            events: [factPrompt(), recallQuestion(), residentAnswer()],
            entries: [log({ kind: 'say', text: 'The west gate passphrase is ember-vellum.', cause: 'memory_recall_answer' })],
            factTexts: ['2026-05-31T16:00:00.000Z - west gate passphrase is ember-vellum (reason: named soak proof)'],
            factPath: 'data/controller/memory/res-hans/facts/routes.md',
            teachSubmittedAtMs: 1_000,
            questionSubmittedAtMs: 61_000,
            minDelayMs: 60_000,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics).toMatchObject({
            factPrompts: 1,
            recallQuestions: 1,
            qmdFactWrites: 1,
            delaySatisfied: 1,
            naturalAnswers: 1,
            jsonLikeReplies: 0,
            passphraseMentions: 1,
            westGateMentions: 1,
        });
        expect(outcome.summaries[0]).toContain('res:hans recalled');
    });

    it('fails when the qmd fact file does not contain the taught durable fact', () => {
        const outcome = verifyNamedMemoryRecallSoakEvidence({
            resident: 'res:hans',
            commandPeer: 'res:codex-smem4',
            events: [factPrompt(), recallQuestion(), residentAnswer()],
            entries: [],
            factTexts: [],
            teachSubmittedAtMs: 1_000,
            questionSubmittedAtMs: 61_000,
            minDelayMs: 60_000,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('qmd durable fact');
        expect(outcome.metrics.qmdFactWrites).toBe(0);
    });

    it('does not pass on an answer that happened before the recall question', () => {
        const outcome = verifyNamedMemoryRecallSoakEvidence({
            resident: 'res:hans',
            commandPeer: 'res:codex-smem4',
            events: [factPrompt(), residentAnswer(), recallQuestion()],
            entries: [],
            factTexts: ['west gate passphrase is ember-vellum'],
            teachSubmittedAtMs: 1_000,
            questionSubmittedAtMs: 61_000,
            minDelayMs: 60_000,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('after the recall question');
        expect(outcome.metrics.naturalAnswers).toBe(0);
    });

    it('rejects JSON-like prompt echoes instead of natural memory recall', () => {
        const outcome = verifyNamedMemoryRecallSoakEvidence({
            resident: 'res:hans',
            commandPeer: 'res:codex-smem4',
            events: [factPrompt(), recallQuestion(), residentJsonAnswer()],
            entries: [],
            factTexts: ['west gate passphrase is ember-vellum'],
            teachSubmittedAtMs: 1_000,
            questionSubmittedAtMs: 61_000,
            minDelayMs: 60_000,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('JSON-like');
        expect(outcome.metrics.jsonLikeReplies).toBe(1);
    });

    it('fails when the resident answers after the question but omits the taught passphrase', () => {
        const outcome = verifyNamedMemoryRecallSoakEvidence({
            resident: 'res:hans',
            commandPeer: 'res:codex-smem4',
            events: [factPrompt(), recallQuestion(), residentAnswer('I remember something about the west gate, but not the phrase.')],
            entries: [],
            factTexts: ['west gate passphrase is ember-vellum'],
            teachSubmittedAtMs: 1_000,
            questionSubmittedAtMs: 61_000,
            minDelayMs: 60_000,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('omitted the west gate passphrase');
        expect(outcome.metrics.passphraseMentions).toBe(0);
    });

    it('fails when the recall question is asked before the requested delay has elapsed', () => {
        const outcome = verifyNamedMemoryRecallSoakEvidence({
            resident: 'res:hans',
            commandPeer: 'res:codex-smem4',
            events: [factPrompt(), recallQuestion(), residentAnswer()],
            entries: [],
            factTexts: ['west gate passphrase is ember-vellum'],
            teachSubmittedAtMs: 1_000,
            questionSubmittedAtMs: 10_000,
            minDelayMs: 60_000,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('delayed recall question');
        expect(outcome.metrics.delaySatisfied).toBe(0);
    });

    it('passes when the event stream misses the question but the resident persisted it in social memory', () => {
        const questionSubmittedAtMs = Date.parse('2026-05-31T16:35:14.558Z');
        const outcome = verifyNamedMemoryRecallSoakEvidence({
            resident: 'res:agent',
            commandPeer: 'res:cmem163442',
            events: [factPrompt()],
            entries: [
                log(
                    { kind: 'say', text: 'I remember west gate passphrase is ember-vellum.', voiceSource: 'scripted' },
                    'res:agent',
                    '2026-05-31T16:35:24.430Z',
                ),
            ],
            factTexts: ['- 2026-05-31T16:34:44.442Z res:cmem163442 taught: "west gate passphrase is ember-vellum."'],
            socialTexts: ['- 2026-05-31T16:35:14.558Z res:cmem163442 said: "agent, what do you remember about west gate passphrase?"'],
            teachSubmittedAtMs: 1_000,
            questionSubmittedAtMs,
            minDelayMs: 30_000,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics.recallQuestions).toBe(1);
        expect(outcome.metrics.naturalAnswers).toBe(1);
    });

    it('does not pass social-memory fallback using an answer logged before the recall question', () => {
        const questionSubmittedAtMs = Date.parse('2026-05-31T16:35:14.558Z');
        const outcome = verifyNamedMemoryRecallSoakEvidence({
            resident: 'res:agent',
            commandPeer: 'res:cmem163442',
            events: [factPrompt()],
            entries: [
                log(
                    { kind: 'say', text: 'I remember west gate passphrase is ember-vellum.', voiceSource: 'scripted' },
                    'res:agent',
                    '2026-05-31T16:35:00.000Z',
                ),
            ],
            factTexts: ['- 2026-05-31T16:34:44.442Z res:cmem163442 taught: "west gate passphrase is ember-vellum."'],
            socialTexts: ['- 2026-05-31T16:35:14.558Z res:cmem163442 said: "agent, what do you remember about west gate passphrase?"'],
            teachSubmittedAtMs: questionSubmittedAtMs - 30_000,
            questionSubmittedAtMs,
            minDelayMs: 30_000,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('after the recall question');
        expect(outcome.metrics.naturalAnswers).toBe(0);
    });

    it('verifies a custom taught fact instead of only the default passphrase', () => {
        const outcome = verifyNamedMemoryRecallSoakEvidence({
            resident: 'res:hans',
            commandPeer: 'res:codex-smem4',
            events: [
                factPrompt('hans, durable fact: east ferry code is moon-salt. Use rememberFact topic routes.'),
                recallQuestion('hans, what do you remember about east ferry code?'),
                residentAnswer('I remember east ferry code is moon-salt.'),
            ],
            entries: [],
            factTexts: ['- 2026-05-31T16:34:44.442Z res:codex-smem4 taught: "east ferry code is moon-salt."'],
            expectedFactText: 'east ferry code is moon-salt',
            teachSubmittedAtMs: 1_000,
            questionSubmittedAtMs: 31_000,
            minDelayMs: 30_000,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics.passphraseMentions).toBe(1);
        expect(outcome.metrics.westGateMentions).toBe(1);
    });

    it('parses safe defaults for the named memory recall soak', () => {
        expect(parseNamedMemoryRecallSoakArgs([], new Date('2026-05-31T16:09:30.000Z'))).toMatchObject({
            resident: 'res:hans',
            commandPeer: 'res:codex-smem4-160930',
            configPath: 'controller.yml',
            outputDir: 'data/benchmarks/capability-qa-2026-05-31',
            durationMs: 780_000,
            delayMs: 600_000,
            pollMs: 500,
            actionTimeoutMs: 120_000,
            factTopic: 'routes',
            factText: 'west gate passphrase is ember-vellum',
        });
    });

    it('parses resident, peer, delay, duration, and output overrides', () => {
        expect(
            parseNamedMemoryRecallSoakArgs([
                '--resident',
                'resident:res:qa-memory',
                '--command-peer=res:codex-fast',
                '--delay-ms',
                '30000',
                '--duration-ms=180000',
                '--action-timeout-ms',
                '90000',
                '--output',
                'tmp/memory-soak',
            ]),
        ).toMatchObject({
            resident: 'res:qa-memory',
            commandPeer: 'res:codex-fast',
            delayMs: 30_000,
            durationMs: 180_000,
            actionTimeoutMs: 90_000,
            outputDir: 'tmp/memory-soak',
        });
    });
});

function factPrompt(text = 'hans, durable fact: west gate passphrase is ember-vellum. Use rememberFact topic routes.'): PerceptionEvent {
    return {
        kind: 'chat',
        from: { id: 'resident:res:codex-smem4', kind: 'resident', name: 'res:codex-smem4', position: { x: 3222, y: 3218, level: 0 } },
        text,
        to: 'public',
    } as PerceptionEvent;
}

function recallQuestion(text = 'hans, what do you remember about the west gate passphrase?'): PerceptionEvent {
    return {
        kind: 'chat',
        from: { id: 'resident:res:codex-smem4', kind: 'resident', name: 'res:codex-smem4', position: { x: 3222, y: 3218, level: 0 } },
        text,
        to: 'public',
    } as PerceptionEvent;
}

function residentAnswer(text = 'The west gate passphrase is ember-vellum.'): PerceptionEvent {
    return {
        kind: 'chat',
        from: { id: 'resident:res:hans', kind: 'resident', name: 'Hans', position: { x: 3221, y: 3218, level: 0 } },
        text,
        to: 'public',
    } as PerceptionEvent;
}

function residentJsonAnswer(): PerceptionEvent {
    return residentAnswer('{"rememberFact":{"topic":"routes","fact":"ember-vellum"}}');
}

function log(action: Record<string, unknown>, source = 'res:hans', t = '2026-05-31T16:11:00.000Z'): NamedMemoryRecallSoakLogEntry {
    return { t, source, action };
}
