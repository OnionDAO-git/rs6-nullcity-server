import fs from 'fs';
import os from 'os';
import path from 'path';
import { EconomyEventLog } from './city-integration/economy-event';
import { CityIntegrationService, type CityRuntime } from './city-integration/service';
import type { RuntimeState } from './memory/runtime-state';
import { ApLedger } from './patron/ap-ledger';

/**
 * S-HOST-WIRE end-to-end integration test.
 *
 * Proves the controller-host wiring contract: ONE shared
 * {@link EconomyEventLog} per memoryRoot can be passed into
 * {@link CityIntegrationService} (which forwards it to ApGpExchangeStore
 * and NcriRegistry) AND into per-resident {@link ApLedger} instances via
 * `attachEconomyEventLog`. After a grant + exchange + NCRI redemption +
 * an ApLedger grant, all four events MUST appear in the same on-disk
 * `<memoryRoot>/city-integration/economy-events.jsonl` file. That single
 * stream is what the (gated) Storyteller's CityEventDigest reads to ground
 * narration in real AP/GP/NCRI movement.
 *
 * This test does NOT spin up a full ControllerHost (that would require a
 * gateway fake, soul loader, llm client, etc.). It instead verifies the
 * narrower contract: the same EconomyEventLog instance, when shared
 * across the subsystems the host owns, produces a single ordered log.
 */
describe('host economy wiring (S-HOST-WIRE)', () => {
    let memoryRoot: string;
    let gold: number;
    let runtime: FakeRuntime;
    let sharedLog: EconomyEventLog;
    let service: CityIntegrationService;

    beforeEach(() => {
        memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'host-econ-wire-'));
        gold = 200;
        runtime = new FakeRuntime();
        // The host would own this instance and expose it via
        // getEconomyEventLog().
        sharedLog = new EconomyEventLog(memoryRoot, () => new Date('2026-05-27T12:00:00.000Z'));
        service = new CityIntegrationService({
            memoryRoot,
            now: () => new Date('2026-05-27T12:00:00.000Z'),
            getRuntime: name => (name === 'res:test' ? runtime : undefined),
            inventory: {
                inspectResidentGold: async name => ({ resident: name, itemId: 995, amount: gold }),
                burnResidentGold: async (name, amount) => {
                    if (gold < amount) {
                        throw new Error('EINSUFFICIENT_GOLD');
                    }
                    gold -= amount;
                    return { resident: name, itemId: 995, burnedAmount: amount, remainingAmount: gold };
                },
            },
            birth: {
                birthResident: async input => ({ resident: input.residentName, created: true, connected: true }),
            },
            // S-HOST-WIRE: the host shares its log with the service so
            // both surfaces feed the same file.
            economyEventLog: sharedLog,
        });
    });

    afterEach(() => {
        fs.rmSync(memoryRoot, { recursive: true, force: true });
    });

    it('exposes the shared log via getEconomyEventLog (host -> service contract)', () => {
        // The service must hand back the same instance the host passed in
        // — not a copy, not a freshly-constructed one. This is what lets
        // the host attach the same log to per-resident ApLedger emitters.
        expect(service.getEconomyEventLog()).toBe(sharedLog);
    });

    it('flows grant + exchange + ncri redeem + ApLedger event into one shared log', async () => {
        // 1. Service-side AP grant (city HTTP surface).
        await service.creditAttention('res:test', {
            idempotencyKey: 'grant-1',
            amount: 25,
            cityUserId: 'user-1',
            sourceType: 'patron_topup',
            sourceId: 'gift-1',
        });

        // 2. Service-side AP-for-GP exchange (burns GP, credits AP).
        await service.exchangeApForGp('res:test', {
            idempotencyKey: 'exch-1',
            apAmount: 40,
            gpAmount: 50,
            cityUserId: 'user-1',
        });

        // 3. Service-side NCRI redemption (admin-approved item lifecycle).
        const ncri = service.createNcri({
            itemId: 1234,
            displayName: 'Test NCRI',
            lore: 'A shared-log proof artifact.',
            owner: 'res:test',
        });
        service.approveNcri(ncri.id, {});
        service.redeemNcri(ncri.id);

        // 4. Resident-side ApLedger grant (post-construction attach path).
        // This proves a per-resident ledger built without the log can be
        // wired up later — the seam the host will use when ResidentRuntime
        // owns an ApLedger.
        const ledger = ApLedger.empty();
        ledger.attachEconomyEventLog(sharedLog, { residentName: 'res:test' });
        ledger.append({
            kind: 'grant',
            amount: 7,
            source: 'live-host-wire',
            ts: '2026-05-27T12:00:00.500Z',
        });

        const events = sharedLog.readAll();
        const kinds = events.map(event => event.kind);
        expect(kinds).toEqual(['ap_topup', 'ap_gp_exchange', 'ncri_redemption', 'ap_grant']);

        // Spot-check: every event is tagged with the resident and uses the
        // shared on-disk file. The digest aggregator can fan out from here.
        for (const event of events) {
            expect(event.residentName).toBe('res:test');
        }
        const logPath = path.join(memoryRoot, 'city-integration', 'economy-events.jsonl');
        expect(fs.existsSync(logPath)).toBe(true);
        const fileLines = fs
            .readFileSync(logPath, 'utf8')
            .split('\n')
            .filter(line => line.trim().length > 0);
        expect(fileLines).toHaveLength(4);
    });
});

class FakeRuntime implements CityRuntime {
    readonly events: unknown[] = [];
    readonly state: RuntimeState = {
        resident: 'res:test',
        attention: 10,
        tick: 1,
        legacy: { kind: 'endurer', progress: {}, complete: false },
        budgets: {
            minuteStartedAt: '2026-05-27T00:00:00.000Z',
            dayStartedAt: '2026-05-27T00:00:00.000Z',
            requestsThisMinute: 0,
            requestsToday: 0,
        },
    };

    incrementAttention(amount: number): void {
        this.state.attention += amount;
    }

    getState(): RuntimeState {
        return this.state;
    }

    onEvent(event: unknown): void {
        this.events.push(event);
    }
}
