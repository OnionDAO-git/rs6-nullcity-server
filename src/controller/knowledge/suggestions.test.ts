import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    KnowledgeSuggestionStore,
    knowledgeSuggestionDedupKey,
    knowledgeSuggestionSchema,
    redactSuggestion,
    type KnowledgeSuggestion,
} from './suggestions';

describe('knowledge suggestions', () => {
    it('validates suggestion shape with zod', () => {
        expect(knowledgeSuggestionSchema.safeParse(suggestion()).success).toBe(true);
        expect(knowledgeSuggestionSchema.safeParse({ id: 'bad' }).success).toBe(false);
        expect(
            knowledgeSuggestionSchema.safeParse(
                suggestion({
                    evidence: { outcome: 'blocked', retrievedKnowledgeIds: [], summaries: ['missing ids'] },
                }),
            ).success,
        ).toBe(false);
    });

    it('generates stable dedup keys from normalized content', () => {
        const a = suggestion({
            proposedChange: { kind: 'workflow_hint', targetId: 'skill-firemaking-basic', summary: ' Use tinderbox on LOGS. ' },
        });
        const b = suggestion({
            proposedChange: { kind: 'workflow_hint', targetId: 'skill-firemaking-basic', summary: 'use tinderbox on logs' },
        });

        expect(knowledgeSuggestionDedupKey(a)).toBe(knowledgeSuggestionDedupKey(b));
    });

    it('emits stdout before writing a per-instance JSONL file', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-suggestions-'));
        const emitted: unknown[] = [];
        const store = new KnowledgeSuggestionStore({
            root,
            controllerId: 'nullcity-controller',
            instanceId: 'railgun-7',
            emitStdout: true,
            storageMode: 'persistent-volume',
            stdout: entry => emitted.push(entry),
        });

        store.append(suggestion({ observation: 'secret sk-or-v1-abc123 should be hidden' }));

        expect(emitted).toHaveLength(1);
        expect(JSON.stringify(emitted[0])).toContain('knowledge_suggestion');
        expect(JSON.stringify(emitted[0])).not.toContain('sk-or-v1-abc123');
        await store.flush();
        const file = path.join(root, 'suggestions.nullcity-controller.railgun-7.jsonl');
        expect(fs.readFileSync(file, 'utf8')).toContain('"event":"knowledge_suggestion"');
    });

    it('swallows file write failures after stdout warning', async () => {
        const emitted: unknown[] = [];
        const store = new KnowledgeSuggestionStore({
            root: '/readonly',
            controllerId: 'controller',
            instanceId: 'instance',
            emitStdout: true,
            storageMode: 'persistent-volume',
            stdout: entry => emitted.push(entry),
            appendFile: () => {
                const error = new Error('readonly') as NodeJS.ErrnoException;
                error.code = 'EROFS';
                throw error;
            },
        });

        expect(() => store.append(suggestion())).not.toThrow();
        await store.flush();
        expect(emitted.map(entry => (entry as { event?: string }).event)).toEqual([
            'knowledge_suggestion',
            'knowledge_suggestion_write_failed',
        ]);
    });

    it('still emits suggestions to stdout when storage is ephemeral and emitStdout is false', () => {
        const emitted: unknown[] = [];
        const store = new KnowledgeSuggestionStore({
            root: '/ephemeral',
            controllerId: 'controller',
            instanceId: 'instance',
            emitStdout: false,
            storageMode: 'ephemeral',
            stdout: entry => emitted.push(entry),
        });

        store.append(suggestion());

        expect(emitted.map(entry => (entry as { event?: string }).event)).toEqual(['knowledge_suggestion']);
    });

    it('still emits write failure warnings when emitStdout is false', async () => {
        const emitted: unknown[] = [];
        const store = new KnowledgeSuggestionStore({
            root: '/readonly',
            controllerId: 'controller',
            instanceId: 'instance',
            emitStdout: false,
            storageMode: 'persistent-volume',
            stdout: entry => emitted.push(entry),
            appendFile: () => {
                const error = new Error('readonly') as NodeJS.ErrnoException;
                error.code = 'EROFS';
                throw error;
            },
        });

        store.append(suggestion());
        await store.flush();

        expect(emitted.map(entry => (entry as { event?: string }).event)).toEqual([
            'knowledge_suggestion',
            'knowledge_suggestion_write_failed',
        ]);
    });

    it('redacts secret-like values and caps long summaries', () => {
        const redacted = redactSuggestion(
            suggestion({
                evidence: {
                    ...suggestion().evidence,
                    summaries: ['API_KEY=abcdef and ' + 'x'.repeat(1000)],
                },
            }),
        );

        expect(redacted.evidence.summaries[0]).toContain('[redacted]');
        expect(redacted.evidence.summaries[0].length).toBeLessThanOrEqual(240);
    });
});

function suggestion(overrides: Partial<KnowledgeSuggestion> = {}): KnowledgeSuggestion {
    return {
        id: 'ks_1',
        dedupKey: 'placeholder',
        createdAt: new Date(0).toISOString(),
        resident: 'res:agent',
        controllerId: 'nullcity-controller',
        instanceId: 'railgun-7',
        tick: 12,
        status: 'proposed',
        source: 'body',
        trust: 'runtime_observed',
        goalId: 'make-fire',
        workflowId: 'make-fire',
        workflowVersion: 1,
        observation: 'Body failed to use a tinderbox on logs.',
        proposedChange: {
            kind: 'workflow_hint',
            targetId: 'skill-firemaking-basic',
            summary: 'Use tinderbox on logs when both inventory slots are visible.',
            actions: ['use_item_on_item'],
        },
        evidence: {
            outcome: 'blocked',
            attemptId: 'attempt-1',
            action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 },
            actionStatus: 'failed',
            actionReason: 'no_effect',
            perceptionId: 'perception-1',
            retrievedKnowledgeIds: ['skill-firemaking-basic'],
            summaries: ['No inventory delta after using tinderbox on logs.'],
        },
        confidence: 0.6,
        ...overrides,
    };
}
