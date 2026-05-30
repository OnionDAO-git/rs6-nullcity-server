import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { RuntimeState } from '../memory/runtime-state';
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
): Promise<{ status: number; payload: unknown; contentType?: string }> {
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
    let root: string;
    let runtime: FakeRuntime;
    let gold: number;
    let started: Awaited<ReturnType<typeof startCityIntegrationHttpServer>> | undefined;
    const token = 'city-secret';

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'city-http-'));
        runtime = new FakeRuntime();
        gold = 100;
    });

    afterEach(async () => {
        if (started) {
            await closeCityIntegrationHttpServer(started.server);
            started = undefined;
        }
        fs.rmSync(root, { recursive: true, force: true });
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
