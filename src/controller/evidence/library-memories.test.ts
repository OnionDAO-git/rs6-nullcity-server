import fs from 'fs';
import os from 'os';
import path from 'path';
import { readRecentLibraryMemories } from './library-memories';

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
});
