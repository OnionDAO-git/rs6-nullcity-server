import fs from 'fs';
import os from 'os';
import path from 'path';
import { residentSlug, type RuntimeState } from '../memory/runtime-state';
import { runCityDigest } from './cli';
import { EconomyEventLog } from './economy-event';
import { CityIntegrationError, CityIntegrationService, type CityRuntime } from './service';
import { SoulProposalStore } from './soul-proposals';

class FakeRuntime implements CityRuntime {
    readonly events: unknown[] = [];
    readonly state: RuntimeState = {
        resident: 'res:test',
        attention: 10,
        tick: 7,
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

    decrementAttention(amount: number): number {
        const before = this.state.attention;
        this.state.attention = Math.max(0, this.state.attention - amount);
        return before - this.state.attention;
    }

    getState(): RuntimeState {
        return this.state;
    }

    onEvent(event: unknown): void {
        this.events.push(event);
    }
}

describe('CityIntegrationService', () => {
    let tempRoot: string;
    let root: string;
    let runtime: FakeRuntime;
    let gold: number;
    let burnCalls: number;
    let birthCalls: number;
    let service: CityIntegrationService;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'city-integration-'));
        root = path.join(tempRoot, 'memory');
        fs.mkdirSync(root, { recursive: true });
        runtime = new FakeRuntime();
        gold = 100;
        burnCalls = 0;
        birthCalls = 0;
        service = new CityIntegrationService({
            memoryRoot: root,
            now: () => new Date('2026-05-27T12:00:00.000Z'),
            getRuntime: resident => (resident === 'res:test' ? runtime : undefined),
            inventory: {
                inspectResidentGold: async resident => ({ resident, itemId: 995, amount: gold }),
                burnResidentGold: async (resident, amount) => {
                    burnCalls += 1;
                    if (gold < amount) {
                        throw new Error('EINSUFFICIENT_GOLD');
                    }
                    gold -= amount;
                    return { resident, itemId: 995, burnedAmount: amount, remainingAmount: gold };
                },
            },
            birth: {
                birthResident: async input => {
                    birthCalls += 1;
                    return { resident: input.residentName, created: true, connected: true };
                },
            },
        });
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('credits resident attention once per idempotency key', async () => {
        const first = await service.creditAttention('res:test', { idempotencyKey: 'ap-1', amount: 5 });
        const replay = await service.creditAttention('res:test', { idempotencyKey: 'ap-1', amount: 5 });

        expect(first).toMatchObject({ ok: true, attentionBefore: 10, attentionAfter: 15, creditedAmount: 5 });
        expect(replay).toMatchObject({ ok: true, attentionBefore: 10, attentionAfter: 15, idempotent: true });
        expect(runtime.state.attention).toBe(15);
    });

    it('rejects idempotency key reuse with a different attention payload', async () => {
        await service.creditAttention('res:test', { idempotencyKey: 'ap-1', amount: 5 });

        await expect(service.creditAttention('res:test', { idempotencyKey: 'ap-1', amount: 6 })).rejects.toMatchObject({
            status: 409,
            code: 'idempotency_payload_mismatch',
        });
    });

    it('records AP credit timeline evidence with before/after, source metadata, tick, and lifeIndex', async () => {
        await service.creditAttention('res:test', {
            idempotencyKey: 'ap-lib-1',
            amount: 50,
            cityUserId: 'user-1',
            sourceType: 'patron_checkin',
            sourceId: 'checkin-123',
            note: 'Welcome bonus',
        });

        const timelinePath = path.join(root, 'library', 'res-test', 'timeline.jsonl');
        const event = JSON.parse(fs.readFileSync(timelinePath, 'utf8').trim());
        expect(event).toMatchObject({
            kind: 'city_attention_credit',
            amount: 50,
            attentionBefore: 10,
            attentionAfter: 60,
            cityUserId: 'user-1',
            sourceType: 'patron_checkin',
            sourceId: 'checkin-123',
            note: 'Welcome bonus',
            tick: 7,
            lifeIndex: 1,
            significanceReasons: ['city:attention_credit'],
        });
    });

    describe('adminDrainAttention (S-OBS-DRAIN-1)', () => {
        it('drains AP via runtime.decrementAttention and reports before/after + actualDrain', async () => {
            runtime.state.attention = 22000;
            const result = await service.adminDrainAttention('res:test', {
                amount: 21995,
                reason: 'live-verify F3 needs-hierarchy',
            });
            expect(result).toMatchObject({
                ok: true,
                resident: 'res:test',
                attentionBefore: 22000,
                attentionAfter: 5,
                requestedDrain: 21995,
                actualDrain: 21995,
                reason: 'live-verify F3 needs-hierarchy',
            });
            expect(runtime.state.attention).toBe(5);
        });

        it('clamps the drain at 0 and reports actualDrain accordingly', async () => {
            runtime.state.attention = 100;
            const result = await service.adminDrainAttention('res:test', {
                amount: 500,
                reason: 'over-drain',
            });
            expect(result).toMatchObject({
                attentionBefore: 100,
                attentionAfter: 0,
                requestedDrain: 500,
                actualDrain: 100,
            });
            expect(runtime.state.attention).toBe(0);
        });

        it('emits an ap_decay economy event with the reason as note and negative apDelta', async () => {
            runtime.state.attention = 200;
            await service.adminDrainAttention('res:test', { amount: 150, reason: 'qa drain' });
            const log = new EconomyEventLog(root);
            const events = log.readAll();
            const drainEvent = events.find(e => e.kind === 'ap_decay');
            expect(drainEvent).toBeDefined();
            expect(drainEvent).toMatchObject({
                kind: 'ap_decay',
                residentName: 'res:test',
                apDelta: -150,
                note: 'qa drain',
            });
        });

        it('emits a city_attention_drain library timeline event with admin metadata', async () => {
            runtime.state.attention = 80;
            await service.adminDrainAttention('res:test', { amount: 30, reason: 'docs example' });
            const timelinePath = path.join(root, 'library', 'res-test', 'timeline.jsonl');
            const event = JSON.parse(fs.readFileSync(timelinePath, 'utf8').trim());
            expect(event).toMatchObject({
                kind: 'city_attention_drain',
                requestedDrain: 30,
                actualDrain: 30,
                attentionBefore: 80,
                attentionAfter: 50,
                tick: 7,
                reason: 'docs example',
                lifeIndex: 1,
                significanceReasons: ['city:admin_attention_drain'],
            });
        });

        it('rejects non-positive drain amounts', async () => {
            await expect(service.adminDrainAttention('res:test', { amount: 0, reason: 'zero' })).rejects.toBeInstanceOf(
                CityIntegrationError,
            );
            await expect(service.adminDrainAttention('res:test', { amount: -5, reason: 'neg' })).rejects.toBeInstanceOf(
                CityIntegrationError,
            );
            await expect(service.adminDrainAttention('res:test', { amount: 1.5, reason: 'frac' })).rejects.toBeInstanceOf(
                CityIntegrationError,
            );
        });

        it('requires a non-empty reason string', async () => {
            await expect(service.adminDrainAttention('res:test', { amount: 5, reason: '' })).rejects.toBeInstanceOf(CityIntegrationError);
            await expect(service.adminDrainAttention('res:test', { amount: 5 })).rejects.toBeInstanceOf(CityIntegrationError);
        });

        it('returns 404-shaped error when resident has no live runtime', async () => {
            await expect(service.adminDrainAttention('res:not-found', { amount: 5, reason: 'missing' })).rejects.toMatchObject({
                status: 404,
                code: 'resident_not_found',
            });
        });
    });

    it('returns insufficient gold without burning coins', async () => {
        const result = await service.burnGold('res:test', { idempotencyKey: 'gold-1', amount: 150 });

        expect(result).toMatchObject({ ok: false, error: 'insufficient_gold', requestedAmount: 150 });
        expect(gold).toBe(100);
        expect(burnCalls).toBe(1);
    });

    it('records real RuneScape GP observation evidence when inspecting resident gold', async () => {
        const result = await service.inspectGold('res:test');

        expect(result).toEqual({ ok: true, resident: 'res:test', itemId: 995, amount: 100 });
        const timelinePath = path.join(root, 'library', 'res-test', 'timeline.jsonl');
        const event = JSON.parse(fs.readFileSync(timelinePath, 'utf8').trim());
        expect(event).toMatchObject({
            kind: 'city_gold_observed',
            itemId: 995,
            amount: 100,
            significanceReasons: ['city:gold_observed'],
        });
    });

    it('burns gold once and replays the same idempotent result', async () => {
        const first = await service.burnGold('res:test', { idempotencyKey: 'gold-2', amount: 40 });
        const replay = await service.burnGold('res:test', { idempotencyKey: 'gold-2', amount: 40 });

        expect(first).toMatchObject({ ok: true, burnedAmount: 40, remainingAmount: 60 });
        expect(replay).toMatchObject({ ok: true, burnedAmount: 40, remainingAmount: 60, idempotent: true });
        expect(gold).toBe(60);
        expect(burnCalls).toBe(1);
    });

    it('records city_gold_burn evidence with real burned amount and source metadata', async () => {
        service = new CityIntegrationService({
            memoryRoot: root,
            now: () => new Date('2026-05-27T12:00:00.000Z'),
            getRuntime: resident => (resident === 'res:test' ? runtime : undefined),
            inventory: {
                inspectResidentGold: async resident => ({ resident, itemId: 995, amount: gold }),
                burnResidentGold: async (resident, _amount) => {
                    burnCalls += 1;
                    gold -= 30;
                    return { resident, itemId: 995, burnedAmount: 30, remainingAmount: gold };
                },
            },
            birth: {
                birthResident: async input => {
                    birthCalls += 1;
                    return { resident: input.residentName, created: true, connected: true };
                },
            },
        });

        const result = await service.burnGold('res:test', {
            idempotencyKey: 'gold-3',
            amount: 40,
            cityUserId: 'user-123',
            sourceType: 'city_trade',
            sourceId: 'trade-9',
        });

        expect(result).toMatchObject({ ok: true, burnedAmount: 30, remainingAmount: 70 });
        const timelinePath = path.join(root, 'library', 'res-test', 'timeline.jsonl');
        const event = JSON.parse(fs.readFileSync(timelinePath, 'utf8').trim());
        expect(event).toMatchObject({
            kind: 'city_gold_burn',
            itemId: 995,
            amount: 30,
            cityUserId: 'user-123',
            sourceType: 'city_trade',
            sourceId: 'trade-9',
            lifeIndex: 1,
            significanceReasons: ['city:gold_burn'],
        });
    });

    it('validates birth payloads before calling the birth authority', async () => {
        await expect(
            service.birthResident({
                proposalId: 'proposal-1',
                residentName: 'bad-name',
                soulMarkdown: '# missing frontmatter',
                fundedAttention: 500,
            }),
        ).rejects.toBeInstanceOf(CityIntegrationError);
        expect(birthCalls).toBe(0);
    });

    it('births a valid proposal payload idempotently', async () => {
        const payload = {
            proposalId: 'proposal-1',
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            fundedAttention: 500,
        };

        const first = await service.birthResident(payload);
        const replay = await service.birthResident(payload);

        expect(first).toMatchObject({ ok: true, proposalId: 'proposal-1', resident: 'res:test' });
        expect(replay).toMatchObject({ ok: true, resident: 'res:test', idempotent: true });
        expect(birthCalls).toBe(1);
    });

    it('delivers a human inbox message as a resident event and library event', async () => {
        const result = await service.deliverMessage('res:test', {
            messageId: 'msg-1',
            threadId: 'thread-1',
            cityUserId: 'user-1',
            senderDisplayName: 'Alice',
            body: 'Can you find the blue moon inn?',
        });

        expect(result).toMatchObject({ ok: true, delivered: true });
        expect(runtime.events).toHaveLength(1);
        expect(runtime.events[0]).toMatchObject({
            kind: 'human_inbox_message',
            text: 'Can you find the blue moon inn?',
            threadId: 'thread-1',
            messageId: 'msg-1',
        });
        const timelinePath = path.join(root, 'library', 'res-test', 'timeline.jsonl');
        const event = JSON.parse(fs.readFileSync(timelinePath, 'utf8').trim());
        expect(event).toMatchObject({
            kind: 'city_inbox_message',
            cityUserId: 'user-1',
            senderDisplayName: 'Alice',
            messageId: 'msg-1',
        });
    });
    // ── AP-for-GP exchange ────────────────────────────────────────────────────

    it('exchangeApForGp: records failed_gp when resident has insufficient gold', async () => {
        gold = 0;
        const result = await service.exchangeApForGp('res:test', {
            idempotencyKey: 'exch-fail-gp',
            apAmount: 50,
            gpAmount: 100,
            cityUserId: 'user-1',
        });
        expect(result.status).toBe('failed_gp');
        expect(result.failureReason).toBe('insufficient_gold');
        expect(result.apEvidence).toBeUndefined();
        expect(result.gpEvidence).toBeUndefined();
        // AP must NOT have been credited
        expect(runtime.state.attention).toBe(10);
    });

    it('exchangeApForGp: records complete exchange when both GP burn and AP credit succeed', async () => {
        gold = 200;
        const result = await service.exchangeApForGp('res:test', {
            idempotencyKey: 'exch-ok',
            apAmount: 50,
            gpAmount: 100,
            cityUserId: 'user-2',
        });
        expect(result.status).toBe('complete');
        expect(result.gpEvidence).toMatchObject({ itemId: 995, burnedAmount: 100, remainingAmount: 100 });
        expect(result.apEvidence).toMatchObject({ creditedAmount: 50, attentionBefore: 10, attentionAfter: 60 });
        expect(result.exchangeId).toBe('apgp:res:test:exch-ok');
        expect(gold).toBe(100);
        expect(runtime.state.attention).toBe(60);
    });

    it('emits service AP/GP activity into the EconomyEventLog for city:digest', async () => {
        gold = 200;
        await service.creditAttention('res:test', {
            idempotencyKey: 'topup-1',
            amount: 25,
            cityUserId: 'user-1',
            sourceType: 'patron_topup',
            sourceId: 'gift-1',
        });
        await service.inspectGold('res:test');
        await service.burnGold('res:test', {
            idempotencyKey: 'burn-1',
            amount: 30,
            cityUserId: 'user-1',
            sourceType: 'city_trade',
            sourceId: 'trade-1',
        });
        await service.exchangeApForGp('res:test', {
            idempotencyKey: 'exch-digest',
            apAmount: 40,
            gpAmount: 50,
            cityUserId: 'user-1',
        });

        const events = new EconomyEventLog(root).readAll();
        expect(events.map(event => event.kind)).toEqual(['ap_topup', 'gp_observed', 'gp_traded', 'ap_gp_exchange']);
        expect(events[0]).toMatchObject({ kind: 'ap_topup', residentName: 'res:test', cityUserId: 'user-1', apDelta: 25 });
        expect(events[1]).toMatchObject({ kind: 'gp_observed', residentName: 'res:test', gpDelta: 0 });
        expect(events[2]).toMatchObject({ kind: 'gp_traded', residentName: 'res:test', cityUserId: 'user-1', gpDelta: -30 });
        expect(events[3]).toMatchObject({
            kind: 'ap_gp_exchange',
            residentName: 'res:test',
            cityUserId: 'user-1',
            apDelta: 40,
            gpDelta: -50,
        });

        const digest = JSON.parse(runCityDigest({ memoryRoot: root }, { now: () => new Date('2026-05-27T12:01:00.000Z') }));
        expect(digest).toMatchObject({
            totalEvents: 4,
            countsByKind: {
                ap_topup: 1,
                gp_observed: 1,
                gp_traded: 1,
                ap_gp_exchange: 1,
            },
            apGrantedTotal: 65,
            gpTradedTotal: 30,
            residents: [{ residentName: 'res:test', apGranted: 65, gpTraded: 30, eventCount: 4 }],
        });
    });

    it('storytellerLatest returns newest digest/dispatch payload for dashboard bridge readers', () => {
        const storytellerRoot = path.join(path.dirname(root), 'storyteller');
        const olderRoot = path.join(storytellerRoot, 'run-older');
        const latestRoot = path.join(storytellerRoot, 'run-latest');
        fs.mkdirSync(olderRoot, { recursive: true });
        fs.mkdirSync(latestRoot, { recursive: true });
        fs.writeFileSync(
            path.join(olderRoot, 'digest.json'),
            JSON.stringify({
                digestId: 'digest-older',
                builtAt: '2026-05-27T11:00:00.000Z',
                topEvents: [{ ref: 'old-1' }],
                residents: [{ residentName: 'res:test' }],
                summary: 'older',
            }),
        );
        fs.writeFileSync(
            path.join(latestRoot, 'digest.json'),
            JSON.stringify({
                digestId: 'digest-latest',
                builtAt: '2026-05-27T12:00:00.000Z',
                topEvents: [{ ref: 'new-1' }, { ref: 'new-2' }],
                residents: [{ residentName: 'res:test' }, { residentName: 'res:peer' }],
                summary: 'latest',
            }),
        );
        fs.writeFileSync(
            path.join(latestRoot, 'dispatch.json'),
            JSON.stringify({
                dispatchId: 'dispatch-latest',
                generatedAt: '2026-05-27T12:05:00.000Z',
                modelProfile: 'haiku',
                needsReview: true,
                operatorWarnings: ['unsupported claim'],
                reviewReasons: ['missing event ref'],
                eventRefsUsed: ['event:1'],
                publicBullets: ['bullet 1'],
            }),
        );

        const latest = service.storytellerLatest();
        expect(latest).toMatchObject({
            ok: true,
            runId: 'run-latest',
            digestId: 'digest-latest',
            topEventCount: 2,
            residentCount: 2,
            summary: 'latest',
            dispatch: {
                dispatchId: 'dispatch-latest',
                modelProfile: 'haiku',
                needsReview: true,
                warningCount: 2,
                eventRefCount: 1,
            },
        });
    });

    it('storytellerLatest throws storyteller_not_found when no storyteller artifacts are present', () => {
        const isolatedMemoryRoot = fs.mkdtempSync(path.join(root, 'isolated-memory-'));
        const isolatedService = new CityIntegrationService({
            memoryRoot: isolatedMemoryRoot,
            now: () => new Date('2026-05-27T12:00:00.000Z'),
            getRuntime: resident => (resident === 'res:test' ? runtime : undefined),
            inventory: {
                inspectResidentGold: async resident => ({ resident, itemId: 995, amount: gold }),
                burnResidentGold: async (resident, amount) => {
                    if (gold < amount) throw new Error('EINSUFFICIENT_GOLD');
                    gold -= amount;
                    return { resident, itemId: 995, burnedAmount: amount, remainingAmount: gold };
                },
            },
            birth: {
                birthResident: async input => ({ resident: input.residentName, created: true, connected: true }),
            },
        });

        expect(() => isolatedService.storytellerLatest()).toThrow(
            expect.objectContaining({
                status: 404,
                code: 'storyteller_not_found',
            }),
        );
    });

    it('storytellerCanon and storytellerReview return queue snapshots for dashboard readers', () => {
        const storytellerRoot = path.join(path.dirname(root), 'storyteller');
        const canonRoot = path.join(storytellerRoot, 'canon', 'run-canon');
        const reviewRoot = path.join(storytellerRoot, 'review', 'run-review');
        fs.mkdirSync(canonRoot, { recursive: true });
        fs.mkdirSync(reviewRoot, { recursive: true });

        fs.writeFileSync(
            path.join(canonRoot, 'digest.json'),
            JSON.stringify({
                digestId: 'digest-canon',
                builtAt: '2026-05-27T12:00:00.000Z',
                topEvents: [{ ref: 'canon-1' }],
                residents: [{ residentName: 'res:test' }],
                summary: 'canon digest',
            }),
        );
        fs.writeFileSync(
            path.join(canonRoot, 'dispatch.json'),
            JSON.stringify({
                dispatchId: 'dispatch-canon',
                generatedAt: '2026-05-27T12:05:00.000Z',
                modelProfile: 'storyteller-v1',
                needsReview: false,
                operatorWarnings: [],
                reviewReasons: [],
                eventRefsUsed: ['canon-1'],
                publicBullets: ['canon bullet'],
            }),
        );

        fs.writeFileSync(
            path.join(reviewRoot, 'digest.json'),
            JSON.stringify({
                digestId: 'digest-review',
                builtAt: '2026-05-27T13:00:00.000Z',
                topEvents: [{ ref: 'review-1' }],
                residents: [{ residentName: 'res:peer' }],
                summary: 'review digest',
            }),
        );
        fs.writeFileSync(
            path.join(reviewRoot, 'dispatch.json'),
            JSON.stringify({
                dispatchId: 'dispatch-review',
                generatedAt: '2026-05-27T13:05:00.000Z',
                modelProfile: 'storyteller-v1',
                needsReview: true,
                operatorWarnings: ['verify refs'],
                reviewReasons: ['missing event ref'],
                eventRefsUsed: ['review-1'],
                publicBullets: ['review bullet'],
            }),
        );

        const canon = service.storytellerCanon();
        expect(canon).toMatchObject({
            ok: true,
            queue: 'canon',
            count: 1,
            entries: [
                {
                    runId: 'run-canon',
                    digestId: 'digest-canon',
                    dispatch: {
                        dispatchId: 'dispatch-canon',
                        needsReview: false,
                    },
                },
            ],
        });

        const review = service.storytellerReview();
        expect(review).toMatchObject({
            ok: true,
            queue: 'review',
            count: 1,
            entries: [
                {
                    runId: 'run-review',
                    digestId: 'digest-review',
                    dispatch: {
                        dispatchId: 'dispatch-review',
                        needsReview: true,
                    },
                },
            ],
        });
    });

    it('bounds storyteller queue snapshots even when callers request a huge limit', () => {
        const storytellerRoot = path.join(path.dirname(root), 'storyteller', 'canon');
        for (let i = 0; i < 55; i++) {
            const runRoot = path.join(storytellerRoot, `run-${String(i).padStart(2, '0')}`);
            fs.mkdirSync(runRoot, { recursive: true });
            fs.writeFileSync(
                path.join(runRoot, 'digest.json'),
                JSON.stringify({
                    digestId: `digest-${i}`,
                    builtAt: `2026-05-27T12:${String(i).padStart(2, '0')}:00.000Z`,
                    topEvents: [{ ref: `event-${i}` }],
                    residents: [{ residentName: 'res:test' }],
                }),
            );
            fs.writeFileSync(
                path.join(runRoot, 'dispatch.json'),
                JSON.stringify({
                    dispatchId: `dispatch-${i}`,
                    generatedAt: `2026-05-27T12:${String(i).padStart(2, '0')}:30.000Z`,
                    modelProfile: 'storyteller-v1',
                    needsReview: false,
                    operatorWarnings: [],
                    reviewReasons: [],
                    eventRefsUsed: [`event-${i}`],
                    publicBullets: [`bullet-${i}`],
                }),
            );
        }

        const canon = service.storytellerCanon(999);

        expect(canon.count).toBe(55);
        expect(canon.entries).toHaveLength(50);
        expect(canon.entries[0]?.digestId).toBe('digest-54');
    });

    it('builds live economy rollups and redacts private human handles for dashboard readers', async () => {
        writeRuntimeState(root, 'res:peer', 33);
        await service.creditAttention('res:test', {
            idempotencyKey: 'eco-live-topup',
            amount: 20,
            cityUserId: 'user:alice',
            note: 'Gift from user:alice via @alice',
        });
        await service.burnGold('res:test', {
            idempotencyKey: 'eco-live-burn',
            amount: 15,
            cityUserId: 'user:alice',
        });
        await service.createSoulProposal({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Earn 100 GP',
            apThreshold: 100,
            proposerCityUserId: 'user:alice',
        });

        const live = service.economyLive({ limit: 10, residentLimit: 5 });
        expect(live.city).toMatchObject({
            residentCount: 2,
            activeResidentCount: 1,
            attentionTotal: 63,
            attentionDelta: 20,
            gpNetDelta: -15,
        });
        expect(live.countsByKind).toMatchObject({
            ap_topup: 1,
            gp_traded: 1,
        });
        expect(live.pendingProposals).toHaveLength(1);
        expect(live.residents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ residentName: 'res:test', attentionBalance: 30, online: true }),
                expect.objectContaining({ residentName: 'res:peer', attentionBalance: 33, online: false }),
            ]),
        );

        const topupEvent = live.recentEvents.find(event => event.kind === 'ap_topup');
        expect(topupEvent).toBeDefined();
        expect(topupEvent?.cityUserId).toBe('<patron #1>');
        expect(topupEvent?.note).toContain('<patron #1>');
        expect(topupEvent?.note).toContain('<patron #2>');
        expect(topupEvent?.note).not.toContain('user:alice');
        expect(topupEvent?.note).not.toContain('@alice');

        const totals = service.economyTotals();
        expect(totals.city).toEqual(live.city);
        expect(totals.topResidentsByAttention[0]).toMatchObject({ residentName: 'res:peer', attentionBalance: 33 });

        const events = service.economyEvents({ limit: 1 });
        expect(events.recentEvents).toHaveLength(1);

        const residents = service.economyResidents();
        expect(residents.residents.map(row => row.residentName).sort()).toEqual(['res:peer', 'res:test']);
    });

    it('exposes only explicitly-listed NCRIs in economyListings (not all approved)', async () => {
        fs.rmSync(path.join(path.dirname(root), 'storyteller'), { recursive: true, force: true });

        // Approved but NOT listed for sale — must not appear in marketplace.
        const approvedOnly = service.createNcri({
            itemId: 4151,
            displayName: 'Abyssal Whip of the City',
            lore: 'A champion relic.',
            owner: 'res:test',
        });
        service.approveNcri(approvedOnly.id, {});

        // Approved AND explicitly listed for sale with pricing.
        const forSale = service.createNcri({
            itemId: 590,
            displayName: 'Tinderbox of the Flame',
            lore: 'Null City fire-starter.',
            owner: 'res:test',
        });
        service.approveNcri(forSale.id, {});
        service.listNcriForSale(forSale.id, { apPrice: 150, gpRedemptionCost: 500 });

        // Redeemed — must not appear.
        const redeemed = service.createNcri({
            itemId: 995,
            displayName: 'Coins of Memory',
            lore: 'Already redeemed proof.',
            owner: 'res:test',
        });
        service.approveNcri(redeemed.id, {});
        service.redeemNcri(redeemed.id);

        const listings = service.economyListings();
        expect(listings.asOf).toBe('2026-05-27T12:00:00.000Z');
        expect(listings.listings).toHaveLength(1);
        expect(listings.listings[0]).toMatchObject({
            ncriId: forSale.id,
            itemId: 590,
            displayName: 'Tinderbox of the Flame',
            approvalStatus: 'approved',
            redemptionStatus: 'available',
            listed: true,
            apPrice: 150,
            gpRedemptionCost: 500,
        });
    });

    it('listNcriForSale returns record + pricing; delistNcri removes from marketplace', () => {
        const ncri = service.createNcri({
            itemId: 4151,
            displayName: 'Whip',
            lore: 'Rare.',
            owner: 'res:test',
        });
        service.approveNcri(ncri.id, {});
        const { record, pricing } = service.listNcriForSale(ncri.id, { apPrice: 200, gpRedemptionCost: 1000 });
        expect(record.saleStatus).toBe('listed');
        expect(pricing.apPrice).toBe(200);
        expect(pricing.gpRedemptionCost).toBe(1000);
        expect(service.economyListings().listings).toHaveLength(1);

        const delisted = service.delistNcri(ncri.id);
        expect(delisted.saleStatus).toBe('delisted');
        expect(service.economyListings().listings).toHaveLength(0);
    });

    it('economyListings heartbeat still works alongside NCRI listing changes', async () => {
        fs.rmSync(path.join(path.dirname(root), 'storyteller'), { recursive: true, force: true });

        const listed = service.createNcri({
            itemId: 4151,
            displayName: 'Abyssal Whip of the City',
            lore: 'A champion relic.',
            owner: 'res:test',
        });
        service.approveNcri(listed.id, {});
        service.transferNcri(listed.id, { newOwner: 'user:buyer', reason: 'sale' });

        const redeemed = service.createNcri({
            itemId: 995,
            displayName: 'Coins of Memory',
            lore: 'Already redeemed proof.',
            owner: 'res:test',
        });
        service.approveNcri(redeemed.id, {});
        service.redeemNcri(redeemed.id);

        const heartbeat = service.economyHeartbeat();
        expect(heartbeat).toMatchObject({
            asOf: '2026-05-27T12:00:00.000Z',
            residentCount: 1,
            activeResidentCount: 1,
            economyEventCount: 2,
            lastEconomyEventKind: 'ncri_redemption',
        });
        expect(heartbeat.degradedFlags).not.toContain('no_economy_events');
        expect(heartbeat.degradedFlags).not.toContain('no_active_residents');
        expect(heartbeat.controllerUptimeSec).toBeGreaterThanOrEqual(0);
        expect(heartbeat.lastEconomyEventTs).toBe('2026-05-27T12:00:00.000Z');
    });

    it('economyHeartbeat counts online runtime residents as active even without economy events', () => {
        fs.mkdirSync(path.join(root, 'res-test'), { recursive: true });
        fs.writeFileSync(path.join(root, 'res-test', 'runtime-state.json'), JSON.stringify(runtime.state));
        fs.rmSync(path.join(path.dirname(root), 'storyteller'), { recursive: true, force: true });

        const heartbeat = service.economyHeartbeat();

        expect(heartbeat).toMatchObject({
            residentCount: 1,
            activeResidentCount: 1,
            economyEventCount: 0,
            degradedFlags: ['no_economy_events', 'storyteller_missing'],
        });
        expect(heartbeat.degradedFlags).not.toContain('no_active_residents');
    });

    it('exchangeApForGp: records failed_ap when GP burn succeeds but runtime is missing', async () => {
        gold = 200;
        const serviceWithoutRuntime = new CityIntegrationService({
            memoryRoot: root,
            now: () => new Date('2026-05-27T12:00:00.000Z'),
            getRuntime: () => undefined,
            inventory: {
                inspectResidentGold: async resident => ({ resident, itemId: 995, amount: gold }),
                burnResidentGold: async (resident, amount) => {
                    burnCalls += 1;
                    if (gold < amount) {
                        throw new Error('EINSUFFICIENT_GOLD');
                    }
                    gold -= amount;
                    return { resident, itemId: 995, burnedAmount: amount, remainingAmount: gold };
                },
            },
            birth: {
                birthResident: async input => {
                    birthCalls += 1;
                    return { resident: input.residentName, created: true, connected: true };
                },
            },
        });
        const result = await serviceWithoutRuntime.exchangeApForGp('res:test', {
            idempotencyKey: 'exch-fail-ap',
            apAmount: 50,
            gpAmount: 100,
            cityUserId: 'user-2',
        });
        expect(result.status).toBe('failed_ap');
        expect(result.gpEvidence).toMatchObject({ itemId: 995, burnedAmount: 100, remainingAmount: 100 });
        expect(result.apEvidence).toBeUndefined();
        expect(result.failureReason).toBe('resident_not_found');
    });

    it('exchangeApForGp: idempotent — same key does not burn GP or credit AP twice', async () => {
        gold = 200;
        const first = await service.exchangeApForGp('res:test', { idempotencyKey: 'exch-idem', apAmount: 50, gpAmount: 100 });
        const second = await service.exchangeApForGp('res:test', { idempotencyKey: 'exch-idem', apAmount: 50, gpAmount: 100 });
        expect(first.status).toBe('complete');
        expect(second.status).toBe('complete');
        // Only one burn and one credit
        expect(gold).toBe(100);
        expect(runtime.state.attention).toBe(60);
        expect(burnCalls).toBe(1);
    });

    it('exchangeApForGp: appends city_ap_gp_exchange Library event on success', async () => {
        gold = 500;
        await service.exchangeApForGp('res:test', {
            idempotencyKey: 'exch-lib',
            apAmount: 30,
            gpAmount: 50,
            cityUserId: 'user-3',
        });
        const timelinePath = path.join(root, 'library', 'res-test', 'timeline.jsonl');
        const events = fs
            .readFileSync(timelinePath, 'utf8')
            .trim()
            .split('\n')
            .map(l => JSON.parse(l));
        const exchangeEvent = events.find((e: Record<string, unknown>) => e['kind'] === 'city_ap_gp_exchange');
        expect(exchangeEvent).toBeDefined();
        expect(exchangeEvent).toMatchObject({
            kind: 'city_ap_gp_exchange',
            status: 'complete',
            apAmount: 30,
            gpAmount: 50,
            cityUserId: 'user-3',
        });
    });

    it('exchangeApForGp: appends city_ap_gp_exchange Library event on failed_gp', async () => {
        gold = 0;
        await service.exchangeApForGp('res:test', { idempotencyKey: 'exch-lib-fail', apAmount: 30, gpAmount: 50 });
        const timelinePath = path.join(root, 'library', 'res-test', 'timeline.jsonl');
        const events = fs
            .readFileSync(timelinePath, 'utf8')
            .trim()
            .split('\n')
            .map(l => JSON.parse(l));
        const exchangeEvent = events.find((e: Record<string, unknown>) => e['kind'] === 'city_ap_gp_exchange');
        expect(exchangeEvent).toBeDefined();
        expect(exchangeEvent).toMatchObject({ kind: 'city_ap_gp_exchange', status: 'failed_gp' });
    });

    it('exchangeApForGp: exchange record survives store restart', async () => {
        gold = 100;
        await service.exchangeApForGp('res:test', { idempotencyKey: 'exch-persist', apAmount: 25, gpAmount: 50 });
        // New service instance over same root
        const service2 = new CityIntegrationService({
            memoryRoot: root,
            now: () => new Date('2026-05-29T12:00:00.000Z'),
            getRuntime: () => undefined,
            inventory: {
                inspectResidentGold: async r => ({ resident: r, itemId: 995, amount: 999 }),
                burnResidentGold: async () => {
                    throw new Error('should not be called on replay');
                },
            },
            birth: { birthResident: async () => ({ resident: 'res:test', created: false, connected: false }) },
        });
        const replayed = await service2.exchangeApForGp('res:test', { idempotencyKey: 'exch-persist', apAmount: 25, gpAmount: 50 });
        expect(replayed.status).toBe('complete');
        expect(replayed.gpEvidence?.burnedAmount).toBe(50);
    });

    it('exchangeApForGp: rejects invalid resident name', async () => {
        await expect(service.exchangeApForGp('bad name!', { idempotencyKey: 'k', apAmount: 1, gpAmount: 1 })).rejects.toMatchObject({
            status: 400,
            code: 'invalid_payload',
        });
    });

    // ── soul proposal queue ──────────────────────────────────────────────────

    it('soul proposals: create, list, fund, approve, reject, and get through the service facade', async () => {
        const first = await service.createSoulProposal({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Earn 100 GP and write the route into the Library',
            binaryCompletionCondition: 'goal:gp-route-written',
            apThreshold: 100,
            proposerCityUserId: 'user:alice',
            proposerDisplayName: 'Alice',
        });
        const second = await service.createSoulProposal({
            residentName: 'res:second',
            soulMarkdown: soulMarkdown('res:second'),
            goalText: 'Learn the Lumbridge paths',
            apThreshold: 25,
            proposerCityUserId: 'user:bob',
        });

        expect(first).toMatchObject({
            residentName: 'res:test',
            status: 'proposed',
            apFunded: 0,
            apThreshold: 100,
            proposerCityUserId: 'user:alice',
            createdAt: '2026-05-27T12:00:00.000Z',
            updatedAt: '2026-05-27T12:00:00.000Z',
        });
        expect((await service.listSoulProposals()).map(proposal => proposal.id).sort()).toEqual([first.id, second.id].sort());

        const funding = await service.fundSoulProposal(first.id, { amount: 40, cityUserId: 'user:bob' });
        expect(funding).toMatchObject({ id: first.id, status: 'funding', apFunded: 40 });

        const threshold = await service.fundSoulProposal(first.id, { amount: 60, cityUserId: 'user:carol' });
        expect(threshold).toMatchObject({ id: first.id, status: 'threshold_crossed', apFunded: 100 });

        const approved = await service.approveSoulProposal(first.id, { adminNotes: 'Born for weekend testing' });
        expect(approved).toMatchObject({ id: first.id, status: 'approved', adminNotes: 'Born for weekend testing' });
        expect(await service.getSoulProposal(first.id)).toMatchObject({ id: first.id, status: 'approved' });

        const rejected = await service.rejectSoulProposal(second.id, { adminNotes: 'Duplicate idea' });
        expect(rejected).toMatchObject({ id: second.id, status: 'rejected', adminNotes: 'Duplicate idea' });
    });

    it('soul proposals: maps store errors to dashboard-safe HTTP-style errors', async () => {
        await expect(service.getSoulProposal('missing')).rejects.toMatchObject({ status: 404, code: 'proposal_not_found' });

        const proposal = await service.createSoulProposal({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Earn 100 GP',
            apThreshold: 100,
            proposerCityUserId: 'user:alice',
        });

        await expect(service.approveSoulProposal(proposal.id, {})).rejects.toMatchObject({
            status: 409,
            code: 'invalid_status_for_approve',
        });
    });

    it('soul proposals: rejects mismatched SOUL markdown before persisting', async () => {
        await expect(
            service.createSoulProposal({
                residentName: 'res:test',
                soulMarkdown: soulMarkdown('res:other'),
                goalText: 'Earn 100 GP',
                apThreshold: 100,
                proposerCityUserId: 'user:alice',
            }),
        ).rejects.toMatchObject({ status: 400, code: 'resident_name_mismatch' });

        expect(await service.listSoulProposals()).toEqual([]);
    });

    // ── birthFromProposal ─────────────────────────────────────────────────────

    it('birthFromProposal: rejects if proposal not found', async () => {
        await expect(service.birthFromProposal('no-such-id')).rejects.toMatchObject({
            status: 404,
            code: 'proposal_not_found',
        });
    });

    it('birthFromProposal: rejects if proposal status is proposed', async () => {
        const store = new SoulProposalStore(root);
        const proposal = store.create({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Make 100 GP/hour',
            apThreshold: 500,
            proposerCityUserId: 'user:alice',
        });
        await expect(service.birthFromProposal(proposal.id)).rejects.toMatchObject({
            status: 409,
            code: 'proposal_not_approved',
        });
        expect(birthCalls).toBe(0);
    });

    it('birthFromProposal: rejects if proposal status is threshold_crossed', async () => {
        const store = new SoulProposalStore(root);
        const proposal = store.create({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Make 100 GP/hour',
            apThreshold: 50,
            proposerCityUserId: 'user:alice',
        });
        store.fund(proposal.id, 100, 'user:alice');
        const funded = store.get(proposal.id)!;
        expect(funded.status).toBe('threshold_crossed');
        await expect(service.birthFromProposal(proposal.id)).rejects.toMatchObject({
            status: 409,
            code: 'proposal_not_approved',
        });
        expect(birthCalls).toBe(0);
    });

    it('birthFromProposal: rejects if proposal status is rejected', async () => {
        const store = new SoulProposalStore(root);
        const proposal = store.create({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Make 100 GP/hour',
            apThreshold: 500,
            proposerCityUserId: 'user:alice',
        });
        store.reject(proposal.id, 'out of scope');
        await expect(service.birthFromProposal(proposal.id)).rejects.toMatchObject({
            status: 409,
            code: 'proposal_not_approved',
        });
        expect(birthCalls).toBe(0);
    });

    it('birthFromProposal: births an approved proposal and transitions it to born', async () => {
        const store = new SoulProposalStore(root);
        const proposal = store.create({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Make 100 GP/hour',
            apThreshold: 50,
            proposerCityUserId: 'user:alice',
        });
        store.fund(proposal.id, 100, 'user:alice');
        store.approve(proposal.id);

        const result = await service.birthFromProposal(proposal.id);
        expect(result).toMatchObject({ ok: true, proposalId: proposal.id, resident: 'res:test' });
        expect(birthCalls).toBe(1);

        const after = store.get(proposal.id)!;
        expect(after.status).toBe('born');
        expect(after.bornAt).toBeDefined();
    });

    it('birthFromProposal: idempotent — calling twice births only once', async () => {
        const store = new SoulProposalStore(root);
        const proposal = store.create({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Make 100 GP/hour',
            apThreshold: 50,
            proposerCityUserId: 'user:alice',
        });
        store.fund(proposal.id, 100, 'user:alice');
        store.approve(proposal.id);

        const first = await service.birthFromProposal(proposal.id);
        const second = await service.birthFromProposal(proposal.id);

        expect(first).toMatchObject({ ok: true, resident: 'res:test' });
        expect(second).toMatchObject({ ok: true, resident: 'res:test' });
        expect(birthCalls).toBe(1);

        const after = store.get(proposal.id)!;
        expect(after.status).toBe('born');
    });

    it('birthFromProposal: emits city_birth Library event with proposalId and fundedAttention', async () => {
        const store = new SoulProposalStore(root);
        const proposal = store.create({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Make 100 GP/hour',
            apThreshold: 50,
            proposerCityUserId: 'user:alice',
        });
        store.fund(proposal.id, 75, 'user:alice');
        store.approve(proposal.id);

        await service.birthFromProposal(proposal.id);

        const timelinePath = path.join(root, 'library', 'res-test', 'timeline.jsonl');
        const events = fs
            .readFileSync(timelinePath, 'utf8')
            .trim()
            .split('\n')
            .map(l => JSON.parse(l) as Record<string, unknown>);
        const birthEvent = events.find(e => e['kind'] === 'city_birth');
        expect(birthEvent).toBeDefined();
        expect(birthEvent).toMatchObject({
            kind: 'city_birth',
            proposalId: proposal.id,
            fundedAttention: 75,
            significanceReasons: ['city:birth'],
        });
    });

    it('birthFromProposal: uses fundedAttention from proposal (apFunded)', async () => {
        const store = new SoulProposalStore(root);
        const proposal = store.create({
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Make 100 GP/hour',
            apThreshold: 50,
            proposerCityUserId: 'user:alice',
        });
        store.fund(proposal.id, 200, 'user:alice');
        store.approve(proposal.id);

        const result = await service.birthFromProposal(proposal.id);
        expect(result).toMatchObject({ fundedAttention: 200 });
    });

    describe('GoalContract methods (S9a)', () => {
        it('createGoalContract returns a goal with active status', () => {
            const goal = service.createGoalContract({
                residentName: 'res:test',
                goalText: 'Find a reliable way to make 100 GP/hour and write the strategy into the Library',
            });
            expect(goal.status).toBe('active');
            expect(goal.residentName).toBe('res:test');
            expect(goal.id).toBeTruthy();
        });

        it('createGoalContract rejects invalid input', () => {
            expect(() => service.createGoalContract({ residentName: 'not-valid', goalText: 'ok' })).toThrow();
        });

        it('listGoalContracts returns all stored goals', () => {
            service.createGoalContract({ residentName: 'res:test', goalText: 'Goal A' });
            service.createGoalContract({ residentName: 'res:test', goalText: 'Goal B' });
            const list = service.listGoalContracts();
            expect(list).toHaveLength(2);
        });

        it('getGoalContract returns the goal by id', () => {
            const created = service.createGoalContract({ residentName: 'res:test', goalText: 'Find 100 GP route' });
            const fetched = service.getGoalContract(created.id);
            expect(fetched.id).toBe(created.id);
            expect(fetched.goalText).toBe('Find 100 GP route');
        });

        it('getGoalContract throws 404 for unknown id', () => {
            expect(() => service.getGoalContract('does-not-exist')).toThrow();
        });

        it('markGoalAchieved updates goal status to achieved AND writes Library goal_achieved event', () => {
            const goal = service.createGoalContract({
                residentName: 'res:test',
                goalText: 'Make 100 GP/hour',
                completion: { condition: 'gp_hour >= 100', evidenceSource: 'runtime:bank-balance' },
            });

            const achieved = service.markGoalAchieved(goal.id, {
                evidence: 'runtime:bank-balance',
                tick: 42,
                apAtCompletion: 80,
                gpAtCompletion: 150,
            });

            expect(achieved.status).toBe('achieved');
            expect(achieved.achievedEvidence).toBe('runtime:bank-balance');

            // Library timeline must have a goal_achieved event.
            const libraryDir = path.join(root, 'library', 'res-test');
            const timeline = fs
                .readFileSync(path.join(libraryDir, 'timeline.jsonl'), 'utf8')
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((l: string) => JSON.parse(l) as Record<string, unknown>);
            const goalEvent = timeline.find((e: Record<string, unknown>) => e.kind === 'goal_achieved');
            expect(goalEvent).toBeDefined();
            expect(goalEvent?.goalId).toBe(goal.id);
            expect(goalEvent?.goalText).toBe('Make 100 GP/hour');
            expect(goalEvent?.evidence).toBe('runtime:bank-balance');
            expect(goalEvent?.apAtCompletion).toBe(80);
            expect(goalEvent?.gpAtCompletion).toBe(150);
            expect(goalEvent?.tick).toBe(42);
        });

        it('markGoalAchieved is idempotent: second call does not write a duplicate Library event', () => {
            const goal = service.createGoalContract({ residentName: 'res:test', goalText: 'Mine ore' });
            service.markGoalAchieved(goal.id, { evidence: 'runtime:bank-balance' });
            service.markGoalAchieved(goal.id, { evidence: 'runtime:bank-balance' });

            const libraryDir = path.join(root, 'library', 'res-test');
            const timeline = fs
                .readFileSync(path.join(libraryDir, 'timeline.jsonl'), 'utf8')
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((l: string) => JSON.parse(l) as Record<string, unknown>);
            const goalEvents = timeline.filter((e: Record<string, unknown>) => e.kind === 'goal_achieved');
            expect(goalEvents).toHaveLength(1);
        });

        it('markGoalAchieved throws on empty evidence', () => {
            const goal = service.createGoalContract({ residentName: 'res:test', goalText: 'Mine ore' });
            expect(() => service.markGoalAchieved(goal.id, { evidence: '   ' })).toThrow();
        });

        it('markGoalAchieved throws 404 for unknown goal id', () => {
            expect(() => service.markGoalAchieved('no-such-id', { evidence: 'ev' })).toThrow();
        });

        it('markGoalAchieved without optional AP/GP context still records goal_achieved', () => {
            const goal = service.createGoalContract({ residentName: 'res:test', goalText: 'Learn Lumbridge' });
            service.markGoalAchieved(goal.id, { evidence: 'library:strategy#1' });

            const libraryDir = path.join(root, 'library', 'res-test');
            const timeline = fs
                .readFileSync(path.join(libraryDir, 'timeline.jsonl'), 'utf8')
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((l: string) => JSON.parse(l) as Record<string, unknown>);
            const goalEvent = timeline.find((e: Record<string, unknown>) => e.kind === 'goal_achieved');
            expect(goalEvent?.apAtCompletion).toBeUndefined();
            expect(goalEvent?.gpAtCompletion).toBeUndefined();
        });
    });
});

function soulMarkdown(name: string): string {
    return [
        '---',
        `name: ${name}`,
        'archetype: endurer',
        'goals:',
        '  - learn the city',
        'attentionProfile:',
        '  startingAttention: 100',
        '  decayCurve: standard',
        '---',
        '',
        `# ${name}`,
        '',
        'Born from a city proposal.',
    ].join('\n');
}

function writeRuntimeState(memoryRoot: string, resident: string, attention: number): void {
    const runtimeState = {
        resident,
        attention,
        tick: 0,
        legacy: { kind: 'endurer', progress: {}, complete: false },
        budgets: {
            minuteStartedAt: '2026-05-27T00:00:00.000Z',
            dayStartedAt: '2026-05-27T00:00:00.000Z',
            requestsThisMinute: 0,
            requestsToday: 0,
        },
    } satisfies Partial<RuntimeState>;
    const filePath = path.join(memoryRoot, residentSlug(resident), 'runtime-state.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(runtimeState, null, 2)}\n`);
}
