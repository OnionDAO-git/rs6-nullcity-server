import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    buildEpitaphDispatchRequests,
    dispatchEpitaphs,
    type DeceasedResidentSummary,
} from './epitaph-dispatcher';
import { LettersStore } from './letters-store';

const summary = (overrides: Partial<DeceasedResidentSummary> = {}): DeceasedResidentSummary => ({
    residentName: 'res:fern',
    residentArchetype: 'mentor',
    residentFaction: 'embassy',
    livedTicks: 1240,
    bestSkill: { name: 'firemaking', level: 22 },
    causeOfDeath: 'goblin (level 5)',
    deceasedAt: '2026-05-23T15:00:00.000Z',
    deceasedTick: 1240,
    ...overrides,
});

describe('buildEpitaphDispatchRequests (EVENT-D4)', () => {
    describe('no patrons', () => {
        it('returns [] when the deceased had no patrons (no recipients to notify)', () => {
            const letters = buildEpitaphDispatchRequests(summary(), []);
            expect(letters).toEqual([]);
        });

        it('returns [] when patron handles are empty strings (filtered)', () => {
            const letters = buildEpitaphDispatchRequests(summary(), ['', '   ']);
            expect(letters).toEqual([]);
        });
    });

    describe('one patron', () => {
        it('returns exactly one epitaph letter addressed to that patron', () => {
            const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion']);
            expect(letters).toHaveLength(1);
            expect(letters[0].kind).toBe('epitaph');
            expect(letters[0].recipient).toBe('alice@onion');
            expect(letters[0].body).toMatch(/res:fern/);
            expect(letters[0].body).toMatch(/goblin/);
            expect(letters[0].body).toMatch(/firemaking/);
            expect(letters[0].body).toMatch(/1240/);
        });

        it('threads dispatchedAt from the deceasedAt timestamp (not "now")', () => {
            const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion']);
            expect(letters[0].dispatchedAt).toBe('2026-05-23T15:00:00.000Z');
        });

        it('senderResident defaults to the deceased themselves when no override given', () => {
            const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion']);
            expect(letters[0].senderResident).toBe('res:fern');
        });

        it('senderResident uses the sibling-flagship override when supplied (hero death)', () => {
            const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion'], {
                senderResident: 'res:wise-old-man',
            });
            expect(letters[0].senderResident).toBe('res:wise-old-man');
        });
    });

    describe('multiple patrons', () => {
        it('returns one letter per unique patron (no duplicates)', () => {
            const letters = buildEpitaphDispatchRequests(summary(), [
                'alice@onion',
                'bob@onion',
                'alice@onion', // duplicate
                'Alice@Onion', // case-insensitive duplicate
            ]);
            expect(letters).toHaveLength(2);
            const recipients = letters.map(l => l.recipient).sort();
            expect(recipients).toEqual(['alice@onion', 'bob@onion']);
        });

        it('preserves the first-seen casing for each unique patron', () => {
            const letters = buildEpitaphDispatchRequests(summary(), ['Alice@Onion', 'BOB@onion']);
            expect(letters.map(l => l.recipient).sort()).toEqual(['Alice@Onion', 'BOB@onion']);
        });
    });

    describe('missing-detail tolerance', () => {
        it('handles missing bestSkill (renderer must not leak "undefined")', () => {
            const letters = buildEpitaphDispatchRequests(summary({ bestSkill: undefined }), ['alice@onion']);
            expect(letters[0].body).not.toMatch(/undefined/);
            expect(letters[0].body).not.toMatch(/NaN/);
        });

        it('handles missing causeOfDeath (renderer says "unrecorded")', () => {
            const letters = buildEpitaphDispatchRequests(summary({ causeOfDeath: undefined }), ['alice@onion']);
            expect(letters[0].body).toMatch(/unrecorded|unknown/i);
        });
    });
});

describe('dispatchEpitaphs (EVENT-D4)', () => {
    let tmp: string;
    let store: LettersStore;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epitaph-dispatch-'));
        store = new LettersStore(tmp);
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('appends every letter to the store and reports per-recipient results', () => {
        const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion', 'bob@onion']);
        const results = dispatchEpitaphs(letters, store);
        expect(results).toHaveLength(2);
        expect(results.every(r => r.deduped === false)).toBe(true);

        const aliceInbox = store.readInbox('alice@onion');
        const bobInbox = store.readInbox('bob@onion');
        expect(aliceInbox).toHaveLength(1);
        expect(bobInbox).toHaveLength(1);
        expect(aliceInbox[0].kind).toBe('epitaph');
        expect(bobInbox[0].kind).toBe('epitaph');
    });

    it('is idempotent — re-dispatching the same request batch does not duplicate inbox entries', () => {
        const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion']);
        dispatchEpitaphs(letters, store);
        const secondPass = dispatchEpitaphs(letters, store);

        expect(secondPass[0].deduped).toBe(true);
        expect(store.readInbox('alice@onion')).toHaveLength(1);
    });

    it('returns [] without writing when given an empty letter array', () => {
        const results = dispatchEpitaphs([], store);
        expect(results).toEqual([]);
        // Inbox directory should not even exist yet.
        expect(fs.existsSync(path.join(tmp, 'data/letters'))).toBe(false);
    });

    it('keeps writing remaining letters when an individual append throws (resilient batch)', () => {
        const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion', 'bob@onion']);
        let calls = 0;
        const flaky = {
            append: (letter: Parameters<LettersStore['append']>[0]) => {
                calls += 1;
                if (calls === 1) {
                    throw new Error('disk full');
                }
                return store.append(letter);
            },
        } as unknown as LettersStore;

        const results = dispatchEpitaphs(letters, flaky);
        expect(results).toHaveLength(2);
        expect(results[0].deduped).toBe(false);
        expect(results[0].error).toBe('disk full');
        expect(results[1].deduped).toBe(false);
        expect(results[1].error).toBeUndefined();
        // bob's letter still went through.
        expect(store.readInbox('bob@onion')).toHaveLength(1);
    });
});
