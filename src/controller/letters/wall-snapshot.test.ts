import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RuntimeState } from '../memory/runtime-state';
import { LettersStore } from '../patron/letters-store';
import { FactionStockpileLedger } from '../factions/stockpile-ledger';
import { buildWallSnapshot, readLibraryEntries, redactWallSnapshot, type WallSnapshot } from './wall-snapshot';

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
            expect(Object.keys(snap).sort()).toEqual(['asOf', 'deathsToday', 'factionStockpiles', 'recentLetters', 'residents']);
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

        it('redactWallSnapshot masks recipient handles and clears letter bodies for public wall display (HD-013)', () => {
            // HD-013 / E13. The wall ticker is a public projection at the
            // IRL event — passers-by should not be able to read another
            // patron's full letter body or full handle. The /v1/inbox
            // endpoint (per-patron URL) keeps full content. Recipient
            // mask: first char + '***' + suffix-after-@-or-after-last-dash;
            // body becomes '' so renderers can show only kind + subject.
            seed('alice@onion', 'standing_tier_crossed', '2026-05-23T15:00:00.000Z');
            seed('claude-sprint-patron', 'epitaph', '2026-05-23T15:30:00.000Z');
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });

            const redacted = redactWallSnapshot(snap);

            expect(redacted.recentLetters).toHaveLength(2);
            // Newest first.
            const [first, second] = redacted.recentLetters;
            expect(first.recipient).toBe('c***-patron');
            expect(first.body).toBe('');
            expect(first.subject).toBe('epitaph for claude-sprint-patron'); // subject preserved
            expect(first.kind).toBe('epitaph');
            expect(second.recipient).toBe('a***@onion');
            expect(second.body).toBe('');
            // Counts/asOf preserved.
            expect(redacted.deathsToday).toBe(snap.deathsToday);
            expect(redacted.asOf).toBe(snap.asOf);
        });

        it('redactWallSnapshot masks single-character handles defensively', () => {
            // Edge: short handles still get masked, never returned in clear.
            seed('a', 'standing_tier_crossed', '2026-05-23T15:00:00.000Z');
            seed('bob', 'epitaph', '2026-05-23T15:30:00.000Z');
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });

            const redacted = redactWallSnapshot(snap);

            // 'a' has no suffix delimiter and only 1 char → '***'
            expect(redacted.recentLetters.find(l => l.kind === 'standing_tier_crossed')?.recipient).toBe('***');
            // 'bob' has no delimiter; still mask the middle chars
            expect(redacted.recentLetters.find(l => l.kind === 'epitaph')?.recipient).toBe('b***');
        });

        it('redactWallSnapshot returns a new object (does not mutate input)', () => {
            seed('alice@onion', 'standing_tier_crossed', '2026-05-23T15:00:00.000Z');
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            const originalRecipient = snap.recentLetters[0].recipient;
            const originalBody = snap.recentLetters[0].body;

            const redacted = redactWallSnapshot(snap);

            // Input untouched.
            expect(snap.recentLetters[0].recipient).toBe(originalRecipient);
            expect(snap.recentLetters[0].body).toBe(originalBody);
            // Output redacted.
            expect(redacted.recentLetters[0].recipient).not.toBe(originalRecipient);
        });

        it('redactWallSnapshot passes residents through unchanged (names/goals are public)', () => {
            writeRuntimeState(root, 'res-hans', { attention: 8000 });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            const redacted = redactWallSnapshot(snap);
            expect(redacted.residents).toEqual(snap.residents);
        });

        it('redactWallSnapshot passes faction stockpiles through unchanged (totals are public)', () => {
            const ledger = new FactionStockpileLedger(root, { now: () => new Date('2026-05-25T19:30:00.000Z') });
            ledger.recordAttempt({
                resident: 'res:wren-calix',
                factionId: 'ledger',
                attempt: factionAttempt('faction_ledger_audit_work', 'move_to'),
            });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-25T19:30:00.000Z') });
            const redacted = redactWallSnapshot(snap);
            expect(redacted.factionStockpiles).toEqual(snap.factionStockpiles);
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

    describe('residents roster', () => {
        it('returns empty residents when no res- directories exist', () => {
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.residents).toEqual([]);
        });

        it('returns an alive resident with display name and attention', () => {
            writeRuntimeState(root, 'res-hans', { attention: 8000 });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.residents).toHaveLength(1);
            const [hans] = snap.residents;
            expect(hans.slug).toBe('res-hans');
            expect(hans.displayName).toBe('Hans');
            expect(hans.alive).toBe(true);
            expect(hans.attention).toBe(8000);
            expect(hans.activeGoal).toBeUndefined();
        });

        it('includes active goal description when cognition.activeGoal is present', () => {
            writeRuntimeState(root, 'res-wise-old-man', {
                attention: 5000,
                cognition: { activeGoal: { id: 'goal-1', description: 'Chop some oak trees', createdAtTick: 100 } },
            });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.residents[0].activeGoal).toBe('Chop some oak trees');
            expect(snap.residents[0].displayName).toBe('Wise Old Man');
        });

        it('falls back to the first authored SOUL goal when runtime cognition has no active goal', () => {
            const soulsDir = path.join(root, 'souls');
            writeRuntimeState(root, 'res-hans', { attention: 8000 });
            writeSoul(soulsDir, 'res-hans.md', {
                name: 'res:hans',
                display: 'Hans the Courtyard Watcher',
                archetype: 'endurer',
                goals: ['greet every visible human at least once per day', 'keep a mental count of visitors'],
            });

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z'), soulsDir });

            expect(snap.residents).toHaveLength(1);
            expect(snap.residents[0].displayName).toBe('Hans the Courtyard Watcher');
            expect(snap.residents[0].activeGoal).toBe('greet every visible human at least once per day');
        });

        it('keeps runtime active goals ahead of authored SOUL fallback goals', () => {
            const soulsDir = path.join(root, 'souls');
            writeRuntimeState(root, 'res-hans', {
                attention: 8000,
                cognition: { activeGoal: { id: 'runtime', description: 'Greet Codex by the gate', createdAtTick: 42 } },
            });
            writeSoul(soulsDir, 'res-hans.md', {
                name: 'res:hans',
                display: 'Hans',
                archetype: 'endurer',
                goals: ['greet every visible human at least once per day'],
            });

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z'), soulsDir });

            expect(snap.residents[0].activeGoal).toBe('Greet Codex by the gate');
        });

        it('marks a resident with a deceased field as alive=false', () => {
            writeRuntimeState(root, 'res-fern', {
                attention: 0,
                deceased: { date: '2026-05-23T10:00:00.000Z', tick: 500, cause: 'attention_exhausted' },
            });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.residents).toHaveLength(1);
            expect(snap.residents[0].alive).toBe(false);
        });

        it('sorts alive residents before deceased, then alphabetically within each group', () => {
            writeRuntimeState(root, 'res-zorka', { attention: 6000 });
            writeRuntimeState(root, 'res-fern', {
                attention: 0,
                deceased: { date: '2026-05-23T10:00:00.000Z', tick: 200, cause: 'attention_exhausted' },
            });
            writeRuntimeState(root, 'res-hans', { attention: 8000 });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            const slugs = snap.residents.map(r => r.slug);
            // Both alive come before deceased; alive sorted alphabetically.
            expect(slugs).toEqual(['res-hans', 'res-zorka', 'res-fern']);
        });

        it('skips a res- directory whose runtime-state.json is missing', () => {
            // Only create the directory, no file inside.
            fs.mkdirSync(path.join(root, 'res-ghost'), { recursive: true });
            writeRuntimeState(root, 'res-hans', { attention: 7000 });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.residents).toHaveLength(1);
            expect(snap.residents[0].slug).toBe('res-hans');
        });

        it('skips a res- directory whose runtime-state.json is malformed JSON', () => {
            fs.mkdirSync(path.join(root, 'res-broken'), { recursive: true });
            fs.writeFileSync(path.join(root, 'res-broken', 'runtime-state.json'), '{ not json }');
            writeRuntimeState(root, 'res-hans', { attention: 7000 });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.residents).toHaveLength(1);
        });

        it('ignores non-res- directories in the root', () => {
            // "data" directory (letters) and other non-res dirs should not appear.
            fs.mkdirSync(path.join(root, 'data', 'letters'), { recursive: true });
            fs.mkdirSync(path.join(root, 'benchmarks'), { recursive: true });
            writeRuntimeState(root, 'res-pip', { attention: 4000 });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-23T16:00:00.000Z') });
            expect(snap.residents).toHaveLength(1);
            expect(snap.residents[0].slug).toBe('res-pip');
        });

        it('populates factionId and factionColor from SOUL factionId when it resolves in the catalog', () => {
            const soulsDir = path.join(root, 'souls');
            writeRuntimeState(root, 'res-mother-anvil', { attention: 7000 });
            writeSoul(soulsDir, 'res-mother-anvil.md', {
                name: 'res:mother-anvil',
                display: 'Mother Anvil',
                archetype: 'achiever',
                factionId: 'foundry',
            });

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-25T16:00:00.000Z'), soulsDir });

            expect(snap.residents).toHaveLength(1);
            const [anvil] = snap.residents;
            expect(anvil.factionId).toBe('foundry');
            expect(anvil.factionDisplayName).toBe('The Foundry');
            expect(anvil.factionColor).toBe('#B87333');
        });

        it('leaves factionId/factionColor absent when the SOUL has no factionId', () => {
            const soulsDir = path.join(root, 'souls');
            writeRuntimeState(root, 'res-hans', { attention: 8000 });
            writeSoul(soulsDir, 'res-hans.md', {
                name: 'res:hans',
                display: 'Hans',
                archetype: 'endurer',
            });

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-25T16:00:00.000Z'), soulsDir });

            expect(snap.residents[0].factionId).toBeUndefined();
            expect(snap.residents[0].factionDisplayName).toBeUndefined();
            expect(snap.residents[0].factionColor).toBeUndefined();
        });

        it('leaves factionColor/factionDisplayName absent when factionId is unknown to the catalog', () => {
            const soulsDir = path.join(root, 'souls');
            writeRuntimeState(root, 'res-orphan', { attention: 5000 });
            writeSoul(soulsDir, 'res-orphan.md', {
                name: 'res:orphan',
                display: 'Orphan',
                archetype: 'endurer',
                factionId: 'no-such-faction',
            });

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-25T16:00:00.000Z'), soulsDir });

            expect(snap.residents[0].factionId).toBe('no-such-faction');
            expect(snap.residents[0].factionDisplayName).toBeUndefined();
            expect(snap.residents[0].factionColor).toBeUndefined();
        });

        it('can limit the wall roster to configured residents so stale benchmark folders stay hidden', () => {
            writeRuntimeState(root, 'res-agent', { attention: 9000 });
            writeRuntimeState(root, 'res-hans', { attention: 8000 });
            writeRuntimeState(root, 'res-bmk-fire-5m-002e9qp0', {
                attention: 5000,
                cognition: { activeGoal: { id: 'bench', description: 'Use tinderbox on logs to make a fire.', createdAtTick: 0 } },
            });

            const snap = buildWallSnapshot(root, {
                now: new Date('2026-05-23T16:00:00.000Z'),
                residentIds: ['res:agent', 'res:hans'],
            });

            expect(snap.residents.map(r => r.slug)).toEqual(['res-agent', 'res-hans']);
        });

        it('includes live SOUL-discovered residents when configured residents are supplied', () => {
            const soulsDir = path.join(root, 'souls');
            writeRuntimeState(root, 'res-agent', { attention: 9000 });
            writeRuntimeState(root, 'res-mother-anvil', { attention: 7000 });
            writeRuntimeState(root, 'res-bmk-fire-5m-002e9qp0', { attention: 5000 });
            writeSoul(soulsDir, 'res-mother-anvil.md', {
                name: 'res:mother-anvil',
                display: 'Mother Anvil',
                archetype: 'achiever',
                factionId: 'foundry',
                goals: ['keep the Foundry hammering'],
            });

            const snap = buildWallSnapshot(root, {
                now: new Date('2026-05-25T16:00:00.000Z'),
                residentIds: ['res:agent'],
                soulsDir,
            });

            expect(snap.residents.map(r => r.slug)).toEqual(['res-agent', 'res-mother-anvil']);
            expect(snap.residents[1]).toMatchObject({
                displayName: 'Mother Anvil',
                activeGoal: 'keep the Foundry hammering',
                factionId: 'foundry',
            });
        });
    });

    describe('story arc phase (M1-ARC-WALL)', () => {
        it('populates arcPhase when library timeline has classified events (patron_gift → fund)', () => {
            writeRuntimeState(root, 'res-hans', { attention: 8000 });
            const timelineDir = path.join(root, 'library', 'res-hans');
            fs.mkdirSync(timelineDir, { recursive: true });
            fs.writeFileSync(
                path.join(timelineDir, 'timeline.jsonl'),
                JSON.stringify({ kind: 'patron_gift', tick: 100, ts: '2026-05-26T01:00:00.000Z', from: 'patron-alice' }) + '\n',
            );

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-26T02:00:00.000Z') });

            expect(snap.residents).toHaveLength(1);
            expect(snap.residents[0].arcPhase).toBe('fund');
        });

        it('leaves arcPhase absent when no library timeline file exists', () => {
            writeRuntimeState(root, 'res-hans', { attention: 8000 });
            // No library dir written.
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-26T02:00:00.000Z') });

            expect(snap.residents[0].arcPhase).toBeUndefined();
        });

        it('populates arcPhase=resolve when timeline has a legacy_event (resolution kind)', () => {
            writeRuntimeState(root, 'res-fern', { attention: 1000 });
            const timelineDir = path.join(root, 'library', 'res-fern');
            fs.mkdirSync(timelineDir, { recursive: true });
            const lines =
                [
                    JSON.stringify({ kind: 'patron_gift', tick: 50, ts: '2026-05-26T00:30:00.000Z', from: 'patron-bob' }),
                    JSON.stringify({ kind: 'near_death_survival', tick: 200, ts: '2026-05-26T01:00:00.000Z' }),
                    JSON.stringify({ kind: 'legacy_event', tick: 500, ts: '2026-05-26T01:30:00.000Z', cause: 'attention_exhausted' }),
                ].join('\n') + '\n';
            fs.writeFileSync(path.join(timelineDir, 'timeline.jsonl'), lines);

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-26T02:00:00.000Z') });

            expect(snap.residents[0].arcPhase).toBe('resolve');
        });
    });

    describe('faction stockpiles', () => {
        it('summarizes persisted faction stockpile totals for the wall', () => {
            const ledger = new FactionStockpileLedger(root, { now: () => new Date('2026-05-25T19:30:00.000Z') });
            ledger.recordAttempt({
                resident: 'res:mother-anvil',
                factionId: 'foundry',
                attempt: factionAttempt('faction_foundry_fuel_work', 'use_item_on_item'),
            });
            ledger.recordAttempt({
                resident: 'res:wren-calix',
                factionId: 'ledger',
                attempt: factionAttempt('faction_ledger_audit_work', 'move_to'),
            });
            ledger.recordAttempt({
                resident: 'res:wren-calix',
                factionId: 'ledger',
                attempt: factionAttempt('faction_ledger_audit_work', 'say'),
            });

            const snap = buildWallSnapshot(root, { now: new Date('2026-05-25T19:30:00.000Z') });

            expect(snap.factionStockpiles).toEqual([
                {
                    factionId: 'foundry',
                    factionDisplayName: 'The Foundry',
                    factionColor: '#B87333',
                    total: 1,
                    resources: [{ resource: 'kindling', amount: 1 }],
                },
                {
                    factionId: 'ledger',
                    factionDisplayName: 'The Ledger',
                    factionColor: '#CD7F32',
                    total: 2,
                    resources: [
                        { resource: 'audit_marks', amount: 1 },
                        { resource: 'public_notices', amount: 1 },
                    ],
                },
            ]);
        });
    });
});

describe('buildWallSnapshot — public polish (PRE-MERGE-POLISH)', () => {
    let root: string;
    let store: LettersStore;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-snapshot-polish-'));
        store = new LettersStore(root);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function seedLetter(args: {
        recipient: string;
        kind: 'standing_tier_crossed' | 'epitaph' | 'civic_milestone';
        subject: string;
        dispatchedAt: string;
        senderResident?: string;
    }): void {
        store.append({
            kind: args.kind,
            recipient: args.recipient,
            senderResident: args.senderResident ?? 'res:hans',
            subject: args.subject,
            body: 'body text',
            dispatchedAt: args.dispatchedAt,
            deliveryChannels: ['web-inbox'],
        });
    }

    describe('dedupeBySubject (#4 wall letter dedup)', () => {
        it('collapses identical subjects to the newest occurrence when enabled', () => {
            // Five witnesses, same epitaph. Wall should not spam the same card 5 times.
            for (let i = 0; i < 5; i += 1) {
                seedLetter({
                    recipient: `witness-${i}@onion`,
                    kind: 'epitaph',
                    subject: 'On the passing of res:hans',
                    dispatchedAt: `2026-05-26T10:0${i}:00.000Z`,
                });
            }
            // A distinct second letter to make sure dedup doesn't drop unique items.
            seedLetter({
                recipient: 'alice@onion',
                kind: 'civic_milestone',
                subject: "Mortician's Ribbon — res:hans",
                dispatchedAt: '2026-05-26T11:00:00.000Z',
            });

            const snap = buildWallSnapshot(root, {
                now: new Date('2026-05-26T12:00:00.000Z'),
                dedupeBySubject: true,
            });

            expect(snap.recentLetters).toHaveLength(2);
            // Newest distinct first.
            expect(snap.recentLetters[0]?.subject).toBe("Mortician's Ribbon — res:hans");
            expect(snap.recentLetters[0]?.dispatchedAt).toBe('2026-05-26T11:00:00.000Z');
            // For the duplicated subject, only the newest survives.
            expect(snap.recentLetters[1]?.subject).toBe('On the passing of res:hans');
            expect(snap.recentLetters[1]?.dispatchedAt).toBe('2026-05-26T10:04:00.000Z');
        });

        it('does not dedupe when option is omitted (backward compat)', () => {
            for (let i = 0; i < 3; i += 1) {
                seedLetter({
                    recipient: `witness-${i}@onion`,
                    kind: 'epitaph',
                    subject: 'On the passing of res:hans',
                    dispatchedAt: `2026-05-26T10:0${i}:00.000Z`,
                });
            }
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-26T12:00:00.000Z') });
            expect(snap.recentLetters).toHaveLength(3);
        });

        it('keeps distinct subjects untouched even with dedupe enabled', () => {
            seedLetter({
                recipient: 'a@onion',
                kind: 'epitaph',
                subject: 'On the passing of res:hans',
                dispatchedAt: '2026-05-26T10:00:00.000Z',
            });
            seedLetter({
                recipient: 'b@onion',
                kind: 'epitaph',
                subject: 'On the passing of res:pip',
                dispatchedAt: '2026-05-26T10:01:00.000Z',
            });
            seedLetter({
                recipient: 'c@onion',
                kind: 'standing_tier_crossed',
                subject: 'You are now Ally of embassy',
                dispatchedAt: '2026-05-26T10:02:00.000Z',
            });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-26T12:00:00.000Z'), dedupeBySubject: true });
            expect(snap.recentLetters).toHaveLength(3);
        });

        it('applies the limit AFTER dedup so the wall is N distinct subjects', () => {
            // 4 duplicate-subject letters + 6 distinct subjects + limit=3
            // Expected: top 3 distinct, not top 3 raw.
            for (let i = 0; i < 4; i += 1) {
                seedLetter({
                    recipient: `dupe-${i}@onion`,
                    kind: 'epitaph',
                    subject: 'On the passing of res:hans',
                    dispatchedAt: `2026-05-26T09:0${i}:00.000Z`,
                });
            }
            for (let i = 0; i < 6; i += 1) {
                seedLetter({
                    recipient: `u-${i}@onion`,
                    kind: 'standing_tier_crossed',
                    subject: `Unique subject ${i}`,
                    dispatchedAt: `2026-05-26T10:0${i}:00.000Z`,
                });
            }
            const snap = buildWallSnapshot(root, {
                now: new Date('2026-05-26T12:00:00.000Z'),
                dedupeBySubject: true,
                limit: 3,
            });
            expect(snap.recentLetters).toHaveLength(3);
            const subjects = snap.recentLetters.map(l => l.subject);
            expect(new Set(subjects).size).toBe(3);
        });
    });

    describe('excludeSynthetic (#3 QA/bench filter)', () => {
        it('drops res-qa-* slugs from the residents roster when enabled', () => {
            writeRuntimeState(root, 'res-hans', { attention: 1000 });
            writeRuntimeState(root, 'res-qa-cook', { attention: 800 });
            writeRuntimeState(root, 'res-qa-woodcutter', { attention: 900 });
            const snap = buildWallSnapshot(root, {
                now: new Date('2026-05-26T12:00:00.000Z'),
                excludeSynthetic: true,
            });
            const slugs = snap.residents.map(r => r.slug);
            expect(slugs).toEqual(['res-hans']);
        });

        it('drops res-bmk_* slugs from the residents roster when enabled', () => {
            writeRuntimeState(root, 'res-hans', { attention: 1000 });
            writeRuntimeState(root, 'res-bmk_fire_5m_002e9qp0', { attention: 5 });
            writeRuntimeState(root, 'res-bmk_fire_5m_01h3m5sy', { attention: 5 });
            const snap = buildWallSnapshot(root, {
                now: new Date('2026-05-26T12:00:00.000Z'),
                excludeSynthetic: true,
            });
            expect(snap.residents.map(r => r.slug)).toEqual(['res-hans']);
        });

        it('keeps res-agent (canonical demo soul, not synthetic) when enabled', () => {
            writeRuntimeState(root, 'res-hans', { attention: 1000 });
            writeRuntimeState(root, 'res-agent', { attention: 500 });
            const snap = buildWallSnapshot(root, {
                now: new Date('2026-05-26T12:00:00.000Z'),
                excludeSynthetic: true,
            });
            const slugs = snap.residents.map(r => r.slug);
            expect(slugs).toContain('res-agent');
            expect(slugs).toContain('res-hans');
        });

        it('includes synthetic residents when option is omitted (backward compat)', () => {
            writeRuntimeState(root, 'res-hans', { attention: 1000 });
            writeRuntimeState(root, 'res-qa-cook', { attention: 800 });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-26T12:00:00.000Z') });
            expect(snap.residents.map(r => r.slug).sort()).toEqual(['res-hans', 'res-qa-cook']);
        });

        it('excludes letters from res:loop-check (senderResident colon form) when excludeSynthetic is true', () => {
            store.append({
                kind: 'standing_tier_crossed',
                recipient: 'alice@onion',
                senderResident: 'res:loop-check',
                subject: 'loop-check tier',
                body: 'body',
                dispatchedAt: '2026-05-26T11:00:00.000Z',
                deliveryChannels: ['web-inbox'],
            });
            store.append({
                kind: 'standing_tier_crossed',
                recipient: 'bob@onion',
                senderResident: 'res:fern',
                subject: 'real letter',
                body: 'body',
                dispatchedAt: '2026-05-26T11:01:00.000Z',
                deliveryChannels: ['web-inbox'],
            });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-26T12:00:00.000Z'), excludeSynthetic: true });
            expect(snap.recentLetters).toHaveLength(1);
            expect(snap.recentLetters[0].senderResident).toBe('res:fern');
        });

        it('excludes letters from res:qa-* senders when excludeSynthetic is true', () => {
            store.append({
                kind: 'standing_tier_crossed',
                recipient: 'charlie@onion',
                senderResident: 'res:qa-woodcutter',
                subject: 'qa tier',
                body: 'body',
                dispatchedAt: '2026-05-26T11:00:00.000Z',
                deliveryChannels: ['web-inbox'],
            });
            seedLetter({
                recipient: 'alice@onion',
                kind: 'standing_tier_crossed',
                subject: 'real letter',
                dispatchedAt: '2026-05-26T11:01:00.000Z',
            });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-26T12:00:00.000Z'), excludeSynthetic: true });
            expect(snap.recentLetters.every(l => l.senderResident !== 'res:qa-woodcutter')).toBe(true);
            expect(snap.recentLetters).toHaveLength(1);
        });

        it('does not count epitaphs from synthetic senders in deathsToday when excludeSynthetic is true', () => {
            store.append({
                kind: 'epitaph',
                recipient: 'graveyard',
                senderResident: 'res:loop-check',
                subject: 'RIP loop-check',
                body: 'body',
                dispatchedAt: '2026-05-26T10:00:00.000Z',
                deliveryChannels: ['web-inbox'],
            });
            const snap = buildWallSnapshot(root, { now: new Date('2026-05-26T12:00:00.000Z'), excludeSynthetic: true });
            expect(snap.deathsToday).toBe(0);
        });
    });
});

describe('readLibraryEntries — public polish (PRE-MERGE-POLISH)', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-entries-polish-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function writePortrait(slug: string, residentName: string, currentState: 'living' | 'deceased' | 'reborn'): void {
        const dir = path.join(root, 'library', slug);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'portrait.json'),
            JSON.stringify({
                residentName,
                currentState,
                livesCount: 1,
                lastUpdated: { ts: '2026-05-26T12:00:00.000Z' },
                voice: { quotes: [{ text: 'a sample quote', tag: 'first' }] },
                patrons: [],
                wants: { current: [] },
            }),
        );
    }

    it('drops res-qa-* portraits when excludeSynthetic is enabled', () => {
        writePortrait('res-hans', 'res:hans', 'living');
        writePortrait('res-qa-cook', 'res:qa-cook', 'living');
        writePortrait('res-qa-woodcutter', 'res:qa-woodcutter', 'deceased');

        const entries = readLibraryEntries(root, { excludeSynthetic: true });
        expect(entries.map(e => e.slug)).toEqual(['res-hans']);
    });

    it('drops res-bmk_* portraits when excludeSynthetic is enabled', () => {
        writePortrait('res-hans', 'res:hans', 'living');
        writePortrait('res-bmk_fire_5m_002e9qp0', 'res:bmk_fire_5m_002e9qp0', 'deceased');

        const entries = readLibraryEntries(root, { excludeSynthetic: true });
        expect(entries.map(e => e.slug)).toEqual(['res-hans']);
    });

    it('includes all portraits when option is omitted (backward compat)', () => {
        writePortrait('res-hans', 'res:hans', 'living');
        writePortrait('res-qa-cook', 'res:qa-cook', 'living');

        const entries = readLibraryEntries(root);
        expect(entries.map(e => e.slug).sort()).toEqual(['res-hans', 'res-qa-cook']);
    });

    it('keeps res-agent (canonical demo soul) when excludeSynthetic is enabled', () => {
        writePortrait('res-hans', 'res:hans', 'living');
        writePortrait('res-agent', 'res:agent', 'deceased');

        const entries = readLibraryEntries(root, { excludeSynthetic: true });
        expect(entries.map(e => e.slug).sort()).toEqual(['res-agent', 'res-hans']);
    });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function writeRuntimeState(root: string, slug: string, partial: Partial<RuntimeState> & { attention: number }): void {
    const dir = path.join(root, slug);
    fs.mkdirSync(dir, { recursive: true });
    const state: Partial<RuntimeState> = {
        resident: slug.replace(/^res-/, 'res:').replace(/-([a-z])/g, (_, c: string) => `-${c}`),
        tick: 0,
        legacy: { kind: 'gather', progress: {}, complete: false },
        budgets: {
            minuteStartedAt: '2026-05-23T00:00:00.000Z',
            dayStartedAt: '2026-05-23T00:00:00.000Z',
            requestsThisMinute: 0,
            requestsToday: 0,
        },
        ...partial,
    };
    fs.writeFileSync(path.join(dir, 'runtime-state.json'), JSON.stringify(state, null, 2));
}

function writeSoul(
    soulsDir: string,
    fileName: string,
    frontmatter: { name: string; display?: string; archetype: string; goals?: string[]; factionId?: string },
): void {
    fs.mkdirSync(soulsDir, { recursive: true });
    const lines = [
        '---',
        `name: ${frontmatter.name}`,
        frontmatter.display ? `display: ${frontmatter.display}` : undefined,
        `archetype: ${frontmatter.archetype}`,
        frontmatter.factionId ? `factionId: ${frontmatter.factionId}` : undefined,
        frontmatter.goals && frontmatter.goals.length > 0 ? 'goals:' : undefined,
        ...(frontmatter.goals || []).map(goal => `  - ${goal}`),
        '---',
        '',
        '# Test soul',
        '',
    ].filter((line): line is string => line !== undefined);
    fs.writeFileSync(path.join(soulsDir, fileName), `${lines.join('\n')}\n`);
}

function factionAttempt(cause: string, kind: string) {
    return {
        attemptId: `attempt-${cause}-${kind}`,
        resident: 'res:test',
        producer: 'body',
        submittedAt: '2026-05-25T19:30:00.000Z',
        action: { kind, cause },
        evidence: [],
        finalStatus: 'success',
    } as any;
}
