import fs from 'fs';
import os from 'os';
import path from 'path';
import { LettersStore } from '../patron/letters-store';
import { buildWallSnapshot, type WallSnapshot } from './wall-snapshot';

describe('buildWallSnapshot (EVENT-D6)', () => {
    let root: string;
    let store: LettersStore;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-snapshot-'));
        store = new LettersStore(root);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function seed(recipient: string, kind: 'standing_tier_crossed' | 'epitaph' | 'civic_milestone', dispatchedAt: string): void {
        store.append({
            kind,
            recipient,
            senderResident: 'res:fern',
            subject: `${kind} for ${recipient}`,
            body: 'body text',
            dispatchedAt,
            deliveryChannels: ['web-inbox'],
        });
    }

    describe('empty / missing inputs', () => {
        it('returns an empty snapshot when no letters directory exists', () => {
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.recentLetters).toEqual([]);
            expect(snap.deathsToday).toBe(0);
            expect(snap.asOf).toBe('2026-05-23T16:00:00.000Z');
        });

        it('returns an empty snapshot when the letters directory is empty', () => {
            fs.mkdirSync(path.join(root, 'data', 'letters'), { recursive: true });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.recentLetters).toEqual([]);
            expect(snap.deathsToday).toBe(0);
        });
    });

    describe('recentLetters', () => {
        it('returns letters across all inboxes in reverse-chronological order', () => {
            seed('alice@onion', 'standing_tier_crossed', '2026-05-23T15:00:00.000Z');
            seed('bob@onion', 'standing_tier_crossed', '2026-05-23T15:30:00.000Z');
            seed('alice@onion', 'epitaph', '2026-05-23T15:45:00.000Z');

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.recentLetters.map(l => l.dispatchedAt)).toEqual([
                '2026-05-23T15:45:00.000Z',
                '2026-05-23T15:30:00.000Z',
                '2026-05-23T15:00:00.000Z',
            ]);
        });

        it('caps the list at the default limit (10) when more letters exist', () => {
            for (let i = 0; i < 15; i += 1) {
                seed(`person-${i}@onion`, 'standing_tier_crossed', `2026-05-23T15:${String(i).padStart(2, '0')}:00.000Z`);
            }
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.recentLetters).toHaveLength(10);
        });

        it('honors a caller-supplied limit', () => {
            seed('alice@onion', 'standing_tier_crossed', '2026-05-23T15:00:00.000Z');
            seed('bob@onion', 'standing_tier_crossed', '2026-05-23T15:30:00.000Z');
            seed('carol@onion', 'epitaph', '2026-05-23T15:45:00.000Z');

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z'), limit: 2 });
            expect(snap.recentLetters).toHaveLength(2);
            expect(snap.recentLetters[0].dispatchedAt).toBe('2026-05-23T15:45:00.000Z');
        });
    });

    describe('deathsToday', () => {
        it('counts unique residents who died in the local-day window containing `now`', () => {
            // Two epitaphs from res:fern (one resident, two patrons) + one epitaph for res:hans.
            // Should count as 2 unique deaths. Use distinct dispatchedAt timestamps
            // because LettersStore dedups on (recipient, kind, dispatchedAt).
            store.append({
                kind: 'epitaph',
                recipient: 'alice@onion',
                senderResident: 'res:fern',
                subject: 'On the passing of res:fern',
                body: 'body',
                dispatchedAt: '2026-05-23T15:00:00.000Z',
                deliveryChannels: ['web-inbox'],
            });
            store.append({
                kind: 'epitaph',
                recipient: 'bob@onion',
                senderResident: 'res:fern',
                subject: 'On the passing of res:fern',
                body: 'body',
                dispatchedAt: '2026-05-23T15:00:00.000Z',
                deliveryChannels: ['web-inbox'],
            });
            store.append({
                kind: 'epitaph',
                recipient: 'alice@onion',
                senderResident: 'res:hans',
                subject: 'On the passing of res:hans',
                body: 'body',
                dispatchedAt: '2026-05-23T16:30:00.000Z', // distinct ts from the res:fern ones
                deliveryChannels: ['web-inbox'],
            });

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T20:00:00.000Z') });
            expect(snap.deathsToday).toBe(2);
        });

        it('excludes epitaphs from earlier days', () => {
            const yesterday = '2026-05-22T15:00:00.000Z';
            store.append({
                kind: 'epitaph',
                recipient: 'alice@onion',
                senderResident: 'res:fern',
                subject: 'On the passing of res:fern',
                body: 'body',
                dispatchedAt: yesterday,
                deliveryChannels: ['web-inbox'],
            });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.deathsToday).toBe(0);
        });

        it('does not count non-epitaph kinds', () => {
            const today = '2026-05-23T15:00:00.000Z';
            seed('alice@onion', 'standing_tier_crossed', today);
            seed('bob@onion', 'civic_milestone', today);
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.deathsToday).toBe(0);
        });
    });

    describe('asOf field', () => {
        it('echoes the supplied `now` as the as-of timestamp on the snapshot', () => {
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:05:00.000Z') });
            expect(snap.asOf).toBe('2026-05-23T16:05:00.000Z');
        });
    });

    describe('shape contract', () => {
        it('returns a WallSnapshot with stable field set', () => {
            seed('alice@onion', 'epitaph', '2026-05-23T15:00:00.000Z');
            const snap: WallSnapshot = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(Object.keys(snap).sort()).toEqual(['asOf', 'deathsToday', 'recentLetters']);
        });
    });

    describe('resilience', () => {
        it('skips an inbox directory whose inbox.jsonl is missing without throwing', () => {
            fs.mkdirSync(path.join(root, 'data', 'letters', 'orphan'), { recursive: true });
            // No inbox.jsonl file inside.
            seed('alice@onion', 'standing_tier_crossed', '2026-05-23T15:00:00.000Z');
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.recentLetters).toHaveLength(1);
        });

        it('skips malformed JSONL lines without throwing', () => {
            // Seed first via the store, then append a garbage line AFTER (LettersStore
            // atomic-writes the whole file each append, so any post-append garbage
            // must be added after the last legitimate append).
            seed('alice@onion', 'standing_tier_crossed', '2026-05-23T15:00:00.000Z');
            seed('alice@onion', 'epitaph', '2026-05-23T15:30:00.000Z');
            const inbox = path.join(root, 'data', 'letters', 'alice-onion', 'inbox.jsonl');
            fs.appendFileSync(inbox, '{ not valid json\n');
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.recentLetters).toHaveLength(2);
        });
    });
});
