import fs from 'fs';
import os from 'os';
import path from 'path';
import { SoulProposalError, SoulProposalStore, type CreateSoulProposalInput } from './soul-proposals';

const BASE_INPUT: CreateSoulProposalInput = {
    residentName: 'res:test-hero',
    soulMarkdown: '---\nname: res:test-hero\narchetype: achiever\n---\nA wandering hero.',
    goalText: 'Find a reliable way to make 100 GP/hour and write the strategy into the Library.',
    apThreshold: 50,
    proposerCityUserId: 'user:alice',
};

describe('SoulProposalStore', () => {
    let root: string;
    let now: Date;
    let store: SoulProposalStore;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-proposals-'));
        now = new Date('2026-05-29T12:00:00.000Z');
        store = new SoulProposalStore(root, () => now);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    describe('create', () => {
        it('returns a proposal with status proposed', () => {
            const proposal = store.create(BASE_INPUT);
            expect(proposal.status).toBe('proposed');
            expect(proposal.schemaVersion).toBe(1);
            expect(proposal.residentName).toBe('res:test-hero');
            expect(proposal.goalText).toBe(BASE_INPUT.goalText);
            expect(proposal.apThreshold).toBe(50);
            expect(proposal.apFunded).toBe(0);
            expect(proposal.proposerCityUserId).toBe('user:alice');
        });

        it('assigns a unique id and timestamps', () => {
            const p1 = store.create(BASE_INPUT);
            const p2 = store.create(BASE_INPUT);
            expect(p1.id).not.toBe(p2.id);
            expect(p1.createdAt).toBe('2026-05-29T12:00:00.000Z');
            expect(p1.updatedAt).toBe('2026-05-29T12:00:00.000Z');
        });

        it('persists the proposal so it can be read back via get()', () => {
            const proposal = store.create(BASE_INPUT);
            const retrieved = store.get(proposal.id);
            expect(retrieved).toBeDefined();
            expect(retrieved!.id).toBe(proposal.id);
            expect(retrieved!.status).toBe('proposed');
        });

        it('stores optional binaryCompletionCondition', () => {
            const p = store.create({ ...BASE_INPUT, binaryCompletionCondition: 'quest:cooks_assistant' });
            expect(p.binaryCompletionCondition).toBe('quest:cooks_assistant');
        });

        it('stores optional proposerDisplayName', () => {
            const p = store.create({ ...BASE_INPUT, proposerDisplayName: 'Alice' });
            expect(p.proposerDisplayName).toBe('Alice');
        });

        it('rejects invalid residentName', () => {
            expect(() => store.create({ ...BASE_INPUT, residentName: 'bad name' })).toThrow();
        });

        it('rejects zero apThreshold', () => {
            expect(() => store.create({ ...BASE_INPUT, apThreshold: 0 })).toThrow();
        });
    });

    describe('list', () => {
        it('returns empty array when no proposals exist', () => {
            expect(store.list()).toEqual([]);
        });

        it('returns all created proposals sorted by createdAt', () => {
            now = new Date('2026-05-29T10:00:00.000Z');
            const p1 = store.create(BASE_INPUT);
            now = new Date('2026-05-29T11:00:00.000Z');
            const p2 = store.create(BASE_INPUT);
            const listed = store.list();
            expect(listed).toHaveLength(2);
            expect(listed[0].id).toBe(p1.id);
            expect(listed[1].id).toBe(p2.id);
        });
    });

    describe('fund', () => {
        it('moves status from proposed to funding when below threshold', () => {
            const proposal = store.create(BASE_INPUT);
            const updated = store.fund(proposal.id, 10, 'user:bob');
            expect(updated.status).toBe('funding');
            expect(updated.apFunded).toBe(10);
        });

        it('moves status to threshold_crossed when funded amount meets threshold', () => {
            const proposal = store.create(BASE_INPUT);
            const updated = store.fund(proposal.id, 50, 'user:bob');
            expect(updated.status).toBe('threshold_crossed');
            expect(updated.apFunded).toBe(50);
        });

        it('moves status to threshold_crossed when funded amount exceeds threshold', () => {
            const proposal = store.create(BASE_INPUT);
            const updated = store.fund(proposal.id, 75, 'user:bob');
            expect(updated.status).toBe('threshold_crossed');
            expect(updated.apFunded).toBe(75);
        });

        it('accumulates multiple contributions', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 20, 'user:bob');
            store.fund(proposal.id, 20, 'user:carol');
            const final = store.fund(proposal.id, 20, 'user:alice');
            expect(final.status).toBe('threshold_crossed');
            expect(final.apFunded).toBe(60);
        });

        it('records funding history', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 30, 'user:bob');
            store.fund(proposal.id, 25, 'user:carol');
            const history = store.getFundingHistory(proposal.id);
            expect(history).toHaveLength(2);
            expect(history[0].cityUserId).toBe('user:bob');
            expect(history[0].amount).toBe(30);
            expect(history[1].cityUserId).toBe('user:carol');
            expect(history[1].amount).toBe(25);
        });

        it('can fund from funding status', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 10, 'user:bob');
            const updated = store.fund(proposal.id, 10, 'user:carol');
            expect(updated.status).toBe('funding');
            expect(updated.apFunded).toBe(20);
        });

        it('can fund from threshold_crossed status (overfunding allowed)', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 50, 'user:bob');
            const updated = store.fund(proposal.id, 10, 'user:carol');
            expect(updated.status).toBe('threshold_crossed');
            expect(updated.apFunded).toBe(60);
        });

        it('throws for zero amount', () => {
            const proposal = store.create(BASE_INPUT);
            expect(() => store.fund(proposal.id, 0, 'user:bob')).toThrow(SoulProposalError);
        });

        it('throws for negative amount', () => {
            const proposal = store.create(BASE_INPUT);
            expect(() => store.fund(proposal.id, -5, 'user:bob')).toThrow(SoulProposalError);
        });

        it('throws when funding a rejected proposal', () => {
            const proposal = store.create(BASE_INPUT);
            store.reject(proposal.id);
            expect(() => store.fund(proposal.id, 10, 'user:bob')).toThrow(SoulProposalError);
        });

        it('throws when funding a born proposal', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 50, 'user:bob');
            store.approve(proposal.id);
            store.markBorn(proposal.id);
            expect(() => store.fund(proposal.id, 10, 'user:bob')).toThrow(SoulProposalError);
        });

        it('throws for unknown proposal id', () => {
            expect(() => store.fund('nonexistent-id', 10, 'user:bob')).toThrow(SoulProposalError);
        });
    });

    describe('approve', () => {
        it('moves status from threshold_crossed to approved', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 50, 'user:bob');
            const approved = store.approve(proposal.id, 'Looks good');
            expect(approved.status).toBe('approved');
            expect(approved.adminNotes).toBe('Looks good');
        });

        it('throws when approving a proposed (not-yet-funded) proposal', () => {
            const proposal = store.create(BASE_INPUT);
            expect(() => store.approve(proposal.id)).toThrow(SoulProposalError);
        });

        it('throws when approving a funding (below threshold) proposal', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 10, 'user:bob');
            expect(() => store.approve(proposal.id)).toThrow(SoulProposalError);
        });

        it('throws when approving a rejected proposal', () => {
            const proposal = store.create(BASE_INPUT);
            store.reject(proposal.id);
            expect(() => store.approve(proposal.id)).toThrow(SoulProposalError);
        });

        it('throws for unknown id', () => {
            expect(() => store.approve('nonexistent-id')).toThrow(SoulProposalError);
        });
    });

    describe('reject', () => {
        it('moves status to rejected from proposed', () => {
            const proposal = store.create(BASE_INPUT);
            const rejected = store.reject(proposal.id, 'Not suitable');
            expect(rejected.status).toBe('rejected');
            expect(rejected.adminNotes).toBe('Not suitable');
        });

        it('moves status to rejected from funding', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 10, 'user:bob');
            const rejected = store.reject(proposal.id);
            expect(rejected.status).toBe('rejected');
        });

        it('moves status to rejected from threshold_crossed', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 50, 'user:bob');
            const rejected = store.reject(proposal.id);
            expect(rejected.status).toBe('rejected');
        });

        it('throws when rejecting an already rejected proposal', () => {
            const proposal = store.create(BASE_INPUT);
            store.reject(proposal.id);
            expect(() => store.reject(proposal.id)).toThrow(SoulProposalError);
        });

        it('throws when rejecting a born proposal', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 50, 'user:bob');
            store.approve(proposal.id);
            store.markBorn(proposal.id);
            expect(() => store.reject(proposal.id)).toThrow(SoulProposalError);
        });

        it('throws for unknown id', () => {
            expect(() => store.reject('nonexistent-id')).toThrow(SoulProposalError);
        });
    });

    describe('markBorn', () => {
        it('moves status from approved to born and records bornAt', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 50, 'user:bob');
            store.approve(proposal.id);
            const born = store.markBorn(proposal.id);
            expect(born.status).toBe('born');
            expect(born.bornAt).toBe('2026-05-29T12:00:00.000Z');
        });

        it('is idempotent — second markBorn returns the same born proposal', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 50, 'user:bob');
            store.approve(proposal.id);
            const born1 = store.markBorn(proposal.id);
            const born2 = store.markBorn(proposal.id);
            expect(born2.status).toBe('born');
            expect(born2.bornAt).toBe(born1.bornAt);
        });

        it('throws when proposal is not approved', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 50, 'user:bob');
            expect(() => store.markBorn(proposal.id)).toThrow(SoulProposalError);
        });

        it('throws when proposal is rejected', () => {
            const proposal = store.create(BASE_INPUT);
            store.reject(proposal.id);
            expect(() => store.markBorn(proposal.id)).toThrow(SoulProposalError);
        });

        it('throws for unknown id', () => {
            expect(() => store.markBorn('nonexistent-id')).toThrow(SoulProposalError);
        });
    });

    describe('full lifecycle replay', () => {
        it('proposed -> funding -> threshold_crossed -> approved -> born', () => {
            const proposal = store.create(BASE_INPUT);
            expect(store.get(proposal.id)!.status).toBe('proposed');

            store.fund(proposal.id, 25, 'user:alice');
            expect(store.get(proposal.id)!.status).toBe('funding');

            store.fund(proposal.id, 25, 'user:bob');
            expect(store.get(proposal.id)!.status).toBe('threshold_crossed');

            store.approve(proposal.id, 'Ready to be born');
            expect(store.get(proposal.id)!.status).toBe('approved');

            store.markBorn(proposal.id);
            expect(store.get(proposal.id)!.status).toBe('born');

            const history = store.getFundingHistory(proposal.id);
            expect(history).toHaveLength(2);
            expect(history[0].amount).toBe(25);
            expect(history[1].amount).toBe(25);
        });

        it('proposed -> rejected', () => {
            const proposal = store.create(BASE_INPUT);
            store.reject(proposal.id, 'Duplicate proposal');
            const final = store.get(proposal.id)!;
            expect(final.status).toBe('rejected');
            expect(final.adminNotes).toBe('Duplicate proposal');
        });

        it('survives a simulated restart by re-reading from disk', () => {
            const proposal = store.create(BASE_INPUT);
            store.fund(proposal.id, 50, 'user:bob');
            store.approve(proposal.id);

            // New store instance reading from same directory
            const store2 = new SoulProposalStore(root, () => now);
            const reloaded = store2.get(proposal.id);
            expect(reloaded).toBeDefined();
            expect(reloaded!.status).toBe('approved');
            expect(reloaded!.apFunded).toBe(50);

            const history = store2.getFundingHistory(proposal.id);
            expect(history).toHaveLength(1);
            expect(history[0].cityUserId).toBe('user:bob');
        });
    });

    describe('two-human funding scenario', () => {
        it('two humans fund one proposal, threshold is crossed, resident is born', () => {
            const proposal = store.create({
                residentName: 'res:funded-hero',
                soulMarkdown: '---\nname: res:funded-hero\narchetype: achiever\n---\nA hero born from community support.',
                goalText: 'Make 100 GP/hour and share strategies with the Library.',
                apThreshold: 100,
                proposerCityUserId: 'user:dev',
            });
            expect(proposal.apFunded).toBe(0);
            expect(proposal.status).toBe('proposed');

            // Human 1 contributes 60 AP
            const afterFirst = store.fund(proposal.id, 60, 'user:alice');
            expect(afterFirst.status).toBe('funding');
            expect(afterFirst.apFunded).toBe(60);

            // Human 2 contributes 50 AP — threshold (100) crossed
            const afterSecond = store.fund(proposal.id, 50, 'user:bob');
            expect(afterSecond.status).toBe('threshold_crossed');
            expect(afterSecond.apFunded).toBe(110);

            // Admin approves and birth is recorded
            store.approve(proposal.id);
            const born = store.markBorn(proposal.id);
            expect(born.status).toBe('born');
            expect(born.bornAt).toBeDefined();

            // Funding history is intact
            const history = store.getFundingHistory(proposal.id);
            expect(history).toHaveLength(2);
            expect(history[0].cityUserId).toBe('user:alice');
            expect(history[1].cityUserId).toBe('user:bob');
        });
    });

    describe('get', () => {
        it('returns undefined for unknown id', () => {
            expect(store.get('nonexistent-id')).toBeUndefined();
        });
    });
});
