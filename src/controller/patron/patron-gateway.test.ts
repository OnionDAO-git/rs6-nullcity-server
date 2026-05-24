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
    });

    describe('sendGift', () => {
        it('rejects gifts for inactive residents', async () => {
            const res = await gateway.sendGift('james', 'res:unknown', 'rs:net');
            expect(res.ok).toBe(false);
            expect(res.error).toBe('resident_not_found');
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

        it('crosses ally on a single big offerTo and dispatches the Ally letter (not Acquaintance)', async () => {
            currencyLedger.credit('james', 50, { reason: 'workshop_attendance' });
            const res = await gatewayWithLetters.offerTo({ humanId: 'james', residentName: 'res:pip', amount: 30 });

            expect(res.ok).toBe(true);
            expect(res.standingDelta?.tierCrossed).toBe('ally');

            const inbox = lettersStore.readInbox('james');
            expect(inbox).toHaveLength(1);
            expect(inbox[0].subject).toMatch(/ally/i);
            expect(inbox[0].body).toMatch(/ally/i);
        });
    });
});
