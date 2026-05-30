import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { residentSlug, type RuntimeState } from '../memory/runtime-state';
import { closeCityIntegrationHttpServer, startCityIntegrationHttpServer } from './http-server';
import { type CityRuntime, CityIntegrationService } from './service';

class FakeRuntime implements CityRuntime {
    readonly state: RuntimeState = {
        resident: 'res:test',
        attention: 10,
        tick: 42,
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

    onEvent(): void {}
}

function requestJson(
    method: string,
    url: string,
    token: string,
    body?: unknown,
): Promise<{ status: number; payload: unknown; contentType?: string; cacheControl?: string }> {
    const target = new URL(url);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                method,
                hostname: target.hostname,
                port: Number(target.port),
                path: `${target.pathname}${target.search}`,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve({
                        status: res.statusCode ?? 0,
                        payload: text ? JSON.parse(text) : {},
                        contentType: res.headers['content-type'],
                        cacheControl: res.headers['cache-control'],
                    });
                });
            },
        );
        req.on('error', reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

describe('CityIntegration HTTP server', () => {
    let tempRoot: string;
    let root: string;
    let runtime: FakeRuntime;
    let gold: number;
    let started: Awaited<ReturnType<typeof startCityIntegrationHttpServer>> | undefined;
    const token = 'city-secret';

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'city-http-'));
        root = path.join(tempRoot, 'memory');
        fs.mkdirSync(root, { recursive: true });
        runtime = new FakeRuntime();
        gold = 100;
    });

    afterEach(async () => {
        if (started) {
            await closeCityIntegrationHttpServer(started.server);
            started = undefined;
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    function makeService(): CityIntegrationService {
        return new CityIntegrationService({
            memoryRoot: root,
            now: () => new Date('2026-05-27T12:00:00.000Z'),
            getRuntime: resident => (resident === 'res:test' ? runtime : undefined),
            inventory: {
                inspectResidentGold: async resident => ({ resident, itemId: 995, amount: gold }),
                burnResidentGold: async (resident, amount) => {
                    if (amount > gold) {
                        throw new Error('EINSUFFICIENT_GOLD');
                    }
                    gold -= amount;
                    return { resident, itemId: 995, burnedAmount: amount, remainingAmount: gold };
                },
            },
            birth: {
                birthResident: async input => ({ resident: input.residentName, created: true, connected: true }),
            },
        });
    }

    it('POST /attention-grants credits AP and returns before/after attention state (S11a)', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('POST', `${started.url}/residents/res%3Atest/attention-grants`, token, {
            idempotencyKey: 'topup-s11a',
            amount: 25,
            cityUserId: 'user:alice',
            sourceType: 'patron_topup',
        });

        expect(response.status).toBe(200);
        expect(response.contentType).toMatch(/application\/json/);
        expect(response.payload).toMatchObject({
            ok: true,
            resident: 'res:test',
            attentionBefore: 10,
            attentionAfter: 35,
            creditedAmount: 25,
        });
    });

    it('POST /admin/residents/:id/ap-drain drains AP and returns before/after (S-OBS-DRAIN-1)', async () => {
        runtime.state.attention = 22000;
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('POST', `${started.url}/admin/residents/res%3Atest/ap-drain`, token, {
            amount: 21995,
            reason: 'live-verify F3',
        });
        expect(response.status).toBe(200);
        expect(response.contentType).toMatch(/application\/json/);
        expect(response.payload).toMatchObject({
            ok: true,
            resident: 'res:test',
            attentionBefore: 22000,
            attentionAfter: 5,
            requestedDrain: 21995,
            actualDrain: 21995,
            reason: 'live-verify F3',
        });
        expect(runtime.state.attention).toBe(5);
    });

    it('POST /admin/residents/:id/ap-drain rejects GET method with 405', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('GET', `${started.url}/admin/residents/res%3Atest/ap-drain`, token);
        expect(response.status).toBe(405);
    });

    it('POST /admin/residents/:id/ap-drain returns 401 without operator bearer token', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('POST', `${started.url}/admin/residents/res%3Atest/ap-drain`, 'wrong-token', {
            amount: 5,
            reason: 'no auth',
        });
        expect(response.status).toBe(401);
        expect(runtime.state.attention).toBe(10);
    });

    it('GET /wealth returns real RuneScape coin item 995 state', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('GET', `${started.url}/residents/res%3Atest/wealth`, token);
        expect(response.status).toBe(200);
        expect(response.contentType).toMatch(/application\/json/);
        expect(response.payload).toEqual({ ok: true, resident: 'res:test', itemId: 995, amount: 100 });
    });

    it('POST /gold-burns returns 409 insufficient_gold without mutating inventory', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('POST', `${started.url}/residents/res%3Atest/gold-burns`, token, {
            idempotencyKey: 'burn-1',
            amount: 101,
            cityUserId: 'user-1',
            sourceType: 'city_trade',
            sourceId: 'trade-1',
        });

        expect(response.status).toBe(409);
        expect(response.payload).toEqual({
            ok: false,
            resident: 'res:test',
            itemId: 995,
            error: 'insufficient_gold',
            requestedAmount: 101,
        });
        expect(gold).toBe(100);
    });

    it('POST /ap-gp-exchanges burns real coin 995 and credits resident AP in one linked record', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('POST', `${started.url}/residents/res%3Atest/ap-gp-exchanges`, token, {
            idempotencyKey: 'exchange-http-1',
            apAmount: 50,
            gpAmount: 25,
            cityUserId: 'user:alice',
            sourceType: 'operator_exchange',
            sourceId: 'exchange-demo-1',
        });

        expect(response.status).toBe(200);
        expect(response.contentType).toMatch(/application\/json/);
        expect(response.payload).toMatchObject({
            exchangeId: 'apgp:res:test:exchange-http-1',
            resident: 'res:test',
            status: 'complete',
            apAmount: 50,
            gpAmount: 25,
            cityUserId: 'user:alice',
            sourceType: 'operator_exchange',
            sourceId: 'exchange-demo-1',
            apEvidence: {
                creditedAmount: 50,
                attentionBefore: 10,
                attentionAfter: 60,
            },
            gpEvidence: {
                itemId: 995,
                burnedAmount: 25,
                remainingAmount: 75,
            },
        });
        expect(gold).toBe(75);
        expect(runtime.state.attention).toBe(60);
    });

    it('POST /ap-gp-exchanges returns 409 when the resident lacks enough real coin 995', async () => {
        gold = 10;
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('POST', `${started.url}/residents/res%3Atest/ap-gp-exchanges`, token, {
            idempotencyKey: 'exchange-http-fail-gp',
            apAmount: 50,
            gpAmount: 25,
            cityUserId: 'user:alice',
        });

        expect(response.status).toBe(409);
        expect(response.payload).toMatchObject({
            exchangeId: 'apgp:res:test:exchange-http-fail-gp',
            resident: 'res:test',
            status: 'failed_gp',
            failureReason: 'insufficient_gold',
        });
        expect(response.payload).not.toHaveProperty('apEvidence');
        expect(response.payload).not.toHaveProperty('gpEvidence');
        expect(gold).toBe(10);
        expect(runtime.state.attention).toBe(10);
    });

    it('GET /economy/digest returns AP and GP service activity for dashboard/storyteller readers', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        await requestJson('POST', `${started.url}/residents/res%3Atest/attention-grants`, token, {
            idempotencyKey: 'topup-1',
            amount: 15,
            cityUserId: 'user-1',
            sourceType: 'patron_topup',
        });
        await requestJson('GET', `${started.url}/residents/res%3Atest/wealth`, token);
        await requestJson('POST', `${started.url}/residents/res%3Atest/gold-burns`, token, {
            idempotencyKey: 'burn-1',
            amount: 20,
            cityUserId: 'user-1',
            sourceType: 'city_trade',
        });

        const response = await requestJson('GET', `${started.url}/economy/digest`, token);

        expect(response.status).toBe(200);
        expect(response.payload).toMatchObject({
            schemaVersion: 1,
            totalEvents: 3,
            countsByKind: {
                ap_topup: 1,
                gp_observed: 1,
                gp_traded: 1,
            },
            apGrantedTotal: 15,
            gpTradedTotal: 20,
            residents: [{ residentName: 'res:test', apGranted: 15, gpTraded: 20, eventCount: 3 }],
        });
    });

    it('GET /economy/live|totals|events|residents|listings|heartbeat returns JSON economy read models', async () => {
        writeRuntimeState(root, 'res:peer', 40);
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        await requestJson('POST', `${started.url}/residents/res%3Atest/attention-grants`, token, {
            idempotencyKey: 'eco-live-topup',
            amount: 20,
            cityUserId: 'user:alice',
            note: 'Gift from user:alice via @alice',
        });
        await requestJson('POST', `${started.url}/residents/res%3Atest/gold-burns`, token, {
            idempotencyKey: 'eco-live-burn',
            amount: 10,
            cityUserId: 'user:alice',
        });
        await requestJson('POST', `${started.url}/proposals`, token, {
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Earn 100 GP',
            apThreshold: 100,
            proposerCityUserId: 'user:alice',
        });
        const createdNcri = await requestJson('POST', `${started.url}/ncri`, token, {
            itemId: 4151,
            displayName: 'Abyssal Whip of the City',
            lore: 'A champion relic.',
            owner: 'res:test',
        });
        expect(createdNcri.status).toBe(201);
        const ncriId = (createdNcri.payload as { id: string }).id;
        const approvedNcri = await requestJson('POST', `${started.url}/ncri/${ncriId}/approve`, token, {});
        expect(approvedNcri.status).toBe(200);
        // S-NCRI-1: must explicitly list the NCRI with pricing before it appears in marketplace.
        const listedNcri = await requestJson('POST', `${started.url}/ncri/${ncriId}/list`, token, {
            apPrice: 150,
            gpRedemptionCost: 500,
        });
        expect(listedNcri.status).toBe(200);
        const transferredNcri = await requestJson('POST', `${started.url}/ncri/${ncriId}/transfer`, token, {
            newOwner: 'user:buyer',
            reason: 'sale',
        });
        expect(transferredNcri.status).toBe(200);

        const live = await requestJson('GET', `${started.url}/economy/live?limit=5&residentLimit=3`, token);
        expect(live.status).toBe(200);
        expect(live.contentType).toMatch(/application\/json/);
        expect(live.cacheControl).toBe('max-age=2');
        expect(live.payload).toMatchObject({
            city: {
                residentCount: 2,
                activeResidentCount: 1,
                attentionTotal: 70,
                attentionDelta: 20,
                gpNetDelta: -10,
            },
            countsByKind: {
                ap_topup: 1,
                gp_traded: 1,
            },
        });
        const livePayload = live.payload as {
            recentEvents: Array<{ kind: string; cityUserId?: string; note?: string }>;
            pendingProposals: Array<{ residentName: string }>;
        };
        const topup = livePayload.recentEvents.find(event => event.kind === 'ap_topup');
        expect(topup?.cityUserId).toBe('<patron #1>');
        expect(topup?.note).not.toContain('user:alice');
        expect(topup?.note).not.toContain('@alice');
        expect(livePayload.pendingProposals).toEqual(expect.arrayContaining([expect.objectContaining({ residentName: 'res:test' })]));

        const totals = await requestJson('GET', `${started.url}/economy/totals`, token);
        expect(totals.status).toBe(200);
        expect(totals.payload).toMatchObject({
            city: {
                residentCount: 2,
                attentionTotal: 70,
            },
        });

        const events = await requestJson('GET', `${started.url}/economy/events?limit=1`, token);
        expect(events.status).toBe(200);
        expect((events.payload as { recentEvents: unknown[] }).recentEvents).toHaveLength(1);

        const residents = await requestJson('GET', `${started.url}/economy/residents`, token);
        expect(residents.status).toBe(200);
        expect((residents.payload as { residents: Array<{ residentName: string }> }).residents.map(r => r.residentName).sort()).toEqual([
            'res:peer',
            'res:test',
        ]);

        const listings = await requestJson('GET', `${started.url}/economy/listings`, token);
        expect(listings.status).toBe(200);
        expect(listings.payload).toMatchObject({
            listings: [
                {
                    ncriId,
                    owner: 'user:buyer',
                    sourceResidentName: 'res:test',
                    listed: true,
                    apPrice: 150,
                    gpRedemptionCost: 500,
                },
            ],
        });

        fs.rmSync(path.join(path.dirname(root), 'storyteller'), { recursive: true, force: true });

        const heartbeat = await requestJson('GET', `${started.url}/economy/heartbeat`, token);
        expect(heartbeat.status).toBe(200);
        expect(heartbeat.cacheControl).toBe('max-age=2');
        expect(heartbeat.payload).toMatchObject({
            residentCount: 2,
            activeResidentCount: 1,
            degradedFlags: ['storyteller_missing'],
            lastEconomyEventKind: 'ncri_sale',
        });
    });

    it('GET /storyteller/latest returns the newest digest/dispatch payload for dashboard bridges', async () => {
        const storytellerRoot = path.join(path.dirname(root), 'storyteller');
        const firstRunRoot = path.join(storytellerRoot, 'run-older');
        const secondRunRoot = path.join(storytellerRoot, 'run-latest');
        fs.mkdirSync(firstRunRoot, { recursive: true });
        fs.mkdirSync(secondRunRoot, { recursive: true });
        fs.writeFileSync(
            path.join(firstRunRoot, 'digest.json'),
            JSON.stringify({
                digestId: 'digest-older',
                builtAt: '2026-05-27T11:00:00.000Z',
                topEvents: [{ ref: 'old-1' }],
                residents: [{ residentName: 'res:test' }],
                summary: 'older digest',
            }),
        );
        fs.writeFileSync(
            path.join(secondRunRoot, 'digest.json'),
            JSON.stringify({
                digestId: 'digest-latest',
                builtAt: '2026-05-27T12:00:00.000Z',
                topEvents: [{ ref: 'new-1' }, { ref: 'new-2' }],
                residents: [{ residentName: 'res:test' }, { residentName: 'res:peer' }],
                summary: 'latest digest',
            }),
        );
        fs.writeFileSync(
            path.join(secondRunRoot, 'dispatch.json'),
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

        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('GET', `${started.url}/storyteller/latest`, token);
        expect(response.status).toBe(200);
        expect(response.payload).toMatchObject({
            ok: true,
            runId: 'run-latest',
            digestId: 'digest-latest',
            topEventCount: 2,
            residentCount: 2,
            summary: 'latest digest',
            dispatch: {
                dispatchId: 'dispatch-latest',
                modelProfile: 'haiku',
                needsReview: true,
                warningCount: 2,
                eventRefCount: 1,
            },
        });
    });

    it('GET /storyteller/canon and /storyteller/review return queue snapshots', async () => {
        const storytellerRoot = path.join(path.dirname(root), 'storyteller');
        const canonRoot = path.join(storytellerRoot, 'canon', 'run-canon');
        const canonOlderRoot = path.join(storytellerRoot, 'canon', 'run-canon-older');
        const reviewRoot = path.join(storytellerRoot, 'review', 'run-review');
        fs.mkdirSync(canonRoot, { recursive: true });
        fs.mkdirSync(canonOlderRoot, { recursive: true });
        fs.mkdirSync(reviewRoot, { recursive: true });

        fs.writeFileSync(
            path.join(canonRoot, 'digest.json'),
            JSON.stringify({
                digestId: 'digest-canon',
                builtAt: '2026-05-27T12:00:00.000Z',
                topEvents: [{ ref: 'canon-1' }],
                residents: [{ residentName: 'res:test' }],
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
            path.join(canonOlderRoot, 'digest.json'),
            JSON.stringify({
                digestId: 'digest-canon-older',
                builtAt: '2026-05-27T11:00:00.000Z',
                topEvents: [{ ref: 'canon-older-1' }],
                residents: [{ residentName: 'res:test' }],
            }),
        );
        fs.writeFileSync(
            path.join(canonOlderRoot, 'dispatch.json'),
            JSON.stringify({
                dispatchId: 'dispatch-canon-older',
                generatedAt: '2026-05-27T11:05:00.000Z',
                modelProfile: 'storyteller-v1',
                needsReview: false,
                operatorWarnings: [],
                reviewReasons: [],
                eventRefsUsed: ['canon-older-1'],
                publicBullets: ['older canon bullet'],
            }),
        );

        fs.writeFileSync(
            path.join(reviewRoot, 'digest.json'),
            JSON.stringify({
                digestId: 'digest-review',
                builtAt: '2026-05-27T13:00:00.000Z',
                topEvents: [{ ref: 'review-1' }],
                residents: [{ residentName: 'res:peer' }],
            }),
        );
        fs.writeFileSync(
            path.join(reviewRoot, 'dispatch.json'),
            JSON.stringify({
                dispatchId: 'dispatch-review',
                generatedAt: '2026-05-27T13:05:00.000Z',
                modelProfile: 'storyteller-v1',
                needsReview: true,
                operatorWarnings: ['warn'],
                reviewReasons: ['missing event ref'],
                eventRefsUsed: ['review-1'],
                publicBullets: ['review bullet'],
            }),
        );

        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const canon = await requestJson('GET', `${started.url}/storyteller/canon`, token);
        expect(canon.status).toBe(200);
        expect(canon.payload).toMatchObject({
            ok: true,
            queue: 'canon',
            count: 2,
        });
        expect((canon.payload as { entries?: unknown[] }).entries).toEqual(
            expect.arrayContaining([expect.objectContaining({ runId: 'run-canon', digestId: 'digest-canon' })]),
        );
        expect((canon.payload as { entries?: unknown[] }).entries).toHaveLength(2);

        const canonLimited = await requestJson('GET', `${started.url}/storyteller/canon?limit=1`, token);
        expect((canonLimited.payload as { entries?: unknown[] }).entries).toEqual(
            expect.arrayContaining([expect.objectContaining({ runId: 'run-canon', digestId: 'digest-canon' })]),
        );
        expect((canonLimited.payload as { entries?: unknown[] }).entries).toHaveLength(1);

        const canonInvalidLimit = await requestJson('GET', `${started.url}/storyteller/canon?limit=1junk`, token);
        expect((canonInvalidLimit.payload as { entries?: unknown[] }).entries).toHaveLength(2);

        const review = await requestJson('GET', `${started.url}/storyteller/review`, token);
        expect(review.status).toBe(200);
        expect(review.payload).toMatchObject({
            ok: true,
            queue: 'review',
            count: 1,
            entries: [{ runId: 'run-review', digestId: 'digest-review' }],
        });
    });

    it('exposes Soul proposal create/list/get/fund/approve/reject/birth routes for dashboard funding flows', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const created = await requestJson('POST', `${started.url}/proposals`, token, {
            residentName: 'res:test',
            soulMarkdown: soulMarkdown('res:test'),
            goalText: 'Earn 100 GP and write the route into the Library',
            binaryCompletionCondition: 'goal:gp-route-written',
            apThreshold: 100,
            proposerCityUserId: 'user:alice',
            proposerDisplayName: 'Alice',
        });
        expect(created.status).toBe(200);
        expect(created.payload).toMatchObject({
            residentName: 'res:test',
            status: 'proposed',
            apFunded: 0,
            apThreshold: 100,
        });
        const proposalId = (created.payload as { id: string }).id;

        const listed = await requestJson('GET', `${started.url}/proposals`, token);
        expect(listed.status).toBe(200);
        expect(listed.payload).toMatchObject([{ id: proposalId, residentName: 'res:test' }]);

        const funded = await requestJson('POST', `${started.url}/proposals/${proposalId}/fund`, token, {
            amount: 100,
            cityUserId: 'user:bob',
        });
        expect(funded.status).toBe(200);
        expect(funded.payload).toMatchObject({ id: proposalId, status: 'threshold_crossed', apFunded: 100 });

        const approved = await requestJson('POST', `${started.url}/proposals/${proposalId}/approve`, token, {
            adminNotes: 'Approved for birth queue smoke',
        });
        expect(approved.status).toBe(200);
        expect(approved.payload).toMatchObject({ id: proposalId, status: 'approved', adminNotes: 'Approved for birth queue smoke' });

        const born = await requestJson('POST', `${started.url}/proposals/${proposalId}/birth`, token);
        expect(born.status).toBe(200);
        expect(born.payload).toMatchObject({
            ok: true,
            proposalId,
            resident: 'res:test',
            fundedAttention: 100,
        });

        // Birth route should be idempotent for retry-safe dashboard operations.
        const bornAgain = await requestJson('POST', `${started.url}/proposals/${proposalId}/birth`, token);
        expect(bornAgain.status).toBe(200);
        expect(bornAgain.payload).toMatchObject({
            ok: true,
            proposalId,
            resident: 'res:test',
            fundedAttention: 100,
        });

        const fetched = await requestJson('GET', `${started.url}/proposals/${proposalId}`, token);
        expect(fetched.status).toBe(200);
        expect(fetched.payload).toMatchObject({ id: proposalId, status: 'born' });

        const rejectedCreate = await requestJson('POST', `${started.url}/proposals`, token, {
            residentName: 'res:spare',
            soulMarkdown: soulMarkdown('res:spare'),
            goalText: 'Find a quiet route',
            apThreshold: 10,
            proposerCityUserId: 'user:carol',
        });
        const rejectedId = (rejectedCreate.payload as { id: string }).id;
        const rejected = await requestJson('POST', `${started.url}/proposals/${rejectedId}/reject`, token, {
            adminNotes: 'duplicate',
        });
        expect(rejected.status).toBe(200);
        expect(rejected.payload).toMatchObject({ id: rejectedId, status: 'rejected', adminNotes: 'duplicate' });
    });

    it('returns 404 for an unknown Soul proposal', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });

        const response = await requestJson('GET', `${started.url}/proposals/no-such-id`, token);
        expect(response.status).toBe(404);
        expect(response.payload).toMatchObject({ error: 'proposal_not_found' });
    });

    it('NCRI routes: create → list → get → approve → transfer → redeem lifecycle', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });
        const base = started.url;

        // Create (admin)
        const created = await requestJson('POST', `${base}/ncri`, token, {
            itemId: 4151,
            displayName: 'Abyssal Whip of the City',
            lore: 'A legendary weapon inscribed with Null City lore.',
            owner: 'user:alice',
        });
        expect(created.status).toBe(201);
        expect(created.payload).toMatchObject({
            itemId: 4151,
            displayName: 'Abyssal Whip of the City',
            approvalStatus: 'pending',
            redemptionStatus: 'available',
            owner: 'user:alice',
        });
        expect(created.contentType).toContain('application/json');
        const ncriId = (created.payload as { id: string }).id;

        // List
        const list = await requestJson('GET', `${base}/ncri`, token);
        expect(list.status).toBe(200);
        expect(Array.isArray(list.payload)).toBe(true);
        expect((list.payload as { id: string }[]).some(r => r.id === ncriId)).toBe(true);

        // Get by id
        const got = await requestJson('GET', `${base}/ncri/${ncriId}`, token);
        expect(got.status).toBe(200);
        expect(got.payload).toMatchObject({ id: ncriId, approvalStatus: 'pending' });

        // 404 for unknown
        const missing = await requestJson('GET', `${base}/ncri/no-such-id`, token);
        expect(missing.status).toBe(404);
        expect(missing.payload).toMatchObject({ error: 'ncri_not_found' });

        // Approve
        const approved = await requestJson('POST', `${base}/ncri/${ncriId}/approve`, token, {
            adminNotes: 'Approved for June 1 event.',
        });
        expect(approved.status).toBe(200);
        expect(approved.payload).toMatchObject({ id: ncriId, approvalStatus: 'approved' });

        // Transfer ownership
        const transferred = await requestJson('POST', `${base}/ncri/${ncriId}/transfer`, token, {
            newOwner: 'user:bob',
        });
        expect(transferred.status).toBe(200);
        expect(transferred.payload).toMatchObject({ id: ncriId, owner: 'user:bob' });

        // Transfer on unapproved NCRI returns 409
        const pending = await requestJson('POST', `${base}/ncri`, token, {
            itemId: 995,
            displayName: 'Gold Coins',
            lore: 'Standard RS gold.',
            owner: 'user:alice',
        });
        const pendingId = (pending.payload as { id: string }).id;
        const badTransfer = await requestJson('POST', `${base}/ncri/${pendingId}/transfer`, token, { newOwner: 'user:bob' });
        expect(badTransfer.status).toBe(409);

        // Redeem
        const redeemed = await requestJson('POST', `${base}/ncri/${ncriId}/redeem`, token);
        expect(redeemed.status).toBe(200);
        expect(redeemed.payload).toMatchObject({ id: ncriId, redemptionStatus: 'redeemed' });

        // Idempotent redeem returns same record
        const redeemedAgain = await requestJson('POST', `${base}/ncri/${ncriId}/redeem`, token);
        expect(redeemedAgain.status).toBe(200);
        expect(redeemedAgain.payload).toMatchObject({ id: ncriId, redemptionStatus: 'redeemed' });
    });

    it('NCRI list/delist routes (S-NCRI-1): approve → list-for-sale → marketplace → delist', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });
        const base = started.url;

        // Create and approve
        const created = await requestJson('POST', `${base}/ncri`, token, {
            itemId: 590,
            displayName: 'Tinderbox of the Flame',
            lore: 'Null City fire starter.',
            owner: 'res:test',
        });
        expect(created.status).toBe(201);
        const ncriId = (created.payload as { id: string }).id;

        await requestJson('POST', `${base}/ncri/${ncriId}/approve`, token, {});

        // List for sale with pricing
        const listed = await requestJson('POST', `${base}/ncri/${ncriId}/list`, token, {
            apPrice: 150,
            gpRedemptionCost: 500,
        });
        expect(listed.status).toBe(200);
        expect(listed.payload).toMatchObject({
            record: expect.objectContaining({ id: ncriId, saleStatus: 'listed' }),
            pricing: expect.objectContaining({ apPrice: 150, gpRedemptionCost: 500 }),
        });

        // Economy listings now shows the NCRI with pricing
        const listings = await requestJson('GET', `${base}/economy/listings`, token);
        expect(listings.status).toBe(200);
        const items = (listings.payload as { listings: { ncriId: string; apPrice?: number }[] }).listings;
        const found = items.find(l => l.ncriId === ncriId);
        expect(found).toBeDefined();
        expect(found?.apPrice).toBe(150);

        // Delist removes it from marketplace
        const delisted = await requestJson('POST', `${base}/ncri/${ncriId}/delist`, token);
        expect(delisted.status).toBe(200);
        expect(delisted.payload).toMatchObject({ id: ncriId, saleStatus: 'delisted' });

        const listingsAfter = await requestJson('GET', `${base}/economy/listings`, token);
        const itemsAfter = (listingsAfter.payload as { listings: { ncriId: string }[] }).listings;
        expect(itemsAfter.find(l => l.ncriId === ncriId)).toBeUndefined();
    });

    it('NCRI list rejects unapproved NCRI with 409', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });
        const base = started.url;

        const created = await requestJson('POST', `${base}/ncri`, token, {
            itemId: 4151,
            displayName: 'Whip',
            lore: 'Rare.',
            owner: 'res:test',
        });
        const ncriId = (created.payload as { id: string }).id;

        const result = await requestJson('POST', `${base}/ncri/${ncriId}/list`, token, {
            apPrice: 100,
            gpRedemptionCost: 200,
        });
        expect(result.status).toBe(409);
    });

    it('NCRI buy route (S-NCRI-2): list-for-sale → buy (idempotent) → removed from marketplace', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });
        const base = started.url;

        const created = await requestJson('POST', `${base}/ncri`, token, {
            itemId: 590,
            displayName: 'Tinderbox of the Flame',
            lore: 'Null City fire starter.',
            owner: 'res:test',
        });
        expect(created.status).toBe(201);
        const ncriId = (created.payload as { id: string }).id;
        await requestJson('POST', `${base}/ncri/${ncriId}/approve`, token, {});
        await requestJson('POST', `${base}/ncri/${ncriId}/list`, token, {
            apPrice: 150,
            gpRedemptionCost: 500,
        });

        const bought = await requestJson('POST', `${base}/ncri/${ncriId}/buy`, token, {
            idempotencyKey: 'buy-http-1',
            cityUserId: 'city-user:alice',
            apPrice: 150,
            sourceId: 'order-http-1',
        });
        expect(bought.status).toBe(200);
        expect(bought.payload).toMatchObject({
            ok: true,
            ncriId,
            buyerCityUserId: 'city-user:alice',
            apPrice: 150,
            gpRedemptionCost: 500,
            sourceId: 'order-http-1',
            record: expect.objectContaining({ id: ncriId, owner: 'city-user:alice', saleStatus: 'sold' }),
        });

        const replay = await requestJson('POST', `${base}/ncri/${ncriId}/buy`, token, {
            idempotencyKey: 'buy-http-1',
            cityUserId: 'city-user:alice',
            apPrice: 150,
            sourceId: 'order-http-1',
        });
        expect(replay.status).toBe(200);
        expect(replay.payload).toMatchObject({ ok: true, ncriId, idempotent: true });

        const listings = await requestJson('GET', `${base}/economy/listings`, token);
        const items = (listings.payload as { listings: { ncriId: string }[] }).listings;
        expect(items.find(item => item.ncriId === ncriId)).toBeUndefined();
    });

    it('GoalContract routes (S9a): create → list → get → achieve lifecycle', async () => {
        started = await startCityIntegrationHttpServer({
            service: makeService(),
            port: 0,
            bearerToken: token,
        });
        const base = started.url;

        // Create
        const created = await requestJson('POST', `${base}/goals`, token, {
            residentName: 'res:test',
            goalText: 'Find a reliable way to make 100 GP/hour and write the strategy into the Library',
            completion: { condition: 'gp_hour >= 100', evidenceSource: 'runtime:bank-balance' },
        });
        expect(created.status).toBe(201);
        expect(created.contentType).toMatch(/application\/json/);
        expect(created.payload).toMatchObject({ status: 'active', residentName: 'res:test' });
        const goalId = (created.payload as { id: string }).id;

        // List
        const list = await requestJson('GET', `${base}/goals`, token);
        expect(list.status).toBe(200);
        expect((list.payload as { id: string }[]).some(g => g.id === goalId)).toBe(true);

        // Get
        const got = await requestJson('GET', `${base}/goals/${goalId}`, token);
        expect(got.status).toBe(200);
        expect(got.payload).toMatchObject({ id: goalId, status: 'active' });

        // Get unknown → 404
        const missing = await requestJson('GET', `${base}/goals/no-such-id`, token);
        expect(missing.status).toBe(404);
        expect(missing.payload).toMatchObject({ error: 'not_found' });

        // Achieve
        const achieved = await requestJson('POST', `${base}/goals/${goalId}/achieve`, token, {
            evidence: 'runtime:bank-balance',
            tick: 50,
            apAtCompletion: 75,
            gpAtCompletion: 120,
        });
        expect(achieved.status).toBe(200);
        expect(achieved.payload).toMatchObject({ id: goalId, status: 'achieved' });

        // Idempotent achieve: second call still returns 200 with achieved status
        const achievedAgain = await requestJson('POST', `${base}/goals/${goalId}/achieve`, token, {
            evidence: 'runtime:bank-balance',
        });
        expect(achievedAgain.status).toBe(200);
        expect(achievedAgain.payload).toMatchObject({ id: goalId, status: 'achieved' });
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
        'Born from a Soul proposal.',
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
