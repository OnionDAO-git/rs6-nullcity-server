import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

/**
 * GoalContract (P0 economy contract).
 *
 * A resident's living, aspirational goal. Per the 2026-05-29 CIC decisions,
 * a Soul goal "can be aspirational and may never complete — that is acceptable."
 * The minimum intelligence bar is: generate a plausible plan, act on survival/GP
 * needs, and learn from the Library — not "finish every goal."
 *
 * Distinct from `SoulProposal.goalText`, which is the goal a human proposes at
 * birth. A GoalContract is the post-birth tracker the resident actually pursues
 * and that the Storyteller can later narrate. The optional binary `completion`
 * lets a goal be checked for done-ness (e.g. "bank GP >= 100") with a named
 * evidence source, but most goals will simply stay `active`.
 */
export type GoalContractStatus = 'active' | 'achieved' | 'abandoned';

export interface GoalCompletion {
    /** Human-readable binary completion condition, e.g. "bank GP >= 100". */
    condition: string;
    /** Where completion evidence comes from, e.g. "runtime:bank-balance" or "library:gp-strategy". */
    evidenceSource: string;
}

export interface GoalContract {
    schemaVersion: 1;
    id: string;
    residentName: string;
    /** Aspirational goal text. May never complete; that is acceptable. */
    goalText: string;
    /** Optional binary completion check. Absent => purely aspirational. */
    completion?: GoalCompletion;
    status: GoalContractStatus;
    createdAt: string;
    updatedAt: string;
    achievedAt?: string;
    achievedEvidence?: string;
    abandonedAt?: string;
    abandonedReason?: string;
}

const goalCompletionSchema = z.object({
    condition: z.string().min(1),
    evidenceSource: z.string().min(1),
});

const goalContractStatusSchema = z.enum(['active', 'achieved', 'abandoned']);

const goalContractSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    residentName: z.string().regex(/^res:[a-z0-9_-]{1,20}$/, 'must match res:<slug>'),
    goalText: z.string().min(1),
    completion: goalCompletionSchema.optional(),
    status: goalContractStatusSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    achievedAt: z.string().min(1).optional(),
    achievedEvidence: z.string().min(1).optional(),
    abandonedAt: z.string().min(1).optional(),
    abandonedReason: z.string().min(1).optional(),
});

export const createGoalContractSchema = z.object({
    residentName: z.string().regex(/^res:[a-z0-9_-]{1,20}$/, 'must match res:<slug>'),
    goalText: z.string().min(1),
    completion: goalCompletionSchema.optional(),
});

export type CreateGoalContractInput = z.infer<typeof createGoalContractSchema>;

export class GoalContractError extends Error {
    constructor(
        public readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'GoalContractError';
    }
}

/**
 * File-backed store for resident goal contracts. Mirrors SoulProposalStore:
 * atomic writes (tmp + rename), schema-validated reads, malformed files skipped
 * on list. One JSON file per goal under `<memoryRoot>/city-integration/goals`.
 */
export class GoalContractStore {
    constructor(
        private readonly memoryRoot: string,
        private readonly now: () => Date = () => new Date(),
    ) {}

    create(input: CreateGoalContractInput): GoalContract {
        const parsed = createGoalContractSchema.parse(input);
        const id = crypto.randomUUID();
        const ts = this.now().toISOString();
        const goal: GoalContract = {
            schemaVersion: 1,
            id,
            residentName: parsed.residentName,
            goalText: parsed.goalText,
            completion: parsed.completion,
            status: 'active',
            createdAt: ts,
            updatedAt: ts,
        };
        this.writeFile(goal);
        return goal;
    }

    markAchieved(id: string, evidence: string): GoalContract {
        if (!evidence || evidence.trim().length === 0) {
            throw new GoalContractError('missing_evidence', 'achievement requires non-empty evidence');
        }
        const goal = this.requireGoal(id);
        if (goal.status === 'achieved') {
            return goal; // idempotent
        }
        if (goal.status === 'abandoned') {
            throw new GoalContractError('already_abandoned', 'cannot achieve an abandoned goal');
        }
        const ts = this.now().toISOString();
        const updated: GoalContract = { ...goal, status: 'achieved', achievedAt: ts, achievedEvidence: evidence, updatedAt: ts };
        this.writeFile(updated);
        return updated;
    }

    markAbandoned(id: string, reason: string): GoalContract {
        if (!reason || reason.trim().length === 0) {
            throw new GoalContractError('missing_reason', 'abandonment requires a non-empty reason');
        }
        const goal = this.requireGoal(id);
        if (goal.status === 'abandoned') {
            return goal; // idempotent
        }
        if (goal.status === 'achieved') {
            throw new GoalContractError('already_achieved', 'cannot abandon an achieved goal');
        }
        const ts = this.now().toISOString();
        const updated: GoalContract = { ...goal, status: 'abandoned', abandonedAt: ts, abandonedReason: reason, updatedAt: ts };
        this.writeFile(updated);
        return updated;
    }

    get(id: string): GoalContract | undefined {
        return this.readFile(id);
    }

    list(): GoalContract[] {
        const dir = this.goalDir();
        if (!fs.existsSync(dir)) {
            return [];
        }
        const goals: GoalContract[] = [];
        for (const fname of fs.readdirSync(dir)) {
            if (!fname.endsWith('.json')) {
                continue;
            }
            try {
                const raw = fs.readFileSync(path.join(dir, fname), 'utf8');
                goals.push(goalContractSchema.parse(JSON.parse(raw)));
            } catch {
                // Skip malformed files.
            }
        }
        return goals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    listByResident(residentName: string): GoalContract[] {
        return this.list().filter(goal => goal.residentName === residentName);
    }

    private requireGoal(id: string): GoalContract {
        const goal = this.readFile(id);
        if (!goal) {
            throw new GoalContractError('not_found', `goal '${id}' not found`);
        }
        return goal;
    }

    private readFile(id: string): GoalContract | undefined {
        const filePath = this.goalPath(id);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        return goalContractSchema.parse(JSON.parse(raw));
    }

    private writeFile(goal: GoalContract): void {
        const filePath = this.goalPath(goal.id);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(goal, null, 2)}\n`);
        fs.renameSync(tmp, filePath);
    }

    private goalPath(id: string): string {
        const safe = id.replace(/[^a-z0-9_-]/gi, '-');
        return path.join(this.goalDir(), `${safe}.json`);
    }

    private goalDir(): string {
        return path.join(this.memoryRoot, 'city-integration', 'goals');
    }
}
