import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export type SoulProposalStatus = 'proposed' | 'funding' | 'threshold_crossed' | 'approved' | 'rejected' | 'born';

export interface SoulProposal {
    schemaVersion: 1;
    id: string;
    residentName: string;
    soulMarkdown: string;
    goalText: string;
    binaryCompletionCondition?: string;
    apThreshold: number;
    apFunded: number;
    proposerCityUserId: string;
    proposerDisplayName?: string;
    status: SoulProposalStatus;
    adminNotes?: string;
    createdAt: string;
    updatedAt: string;
    bornAt?: string;
}

export interface FundingContribution {
    cityUserId: string;
    amount: number;
    ts: string;
}

interface SoulProposalFile {
    schemaVersion: 1;
    proposal: SoulProposal;
    fundingHistory: FundingContribution[];
}

const fundingContributionSchema = z.object({
    cityUserId: z.string().min(1),
    amount: z.number().int().positive(),
    ts: z.string().min(1),
});

const soulProposalStatusSchema = z.enum(['proposed', 'funding', 'threshold_crossed', 'approved', 'rejected', 'born']);

const soulProposalSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    residentName: z.string().regex(/^res:[a-z0-9_-]{1,20}$/, 'must match res:<slug>'),
    soulMarkdown: z.string().min(1),
    goalText: z.string().min(1),
    binaryCompletionCondition: z.string().min(1).optional(),
    apThreshold: z.number().int().positive(),
    apFunded: z.number().int().nonnegative(),
    proposerCityUserId: z.string().min(1),
    proposerDisplayName: z.string().min(1).optional(),
    status: soulProposalStatusSchema,
    adminNotes: z.string().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    bornAt: z.string().min(1).optional(),
});

const soulProposalFileSchema = z.object({
    schemaVersion: z.literal(1),
    proposal: soulProposalSchema,
    fundingHistory: z.array(fundingContributionSchema),
});

export const createSoulProposalSchema = z.object({
    residentName: z.string().regex(/^res:[a-z0-9_-]{1,20}$/, 'must match res:<slug>'),
    soulMarkdown: z.string().min(1),
    goalText: z.string().min(1),
    binaryCompletionCondition: z.string().min(1).optional(),
    apThreshold: z.number().int().positive(),
    proposerCityUserId: z.string().min(1),
    proposerDisplayName: z.string().min(1).optional(),
});

export type CreateSoulProposalInput = z.infer<typeof createSoulProposalSchema>;

export class SoulProposalError extends Error {
    constructor(
        public readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'SoulProposalError';
    }
}

/** Terminal statuses that no longer accept funding or admin actions. */
const TERMINAL_STATUSES: SoulProposalStatus[] = ['rejected', 'born'];

/** Statuses that accept additional AP funding. */
const FUNDABLE_STATUSES: SoulProposalStatus[] = ['proposed', 'funding', 'threshold_crossed'];

export class SoulProposalStore {
    constructor(
        private readonly memoryRoot: string,
        private readonly now: () => Date = () => new Date(),
    ) {}

    create(input: CreateSoulProposalInput): SoulProposal {
        const parsed = createSoulProposalSchema.parse(input);
        const id = crypto.randomUUID();
        const ts = this.now().toISOString();
        const proposal: SoulProposal = {
            schemaVersion: 1,
            id,
            residentName: parsed.residentName,
            soulMarkdown: parsed.soulMarkdown,
            goalText: parsed.goalText,
            binaryCompletionCondition: parsed.binaryCompletionCondition,
            apThreshold: parsed.apThreshold,
            apFunded: 0,
            proposerCityUserId: parsed.proposerCityUserId,
            proposerDisplayName: parsed.proposerDisplayName,
            status: 'proposed',
            createdAt: ts,
            updatedAt: ts,
        };
        this.writeFile({ schemaVersion: 1, proposal, fundingHistory: [] });
        return proposal;
    }

    fund(id: string, amount: number, cityUserId: string): SoulProposal {
        if (!Number.isInteger(amount) || amount <= 0) {
            throw new SoulProposalError('invalid_amount', 'funding amount must be a positive integer');
        }
        const file = this.requireFile(id);
        const { proposal } = file;
        if (!FUNDABLE_STATUSES.includes(proposal.status)) {
            throw new SoulProposalError('unfundable_status', `cannot fund a proposal with status '${proposal.status}'`);
        }
        const newFunded = proposal.apFunded + amount;
        const newStatus: SoulProposalStatus = newFunded >= proposal.apThreshold ? 'threshold_crossed' : 'funding';
        const ts = this.now().toISOString();
        const updated: SoulProposal = { ...proposal, apFunded: newFunded, status: newStatus, updatedAt: ts };
        const contribution: FundingContribution = { cityUserId, amount, ts };
        this.writeFile({ ...file, proposal: updated, fundingHistory: [...file.fundingHistory, contribution] });
        return updated;
    }

    approve(id: string, adminNotes?: string): SoulProposal {
        const file = this.requireFile(id);
        const { proposal } = file;
        if (proposal.status !== 'threshold_crossed') {
            throw new SoulProposalError(
                'invalid_status_for_approve',
                `can only approve a proposal with status 'threshold_crossed', got '${proposal.status}'`,
            );
        }
        const ts = this.now().toISOString();
        const updated: SoulProposal = { ...proposal, status: 'approved', adminNotes, updatedAt: ts };
        this.writeFile({ ...file, proposal: updated });
        return updated;
    }

    reject(id: string, adminNotes?: string): SoulProposal {
        const file = this.requireFile(id);
        const { proposal } = file;
        if (TERMINAL_STATUSES.includes(proposal.status)) {
            throw new SoulProposalError('already_terminal', `cannot reject a proposal with status '${proposal.status}'`);
        }
        const ts = this.now().toISOString();
        const updated: SoulProposal = { ...proposal, status: 'rejected', adminNotes, updatedAt: ts };
        this.writeFile({ ...file, proposal: updated });
        return updated;
    }

    markBorn(id: string): SoulProposal {
        const file = this.requireFile(id);
        const { proposal } = file;
        if (proposal.status === 'born') {
            return proposal;
        }
        if (proposal.status !== 'approved') {
            throw new SoulProposalError('not_approved', `can only mark born a proposal with status 'approved', got '${proposal.status}'`);
        }
        const ts = this.now().toISOString();
        const updated: SoulProposal = { ...proposal, status: 'born', bornAt: ts, updatedAt: ts };
        this.writeFile({ ...file, proposal: updated });
        return updated;
    }

    get(id: string): SoulProposal | undefined {
        const file = this.readFile(id);
        return file?.proposal;
    }

    getFundingHistory(id: string): FundingContribution[] {
        const file = this.requireFile(id);
        return file.fundingHistory;
    }

    list(): SoulProposal[] {
        const dir = this.proposalDir();
        if (!fs.existsSync(dir)) {
            return [];
        }
        const proposals: SoulProposal[] = [];
        for (const fname of fs.readdirSync(dir)) {
            if (!fname.endsWith('.json')) continue;
            try {
                const raw = fs.readFileSync(path.join(dir, fname), 'utf8');
                const file = soulProposalFileSchema.parse(JSON.parse(raw));
                proposals.push(file.proposal);
            } catch {
                // Skip malformed files
            }
        }
        return proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    private requireFile(id: string): SoulProposalFile {
        const file = this.readFile(id);
        if (!file) {
            throw new SoulProposalError('not_found', `proposal '${id}' not found`);
        }
        return file;
    }

    private readFile(id: string): SoulProposalFile | undefined {
        const filePath = this.proposalPath(id);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        return soulProposalFileSchema.parse(JSON.parse(raw));
    }

    private writeFile(file: SoulProposalFile): void {
        const filePath = this.proposalPath(file.proposal.id);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
        fs.renameSync(tmp, filePath);
    }

    private proposalPath(id: string): string {
        const safe = id.replace(/[^a-z0-9_-]/gi, '-');
        return path.join(this.proposalDir(), `${safe}.json`);
    }

    private proposalDir(): string {
        return path.join(this.memoryRoot, 'city-integration', 'proposals');
    }
}
