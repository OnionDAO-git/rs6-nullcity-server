import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    buildEpitaphDispatchRequests,
    dispatchEpitaphs,
    findLivingSibling,
    loadPreparedEpitaph,
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
            expect(letters[0].body).toMatch(/12 minutes/); // 1240 ticks ≈ 12 minutes
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
        // N5: each patron gets epitaph + Mortician's Ribbon (2 letters).
        expect(aliceInbox).toHaveLength(2);
        expect(bobInbox).toHaveLength(2);
        expect(aliceInbox.find(l => l.kind === 'epitaph')).toBeDefined();
        expect(bobInbox.find(l => l.kind === 'epitaph')).toBeDefined();
    });

    it('is idempotent — re-dispatching the same request batch does not duplicate inbox entries', () => {
        const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion']);
        dispatchEpitaphs(letters, store);
        const secondPass = dispatchEpitaphs(letters, store);

        expect(secondPass[0].deduped).toBe(true);
        // N5: epitaph + ribbon both deduped on re-dispatch → still 2 letters, not 4.
        expect(store.readInbox('alice@onion')).toHaveLength(2);
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
        // N5: bob's epitaph + ribbon both went through (flaky only throws on call 1).
        expect(store.readInbox('bob@onion')).toHaveLength(2);
    });

    describe("N5: Mortician's Ribbon", () => {
        it('dispatches a civic_milestone ribbon for each patron alongside the epitaph', () => {
            const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion']);
            dispatchEpitaphs(letters, store);

            const aliceInbox = store.readInbox('alice@onion');
            const ribbon = aliceInbox.find(l => l.kind === 'civic_milestone');
            expect(ribbon).toBeDefined();
            expect(ribbon!.recipient).toBe('alice@onion');
            expect(ribbon!.senderResident).toBe('res:fern');
            expect(ribbon!.subject).toMatch(/Mortician's Ribbon/);
            expect(ribbon!.body).toMatch(/res:fern/);
            expect(ribbon!.body).toMatch(/alice@onion/);
            expect(ribbon!.deliveryChannels).toContain('lanyard-card');
            expect(ribbon!.dispatchedAt).toBe('2026-05-23T15:00:00.000Z');
        });

        it('dispatches ribbons for all patrons in a multi-patron batch', () => {
            const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion', 'bob@onion']);
            dispatchEpitaphs(letters, store);

            expect(store.readInbox('alice@onion').find(l => l.kind === 'civic_milestone')).toBeDefined();
            expect(store.readInbox('bob@onion').find(l => l.kind === 'civic_milestone')).toBeDefined();
        });

        it('does NOT dispatch a ribbon for broadcast-kind letters (only for epitaphs)', () => {
            // Simulate a broadcast letter (not an epitaph) dispatched through the same path.
            const { produceBroadcastLetter } = require('./letters-producer');
            const broadcastLetter = produceBroadcastLetter({
                recipient: 'alice@onion',
                residentName: 'res:fern',
                faction: 'embassy',
                livedTicks: 1240,
                causeOfDeath: 'goblin',
                ts: '2026-05-23T15:00:00.000Z',
            });
            dispatchEpitaphs([broadcastLetter], store);

            const aliceInbox = store.readInbox('alice@onion');
            // Only the broadcast letter; no ribbon for a non-epitaph dispatch.
            expect(aliceInbox).toHaveLength(1);
            expect(aliceInbox[0].kind).toBe('broadcast');
            expect(aliceInbox.find(l => l.kind === 'civic_milestone')).toBeUndefined();
        });

        it('is idempotent per death — re-dispatching the same death does not add a second ribbon', () => {
            const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion']);
            dispatchEpitaphs(letters, store);
            dispatchEpitaphs(letters, store);

            const aliceRibbons = store.readInbox('alice@onion').filter(l => l.kind === 'civic_milestone');
            expect(aliceRibbons).toHaveLength(1);
        });
    });
});

describe('loadPreparedEpitaph (M4)', () => {
    it('returns the text of prepared-epitaph.txt when the file exists', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epitaph-test-'));
        const residentDir = path.join(dir, 'res:hans');
        fs.mkdirSync(residentDir);
        fs.writeFileSync(path.join(residentDir, 'prepared-epitaph.txt'), 'Hans: My time here grows short.\n');

        expect(loadPreparedEpitaph(dir, 'res:hans')).toBe('Hans: My time here grows short.');
        fs.rmSync(dir, { recursive: true });
    });

    it('returns undefined when the file does not exist', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epitaph-test-'));
        expect(loadPreparedEpitaph(dir, 'res:nobody')).toBeUndefined();
        fs.rmSync(dir, { recursive: true });
    });

    it('returns undefined for an empty file', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epitaph-test-'));
        const residentDir = path.join(dir, 'res:hans');
        fs.mkdirSync(residentDir);
        fs.writeFileSync(path.join(residentDir, 'prepared-epitaph.txt'), '   \n');

        expect(loadPreparedEpitaph(dir, 'res:hans')).toBeUndefined();
        fs.rmSync(dir, { recursive: true });
    });
});

describe('buildEpitaphDispatchRequests with preparedEpitaph (M4)', () => {
    it('includes prepared epitaph in letter body when set on DeceasedResidentSummary', () => {
        const deceased = summary({ preparedEpitaph: 'I stood my ground to the end.' });
        const letters = buildEpitaphDispatchRequests(deceased, ['alice@onion']);

        expect(letters[0].body).toMatch(/In their own words:/);
        expect(letters[0].body).toMatch(/I stood my ground to the end\./);
    });

    it('does not include "In their own words" when preparedEpitaph is absent', () => {
        const letters = buildEpitaphDispatchRequests(summary(), ['alice@onion']);

        expect(letters[0].body).not.toMatch(/In their own words:/);
    });
});

describe('findLivingSibling (HD-012)', () => {
    it('returns undefined when siblings list is empty', () => {
        expect(findLivingSibling([], () => true)).toBeUndefined();
    });

    it('returns undefined when all siblings are deceased', () => {
        expect(findLivingSibling(['res:hans', 'res:aereck'], () => false)).toBeUndefined();
    });

    it('returns the first alive sibling', () => {
        const alive = new Set(['res:aereck']);
        expect(findLivingSibling(['res:hans', 'res:aereck'], r => alive.has(r))).toBe('res:aereck');
    });

    it('skips a dead sibling and returns the next alive one', () => {
        const alive = new Set(['res:duke-horacio']);
        expect(findLivingSibling(['res:hans', 'res:duke-horacio', 'res:thrand'], r => alive.has(r))).toBe('res:duke-horacio');
    });

    it('trims whitespace from sibling names', () => {
        expect(findLivingSibling(['  res:hans  '], () => true)).toBe('res:hans');
    });

    it('skips empty-string entries and returns the next valid alive sibling', () => {
        const alive = new Set(['res:pip']);
        expect(findLivingSibling(['', '  ', 'res:pip'], r => alive.has(r))).toBe('res:pip');
    });
});
