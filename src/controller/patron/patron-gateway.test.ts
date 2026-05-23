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
});
