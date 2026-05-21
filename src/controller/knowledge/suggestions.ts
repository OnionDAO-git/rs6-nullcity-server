import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { KnowledgeStorageMode } from '../config';

const MAX_TEXT_LENGTH = 240;
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|sk-or-v1-[A-Za-z0-9_-]+|[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)=[^\s,;]+)/gi;

export const suggestionOutcomeSchema = z.enum([
    'success',
    'partial',
    'blocked',
    'unsafe',
    'invalid_action',
    'repeated_no_progress',
    'hallucinated_target',
]);
export const workflowAvailabilityStatusSchema = z.enum([
    'can_do_now',
    'missing_item',
    'missing_target',
    'unsafe',
    'blocked',
    'not_relevant',
]);

export const suggestionEvidenceBundleSchema = z.object({
    outcome: suggestionOutcomeSchema,
    attemptId: z.string().optional(),
    action: z.unknown().optional(),
    actionStatus: z.string().optional(),
    actionReason: z.string().optional(),
    perceptionId: z.string().optional(),
    before: z
        .object({
            position: z.string().optional(),
            inventory: z.array(z.string()).optional(),
            skills: z.array(z.string()).optional(),
            visibleTargets: z.array(z.string()).optional(),
        })
        .optional(),
    after: z
        .object({
            position: z.string().optional(),
            inventory: z.array(z.string()).optional(),
            skills: z.array(z.string()).optional(),
            visibleTargets: z.array(z.string()).optional(),
        })
        .optional(),
    deltas: z
        .object({
            inventory: z.array(z.string()).optional(),
            skills: z.array(z.string()).optional(),
            position: z.string().optional(),
        })
        .optional(),
    retrievedKnowledgeIds: z.array(z.string()),
    availability: z
        .array(
            z.object({
                workflowId: z.string(),
                status: workflowAvailabilityStatusSchema,
                reason: z.string(),
            }),
        )
        .optional(),
    model: z.string().optional(),
    promptVersion: z.string().optional(),
    worldVersion: z.string().optional(),
    summaries: z.array(z.string()),
});

const knowledgeSuggestionBaseSchema = z.object({
    id: z.string(),
    dedupKey: z.string(),
    createdAt: z.string(),
    resident: z.string(),
    controllerId: z.string(),
    instanceId: z.string(),
    tick: z.number(),
    status: z.enum(['proposed', 'promoted', 'rejected', 'superseded']),
    source: z.enum(['brain', 'body', 'nervous_system', 'routine', 'human_chat', 'benchmark']),
    trust: z.enum(['engine_confirmed', 'runtime_observed', 'human_claim', 'agent_claim']),
    goalId: z.string().optional(),
    workflowId: z.string().optional(),
    workflowVersion: z.number().optional(),
    observation: z.string(),
    proposedChange: z.object({
        kind: z.enum(['new_entry', 'update_entry', 'workflow_hint', 'risk_rule', 'availability_rule']),
        targetId: z.string().optional(),
        title: z.string().optional(),
        summary: z.string(),
        keywords: z.array(z.string()).optional(),
        requiredItems: z.array(z.string()).optional(),
        actions: z.array(z.string()).optional(),
        successSignals: z.array(z.string()).optional(),
        scope: z.string().optional(),
    }),
    evidence: suggestionEvidenceBundleSchema,
    confidence: z.number(),
    duplicateOf: z.string().optional(),
    supersedes: z.array(z.string()).optional(),
    reviewedBy: z.string().optional(),
    reviewedAt: z.string().optional(),
    decisionReason: z.string().optional(),
    promotionCommit: z.string().optional(),
    benchmarkRunIds: z.array(z.string()).optional(),
});

export const knowledgeSuggestionSchema = knowledgeSuggestionBaseSchema.superRefine((suggestion, context) => {
    if (suggestion.trust !== 'runtime_observed' && suggestion.trust !== 'engine_confirmed') {
        return;
    }
    if (!suggestion.evidence.attemptId) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence', 'attemptId'],
            message: 'runtime-observed suggestions require attemptId',
        });
    }
    if (!suggestion.evidence.perceptionId) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence', 'perceptionId'],
            message: 'runtime-observed suggestions require perceptionId',
        });
    }
});

export type KnowledgeSuggestion = z.infer<typeof knowledgeSuggestionSchema>;

export interface KnowledgeSuggestionStoreOptions {
    root: string;
    controllerId: string;
    instanceId: string;
    emitStdout: boolean;
    storageMode: KnowledgeStorageMode;
    stdout?: (entry: Record<string, unknown>) => void;
    appendFile?: (filePath: string, content: string) => void | Promise<void>;
}

export class KnowledgeSuggestionStore {
    private readonly warnedWriteFailures = new Set<string>();
    private readonly stdout: (entry: Record<string, unknown>) => void;
    private readonly appendFile: (filePath: string, content: string) => void | Promise<void>;
    private pendingWrites: Promise<void>[] = [];

    constructor(private readonly options: KnowledgeSuggestionStoreOptions) {
        this.stdout = options.stdout || (entry => process.stdout.write(`${JSON.stringify(entry)}\n`));
        this.appendFile = options.appendFile || ((filePath, content) => fs.promises.appendFile(filePath, content));
    }

    append(rawSuggestion: KnowledgeSuggestion): void {
        const suggestion = redactSuggestion({
            ...rawSuggestion,
            dedupKey: rawSuggestion.dedupKey || knowledgeSuggestionDedupKey(rawSuggestion),
        });
        const parsed = knowledgeSuggestionSchema.parse(suggestion);
        const event = { event: 'knowledge_suggestion', ...parsed };

        this.stdout(event);

        if (this.options.storageMode !== 'persistent-volume') {
            return;
        }

        const write = Promise.resolve()
            .then(async () => {
                await fs.promises.mkdir(this.options.root, { recursive: true });
                await this.appendFile(this.filePath(), `${JSON.stringify(event)}\n`);
            })
            .catch(error => this.warnWriteFailure(error))
            .finally(() => {
                this.pendingWrites = this.pendingWrites.filter(pending => pending !== write);
            });
        this.pendingWrites.push(write);
    }

    async flush(): Promise<void> {
        await Promise.all(this.pendingWrites);
    }

    filePath(): string {
        return path.join(
            this.options.root,
            `suggestions.${safeFilePart(this.options.controllerId)}.${safeFilePart(this.options.instanceId)}.jsonl`,
        );
    }

    private warnWriteFailure(error: unknown): void {
        const errno = error as NodeJS.ErrnoException;
        const code = errno.code || 'UNKNOWN';
        const key = `${code}:${this.options.root}`;
        if (this.warnedWriteFailures.has(key)) {
            return;
        }

        this.warnedWriteFailures.add(key);
        this.stdout({
            event: 'knowledge_suggestion_write_failed',
            controllerId: this.options.controllerId,
            instanceId: this.options.instanceId,
            storageMode: this.options.storageMode,
            code,
            message: redactText(errno.message || String(error)),
        });
    }
}

export function knowledgeSuggestionDedupKey(
    suggestion: Pick<KnowledgeSuggestion, 'proposedChange' | 'workflowId' | 'trust'> & {
        evidence?: { actionReason?: string; outcome?: string };
    },
): string {
    return [
        suggestion.proposedChange.kind,
        suggestion.workflowId || '',
        suggestion.proposedChange.targetId || '',
        normalizeForKey(suggestion.proposedChange.summary),
        normalizeForKey(suggestion.evidence?.actionReason || suggestion.evidence?.outcome || ''),
        suggestion.trust,
    ].join('|');
}

export function redactSuggestion(suggestion: KnowledgeSuggestion): KnowledgeSuggestion {
    return redactValue(suggestion) as KnowledgeSuggestion;
}

function redactValue(value: unknown): unknown {
    if (typeof value === 'string') {
        return redactText(value);
    }
    if (Array.isArray(value)) {
        return value.map(redactValue);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactValue(child)]));
    }

    return value;
}

function redactText(text: string): string {
    const redacted = text.replace(SECRET_PATTERN, '[redacted]');
    return redacted.length > MAX_TEXT_LENGTH ? redacted.slice(0, MAX_TEXT_LENGTH).trimEnd() : redacted;
}

function normalizeForKey(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/[^\w:]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function safeFilePart(text: string): string {
    return text.replace(/[^a-z0-9._-]+/gi, '_');
}
