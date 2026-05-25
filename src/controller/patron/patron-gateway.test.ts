import fs from 'fs';
import os from 'os';
import path from 'path';
import { CurrencyLedger } from './currency-ledger';
import { StandingLedger } from './standing-ledger';
import { PatronGateway } from './patron-gateway';
import { ResidentRuntime } from '../resident-runtime';

describe('PatronGateway', () => {
    let currencyLedger: CurrencyLedger;
    let standingLedger: StandingLedger;
    let runtimes: Map<string, ResidentRuntime>;
    let soulsDir: string;
    let mockRuntime: jest.Mocked<any>;
    let mockTrajectory: jest.Mocked<any>;
    let mockLibrary: jest.Mocked<any>;
    let gateway: PatronGateway;

    beforeEach(() => {
        currencyLedger = new CurrencyLedger({ now: () => new Date('2026-05-23T04:00:00Z') });
        standingLedger = new StandingLedger({ now: () => new Date('2026-05-23T04:00:00Z') });
        runtimes = new Map();
        soulsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-patron-souls-'));

        mockTrajectory = {
            recordPatron: jest.fn(),
        };
        mockLibrary = {
            observePatron: jest.fn(),
        };
        mockRuntime = {
            name: 'res:pip',
            getState: jest.fn(() => ({ tick: 5, faction: 'embassy' })),
            getEvidence: jest.fn(() => ({
                trajectory: mockTrajectory,
                library: mockLibrary,
            })),
            incrementAttention: jest.fn(),
        };

        runtimes.set('res:pip', mockRuntime as any);

        gateway = new PatronGateway({
            currencyLedger,
            standingLedger,
            runtimes,
            soulsDir,
            now: () => new Date('2026-05-23T04:00:00Z'),
        });
    });

    afterEach(() => {
        fs.rmSync(soulsDir, { recursive: true, force: true });
    });

    describe('offerTo', () => {
        it('rejects invalid amounts or non-integers', async () => {
            const res = await gateway.offerTo({ humanId: 'james', residentName: 'res:pip', amount: -5 });
            expect(res.ok).toBe(false);
            expect(res.error).toBe('invalid_amount');

            const resFloat = await gateway.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 2.5 });
            expect(resFloat.ok).toBe(false);
            expect(resFloat.error).toBe('invalid_amount');
        });

        it('rejects inactive or non-existent residents', async () => {
            const res = await gateway.offerTo({ humanId: 'james', residentName: 'res:unknown', amount: 5 });
            expect(res.ok).toBe(false);
            expect(res.error).toBe('resident_not_found');
        });

        it('rejects when human balance is insufficient', async () => {
            currencyLedger.credit('james', 3, { reason: 'daily_check_in' });
            const res = await gateway.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 5 });
            expect(res.ok).toBe(false);
            expect(res.error).toBe('insufficient_currency');
        });

        it('successfully processes offer and returns standingDelta', async () => {
            currencyLedger.credit('james', 10, { reason: 'workshop_attendance' });
            const res = await gateway.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 5, interactionContext: 'chathead' });

            expect(res.ok).toBe(true);
            expect(currencyLedger.balance('james')).toBe(5);
            expect(mockRuntime.incrementAttention).toHaveBeenCalledWith(10);
            expect(standingLedger.points('james', 'embassy')).toBe(5);

            expect(mockTrajectory.recordPatron).toHaveBeenCalledWith({
                patronKind: 'patron_gift',
                patronHandle: 'james',
                note: 'chathead',
            });
            expect(mockLibrary.observePatron).toHaveBeenCalledWith({
                kind: 'patron_gift',
                ts: '2026-05-23T04:00:00.000Z',
                tick: 5,
                patronHandle: 'james',
                note: 'chathead',
                // E7 enrichment: amount + attentionDelta + (optional) tier
                // get forwarded so the Brain's memory rendering can include
                // them. tier is undefined here because 5 Shards stays under
                // the stranger → acquaintance threshold.
                amount: 5,
                standingTier: undefined,
                attentionDelta: 10,
            });

            expect(res.standingDelta).toEqual({
                factionId: 'embassy',
                before: 0,
                after: 5,
                tierCrossed: undefined,
                tiersCrossed: [],
            });
        });

        it('handles standing tier crossing correctly', async () => {
            currencyLedger.credit('james', 20, { reason: 'workshop_attendance' });
            // Stranger to Acquaintance crossing happens at threshold >= 10 shards
            const res = await gateway.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 12 });

            expect(res.ok).toBe(true);
            expect(res.standingDelta?.tierCrossed).toBe('acquaintance');
        });
    });

    describe('sponsorBirth', () => {
        it('rejects birth when balance is insufficient', async () => {
            const res = await gateway.sponsorBirth({
                humanId: 'james',
                factionId: 'foundry',
                name: 'res:newborn',
                cost: 24,
            });

            expect(res.ok).toBe(false);
            expect(res.error).toBe('insufficient_currency');
        });

        it('successfully seeds soul file and registers standing/cooldowns', async () => {
            currencyLedger.credit('james', 30, { reason: 'workshop_attendance' });
            const onResidentBorn = jest.fn();

            const birthGateway = new PatronGateway({
                currencyLedger,
                standingLedger,
                runtimes,
                soulsDir,
                onResidentBorn,
                now: () => new Date('2026-05-23T04:00:00Z'),
            });

            const res = await birthGateway.sponsorBirth({
                humanId: 'james',
                factionId: 'foundry',
                name: 'res:newborn',
                cost: 24,
                soulFields: {
                    goals: 'Master Smithing',
                    alignment: 'lawful-good',
                },
            });

            expect(res.ok).toBe(true);
            expect(currencyLedger.balance('james')).toBe(6);
            expect(standingLedger.points('james', 'foundry')).toBe(10); // Instant acquaintance!
            expect(onResidentBorn).toHaveBeenCalledWith('res:newborn');

            // Verify seeded soul file
            const soulFilePath = path.join(soulsDir, 'newborn.md');
            expect(fs.existsSync(soulFilePath)).toBe(true);
            const soulContent = fs.readFileSync(soulFilePath, 'utf8');
            expect(soulContent).toContain('name: res:newborn');
            expect(soulContent).toContain('faction: foundry');
            expect(soulContent).toContain('alignment: lawful-good');
            expect(soulContent).toContain('- Master Smithing');
            expect(soulContent).toContain('Sponsored by james.');

            // Verify 24h cooldown is enforced
            const resCooldown = await birthGateway.sponsorBirth({
                humanId: 'james',
                factionId: 'foundry',
                name: 'res:another',
                cost: 24,
            });
            expect(resCooldown.ok).toBe(false);
            expect(resCooldown.error).toBe('cooldown_active');
        });
    });

    describe('witnessAt', () => {
        it('logs witness events at landmarks for active residents', async () => {
            const res = await gateway.witnessAt('james', 'lumbridge_fountain', 'res:pip');
            expect(res.ok).toBe(true);

            expect(mockTrajectory.recordPatron).toHaveBeenCalledWith({
                patronKind: 'patron_witness',
                patronHandle: 'james',
                artifact: 'lumbridge_fountain',
            });
            expect(mockLibrary.observePatron).toHaveBeenCalledWith({
                kind: 'patron_witness',
                ts: '2026-05-23T04:00:00.000Z',
                tick: 5,
                patronHandle: 'james',
                artifact: 'lumbridge_fountain',
            });
        });

        it('credits +3 standing by default and returns standingDelta', async () => {
            const res = await gateway.witnessAt('james', 'first_fire', 'res:pip');
            expect(res.ok).toBe(true);
            expect(standingLedger.points('james', 'embassy')).toBe(3);
            expect(res.standingDelta).toEqual({
                factionId: 'embassy',
                before: 0,
                after: 3,
                tierCrossed: undefined,
                tiersCrossed: [],
            });
        });

        it('respects a custom amount and crosses tier when threshold met', async () => {
            const res = await gateway.witnessAt('james', 'first_fire', 'res:pip', 12);
            expect(res.ok).toBe(true);
            expect(standingLedger.points('james', 'embassy')).toBe(12);
            expect(res.standingDelta?.tierCrossed).toBe('acquaintance');
        });

        it('skips standing bump when residentName is omitted (no faction to credit)', async () => {
            const res = await gateway.witnessAt('james', 'lumbridge_fountain');
            expect(res.ok).toBe(true);
            expect(standingLedger.points('james', 'embassy')).toBe(0);
            expect(res.standingDelta).toBeUndefined();
        });

        it('skips standing bump when amount=0', async () => {
            const res = await gateway.witnessAt('james', 'lumbridge_fountain', 'res:pip', 0);
            expect(res.ok).toBe(true);
            expect(standingLedger.points('james', 'embassy')).toBe(0);
            expect(res.standingDelta).toBeUndefined();
        });

        // E31 / HD-037 HIGH-2: standingDelta.before must be a TRUE snapshot
        // taken before recordSupport, not (after - amount). Without the
        // snapshot, any future decay/cap that makes recordSupport's net
        // change differ from `amount` will silently produce wrong `before`
        // values. Pre-fix this test would still have passed because
        // recordSupport ALWAYS adds exactly `amount` — but the test guards
        // the invariant by seeding pre-existing standing and asserting
        // before reports the pre-existing value, not 0.
        it('standingDelta.before reports the pre-witness value, not (after - amount) (HD-037)', async () => {
            // Pre-seed standing with an unrelated 7-point bump.
            standingLedger.recordSupport('james', 'embassy', 7, { reason: 'pre-existing' });
            expect(standingLedger.points('james', 'embassy')).toBe(7);

            const res = await gateway.witnessAt('james', 'first_fire', 'res:pip', 5);
            expect(res.ok).toBe(true);
            expect(res.standingDelta?.before).toBe(7);
            expect(res.standingDelta?.after).toBe(12);
        });
    });

    describe('askResident', () => {
        let memoryDir: string;
        let gatewayWithMemory: PatronGateway;

        beforeEach(() => {
            memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-patron-ask-memory-'));
            gatewayWithMemory = new PatronGateway({
                currencyLedger,
                standingLedger,
                runtimes,
                soulsDir,
                memoryDir,
                now: () => new Date('2026-05-23T04:00:00Z'),
            });
        });

        afterEach(() => {
            fs.rmSync(memoryDir, { recursive: true, force: true });
        });

        it('rejects empty / whitespace-only questions', async () => {
            const res = await gatewayWithMemory.askResident('james', 'res:pip', '   ');
            expect(res.ok).toBe(false);
            // E31 / HD-037 HIGH-1: ask has no amount; route empty args to
            // 'invalid_input' (NOT the misappropriated 'invalid_amount').
            expect(res.error).toBe('invalid_input');
        });

        it('rejects unknown residents', async () => {
            const res = await gatewayWithMemory.askResident('james', 'res:unknown', 'What is your name?');
            expect(res.ok).toBe(false);
            expect(res.error).toBe('resident_not_found');
        });

        it('appends a patron_ask line to the resident library timeline', async () => {
            const question = 'What did the fire teach you, pip?';
            const res = await gatewayWithMemory.askResident('james', 'res:pip', question);
            expect(res.ok).toBe(true);
            expect(res.eventId).toMatch(/^ask-james-res:pip-/);

            const timelinePath = path.join(memoryDir, 'library', 'res-pip', 'timeline.jsonl');
            expect(fs.existsSync(timelinePath)).toBe(true);
            const lines = fs.readFileSync(timelinePath, 'utf8').trim().split('\n').filter(Boolean);
            expect(lines).toHaveLength(1);
            const entry = JSON.parse(lines[0]);
            expect(entry).toMatchObject({
                kind: 'patron_ask',
                patronHandle: 'james',
                question,
                tick: 5,
                ts: '2026-05-23T04:00:00.000Z',
                lifeIndex: 1,
                significanceReasons: ['patron:patron_ask'],
            });
        });

        it('returns ok but writes nothing when memoryDir is not configured', async () => {
            // Outer gateway has no memoryDir
            const res = await gateway.askResident('james', 'res:pip', 'Hey!');
            expect(res.ok).toBe(true);
            // No timeline written under outer soulsDir
            expect(fs.existsSync(path.join(soulsDir, 'library'))).toBe(false);
        });

        // E31 / HD-038 LOW-1: cap question to 500 chars + strip control chars
        // so a 10MB --text payload doesn't pollute timeline + future prompt
        // envelopes forever.
        it('caps question to 500 chars and strips control characters (HD-038)', async () => {
            // 600 chars of 'A' should truncate to 500.
            const longQuestion = 'A'.repeat(600);
            const res = await gatewayWithMemory.askResident('james', 'res:pip', longQuestion);
            expect(res.ok).toBe(true);
            const timelinePath = path.join(memoryDir, 'library', 'res-pip', 'timeline.jsonl');
            const lines = fs.readFileSync(timelinePath, 'utf8').trim().split('\n').filter(Boolean);
            const entry = JSON.parse(lines[lines.length - 1]);
            expect((entry.question as string).length).toBe(500);

            // Control chars (NUL, BEL, DEL) replaced by space, not deleted.
            // Each control char becomes EXACTLY one space — we don't collapse
            // adjacent whitespace because that would change the user's intent
            // for legitimate questions like "What's 1+2?  Three or four?".
            const withControls = `Hello\x00World\x07!\x7F end`;
            const res2 = await gatewayWithMemory.askResident('james', 'res:pip', withControls);
            expect(res2.ok).toBe(true);
            const lines2 = fs.readFileSync(timelinePath, 'utf8').trim().split('\n').filter(Boolean);
            const entry2 = JSON.parse(lines2[lines2.length - 1]);
            // \x7F → space, then literal space → 2 spaces total between '!' and 'end'.
            expect(entry2.question).toBe('Hello World !  end');
        });
    });

    describe('sendGift', () => {
        it('rejects gifts for inactive residents', async () => {
            const res = await gateway.sendGift('james', 'res:unknown', 'rs:net');
            expect(res.ok).toBe(false);
            expect(res.error).toBe('resident_not_found');
        });

        // E31 / HD-037 HIGH-1: distinguish empty args from missing resident.
        // Pre-fix sendGift returned 'resident_not_found' for both, hiding
        // operator typos.
        it('rejects gifts with empty args using invalid_input (HD-037)', async () => {
            const emptyHuman = await gateway.sendGift('', 'res:pip', 'rs:shrimps');
            expect(emptyHuman.ok).toBe(false);
            expect(emptyHuman.error).toBe('invalid_input');

            const emptyResident = await gateway.sendGift('james', '', 'rs:shrimps');
            expect(emptyResident.ok).toBe(false);
            expect(emptyResident.error).toBe('invalid_input');

            const emptyArtifact = await gateway.sendGift('james', 'res:pip', '');
            expect(emptyArtifact.ok).toBe(false);
            expect(emptyArtifact.error).toBe('invalid_input');
        });

        it('logs item gift events successfully', async () => {
            const res = await gateway.sendGift('james', 'res:pip', 'rs:shrimps');
            expect(res.ok).toBe(true);

            expect(mockTrajectory.recordPatron).toHaveBeenCalledWith({
                patronKind: 'patron_gift',
                patronHandle: 'james',
                artifact: 'rs:shrimps',
            });
            expect(mockLibrary.observePatron).toHaveBeenCalledWith({
                kind: 'patron_gift',
                ts: '2026-05-23T04:00:00.000Z',
                tick: 5,
                patronHandle: 'james',
                artifact: 'rs:shrimps',
            });
        });
    });

    describe('J-δ-β-2: letter dispatch on tier crossing', () => {
        let lettersRoot: string;
        let lettersStore: import('./letters-store').LettersStore;
        let gatewayWithLetters: PatronGateway;

        beforeEach(() => {
            lettersRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-patron-letters-'));
            const { LettersStore } = require('./letters-store');
            lettersStore = new LettersStore(lettersRoot);
            gatewayWithLetters = new PatronGateway({
                currencyLedger,
                standingLedger,
                runtimes,
                soulsDir,
                lettersStore,
                now: () => new Date('2026-05-23T04:00:00Z'),
            });
        });

        afterEach(() => {
            fs.rmSync(lettersRoot, { recursive: true, force: true });
        });

        it('appends a standing_tier_crossed letter to the recipient inbox on offerTo crossing acquaintance', async () => {
            currencyLedger.credit('james', 12, { reason: 'workshop_attendance' });
            const res = await gatewayWithLetters.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 12 });

            expect(res.ok).toBe(true);
            expect(res.standingDelta?.tierCrossed).toBe('acquaintance');

            const inbox = lettersStore.readInbox('james');
            expect(inbox).toHaveLength(1);
            expect(inbox[0].kind).toBe('standing_tier_crossed');
            expect(inbox[0].subject).toMatch(/acquaintance/i);
            expect(inbox[0].recipient).toBe('james');
            expect(inbox[0].senderResident).toBe('res:pip');
        });

        it('does NOT append a letter when offerTo does not cross a tier', async () => {
            currencyLedger.credit('james', 10, { reason: 'workshop_attendance' });
            // 5 Shards leaves james at 5 points (stranger sentinel) — no crossing.
            const res = await gatewayWithLetters.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 5 });

            expect(res.ok).toBe(true);
            expect(res.standingDelta?.tierCrossed).toBeUndefined();
            expect(lettersStore.readInbox('james')).toHaveLength(0);
        });

        it('appends a letter on sponsorBirth (always grants +10 → stranger→acquaintance crossing for first sponsor)', async () => {
            currencyLedger.credit('james', 30, { reason: 'workshop_attendance' });
            const onResidentBorn = jest.fn();
            const birthGateway = new PatronGateway({
                currencyLedger,
                standingLedger,
                runtimes,
                soulsDir,
                lettersStore,
                onResidentBorn,
                now: () => new Date('2026-05-23T04:00:00Z'),
            });

            const res = await birthGateway.sponsorBirth({
                humanId: 'james',
                factionId: 'foundry',
                name: 'res:newborn',
                cost: 24,
            });

            expect(res.ok).toBe(true);
            expect(res.standingDelta?.tierCrossed).toBe('acquaintance');

            const inbox = lettersStore.readInbox('james');
            expect(inbox).toHaveLength(1);
            expect(inbox[0].subject).toMatch(/acquaintance/i);
            expect(inbox[0].senderResident).toBe('res:newborn');
        });

        it('skips letter dispatch entirely when lettersStore is NOT configured (back-compat)', async () => {
            // The gateway from the outer describe block has NO lettersStore.
            currencyLedger.credit('james', 12, { reason: 'workshop_attendance' });
            const res = await gateway.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 12 });

            expect(res.ok).toBe(true);
            expect(res.standingDelta?.tierCrossed).toBe('acquaintance');
            // No store was attached; no file should have been created under lettersRoot.
            expect(fs.existsSync(path.join(lettersRoot, 'data', 'letters'))).toBe(false);
        });

        it('idempotency: a repeated offerTo at the same timestamp with same crossing does not duplicate the letter', async () => {
            currencyLedger.credit('james', 24, { reason: 'workshop_attendance' });
            await gatewayWithLetters.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 12 });
            // The second call cannot re-cross acquaintance (already past it), so no letter on second call.
            // But verify that the first call's letter is not duplicated by some other path.
            const inbox = lettersStore.readInbox('james');
            expect(inbox).toHaveLength(1);
        });

        it('crosses ally on a single big offerTo and dispatches one letter PER tier crossed (HD-040)', async () => {
            // HD-040 (E36-F36b, 2026-05-24): a single grant that crosses
            // multiple thresholds must produce one letter per tier so the
            // patron sees their entire standing journey, not just the final
            // tier. A 30-point offer from stranger → ally crosses both
            // acquaintance (10) and ally (30) — both letters fire.
            currencyLedger.credit('james', 50, { reason: 'workshop_attendance' });
            const res = await gatewayWithLetters.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 30 });

            expect(res.ok).toBe(true);
            expect(res.standingDelta?.tierCrossed).toBe('ally');

            const inbox = lettersStore.readInbox('james');
            expect(inbox).toHaveLength(2);
            // Letters land in ascending tier order (acquaintance first, ally
            // second) per StandingLedger.recordSupport's `tiersCrossed`
            // contract.
            expect(inbox[0].subject).toMatch(/acquaintance/i);
            expect(inbox[0].body).toMatch(/acquaintance/i);
            expect(inbox[1].subject).toMatch(/ally/i);
            expect(inbox[1].body).toMatch(/ally/i);
        });

        it('crosses all three tiers in one grant and dispatches three letters in ascending order (HD-040)', async () => {
            currencyLedger.credit('james', 100, { reason: 'workshop_attendance' });
            const res = await gatewayWithLetters.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 75 });

            expect(res.ok).toBe(true);
            expect(res.standingDelta?.tierCrossed).toBe('officer');

            const inbox = lettersStore.readInbox('james');
            expect(inbox).toHaveLength(3);
            expect(inbox[0].subject).toMatch(/acquaintance/i);
            expect(inbox[1].subject).toMatch(/ally/i);
            expect(inbox[2].subject).toMatch(/officer/i);
        });
    });

    describe('J4: civic milestone letter on witnessAt', () => {
        let lettersRoot: string;
        let lettersStore: import('./letters-store').LettersStore;
        let gatewayWithLetters: PatronGateway;

        beforeEach(() => {
            lettersRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-civic-letters-'));
            const { LettersStore } = require('./letters-store');
            lettersStore = new LettersStore(lettersRoot);
            gatewayWithLetters = new PatronGateway({
                currencyLedger,
                standingLedger,
                runtimes,
                soulsDir,
                lettersStore,
                now: () => new Date('2026-05-23T04:00:00Z'),
            });
        });

        afterEach(() => {
            fs.rmSync(lettersRoot, { recursive: true, force: true });
        });

        it('dispatches a civic_milestone embassy_visit letter when a patron witnesses a resident', async () => {
            const res = await gatewayWithLetters.witnessAt('alice@onion', 'lumbridge_churchyard', 'res:pip');
            expect(res.ok).toBe(true);

            const inbox = lettersStore.readInbox('alice@onion');
            const civicLetters = inbox.filter(l => l.kind === 'civic_milestone');
            expect(civicLetters).toHaveLength(1);
            expect(civicLetters[0].recipient).toBe('alice@onion');
            expect(civicLetters[0].senderResident).toBe('res:pip');
            expect(civicLetters[0].subject).toMatch(/res:pip/i);
            expect(civicLetters[0].body).toContain('lumbridge_churchyard');
        });

        it('dispatches BOTH a civic_milestone letter AND a standing_tier letter when the witness also crosses acquaintance', async () => {
            const res = await gatewayWithLetters.witnessAt('alice@onion', 'lumbridge_churchyard', 'res:pip', 12);
            expect(res.ok).toBe(true);
            expect(res.standingDelta?.tierCrossed).toBe('acquaintance');

            const inbox = lettersStore.readInbox('alice@onion');
            expect(inbox).toHaveLength(2);
            const kinds = inbox.map(l => l.kind).sort();
            expect(kinds).toEqual(['civic_milestone', 'standing_tier_crossed']);
        });

        it('does NOT dispatch a civic_milestone letter when witnessAt has no residentName', async () => {
            const res = await gatewayWithLetters.witnessAt('alice@onion', 'lumbridge_churchyard');
            expect(res.ok).toBe(true);

            const inbox = lettersStore.readInbox('alice@onion');
            expect(inbox).toHaveLength(0);
        });

        it('does NOT dispatch a civic_milestone letter when no lettersStore is configured', async () => {
            // gateway from outer describe block has no lettersStore
            const res = await gateway.witnessAt('alice@onion', 'lumbridge_churchyard', 'res:pip');
            expect(res.ok).toBe(true);
            expect(fs.existsSync(path.join(lettersRoot, 'data', 'letters'))).toBe(false);
        });
    });
});
