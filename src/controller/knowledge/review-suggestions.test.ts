import fs from 'fs';
import os from 'os';
import path from 'path';
import { groupSuggestionEvents, loadSuggestionEvents, parseReviewSuggestionsArgs } from './review-suggestions';
import type { KnowledgeSuggestion } from './suggestions';

describe('review suggestions', () => {
    it('loads per-instance suggestion files and groups by dedup key', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suggestion-review-'));
        const suggestion = baseSuggestion('key-a');
        fs.writeFileSync(
            path.join(root, 'suggestions.controller.instance.jsonl'),
            [
                JSON.stringify({ event: 'knowledge_suggestion', ...suggestion }),
                `2026-05-20T00:00:00Z stdout ${JSON.stringify({ event: 'knowledge_suggestion', ...baseSuggestion('key-a', 'res:railgun') })}`,
                JSON.stringify({ event: 'knowledge_suggestion', ...baseSuggestion('key-a', 'res:pip') }),
                JSON.stringify({ event: 'other', ignored: true }),
            ].join('\n'),
        );

        const groups = groupSuggestionEvents(loadSuggestionEvents(root));

        expect(groups).toEqual([
            expect.objectContaining({
                dedupKey: 'key-a',
                count: 3,
                residents: ['res:agent', 'res:pip', 'res:railgun'],
                rubric: expect.objectContaining({
                    hasAttemptEvidence: true,
                    hasPerceptionEvidence: true,
                    hasRuntimeEvidence: true,
                    readyForHumanReview: true,
                }),
            }),
        ]);
    });

    it('parses suggestions CLI args and environment variables', () => {
        const oldEnv = { ...process.env };
        process.env.CONTROLLER_CONFIG = 'controller.env.yml';
        process.env.CONTROLLER_KNOWLEDGE_DIR = '/env/knowledge';

        try {
            // Test defaults
            expect(parseReviewSuggestionsArgs([])).toEqual({
                configPath: 'controller.env.yml',
                knowledgeDir: '/env/knowledge',
            });

            // Test CLI overrides
            expect(parseReviewSuggestionsArgs(['--config', 'local.yml', '--dir', '/cli/knowledge'])).toEqual({
                configPath: 'local.yml',
                knowledgeDir: '/cli/knowledge',
            });

            // Test aliases
            expect(parseReviewSuggestionsArgs(['-c', 'local.yml', '-d', '/cli/knowledge'])).toEqual({
                configPath: 'local.yml',
                knowledgeDir: '/cli/knowledge',
            });

            // Test positional fallback
            expect(parseReviewSuggestionsArgs(['/fallback/knowledge'])).toEqual({
                configPath: 'controller.env.yml',
                knowledgeDir: '/fallback/knowledge',
            });
        } finally {
            process.env = oldEnv;
        }
    });
});

function baseSuggestion(dedupKey: string, resident = 'res:agent'): KnowledgeSuggestion {
    return {
        id: `${dedupKey}-${resident}`,
        dedupKey,
        createdAt: new Date(0).toISOString(),
        resident,
        controllerId: 'controller',
        instanceId: 'instance',
        tick: 1,
        status: 'proposed',
        source: 'body',
        trust: 'runtime_observed',
        observation: 'Failed action.',
        proposedChange: { kind: 'workflow_hint', summary: 'Try another target.' },
        evidence: {
            outcome: 'blocked',
            attemptId: `attempt-${dedupKey}-${resident}`,
            perceptionId: 'tick:1',
            retrievedKnowledgeIds: [],
            summaries: ['blocked'],
        },
        confidence: 0.4,
    };
}
