import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ProgressLine, TrajectoryLine } from './schemas';
import { LibraryUpdater } from './library-updater';

describe('LibraryUpdater', () => {
    it('appends only story-significant trajectory lines to timeline.jsonl', () => {
        const { updater, root } = testUpdater();

        updater.observeTrajectory(trajectory({ kind: 'hook', winnerId: 'routine' }));
        updater.observeTrajectory(trajectory({ kind: 'say', text: 'I am looking for a tree.' }));

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({
                kind: 'say',
                text: 'I am looking for a tree.',
                lifeIndex: 1,
            }),
        ]);
    });

    it('appends significant progress and tracks stuck recovery context', () => {
        const { updater, root } = testUpdater();

        updater.observeProgress(progress({ tick: 5, meaningful: false, stuckSince: 5 }));
        updater.observeProgress(progress({ tick: 6, meaningful: true, reasons: ['inventory:+1'] }));

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({ kind: 'stuck_detected', tick: 5, stuckSince: 5 }),
            expect.objectContaining({ kind: 'stuck_recovered', tick: 6, stuckSince: 5 }),
        ]);
    });

    it('records patron events and maintains library index state', () => {
        const { updater, root } = testUpdater();

        updater.observePatron({
            kind: 'patron_gift',
            ts: '2026-05-21T11:02:00.000Z',
            tick: 8,
            patronHandle: 'Alice',
            artifact: 'tinderbox',
        });
        updater.observeTrajectory(trajectory({ kind: 'legacy_event', tick: 9, event: { cause: 'death', rebirth: true } }));

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({ kind: 'patron_gift', patronHandle: 'Alice', artifact: 'tinderbox', lifeIndex: 1 }),
            expect.objectContaining({ kind: 'legacy_event', lifeIndex: 1 }),
        ]);
        expect(JSON.parse(fs.readFileSync(path.join(libraryDir(root), 'index.json'), 'utf8'))).toEqual(
            expect.objectContaining({
                schemaVersion: 1,
                resident: 'res:agent',
                lives: 2,
                currentState: 'living',
            }),
        );
    });
});

function testUpdater(): { updater: LibraryUpdater; root: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-updater-'));
    return { updater: new LibraryUpdater('res:agent', root), root };
}

function libraryDir(root: string): string {
    return path.join(root, 'library', 'res-agent');
}

function readTimeline(root: string): Array<Record<string, unknown>> {
    const timelinePath = path.join(libraryDir(root), 'timeline.jsonl');
    if (!fs.existsSync(timelinePath)) {
        return [];
    }
    return fs
        .readFileSync(timelinePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

function trajectory(overrides: Partial<TrajectoryLine>): TrajectoryLine {
    return {
        schemaVersion: 1,
        ts: '2026-05-21T11:00:00.000Z',
        tick: 12,
        sessionId: 'session-a',
        kind: 'action',
        ...overrides,
    } as TrajectoryLine;
}

function progress(overrides: Partial<ProgressLine>): ProgressLine {
    return {
        schemaVersion: 1,
        ts: '2026-05-21T11:01:00.000Z',
        tick: 12,
        sessionId: 'session-a',
        kind: 'progress',
        meaningful: false,
        reasons: [],
        stuckSince: null,
        ...overrides,
    };
}
