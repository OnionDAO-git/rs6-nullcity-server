import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ProgressLine, TrajectoryLine } from './schemas';
import { LibraryUpdater } from './library-updater';
import type { NcriLibraryEvent } from './library-updater';

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

    it('observeRevival bumps lives, restores currentState, and appends a revival timeline event (E8 fix)', () => {
        // Regression for E8 (intelligence-verification-log.md § E8 / F8a):
        // Codex's 4f62d181 added restart respawn for dev residents, but the
        // revival ONLY mutated runtime state — no trajectory event, no
        // library bump. The resident has no narrative beat saying "I came
        // back" so the Brain's prompt envelope never reflects the
        // continuity break. observeRevival closes the substrate side of
        // that gap; the wire-in (one call from resident-runtime revival
        // path) is tracked as Codex-zone follow-up.
        const { updater, root } = testUpdater();

        // Resident "dies" first so lives bumps from a deceased state.
        updater.observeTrajectory(trajectory({ kind: 'legacy_event', tick: 5, event: { cause: 'attention_exhausted' } }));
        const afterDeath = JSON.parse(fs.readFileSync(path.join(libraryDir(root), 'index.json'), 'utf8'));
        expect(afterDeath.currentState).toBe('ended');
        expect(afterDeath.lives).toBe(1);

        updater.observeRevival({
            ts: '2026-05-24T13:32:00.000Z',
            tick: 100,
            cause: 'restart_respawn_policy',
        });

        // Index bumps lives + flips back to living.
        const afterRevival = JSON.parse(fs.readFileSync(path.join(libraryDir(root), 'index.json'), 'utf8'));
        expect(afterRevival).toEqual(
            expect.objectContaining({
                lives: 2,
                currentState: 'living',
            }),
        );

        // Timeline carries a revival event with the resolved lifeIndex.
        const timeline = readTimeline(root);
        const revival = timeline.find(event => event.kind === 'revival');
        expect(revival).toBeDefined();
        expect(revival).toEqual(
            expect.objectContaining({
                kind: 'revival',
                ts: '2026-05-24T13:32:00.000Z',
                tick: 100,
                cause: 'restart_respawn_policy',
                lifeIndex: 2,
            }),
        );
    });

    it('observeRevival without a prior death still appends the event and increments lives (defensive)', () => {
        // Real-world: maintainer may add respawnPolicy mid-life or call
        // observeRevival on a never-died resident during testing. Don't
        // silently drop the event — record it, bump lives, keep state
        // "living". The Brain still benefits from the memory beat.
        const { updater, root } = testUpdater();

        updater.observeRevival({
            ts: '2026-05-24T13:33:00.000Z',
            tick: 50,
            cause: 'manual',
        });

        const index = JSON.parse(fs.readFileSync(path.join(libraryDir(root), 'index.json'), 'utf8'));
        expect(index.lives).toBe(2);
        expect(index.currentState).toBe('living');
        const timeline = readTimeline(root);
        expect(timeline.find(event => event.kind === 'revival')).toBeDefined();
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

describe('LibraryUpdater — observeNcriEvent', () => {
    it('appends ncri_created to timeline with required fields', () => {
        const { updater, root } = testUpdater();

        updater.observeNcriEvent({
            kind: 'ncri_created',
            ts: '2026-05-29T17:10:00.000Z',
            tick: 42,
            ncriId: 'ncri-abc-123',
            itemId: 4151,
            displayName: 'Abyssal Whip',
            owner: 'user-james',
        });

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({
                kind: 'ncri_created',
                ncriId: 'ncri-abc-123',
                itemId: 4151,
                displayName: 'Abyssal Whip',
                owner: 'user-james',
                lifeIndex: 1,
                significanceReasons: ['ncri:ncri_created'],
            }),
        ]);
    });

    it('appends ncri_transferred with previousOwner', () => {
        const { updater, root } = testUpdater();

        updater.observeNcriEvent({
            kind: 'ncri_transferred',
            ts: '2026-05-29T17:15:00.000Z',
            tick: 50,
            ncriId: 'ncri-abc-123',
            itemId: 4151,
            displayName: 'Abyssal Whip',
            owner: 'user-recipient',
            previousOwner: 'user-james',
        });

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({
                kind: 'ncri_transferred',
                owner: 'user-recipient',
                previousOwner: 'user-james',
                significanceReasons: ['ncri:ncri_transferred'],
            }),
        ]);
    });

    it('appends ncri_redeemed to timeline without previousOwner', () => {
        const { updater, root } = testUpdater();

        updater.observeNcriEvent({
            kind: 'ncri_redeemed',
            ts: '2026-05-29T17:20:00.000Z',
            tick: 60,
            ncriId: 'ncri-abc-123',
            itemId: 4151,
            displayName: 'Abyssal Whip',
            owner: 'user-recipient',
        });

        const timeline = readTimeline(root);
        expect(timeline).toHaveLength(1);
        expect(timeline[0]).toEqual(
            expect.objectContaining({
                kind: 'ncri_redeemed',
                ncriId: 'ncri-abc-123',
                itemId: 4151,
                significanceReasons: ['ncri:ncri_redeemed'],
            }),
        );
        expect(timeline[0].previousOwner).toBeUndefined();
    });
});

describe('LibraryUpdater — observeGoalAchieved', () => {
    it('appends goal_achieved to timeline with all required fields and lifeIndex', () => {
        const { updater, root } = testUpdater();

        updater.observeGoalAchieved({
            kind: 'goal_achieved',
            ts: '2026-05-29T10:00:00.000Z',
            tick: 42,
            goalId: 'goal-abc-123',
            goalText: 'Find a reliable way to make 100 GP/hour and write the strategy into the Library.',
            evidence: 'runtime:bank-balance',
            apAtCompletion: 1500,
            gpAtCompletion: 150,
        });

        expect(readTimeline(root)).toEqual([
            expect.objectContaining({
                kind: 'goal_achieved',
                ts: '2026-05-29T10:00:00.000Z',
                tick: 42,
                goalId: 'goal-abc-123',
                goalText: 'Find a reliable way to make 100 GP/hour and write the strategy into the Library.',
                evidence: 'runtime:bank-balance',
                apAtCompletion: 1500,
                gpAtCompletion: 150,
                lifeIndex: 1,
                significanceReasons: ['goal:achieved'],
            }),
        ]);
    });

    it('records goal_achieved without optional AP/GP context when not provided', () => {
        const { updater, root } = testUpdater();

        updater.observeGoalAchieved({
            kind: 'goal_achieved',
            ts: '2026-05-29T11:00:00.000Z',
            tick: 55,
            goalId: 'goal-minimal',
            goalText: 'Cook a meal for the chef.',
            evidence: 'library:quest_complete',
        });

        const timeline = readTimeline(root);
        expect(timeline).toHaveLength(1);
        expect(timeline[0]).toEqual(
            expect.objectContaining({
                kind: 'goal_achieved',
                goalId: 'goal-minimal',
                evidence: 'library:quest_complete',
                lifeIndex: 1,
            }),
        );
        expect(timeline[0].apAtCompletion).toBeUndefined();
        expect(timeline[0].gpAtCompletion).toBeUndefined();
    });

    it('records multiple goal completions for the same resident independently', () => {
        const { updater, root } = testUpdater();

        updater.observeGoalAchieved({
            kind: 'goal_achieved',
            ts: '2026-05-29T10:00:00.000Z',
            tick: 10,
            goalId: 'goal-first',
            goalText: 'First goal',
            evidence: 'e1',
        });
        updater.observeGoalAchieved({
            kind: 'goal_achieved',
            ts: '2026-05-29T11:00:00.000Z',
            tick: 20,
            goalId: 'goal-second',
            goalText: 'Second goal',
            evidence: 'e2',
            gpAtCompletion: 500,
        });

        const timeline = readTimeline(root);
        expect(timeline).toHaveLength(2);
        expect(timeline[0]).toEqual(expect.objectContaining({ goalId: 'goal-first', tick: 10 }));
        expect(timeline[1]).toEqual(expect.objectContaining({ goalId: 'goal-second', tick: 20, gpAtCompletion: 500 }));
    });

    it('goal_achieved uses lifeIndex from current index state', () => {
        const { updater, root } = testUpdater();

        // legacy_event(rebirth: false) keeps lives=1, sets state='ended'.
        // observeRevival then bumps lives to 2.
        updater.observeTrajectory(trajectory({ kind: 'legacy_event', tick: 5, event: { cause: 'death', rebirth: false } }));
        updater.observeRevival({ ts: '2026-05-29T09:00:00.000Z', tick: 6, cause: 'restart' });

        const indexAfterRevival = JSON.parse(fs.readFileSync(path.join(libraryDir(root), 'index.json'), 'utf8'));
        expect(indexAfterRevival.lives).toBe(2);

        updater.observeGoalAchieved({
            kind: 'goal_achieved',
            ts: '2026-05-29T10:00:00.000Z',
            tick: 50,
            goalId: 'goal-life2',
            goalText: 'Goal achieved in second life',
            evidence: 'live:bench',
        });

        const timeline = readTimeline(root);
        const goalEvent = timeline.find(e => e.kind === 'goal_achieved');
        expect(goalEvent).toEqual(expect.objectContaining({ lifeIndex: 2 }));
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
