import fs from 'fs';
import os from 'os';
import path from 'path';
import { readRecentLibraryMemories, readRecentPatronMemories } from './library-memories';

describe('readRecentLibraryMemories', () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'library-memories-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    function writeTimeline(resident: string, lines: Array<Record<string, unknown>>): void {
        const dir = path.join(tmpRoot, 'library', resident.replace(/[^a-z0-9-]/gi, '-'));
        fs.mkdirSync(dir, { recursive: true });
        const body = lines.map(line => JSON.stringify(line)).join('\n');
        fs.writeFileSync(path.join(dir, 'timeline.jsonl'), body ? `${body}\n` : '');
    }

    it('returns empty array when the library has no timeline file (fresh resident)', () => {
        expect(readRecentLibraryMemories(tmpRoot, 'res:agent', 5)).toEqual([]);
    });

    it('renders patron_witness events as Patron Witness: <handle> on <ts>', () => {
        writeTimeline('res:agent', [
            {
                schemaVersion: 1,
                ts: '2026-05-22T18:00:00.000Z',
                tick: 100,
                sessionId: 'external',
                kind: 'patron_witness',
                patronHandle: 'alice@onion',
                significanceReasons: ['patron:patron_witness'],
            },
        ]);

        const memories = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
        expect(memories).toHaveLength(1);
        expect(memories[0]).toMatch(/patron/i);
        expect(memories[0]).toContain('alice@onion');
        expect(memories[0]).toContain('2026-05-22');
    });

    it('renders patron_gift events with the gift artifact when present', () => {
        writeTimeline('res:agent', [
            {
                schemaVersion: 1,
                ts: '2026-05-22T18:05:00.000Z',
                tick: 105,
                kind: 'patron_gift',
                patronHandle: 'bob@onion',
                artifact: 'bronze_dagger',
                significanceReasons: ['patron:patron_gift'],
            },
        ]);

        const [memory] = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
        expect(memory).toContain('bob@onion');
        expect(memory).toContain('bronze_dagger');
    });

    it('renders patron_sponsor events with the patron handle', () => {
        writeTimeline('res:agent', [
            {
                schemaVersion: 1,
                ts: '2026-05-22T18:10:00.000Z',
                tick: 110,
                kind: 'patron_sponsor',
                patronHandle: 'carol@onion',
                significanceReasons: ['patron:patron_sponsor'],
            },
        ]);

        const [memory] = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
        expect(memory).toMatch(/sponsor/i);
        expect(memory).toContain('carol@onion');
    });

    it('returns the LAST n entries when there are more entries than n', () => {
        writeTimeline('res:agent', [
            { ts: '2026-05-22T18:00:00.000Z', kind: 'patron_witness', patronHandle: 'a@onion' },
            { ts: '2026-05-22T18:01:00.000Z', kind: 'patron_witness', patronHandle: 'b@onion' },
            { ts: '2026-05-22T18:02:00.000Z', kind: 'patron_witness', patronHandle: 'c@onion' },
            { ts: '2026-05-22T18:03:00.000Z', kind: 'patron_witness', patronHandle: 'd@onion' },
        ]);

        const memories = readRecentLibraryMemories(tmpRoot, 'res:agent', 2);
        expect(memories).toHaveLength(2);
        // Should be the LAST two, chronologically.
        expect(memories[0]).toContain('c@onion');
        expect(memories[1]).toContain('d@onion');
    });

    it('returns the entries in chronological order (oldest first within the returned window)', () => {
        writeTimeline('res:agent', [
            { ts: '2026-05-22T18:00:00.000Z', kind: 'patron_witness', patronHandle: 'first@onion' },
            { ts: '2026-05-22T18:01:00.000Z', kind: 'patron_witness', patronHandle: 'second@onion' },
        ]);

        const memories = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
        expect(memories[0]).toContain('first@onion');
        expect(memories[1]).toContain('second@onion');
    });

    it('renders non-patron story events (first_xp, milestone) using a generic memory line', () => {
        writeTimeline('res:agent', [
            {
                ts: '2026-05-22T18:00:00.000Z',
                kind: 'first_xp',
                skill: 'firemaking',
                note: 'lit first fire',
            },
        ]);

        const [memory] = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
        expect(memory).toContain('first_xp');
        expect(memory).toContain('firemaking');
    });

    it('ignores corrupt jsonl lines and continues parsing valid ones', () => {
        const dir = path.join(tmpRoot, 'library', 'res-agent');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'timeline.jsonl'),
            [
                JSON.stringify({ ts: '2026-05-22T18:00:00.000Z', kind: 'patron_witness', patronHandle: 'good@onion' }),
                'this line is not valid json {',
                JSON.stringify({ ts: '2026-05-22T18:01:00.000Z', kind: 'patron_witness', patronHandle: 'also-good@onion' }),
                '',
            ].join('\n') + '\n',
        );

        const memories = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
        expect(memories).toHaveLength(2);
        expect(memories[0]).toContain('good@onion');
        expect(memories[1]).toContain('also-good@onion');
    });

    it('handles a request of n=0 by returning empty array', () => {
        writeTimeline('res:agent', [{ ts: '2026-05-22T18:00:00.000Z', kind: 'patron_witness', patronHandle: 'alice@onion' }]);
        expect(readRecentLibraryMemories(tmpRoot, 'res:agent', 0)).toEqual([]);
    });

    it('resolves the resident slug consistently with how LibraryUpdater writes it (res:agent → res-agent)', () => {
        writeTimeline('res:agent', [{ ts: '2026-05-22T18:00:00.000Z', kind: 'patron_witness', patronHandle: 'alice@onion' }]);
        const memories = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
        expect(memories).toHaveLength(1);
    });

    it('enriches patron_gift rendering with amount + standingTier when present (E7 fix)', () => {
        // Regression for E7 (intelligence-verification-log.md). Pre-fix the
        // rendering said only "Patron gift from X: a gift" because the CLI
        // path passes `note: 'cli_offer'` not `artifact`. Now PatronGateway
        // also forwards amount + tier crossing so the Brain can actually
        // react. Without amount + tier, an out-of-band Shards offer at IRL
        // has zero observable in-world effect.
        writeTimeline('res:agent', [
            {
                schemaVersion: 1,
                ts: '2026-05-24T15:00:00.000Z',
                tick: 50000,
                kind: 'patron_gift',
                patronHandle: 'james',
                amount: 10,
                standingTier: 'acquaintance',
                attentionDelta: 20,
                note: 'cli_offer',
                significanceReasons: ['patron:patron_gift'],
            },
        ]);

        const [memory] = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
        expect(memory).toContain('james');
        expect(memory).toContain('10');
        expect(memory).toMatch(/acquaintance/i);
    });

    // E44 (intelligence-verification-log.md § E44, task #156): revival events
    // from LibraryUpdater.observeRevival ship lifeIndex + cause; render as
    // first-person narrative so the Brain prompt envelope can react to the
    // continuity break instead of seeing anonymous noise from the default.
    describe('E44: revival event first-person narrative rendering', () => {
        it('renders a revival event with humanized cause + ordinal lifeIndex', () => {
            writeTimeline('res:agent', [
                {
                    schemaVersion: 1,
                    ts: '2026-05-24T17:35:23.486Z',
                    tick: 3528,
                    sessionId: 'external',
                    kind: 'revival',
                    cause: 'operator_revive_attention_exhausted',
                    lifeIndex: 2,
                    significanceReasons: ['life:revival'],
                },
            ]);

            const [memory] = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
            expect(memory).toContain('I returned to life');
            expect(memory).toContain('2nd life');
            expect(memory).toContain('attention ran out');
            expect(memory).toContain('operator restored me');
            expect(memory).toContain('2026-05-24 17:35:23');
        });

        it('humanizes the restart_respawn_policy cause used by ResidentRuntime.applyRestartRespawnPolicy', () => {
            writeTimeline('res:agent', [
                {
                    schemaVersion: 1,
                    ts: '2026-05-24T18:00:00.000Z',
                    tick: 4000,
                    sessionId: 'external',
                    kind: 'revival',
                    cause: 'restart_respawn_policy',
                    lifeIndex: 5,
                    significanceReasons: ['life:revival'],
                },
            ]);

            const [memory] = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
            expect(memory).toContain('5th life');
            expect(memory).toContain('after a controller restart');
            expect(memory).not.toContain('restart_respawn_policy'); // raw cause is humanized away
        });

        it('falls back gracefully when cause + lifeIndex are missing or unknown', () => {
            writeTimeline('res:agent', [
                {
                    schemaVersion: 1,
                    ts: '2026-05-24T19:00:00.000Z',
                    tick: 5000,
                    sessionId: 'external',
                    kind: 'revival',
                    cause: 'novel_future_cause_we_havent_humanized_yet',
                    // no lifeIndex
                    significanceReasons: ['life:revival'],
                },
            ]);

            const [memory] = readRecentLibraryMemories(tmpRoot, 'res:agent', 5);
            expect(memory).toContain('I returned to life');
            expect(memory).toContain('novel_future_cause_we_havent_humanized_yet'); // unknown cause passes through verbatim
            expect(memory).not.toMatch(/\dth life/); // no lifeIndex → no ordinal clause
            expect(memory).not.toMatch(/\dst life/);
        });

        it('uses correct English ordinals (1st / 2nd / 3rd / 11th / 21st)', () => {
            const ordinals: Array<[number, string]> = [
                [1, '1st'],
                [2, '2nd'],
                [3, '3rd'],
                [4, '4th'],
                [11, '11th'],
                [12, '12th'],
                [13, '13th'],
                [21, '21st'],
                [22, '22nd'],
                [101, '101st'],
            ];
            const lines = ordinals.map(([n], i) => ({
                schemaVersion: 1,
                ts: `2026-05-24T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
                tick: 1000 + i,
                sessionId: 'external',
                kind: 'revival',
                cause: 'attention_exhausted',
                lifeIndex: n,
                significanceReasons: ['life:revival'],
            }));
            writeTimeline('res:agent', lines);

            const memories = readRecentLibraryMemories(tmpRoot, 'res:agent', ordinals.length);
            ordinals.forEach(([, expectedOrdinal], i) => {
                expect(memories[i]).toContain(`${expectedOrdinal} life`);
            });
        });
    });
});

describe('readRecentPatronMemories', () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'library-patron-memories-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    function writeTimeline(resident: string, lines: Array<Record<string, unknown>>): void {
        const dir = path.join(tmpRoot, 'library', resident.replace(/[^a-z0-9-]/gi, '-'));
        fs.mkdirSync(dir, { recursive: true });
        const body = lines.map(line => JSON.stringify(line)).join('\n');
        fs.writeFileSync(path.join(dir, 'timeline.jsonl'), body ? `${body}\n` : '');
    }

    // Why this reader exists (E7 fix, see docs/intelligence-verification-log.md
    // § E7): res:agent's timeline is dominated by stuck/say spam at ~1/10s.
    // The general-purpose readRecentLibraryMemories window of 4 evicts patron
    // events within minutes, leaving the Brain blind to out-of-band Shards
    // offers. A dedicated patron-only window preserves them long enough for
    // the resident to acknowledge the patron in conversation or behavior.
    it('returns last N patron events even when timeline is dominated by stuck/say noise', () => {
        writeTimeline('res:agent', [
            { ts: '2026-05-24T13:00:00.000Z', kind: 'patron_gift', patronHandle: 'alice@onion' },
            { ts: '2026-05-24T13:01:00.000Z', kind: 'say', text: 'I am here.' },
            { ts: '2026-05-24T13:02:00.000Z', kind: 'stuck_detected', stuckSince: 100 },
            { ts: '2026-05-24T13:03:00.000Z', kind: 'stuck_recovered', stuckSince: 100 },
            { ts: '2026-05-24T13:04:00.000Z', kind: 'say', text: 'Moving on.' },
            { ts: '2026-05-24T13:05:00.000Z', kind: 'say', text: 'Still here.' },
            { ts: '2026-05-24T13:06:00.000Z', kind: 'patron_witness', patronHandle: 'bob@onion' },
            { ts: '2026-05-24T13:07:00.000Z', kind: 'say', text: 'Chop chop.' },
        ]);

        const patronMemories = readRecentPatronMemories(tmpRoot, 'res:agent', 4);
        expect(patronMemories).toHaveLength(2);
        expect(patronMemories[0]).toContain('alice@onion');
        expect(patronMemories[1]).toContain('bob@onion');
    });

    it('returns empty when the timeline file is missing (fresh resident)', () => {
        expect(readRecentPatronMemories(tmpRoot, 'res:agent', 4)).toEqual([]);
    });

    it('returns the LAST n patron events when there are more than n', () => {
        writeTimeline('res:agent', [
            { ts: '2026-05-24T13:00:00.000Z', kind: 'patron_gift', patronHandle: 'a@onion' },
            { ts: '2026-05-24T13:01:00.000Z', kind: 'patron_gift', patronHandle: 'b@onion' },
            { ts: '2026-05-24T13:02:00.000Z', kind: 'patron_gift', patronHandle: 'c@onion' },
            { ts: '2026-05-24T13:03:00.000Z', kind: 'patron_gift', patronHandle: 'd@onion' },
        ]);

        const patronMemories = readRecentPatronMemories(tmpRoot, 'res:agent', 2);
        expect(patronMemories).toHaveLength(2);
        expect(patronMemories[0]).toContain('c@onion');
        expect(patronMemories[1]).toContain('d@onion');
    });

    it('honors n=0 by returning empty', () => {
        writeTimeline('res:agent', [{ ts: '2026-05-24T13:00:00.000Z', kind: 'patron_gift', patronHandle: 'a@onion' }]);
        expect(readRecentPatronMemories(tmpRoot, 'res:agent', 0)).toEqual([]);
    });

    it('filters out non-patron events even when they are more recent', () => {
        writeTimeline('res:agent', [
            { ts: '2026-05-24T13:00:00.000Z', kind: 'patron_gift', patronHandle: 'alice@onion' },
            { ts: '2026-05-24T13:01:00.000Z', kind: 'first_xp', skill: 'firemaking' },
            { ts: '2026-05-24T13:02:00.000Z', kind: 'say', text: 'I am here.' },
        ]);

        const patronMemories = readRecentPatronMemories(tmpRoot, 'res:agent', 4);
        expect(patronMemories).toHaveLength(1);
        expect(patronMemories[0]).toContain('alice@onion');
    });
});
