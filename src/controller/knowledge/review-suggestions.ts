import fs from 'fs';
import path from 'path';
import { knowledgeSuggestionSchema, type KnowledgeSuggestion } from './suggestions';
import { loadControllerConfig } from '../config';

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

export interface ReviewSuggestionsCliOptions {
    configPath: string;
    knowledgeDir?: string;
}

export function parseReviewSuggestionsArgs(argv: string[]): ReviewSuggestionsCliOptions {
    const options: ReviewSuggestionsCliOptions = {
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        knowledgeDir: process.env.CONTROLLER_KNOWLEDGE_DIR,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--config' || arg === '-c') {
            const next = argv[i + 1];
            if (!next) throw new Error(`${arg} requires a path`);
            options.configPath = next;
            i += 1;
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else if (arg === '--dir' || arg === '--knowledge-dir' || arg === '-d') {
            const next = argv[i + 1];
            if (!next) throw new Error(`${arg} requires a path`);
            options.knowledgeDir = next;
            i += 1;
        } else if (arg.startsWith('--dir=')) {
            options.knowledgeDir = arg.slice('--dir='.length);
        } else if (arg.startsWith('--knowledge-dir=')) {
            options.knowledgeDir = arg.slice('--knowledge-dir='.length);
        } else if (!arg.startsWith('-')) {
            options.knowledgeDir = arg;
        } else {
            throw new Error(`Unknown argument ${arg}`);
        }
    }
    return options;
}

if (require.main === module) {
    const options = parseReviewSuggestionsArgs(process.argv.slice(2));
    let root = options.knowledgeDir;
    if (!root) {
        try {
            const config = loadControllerConfig(options.configPath);
            root = config.knowledge.dir;
        } catch {
            root = path.resolve(process.cwd(), 'data/knowledge');
        }
    }
    const groups = groupSuggestionEvents(loadSuggestionEvents(root));
    process.stdout.write(`${JSON.stringify({ root, groups }, null, 2)}\n`);
}
