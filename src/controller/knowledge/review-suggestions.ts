import fs from 'fs';
import path from 'path';
import { knowledgeSuggestionSchema, type KnowledgeSuggestion } from './suggestions';

export interface SuggestionReviewGroup {
    dedupKey: string;
    count: number;
    residents: string[];
    firstSeen: string;
    lastSeen: string;
    statuses: string[];
    rubric: SuggestionReviewRubric;
    examples: KnowledgeSuggestion[];
}

export interface SuggestionReviewRubric {
    hasAttemptEvidence: boolean;
    hasPerceptionEvidence: boolean;
    hasRuntimeEvidence: boolean;
    hasSuccessOrBlockerOutcome: boolean;
    hasActionOrSummary: boolean;
    readyForHumanReview: boolean;
}

export function loadSuggestionEvents(root: string): KnowledgeSuggestion[] {
    if (!fs.existsSync(root)) {
        return [];
    }

    return fs
        .readdirSync(root)
        .filter(fileName => /^suggestions\..+\.jsonl$/.test(fileName))
        .flatMap(fileName => readSuggestionFile(path.join(root, fileName)));
}

export function groupSuggestionEvents(suggestions: KnowledgeSuggestion[]): SuggestionReviewGroup[] {
    const groups = new Map<string, KnowledgeSuggestion[]>();
    for (const suggestion of suggestions) {
        groups.set(suggestion.dedupKey, [...(groups.get(suggestion.dedupKey) || []), suggestion]);
    }

    return [...groups.entries()]
        .map(([dedupKey, entries]) => {
            const sorted = entries.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            return {
                dedupKey,
                count: entries.length,
                residents: unique(entries.map(entry => entry.resident)).sort(),
                firstSeen: sorted[0].createdAt,
                lastSeen: sorted[sorted.length - 1].createdAt,
                statuses: unique(entries.map(entry => entry.status)).sort(),
                rubric: reviewRubric(entries),
                examples: sorted.slice(0, 3),
            };
        })
        .sort((a, b) => b.count - a.count || a.dedupKey.localeCompare(b.dedupKey));
}

function reviewRubric(entries: KnowledgeSuggestion[]): SuggestionReviewRubric {
    const hasAttemptEvidence = entries.some(entry => Boolean(entry.evidence.attemptId));
    const hasPerceptionEvidence = entries.some(entry => Boolean(entry.evidence.perceptionId));
    const hasRuntimeEvidence = entries.some(entry => entry.trust === 'runtime_observed' || entry.trust === 'engine_confirmed');
    const hasSuccessOrBlockerOutcome = entries.some(entry =>
        ['success', 'blocked', 'unsafe', 'invalid_action', 'repeated_no_progress'].includes(entry.evidence.outcome),
    );
    const hasActionOrSummary = entries.some(entry => Boolean(entry.evidence.action) || entry.evidence.summaries.length > 0);
    return {
        hasAttemptEvidence,
        hasPerceptionEvidence,
        hasRuntimeEvidence,
        hasSuccessOrBlockerOutcome,
        hasActionOrSummary,
        readyForHumanReview:
            hasAttemptEvidence && hasPerceptionEvidence && hasRuntimeEvidence && hasSuccessOrBlockerOutcome && hasActionOrSummary,
    };
}

function readSuggestionFile(filePath: string): KnowledgeSuggestion[] {
    return fs
        .readFileSync(filePath, 'utf8')
        .split(/\r?\n/g)
        .filter(Boolean)
        .flatMap(line => {
            try {
                const parsed = JSON.parse(extractJsonObject(line)) as Record<string, unknown>;
                if (parsed.event !== 'knowledge_suggestion') {
                    return [];
                }
                const { event: _event, ...suggestion } = parsed;
                const result = knowledgeSuggestionSchema.safeParse(suggestion);
                return result.success ? [result.data] : [];
            } catch {
                return [];
            }
        });
}

function extractJsonObject(line: string): string {
    const start = line.indexOf('{');
    const end = line.lastIndexOf('}');
    return start >= 0 && end >= start ? line.slice(start, end + 1) : line;
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

if (require.main === module) {
    const root = process.argv[2] || process.env.CONTROLLER_KNOWLEDGE_DIR || path.resolve(process.cwd(), 'data/knowledge');
    const groups = groupSuggestionEvents(loadSuggestionEvents(root));
    process.stdout.write(`${JSON.stringify({ root, groups }, null, 2)}\n`);
}
