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

    it('tags the final spoken line before a legacy event as last words', () => {
        const { updater, root } = testUpdater();

        updater.observeTrajectory(trajectory({ kind: 'say', tick: 2, text: 'I want one more log.' }));
        updater.observeTrajectory(trajectory({ kind: 'say', tick: 4, text: 'Remember the fire.' }));
        updater.observeTrajectory(trajectory({ kind: 'legacy_event', tick: 5, event: { cause: 'death' } }));

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({ kind: 'say', text: 'I want one more log.', lastWords: false }),
            expect.objectContaining({ kind: 'say', text: 'Remember the fire.', lastWords: true }),
            expect.objectContaining({ kind: 'wants_unfulfilled', want: 'I want one more log.', wantedAtTick: 2 }),
            expect.objectContaining({ kind: 'legacy_event' }),
        ]);
    });

    it('records unfulfilled wants before closing a life', async () => {
        const { updater, root } = testUpdater();

        updater.observeTrajectory(trajectory({ kind: 'say', tick: 2, text: 'I want to cook shrimp.' }));
        updater.observeTrajectory(trajectory({ kind: 'say', tick: 4, text: 'I need a safe fire.' }));
        updater.observeTrajectory(trajectory({ kind: 'legacy_event', tick: 5, event: { cause: 'death' } }));

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({ kind: 'say', text: 'I want to cook shrimp.' }),
            expect.objectContaining({ kind: 'say', text: 'I need a safe fire.', lastWords: true }),
            expect.objectContaining({
                kind: 'wants_unfulfilled',
                want: 'I want to cook shrimp.',
                wantedAtTick: 2,
                lifeIndex: 1,
            }),
            expect.objectContaining({
                kind: 'wants_unfulfilled',
                want: 'I need a safe fire.',
                wantedAtTick: 4,
                lifeIndex: 1,
            }),
            expect.objectContaining({ kind: 'legacy_event' }),
        ]);

        await updater.regeneratePortrait();
        expect(fs.readFileSync(path.join(libraryDir(root), 'portrait.md'), 'utf8')).toContain('Still wanted "I want to cook shrimp."');
    });

    it('records peer relationships in the timeline and portrait', async () => {
        const { updater, root } = testUpdater();
        const target = {
            id: 'resident:res:codex',
            kind: 'resident',
            name: 'Codex',
            position: { x: 3228, y: 3230, level: 0 },
        };

        updater.observeTrajectory(
            trajectory({ kind: 'action', tick: 2, actionKind: 'trade_request', action: { kind: 'trade_request', target } }),
        );
        updater.observeTrajectory(
            trajectory({ kind: 'action', tick: 4, actionKind: 'trade_request', action: { kind: 'trade_request', target } }),
        );
        updater.observeTrajectory(
            trajectory({ kind: 'action', tick: 6, actionKind: 'trade_request', action: { kind: 'trade_request', target } }),
        );

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({ kind: 'first_peer_encounter', peer: 'Codex', peerId: 'resident:res:codex', interactions: 1 }),
            expect.objectContaining({ kind: 'relationship_repeated', peer: 'Codex', peerId: 'resident:res:codex', interactions: 3 }),
        ]);

        await updater.regeneratePortrait();

        const portrait = JSON.parse(fs.readFileSync(path.join(libraryDir(root), 'portrait.json'), 'utf8'));
        expect(portrait.relationships).toEqual([
            expect.objectContaining({
                peer: 'Codex',
                firstMet: { tick: 2 },
                interactions: 3,
                lastInteraction: { tick: 6, partingBeforeDeath: false },
            }),
        ]);

        const markdown = fs.readFileSync(path.join(libraryDir(root), 'portrait.md'), 'utf8');
        expect(markdown).toContain('## Who they knew');
        expect(markdown).toContain('- Codex (3 interactions)');
    });

    it('records near-death survival in the timeline and portrait', async () => {
        const { updater, root } = testUpdater();

        updater.observeProgress(progress({ tick: 2, meaningful: true, reasons: ['hp:-4'] }));
        updater.observeProgress(progress({ tick: 5, meaningful: true, reasons: ['hp:+3', 'inventory:-1'] }));

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({
                kind: 'near_death_survival',
                tick: 5,
                dangerSince: 2,
                recoveredAmount: 3,
            }),
        ]);

        await updater.regeneratePortrait();

        const portrait = JSON.parse(fs.readFileSync(path.join(libraryDir(root), 'portrait.json'), 'utf8'));
        expect(portrait.lives[0]).toEqual(
            expect.objectContaining({
                epithet: 'The survivor',
                notableEvents: expect.arrayContaining([expect.objectContaining({ kind: 'near_death_survival' })]),
            }),
        );
        expect(fs.readFileSync(path.join(libraryDir(root), 'portrait.md'), 'utf8')).toContain('Survived danger at tick 5');
    });

    it('keeps peer interaction counts across library updater restarts', () => {
        const { updater, root } = testUpdater();
        const target = {
            id: 'resident:res:codex',
            kind: 'resident',
            name: 'Codex',
            position: { x: 3228, y: 3230, level: 0 },
        };

        updater.observeTrajectory(
            trajectory({ kind: 'action', tick: 2, actionKind: 'trade_request', action: { kind: 'trade_request', target } }),
        );
        updater.observeTrajectory(
            trajectory({ kind: 'action', tick: 4, actionKind: 'trade_request', action: { kind: 'trade_request', target } }),
        );

        const restarted = new LibraryUpdater('res:agent', root);
        restarted.observeTrajectory(
            trajectory({ kind: 'action', tick: 6, actionKind: 'trade_request', action: { kind: 'trade_request', target } }),
        );

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({ kind: 'first_peer_encounter', interactions: 1 }),
            expect.objectContaining({ kind: 'relationship_repeated', interactions: 3 }),
        ]);
    });

    it('regenerates portrait.md and portrait.json from the resident timeline', async () => {
        const { updater, root } = testUpdater();

        updater.observeTrajectory(trajectory({ kind: 'say', tick: 1, text: 'I want to chop a sturdy tree.' }));
        updater.observeProgress(progress({ tick: 2, meaningful: true, reasons: ['xp_gain:woodcutting:25'] }));
        updater.observePatron({
            kind: 'patron_gift',
            ts: '2026-05-21T11:02:00.000Z',
            tick: 3,
            patronHandle: 'Alice',
            artifact: 'tinderbox',
        });
        updater.observeTrajectory(trajectory({ kind: 'say', tick: 4, text: 'Tell James I found sparks.' }));
        updater.observeTrajectory(trajectory({ kind: 'legacy_event', tick: 5, event: { cause: 'goblin ambush' } }));

        await updater.regeneratePortrait();

        const portrait = JSON.parse(fs.readFileSync(path.join(libraryDir(root), 'portrait.json'), 'utf8'));
        expect(portrait).toEqual(
            expect.objectContaining({
                schemaVersion: 1,
                residentName: 'res:agent',
                epithet: expect.any(String),
                currentState: 'deceased',
                livesCount: 1,
                patrons: [
                    expect.objectContaining({
                        handle: 'Alice',
                        sentence: expect.stringContaining('tinderbox'),
                    }),
                ],
            }),
        );
        expect(portrait.voice.quotes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ text: 'Tell James I found sparks.', tag: 'last_words' }),
                expect.objectContaining({ text: 'I want to chop a sturdy tree.', tag: 'mentions_want' }),
            ]),
        );
        expect(portrait.lives[0]).toEqual(
            expect.objectContaining({
                index: 1,
                deathCause: 'goblin ambush',
                lastWords: 'Tell James I found sparks.',
                notableEvents: expect.arrayContaining([expect.objectContaining({ kind: 'first_xp' })]),
            }),
        );
        expect(portrait.wants.unfulfilledAtDeath).toEqual([{ lifeIndex: 1, want: 'I want to chop a sturdy tree.' }]);

        const markdown = fs.readFileSync(path.join(libraryDir(root), 'portrait.md'), 'utf8');
        expect(markdown).toContain('# res:agent,');
        expect(markdown).toContain('## What they wanted');
        expect(markdown).toContain('## In their own words');
        expect(markdown).toContain('### How it ended');
        expect(markdown).toContain('## Patrons');
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
