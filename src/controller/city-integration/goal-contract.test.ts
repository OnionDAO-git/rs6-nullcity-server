import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGoalContractSchema, GoalContractError, GoalContractStore } from './goal-contract';

describe('GoalContractStore', () => {
    let root: string;
    let clock: number;
    let store: GoalContractStore;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-contract-'));
        clock = Date.parse('2026-05-29T12:00:00.000Z');
        store = new GoalContractStore(root, () => new Date(clock));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('creates an active aspirational goal', () => {
        const goal = store.create({
            residentName: 'res:hans',
            goalText: 'Find a reliable way to make 100 GP/hour and write the strategy into the Library.',
        });
        expect(goal.status).toBe('active');
        expect(goal.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(goal.goalText).toContain('100 GP/hour');
        expect(goal.completion).toBeUndefined();
        expect(goal.createdAt).toBe('2026-05-29T12:00:00.000Z');
        expect(goal.updatedAt).toBe(goal.createdAt);
    });

    it('creates a goal with an optional binary completion', () => {
        const goal = store.create({
            residentName: 'res:hans',
            goalText: 'Bank 100 GP.',
            completion: { condition: 'bank GP >= 100', evidenceSource: 'runtime:bank-balance' },
        });
        expect(goal.completion).toEqual({ condition: 'bank GP >= 100', evidenceSource: 'runtime:bank-balance' });
    });

    it('rejects an invalid resident name', () => {
        expect(() => store.create({ residentName: 'hans', goalText: 'x' })).toThrow();
    });

    it('rejects empty goal text', () => {
        expect(() => store.create({ residentName: 'res:hans', goalText: '' })).toThrow();
    });

    it('get returns undefined for a missing goal', () => {
        expect(store.get('does-not-exist')).toBeUndefined();
    });

    it('persists across store instances (replay from disk)', () => {
        const goal = store.create({ residentName: 'res:hans', goalText: 'Endure the courtyard.' });
        const fresh = new GoalContractStore(root);
        expect(fresh.get(goal.id)?.goalText).toBe('Endure the courtyard.');
    });

    it('marks a goal achieved with evidence', () => {
        const goal = store.create({ residentName: 'res:hans', goalText: 'Bank 100 GP.' });
        clock += 60000;
        const done = store.markAchieved(goal.id, 'library:gp-strategy#42');
        expect(done.status).toBe('achieved');
        expect(done.achievedEvidence).toBe('library:gp-strategy#42');
        expect(done.achievedAt).toBe('2026-05-29T12:01:00.000Z');
        expect(done.updatedAt).toBe(done.achievedAt);
    });

    it('markAchieved is idempotent (keeps first evidence + timestamp)', () => {
        const goal = store.create({ residentName: 'res:hans', goalText: 'A reachable goal.' });
        const first = store.markAchieved(goal.id, 'ev-1');
        clock += 5000;
        const second = store.markAchieved(goal.id, 'ev-2');
        expect(second.achievedEvidence).toBe('ev-1');
        expect(second.achievedAt).toBe(first.achievedAt);
    });

    it('requires non-empty evidence to achieve', () => {
        const goal = store.create({ residentName: 'res:hans', goalText: 'A reachable goal.' });
        expect(() => store.markAchieved(goal.id, '   ')).toThrow(GoalContractError);
    });

    it('marks a goal abandoned with a reason', () => {
        const goal = store.create({ residentName: 'res:hans', goalText: 'A reachable goal.' });
        const abandoned = store.markAbandoned(goal.id, 'resident faded at zero AP');
        expect(abandoned.status).toBe('abandoned');
        expect(abandoned.abandonedReason).toBe('resident faded at zero AP');
    });

    it('markAbandoned is idempotent (keeps first reason)', () => {
        const goal = store.create({ residentName: 'res:hans', goalText: 'A reachable goal.' });
        store.markAbandoned(goal.id, 'reason-1');
        const second = store.markAbandoned(goal.id, 'reason-2');
        expect(second.abandonedReason).toBe('reason-1');
    });

    it('cannot abandon an achieved goal', () => {
        const goal = store.create({ residentName: 'res:hans', goalText: 'A reachable goal.' });
        store.markAchieved(goal.id, 'ev');
        expect(() => store.markAbandoned(goal.id, 'too late')).toThrow(GoalContractError);
    });

    it('cannot achieve an abandoned goal', () => {
        const goal = store.create({ residentName: 'res:hans', goalText: 'A reachable goal.' });
        store.markAbandoned(goal.id, 'gave up');
        expect(() => store.markAchieved(goal.id, 'ev')).toThrow(GoalContractError);
    });

    it('markAchieved throws not_found for a missing goal', () => {
        expect(() => store.markAchieved('does-not-exist', 'ev')).toThrow(GoalContractError);
    });

    it('lists goals sorted by createdAt and filters by resident', () => {
        const a = store.create({ residentName: 'res:hans', goalText: 'first' });
        clock += 1000;
        const b = store.create({ residentName: 'res:pip', goalText: 'second' });
        clock += 1000;
        const c = store.create({ residentName: 'res:hans', goalText: 'third' });
        expect(store.list().map(g => g.id)).toEqual([a.id, b.id, c.id]);
        expect(store.listByResident('res:hans').map(g => g.goalText)).toEqual(['first', 'third']);
    });

    it('writes atomically (only .json files remain on disk)', () => {
        const goal = store.create({ residentName: 'res:hans', goalText: 'A reachable goal.' });
        const dir = path.join(root, 'city-integration', 'goals');
        const files = fs.readdirSync(dir);
        expect(files.every(f => f.endsWith('.json'))).toBe(true);
        expect(files).toContain(`${goal.id}.json`);
    });

    it('createGoalContractSchema rejects an empty completion field', () => {
        expect(() =>
            createGoalContractSchema.parse({
                residentName: 'res:hans',
                goalText: 'x',
                completion: { condition: '', evidenceSource: 'y' },
            }),
        ).toThrow();
    });
});
