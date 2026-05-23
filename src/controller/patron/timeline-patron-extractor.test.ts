import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractPatronHandlesFromTimeline } from './timeline-patron-extractor';

function timelineDir(root: string, slug: string): string {
    return path.join(root, 'library', slug);
}

function writeTimeline(root: string, slug: string, lines: unknown[]): void {
    const dir = timelineDir(root, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'timeline.jsonl'),
        lines.map(line => JSON.stringify(line)).join('\n') + '\n',
    );
}

describe('extractPatronHandlesFromTimeline (EVENT-D4-bridge)', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-extractor-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    describe('empty / missing inputs', () => {
        it('returns [] when the timeline file does not exist (fresh resident)', () => {
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual([]);
        });

        it('returns [] for an empty timeline file', () => {
            writeTimeline(root, 'res-fern', []);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual([]);
        });

        it('returns [] when the timeline contains no events with patronHandle', () => {
            writeTimeline(root, 'res-fern', [
                { kind: 'session_started', ts: '2026-05-23T10:00:00.000Z' },
                { kind: 'first_log', ts: '2026-05-23T10:01:00.000Z' },
            ]);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual([]);
        });
    });

    describe('single patron', () => {
        it('returns the patron handle exactly once for a single patron_witness event', () => {
            writeTimeline(root, 'res-fern', [
                { kind: 'patron_witness', patronHandle: 'alice@onion', ts: '2026-05-23T10:00:00.000Z' },
            ]);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual(['alice@onion']);
        });

        it('returns the patron handle exactly once for repeated events from the same patron', () => {
            writeTimeline(root, 'res-fern', [
                { kind: 'patron_witness', patronHandle: 'alice@onion' },
                { kind: 'patron_gift', patronHandle: 'alice@onion', artifact: 'rs:tinderbox' },
                { kind: 'patron_sponsor', patronHandle: 'alice@onion' },
            ]);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual(['alice@onion']);
        });
    });

    describe('multiple patrons', () => {
        it('returns each unique patron handle in first-seen order', () => {
            writeTimeline(root, 'res-fern', [
                { kind: 'patron_witness', patronHandle: 'alice@onion' },
                { kind: 'patron_gift', patronHandle: 'bob@onion' },
                { kind: 'patron_witness', patronHandle: 'carol@onion' },
            ]);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual([
                'alice@onion',
                'bob@onion',
                'carol@onion',
            ]);
        });

        it('dedupes case-insensitively and preserves the first-seen casing', () => {
            writeTimeline(root, 'res-fern', [
                { kind: 'patron_witness', patronHandle: 'Alice@Onion' },
                { kind: 'patron_witness', patronHandle: 'alice@onion' },
                { kind: 'patron_witness', patronHandle: 'ALICE@ONION' },
            ]);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual(['Alice@Onion']);
        });
    });

    describe('defensive parsing', () => {
        it('ignores patronHandle when it is not a string (number, object, null, undefined)', () => {
            writeTimeline(root, 'res-fern', [
                { kind: 'patron_witness', patronHandle: 12345 },
                { kind: 'patron_witness', patronHandle: { name: 'alice' } },
                { kind: 'patron_witness', patronHandle: null },
                { kind: 'patron_witness' }, // missing
                { kind: 'patron_witness', patronHandle: 'real@onion' },
            ]);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual(['real@onion']);
        });

        it('ignores empty/whitespace-only patronHandle', () => {
            writeTimeline(root, 'res-fern', [
                { kind: 'patron_witness', patronHandle: '' },
                { kind: 'patron_witness', patronHandle: '   ' },
                { kind: 'patron_witness', patronHandle: 'alice@onion' },
            ]);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual(['alice@onion']);
        });

        it('trims surrounding whitespace from a valid handle before dedup', () => {
            writeTimeline(root, 'res-fern', [
                { kind: 'patron_witness', patronHandle: '  alice@onion  ' },
                { kind: 'patron_witness', patronHandle: 'alice@onion' },
            ]);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual(['alice@onion']);
        });

        it('skips malformed JSONL lines without throwing (resilient to log corruption)', () => {
            const slug = 'res-fern';
            const dir = timelineDir(root, slug);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, 'timeline.jsonl'),
                [
                    JSON.stringify({ kind: 'patron_witness', patronHandle: 'alice@onion' }),
                    '{ not valid json',
                    JSON.stringify({ kind: 'patron_gift', patronHandle: 'bob@onion' }),
                ].join('\n') + '\n',
            );
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual(['alice@onion', 'bob@onion']);
        });

        it('skips blank lines', () => {
            const dir = timelineDir(root, 'res-fern');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, 'timeline.jsonl'),
                '\n\n' +
                    JSON.stringify({ kind: 'patron_witness', patronHandle: 'alice@onion' }) +
                    '\n\n',
            );
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual(['alice@onion']);
        });
    });

    describe('resident-slug derivation', () => {
        it('handles "res:fern" → "res-fern" slug (matches residentSlug convention)', () => {
            writeTimeline(root, 'res-fern', [{ kind: 'patron_witness', patronHandle: 'alice@onion' }]);
            expect(extractPatronHandlesFromTimeline(root, 'res:fern')).toEqual(['alice@onion']);
        });

        it('handles a slug with multiple colons and special chars', () => {
            writeTimeline(root, 'res-father-aereck', [
                { kind: 'patron_witness', patronHandle: 'alice@onion' },
            ]);
            expect(extractPatronHandlesFromTimeline(root, 'res:father-aereck')).toEqual(['alice@onion']);
        });
    });
});
