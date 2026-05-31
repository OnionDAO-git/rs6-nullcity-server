import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { LettersStore } from '../patron/letters-store';
import { PatronStore } from '../patron/patron-store';
import { closeLettersHttpServer, type LettersHttpAuthOptions, startLettersHttpServer } from './letters-http-server';

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; contentType?: string }> {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { headers }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () =>
                resolve({
                    status: response.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString('utf8'),
                    contentType: response.headers['content-type'],
                }),
            );
        });
        request.on('error', reject);
        request.end();
    });
}

function getOrTimeout(
    url: string,
    timeoutMs: number,
): Promise<{ timedOut: true } | { timedOut: false; status: number; body: string; contentType?: string }> {
    return new Promise(resolve => {
        let settled = false;
        const request = http.get(url, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve({
                    timedOut: false,
                    status: response.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString('utf8'),
                    contentType: response.headers['content-type'],
                });
            });
        });
        request.on('error', () => {
            // A destroyed request after the client-side timeout is expected.
        });
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            request.destroy();
            resolve({ timedOut: true });
        }, timeoutMs);
        request.end();
    });
}

describe('letters HTTP server (EVENT-D2a)', () => {
    let tmp: string;
    let store: LettersStore;
    let server: Awaited<ReturnType<typeof startLettersHttpServer>> | undefined;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'letters-http-'));
        store = new LettersStore(tmp);
    });

    afterEach(async () => {
        if (server) {
            await closeLettersHttpServer(server.server);
            server = undefined;
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function seedLetter(recipient: string, subject: string, dispatchedAt: string): void {
        store.append({
            kind: 'standing_tier_crossed',
            recipient,
            senderResident: 'res:fern',
            subject,
            body: `Body for ${recipient}: ${subject}`,
            dispatchedAt,
            deliveryChannels: ['web-inbox'],
        });
    }

    describe('GET /v1/inbox', () => {
        it('returns the inbox for the human as JSON', async () => {
            seedLetter('alice@onion', 'Welcome', '2026-05-23T13:00:00.000Z');
            seedLetter('alice@onion', 'You are now Ally', '2026-05-23T13:30:00.000Z');
            server = await startLettersHttpServer({ store, port: 0 });

            const response = await get(`${server.url}?human=alice@onion`);

            expect(response.status).toBe(200);
            expect(response.contentType).toMatch(/application\/json/);
            const payload = JSON.parse(response.body) as { letters: unknown[] };
            expect(Array.isArray(payload.letters)).toBe(true);
            expect(payload.letters).toHaveLength(2);
        });

        it('returns an empty letters array when the human has no inbox file', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(`${server.url}?human=stranger@onion`);
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { letters: unknown[] };
            expect(payload.letters).toEqual([]);
        });

        it('treats recipient slug case-insensitively (alice@Onion === alice@onion)', async () => {
            seedLetter('alice@onion', 'Mixed-case test', '2026-05-23T13:00:00.000Z');
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(`${server.url}?human=Alice%40ONION`);
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { letters: { subject: string }[] };
            expect(payload.letters[0]?.subject).toBe('Mixed-case test');
        });

        it('returns 400 when ?human is missing', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(server.url);
            expect(response.status).toBe(400);
            const payload = JSON.parse(response.body) as { error: string };
            expect(payload.error).toMatch(/human/i);
        });

        it('returns 400 when ?human is empty', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(`${server.url}?human=`);
            expect(response.status).toBe(400);
        });

        it('returns 404 for any other path', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(`${server.url.replace('/v1/inbox', '/v1/something-else')}?human=alice@onion`);
            expect(response.status).toBe(404);
        });

        it('returns 405 for non-GET methods', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await new Promise<{ status: number }>((resolve, reject) => {
                const req = http.request(server!.url, { method: 'POST' }, res => {
                    res.on('data', () => undefined);
                    res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
                });
                req.on('error', reject);
                req.end();
            });
            expect(response.status).toBe(405);
        });

        it('listens on the requested port + path; url field reports the bound address', async () => {
            server = await startLettersHttpServer({ store, port: 0, path: '/v1/inbox' });
            expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/inbox$/);
        });
    });

    describe('bearer-token auth (optional)', () => {
        const auth: LettersHttpAuthOptions = { bearerToken: 'secret-123' };

        it('returns 401 when no Authorization header is sent and auth is configured', async () => {
            server = await startLettersHttpServer({ store, port: 0, auth });
            const response = await get(`${server.url}?human=alice@onion`);
            expect(response.status).toBe(401);
        });

        it('returns 401 when the bearer token is wrong', async () => {
            server = await startLettersHttpServer({ store, port: 0, auth });
            const response = await get(`${server.url}?human=alice@onion`, { Authorization: 'Bearer wrong-token' });
            expect(response.status).toBe(401);
        });

        it('returns 200 when the bearer token matches', async () => {
            seedLetter('alice@onion', 'authed', '2026-05-23T13:00:00.000Z');
            server = await startLettersHttpServer({ store, port: 0, auth });
            const response = await get(`${server.url}?human=alice@onion`, { Authorization: 'Bearer secret-123' });
            expect(response.status).toBe(200);
        });

        it('accepts no auth when none configured (default open for local-network use)', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(`${server.url}?human=alice@onion`);
            expect(response.status).toBe(200);
        });
    });

    describe('letter shape', () => {
        it('returns letters with the full Letter shape preserved', async () => {
            seedLetter('alice@onion', 'Shape test', '2026-05-23T13:00:00.000Z');
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(`${server.url}?human=alice@onion`);
            const payload = JSON.parse(response.body) as { letters: Array<Record<string, unknown>> };
            const letter = payload.letters[0];
            expect(letter).toMatchObject({
                kind: 'standing_tier_crossed',
                recipient: 'alice@onion',
                senderResident: 'res:fern',
                subject: 'Shape test',
                body: expect.stringContaining('alice@onion'),
                dispatchedAt: '2026-05-23T13:00:00.000Z',
                deliveryChannels: ['web-inbox'],
            });
        });
    });

    describe('GET /v1/wall/snapshot (EVENT-D6)', () => {
        it('returns 404 when lettersRoot is not configured (wall disabled)', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const wallUrl = server.url.replace('/v1/inbox', '/v1/wall/snapshot');
            const response = await get(wallUrl);
            expect(response.status).toBe(404);
        });

        it('returns a snapshot JSON when lettersRoot is configured', async () => {
            seedLetter('alice@onion', 'Welcome', '2026-05-23T15:00:00.000Z');
            seedLetter('bob@onion', 'You are now Ally', '2026-05-23T15:30:00.000Z');
            server = await startLettersHttpServer({
                store,
                port: 0,
                lettersRoot: tmp,
                now: () => new Date('2026-05-23T16:00:00.000Z'),
            });
            const wallUrl = server.url.replace('/v1/inbox', '/v1/wall/snapshot');
            const response = await get(wallUrl);
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { recentLetters: unknown[]; deathsToday: number; asOf: string };
            expect(payload.recentLetters).toHaveLength(2);
            expect(payload.deathsToday).toBe(0);
            expect(payload.asOf).toBe('2026-05-23T16:00:00.000Z');
        });

        it('redacts recipients and clears bodies when wallRedact is enabled (HD-013)', async () => {
            // HD-013 / E13. The wall ticker is a public projection at
            // Chicago — passers-by must not see other patrons' full
            // handles or letter bodies. wallRedact passes the snapshot
            // through redactWallSnapshot before returning. The per-patron
            // /v1/inbox?human=... endpoint stays full-fidelity for the
            // patron's own consumption.
            seedLetter('alice@onion', 'Welcome', '2026-05-23T15:00:00.000Z');
            seedLetter('claude-sprint-patron', 'You are now Ally', '2026-05-23T15:30:00.000Z');
            server = await startLettersHttpServer({
                store,
                port: 0,
                lettersRoot: tmp,
                wallRedact: true,
                now: () => new Date('2026-05-23T16:00:00.000Z'),
            });
            const wallUrl = server.url.replace('/v1/inbox', '/v1/wall/snapshot');
            const response = await get(wallUrl);
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { recentLetters: Array<{ recipient: string; body: string; subject: string }> };
            expect(payload.recentLetters).toHaveLength(2);
            // Subjects are preserved (short, already-public).
            // Newest first → claude-sprint-patron's letter.
            expect(payload.recentLetters[0].subject).toBe('You are now Ally');
            // Recipients masked.
            expect(payload.recentLetters[0].recipient).toBe('c***-patron');
            expect(payload.recentLetters[1].recipient).toBe('a***@onion');
            // Bodies cleared.
            for (const letter of payload.recentLetters) {
                expect(letter.body).toBe('');
            }
        });

        it('returns full bodies + recipients when wallRedact is not set (default behavior preserved)', async () => {
            seedLetter('alice@onion', 'Welcome', '2026-05-23T15:00:00.000Z');
            server = await startLettersHttpServer({
                store,
                port: 0,
                lettersRoot: tmp,
                now: () => new Date('2026-05-23T16:00:00.000Z'),
            });
            const wallUrl = server.url.replace('/v1/inbox', '/v1/wall/snapshot');
            const response = await get(wallUrl);
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { recentLetters: Array<{ recipient: string; body: string }> };
            expect(payload.recentLetters[0].recipient).toBe('alice@onion');
            expect(payload.recentLetters[0].body).toContain('Body for alice@onion');
        });

        it('honors auth on the wall route the same way as the inbox route', async () => {
            server = await startLettersHttpServer({
                store,
                port: 0,
                lettersRoot: tmp,
                auth: { bearerToken: 'wall-secret' },
            });
            const wallUrl = server.url.replace('/v1/inbox', '/v1/wall/snapshot');
            const unauthed = await get(wallUrl);
            expect(unauthed.status).toBe(401);
            const authed = await get(wallUrl, { Authorization: 'Bearer wall-secret' });
            expect(authed.status).toBe(200);
        });

        it('can limit the wall roster to configured residents', async () => {
            writeRuntimeState(tmp, 'res-agent', { attention: 9000 });
            writeRuntimeState(tmp, 'res-hans', { attention: 8000 });
            writeRuntimeState(tmp, 'res-bmk-fire-5m-002e9qp0', { attention: 5000 });
            server = await startLettersHttpServer({
                store,
                port: 0,
                lettersRoot: tmp,
                residentIds: ['res:agent', 'res:hans'],
                now: () => new Date('2026-05-23T16:00:00.000Z'),
            });

            const response = await get(server.url.replace('/v1/inbox', '/v1/wall/snapshot'));

            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { residents: Array<{ slug: string }> };
            expect(payload.residents.map(r => r.slug)).toEqual(['res-agent', 'res-hans']);
        });

        it('uses SOUL goals for wall roster residents that have not planned a runtime goal yet', async () => {
            const soulsDir = path.join(tmp, 'souls');
            writeRuntimeState(tmp, 'res-hans', { attention: 8000 });
            writeSoul(soulsDir, 'res-hans.md', {
                name: 'res:hans',
                display: 'Hans',
                archetype: 'endurer',
                goals: ['greet every visible human at least once per day'],
            });
            server = await startLettersHttpServer({
                store,
                port: 0,
                lettersRoot: tmp,
                residentIds: ['res:hans'],
                soulsDir,
                now: () => new Date('2026-05-23T16:00:00.000Z'),
            });

            const response = await get(server.url.replace('/v1/inbox', '/v1/wall/snapshot'));

            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { residents: Array<{ activeGoal?: string }> };
            expect(payload.residents[0].activeGoal).toBe('greet every visible human at least once per day');
        });
    });

    describe('public-surface filters (PRE-MERGE-POLISH)', () => {
        it('GET /v1/wall/snapshot drops res-qa-* residents from the public roster', async () => {
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            writeRuntimeState(tmp, 'res-hans', { attention: 1000 });
            writeRuntimeState(tmp, 'res-qa-cook', { attention: 800 });
            writeRuntimeState(tmp, 'res-bmk_fire_5m_xxx', { attention: 5 });

            const response = await get(server.url.replace('/v1/inbox', '/v1/wall/snapshot'));

            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body);
            const slugs = (payload.residents as Array<{ slug: string }>).map(r => r.slug);
            expect(slugs).toEqual(['res-hans']);
        });

        it('GET /v1/wall/snapshot dedupes recentLetters by subject', async () => {
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            for (let i = 0; i < 4; i += 1) {
                store.append({
                    kind: 'epitaph',
                    recipient: `witness-${i}@onion`,
                    senderResident: 'res:hans',
                    subject: 'On the passing of res:hans',
                    body: 'body text',
                    dispatchedAt: `2026-05-26T10:0${i}:00.000Z`,
                    deliveryChannels: ['web-inbox'],
                });
            }
            store.append({
                kind: 'civic_milestone',
                recipient: 'alice@onion',
                senderResident: 'res:hans',
                subject: "Mortician's Ribbon — res:hans",
                body: 'body text',
                dispatchedAt: '2026-05-26T11:00:00.000Z',
                deliveryChannels: ['web-inbox'],
            });

            const response = await get(server.url.replace('/v1/inbox', '/v1/wall/snapshot'));

            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body);
            const subjects = (payload.recentLetters as Array<{ subject: string }>).map(l => l.subject);
            // Five letters submitted but only TWO distinct subjects survive.
            expect(subjects).toHaveLength(2);
            expect(new Set(subjects).size).toBe(2);
        });

        it('GET /v1/library drops res-qa-* portraits from the public list', async () => {
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            writePortraitJson(tmp, 'res-hans', {
                residentName: 'res:hans',
                currentState: 'living',
                livesCount: 1,
                lastUpdated: { ts: '2026-05-26T12:00:00.000Z' },
                voice: { quotes: [{ text: 'A good day in the courtyard, friend.', tag: 'first' }] },
                patrons: [],
                wants: { current: [] },
            });
            writePortraitJson(tmp, 'res-qa-cook', {
                residentName: 'res:qa-cook',
                currentState: 'living',
                livesCount: 1,
                lastUpdated: { ts: '2026-05-26T12:00:00.000Z' },
                voice: { quotes: [] },
                patrons: [],
                wants: { current: [] },
            });

            const response = await get(server.url.replace('/v1/inbox', '/v1/library'));

            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body);
            const slugs = (payload.residents as Array<{ slug: string }>).map(r => r.slug);
            expect(slugs).toEqual(['res-hans']);
        });
    });

    describe('GET /v1/health (O4)', () => {
        it('returns 404 when no health probe is configured', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(server.url.replace('/v1/inbox', '/v1/health'));
            expect(response.status).toBe(404);
        });

        it('runs the configured health probe and returns 200 when inference is usable', async () => {
            const health = jest.fn(async () => ({
                ok: true,
                status: 'ok' as const,
                endpoint: 'default',
                latencyMs: 42,
            }));
            server = await startLettersHttpServer({ store, port: 0, health });
            const healthUrl = server.url.replace('/v1/inbox', '/v1/health');

            const response = await get(healthUrl);

            expect(response.status).toBe(200);
            expect(health).toHaveBeenCalledTimes(1);
            expect(JSON.parse(response.body)).toMatchObject({
                ok: true,
                controller: 'ok',
                inference: { ok: true, status: 'ok', endpoint: 'default', latencyMs: 42 },
            });
        });

        it('returns 503 when the health probe reports an inference failure', async () => {
            server = await startLettersHttpServer({
                store,
                port: 0,
                health: async () => ({
                    ok: false,
                    status: 'empty_completion',
                    endpoint: 'default',
                    latencyMs: 60_000,
                }),
            });

            const response = await get(server.url.replace('/v1/inbox', '/v1/health'));

            expect(response.status).toBe(503);
            expect(JSON.parse(response.body)).toMatchObject({
                ok: false,
                controller: 'ok',
                inference: { ok: false, status: 'empty_completion', endpoint: 'default' },
            });
        });

        it('returns 503 when the health probe throws', async () => {
            server = await startLettersHttpServer({
                store,
                port: 0,
                health: async () => {
                    throw new Error('probe exploded');
                },
            });

            const response = await get(server.url.replace('/v1/inbox', '/v1/health'));

            expect(response.status).toBe(503);
            expect(JSON.parse(response.body)).toMatchObject({
                ok: false,
                controller: 'ok',
                inference: { ok: false, status: 'error', error: 'probe exploded' },
            });
        });

        it('returns quickly when the health probe never settles', async () => {
            server = await startLettersHttpServer({
                store,
                port: 0,
                healthTimeoutMs: 15,
                health: async () => new Promise(() => undefined),
            });

            const response = await getOrTimeout(server.url.replace('/v1/inbox', '/v1/health'), 100);

            expect(response).toMatchObject({ timedOut: false, status: 503 });
            if (response.timedOut) {
                throw new Error('health route did not respond before the client timeout');
            }
            expect(JSON.parse(response.body)).toMatchObject({
                ok: false,
                controller: 'ok',
                inference: {
                    ok: false,
                    status: 'health_timeout',
                    endpoint: 'letters-http',
                    error: 'health probe timed out after 15ms',
                },
            });
        });

        it('applies bearer-token auth to health checks', async () => {
            server = await startLettersHttpServer({
                store,
                port: 0,
                auth: { bearerToken: 'health-secret' },
                health: async () => ({ ok: true, status: 'ok', endpoint: 'default' }),
            });
            const healthUrl = server.url.replace('/v1/inbox', '/v1/health');

            const unauthed = await get(healthUrl);
            const authed = await get(healthUrl, { Authorization: 'Bearer health-secret' });

            expect(unauthed.status).toBe(401);
            expect(authed.status).toBe(200);
        });
    });

    describe('GET /v1/patron/balance (HD-016 C)', () => {
        it('returns 404 when patronMemoryRoot is not configured', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/balance') + '?human=alice@onion');
            expect(response.status).toBe(404);
        });

        it('returns 400 when human param is missing', async () => {
            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/balance'));
            expect(response.status).toBe(400);
            expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringContaining('human') });
        });

        it('returns zero balance for a human with no ledger entry', async () => {
            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/balance') + '?human=stranger@onion');
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { human: string; balance: number; currency: string };
            expect(payload).toMatchObject({ human: 'stranger@onion', balance: 0, currency: 'AP' });
        });

        it('returns the correct balance after granting AP', async () => {
            const patronStore = new PatronStore(tmp);
            const ledger = patronStore.loadCurrency();
            ledger.credit('alice@onion', 42, { reason: 'test-grant' });
            patronStore.saveCurrency(ledger);

            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/balance') + '?human=alice@onion');
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { human: string; balance: number; currency: string };
            expect(payload).toMatchObject({ human: 'alice@onion', balance: 42, currency: 'AP' });
        });
    });

    describe('GET /v1/patron/standing (HD-016 D)', () => {
        it('returns 404 when patronMemoryRoot is not configured', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/standing') + '?human=alice@onion');
            expect(response.status).toBe(404);
        });

        it('returns 400 when human param is missing', async () => {
            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/standing'));
            expect(response.status).toBe(400);
        });

        it('returns tier null and acquaintance as nextTier for a human with no standing', async () => {
            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/standing') + '?human=stranger@onion');
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as {
                human: string;
                faction: string;
                points: number;
                tier: string | null;
                tierMin: number;
                nextTier: string | null;
                pointsToNext: number | null;
            };
            expect(payload).toMatchObject({
                human: 'stranger@onion',
                faction: 'embassy',
                points: 0,
                tier: null,
                tierMin: 0,
                nextTier: 'acquaintance',
                pointsToNext: 10,
            });
        });

        it('returns correct tier, tierMin, and nextTier for an acquaintance (10 pts)', async () => {
            const patronStore = new PatronStore(tmp);
            const ledger = patronStore.loadStanding();
            ledger.recordSupport('alice@onion', 'embassy', 10, { reason: 'test-support' });
            patronStore.saveStanding(ledger);

            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/standing') + '?human=alice@onion');
            const payload = JSON.parse(response.body) as {
                points: number;
                tier: string | null;
                tierMin: number;
                nextTier: string | null;
                pointsToNext: number | null;
            };
            expect(payload).toMatchObject({ points: 10, tier: 'acquaintance', tierMin: 10, nextTier: 'ally', pointsToNext: 20 });
        });

        it('returns tierMin for acquaintance when patron is mid-tier (15 pts)', async () => {
            const patronStore = new PatronStore(tmp);
            const ledger = patronStore.loadStanding();
            ledger.recordSupport('alice@onion', 'embassy', 15, { reason: 'test-support' });
            patronStore.saveStanding(ledger);

            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/standing') + '?human=alice@onion');
            const payload = JSON.parse(response.body) as { points: number; tierMin: number; pointsToNext: number | null };
            // tierMin = 10 (acquaintance threshold); pointsToNext = 30 - 15 = 15
            // correct progress = (15 - 10) / (30 - 10) = 25%  (NOT 0% as the old code produced)
            expect(payload).toMatchObject({ points: 15, tierMin: 10, pointsToNext: 15 });
        });

        it('returns nextTier null and pointsToNext null for an officer (max tier)', async () => {
            const patronStore = new PatronStore(tmp);
            const ledger = patronStore.loadStanding();
            ledger.recordSupport('alice@onion', 'embassy', 75, { reason: 'test-support' });
            patronStore.saveStanding(ledger);

            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/standing') + '?human=alice@onion');
            const payload = JSON.parse(response.body) as {
                tier: string | null;
                tierMin: number;
                nextTier: string | null;
                pointsToNext: number | null;
            };
            expect(payload).toMatchObject({ tier: 'officer', tierMin: 75, nextTier: null, pointsToNext: null });
        });

        it('defaults to embassy faction when no faction param supplied', async () => {
            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/standing') + '?human=alice@onion');
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { faction: string };
            expect(payload.faction).toBe('embassy');
        });

        it('respects an explicit faction query param', async () => {
            const patronStore = new PatronStore(tmp);
            const ledger = patronStore.loadStanding();
            ledger.recordSupport('bob@onion', 'foundry', 30, { reason: 'test-support' });
            patronStore.saveStanding(ledger);

            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/standing') + '?human=bob@onion&faction=foundry');
            const payload = JSON.parse(response.body) as { faction: string; tier: string | null; points: number };
            expect(payload).toMatchObject({ faction: 'foundry', tier: 'ally', points: 30 });
        });
    });

    describe('GET /v1/patron/checkin (J7 self-service)', () => {
        it('returns 404 when patronMemoryRoot is not configured', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/checkin') + '?human=alice@onion');
            expect(response.status).toBe(404);
        });

        it('returns 400 when human param is missing', async () => {
            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/checkin'));
            expect(response.status).toBe(400);
            expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringContaining('human') });
        });

        it('credits 1 Shard and returns checked_in on first call of the day', async () => {
            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/checkin') + '?human=alice@onion');
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as {
                result: string;
                shards_earned: number;
                new_balance: number;
                currency: string;
            };
            expect(payload.result).toBe('checked_in');
            expect(payload.shards_earned).toBe(1);
            expect(payload.new_balance).toBe(1);
            expect(payload.currency).toBe('AP');
            // Verify the credit is persisted to disk.
            const patronStore = new PatronStore(tmp);
            const ledger = patronStore.loadCurrency();
            expect(ledger.balance('alice@onion')).toBe(1);
        });

        it('returns already_checked_in and 0 shards_earned on a second same-day call', async () => {
            // Seed an existing check-in for today.
            const patronStore = new PatronStore(tmp);
            const ledger = patronStore.loadCurrency();
            const tracker = patronStore.loadCheckIn(ledger);
            tracker.checkIn('alice@onion');
            patronStore.saveCurrency(ledger);
            patronStore.saveCheckIn(tracker);

            server = await startLettersHttpServer({ store, port: 0, patronMemoryRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/checkin') + '?human=alice@onion');
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { result: string; shards_earned: number; new_balance: number };
            expect(payload.result).toBe('already_checked_in');
            expect(payload.shards_earned).toBe(0);
            expect(payload.new_balance).toBe(1);
        });
    });

    describe('GET /v1/graveyard (N4)', () => {
        it('returns 404 when lettersRoot is not configured', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(server.url.replace('/v1/inbox', '/v1/graveyard'));
            expect(response.status).toBe(404);
        });

        it('returns empty list when no deceased residents exist', async () => {
            writeRuntimeState(tmp, 'res-agent', { attention: 9000 });
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/graveyard'));
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { deceased: unknown[]; total: number };
            expect(payload.deceased).toEqual([]);
            expect(payload.total).toBe(0);
        });

        it('returns deceased entry with slug, displayName, cause, diedAt, and livedTicks', async () => {
            writeRuntimeState(tmp, 'res-fallen', {
                attention: 0,
                tick: 1234,
                deceased: {
                    cause: 'attention_exhausted',
                    date: '2026-05-26T10:00:00.000Z',
                    tick: 1234,
                    processed: true,
                },
            });
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/graveyard'));
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as {
                deceased: Array<{ slug: string; displayName: string; cause: string; diedAt: string; livedTicks: number }>;
            };
            expect(payload.deceased).toHaveLength(1);
            const entry = payload.deceased[0];
            expect(entry.slug).toBe('res-fallen');
            expect(entry.displayName).toBe('Fallen');
            expect(entry.cause).toBe('attention_exhausted');
            expect(entry.diedAt).toBe('2026-05-26T10:00:00.000Z');
            expect(entry.livedTicks).toBe(1234);
        });
    });

    describe('GET /v1/library (Pillar 3 — Library of Souls browse)', () => {
        it('returns 404 when lettersRoot is not configured', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(server.url.replace('/v1/inbox', '/v1/library'));
            expect(response.status).toBe(404);
        });

        it('returns empty list when no library portraits exist', async () => {
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/library'));
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { residents: unknown[]; total: number };
            expect(payload.residents).toEqual([]);
            expect(payload.total).toBe(0);
        });

        it('returns portrait summary with slug, displayName, currentState, and topQuote', async () => {
            writePortraitJson(tmp, 'res-fern', {
                schemaVersion: 1,
                residentName: 'Fern',
                currentState: 'living',
                livesCount: 1,
                epithet: 'the Wanderer',
                voice: { quotes: [{ tick: 10, text: 'The road goes on.', lifeIndex: 1, tag: 'first' }] },
                patrons: [{ handle: 'alice@onion', events: [], sentence: 'alice supported.' }],
                wants: { current: ['find a safe path'], unfulfilledAtDeath: [] },
                storyArc: {
                    phase: 'progress',
                    summary: 'active',
                    evidence: { pitches: 0, fundingEvents: 1, progressEvents: 2, resolutionEvents: 0, letterEvents: 0 },
                },
                born: { ts: '2026-05-26T00:00:00.000Z', tick: 0 },
                lastUpdated: { ts: '2026-05-26T12:00:00.000Z', tick: 100 },
                relationships: [],
                artifacts: [],
            });
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/library'));
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as {
                residents: Array<{
                    slug: string;
                    displayName: string;
                    currentState: string;
                    topQuote?: string;
                    arcPhase?: string;
                    patronHandles: string[];
                }>;
            };
            expect(payload.residents).toHaveLength(1);
            const entry = payload.residents[0];
            expect(entry.slug).toBe('res-fern');
            expect(entry.displayName).toBe('Fern');
            expect(entry.currentState).toBe('living');
            expect(entry.topQuote).toBe('The road goes on.');
            expect(entry.arcPhase).toBe('progress');
            expect(entry.patronHandles).toContain('alice@onion');
        });
    });

    describe('GET /v1/patron/residents (Pillar 2 — residents you have known)', () => {
        it('returns 404 when lettersRoot is not configured', async () => {
            server = await startLettersHttpServer({ store, port: 0 });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/residents?human=alice'));
            expect(response.status).toBe(404);
        });

        it('returns 400 when human param is missing', async () => {
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/residents'));
            expect(response.status).toBe(400);
            expect(JSON.parse(response.body)).toMatchObject({ error: expect.stringContaining('human') });
        });

        it('returns empty list when patron has not supported any residents', async () => {
            writePortraitJson(tmp, 'res-fern', {
                schemaVersion: 1,
                residentName: 'Fern',
                currentState: 'living',
                livesCount: 1,
                patrons: [{ handle: 'bob@onion', events: [], sentence: 'bob.' }],
                voice: { quotes: [] },
                wants: { current: [], unfulfilledAtDeath: [] },
                born: { ts: '2026-05-26T00:00:00.000Z', tick: 0 },
                lastUpdated: { ts: '2026-05-26T12:00:00.000Z', tick: 100 },
                relationships: [],
                artifacts: [],
            });
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/residents?human=alice%40onion'));
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as { residents: unknown[]; total: number };
            expect(payload.residents).toEqual([]);
            expect(payload.total).toBe(0);
        });

        it('returns residents the patron has backed, with state and faction fields', async () => {
            writePortraitJson(tmp, 'res-fern', {
                schemaVersion: 1,
                residentName: 'Fern',
                currentState: 'living',
                livesCount: 1,
                epithet: 'the wanderer',
                patrons: [
                    { handle: 'alice@onion', events: [], sentence: 'alice supported.' },
                    { handle: 'bob@onion', events: [], sentence: 'bob supported.' },
                ],
                voice: { quotes: [{ tick: 10, text: 'Hello world.', lifeIndex: 1, tag: 'first' }] },
                wants: { current: ['explore'], unfulfilledAtDeath: [] },
                born: { ts: '2026-05-26T00:00:00.000Z', tick: 0 },
                lastUpdated: { ts: '2026-05-26T12:00:00.000Z', tick: 100 },
                relationships: [],
                artifacts: [],
            });
            writePortraitJson(tmp, 'res-oak', {
                schemaVersion: 1,
                residentName: 'Oak',
                currentState: 'deceased',
                livesCount: 2,
                patrons: [{ handle: 'alice@onion', events: [], sentence: 'alice.' }],
                voice: { quotes: [] },
                wants: { current: [], unfulfilledAtDeath: ['find a tree'] },
                born: { ts: '2026-05-25T00:00:00.000Z', tick: 0 },
                lastUpdated: { ts: '2026-05-26T08:00:00.000Z', tick: 200 },
                relationships: [],
                artifacts: [],
            });
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            // Case-insensitive handle matching: ALICE@ONION matches alice@onion portraits.
            const response = await get(server.url.replace('/v1/inbox', '/v1/patron/residents?human=ALICE%40onion'));
            expect(response.status).toBe(200);
            const payload = JSON.parse(response.body) as {
                residents: Array<{ slug: string; displayName: string; currentState: string; livesCount: number }>;
                total: number;
            };
            expect(payload.total).toBe(2);
            const slugs = payload.residents.map(r => r.slug).sort();
            expect(slugs).toEqual(['res-fern', 'res-oak']);
            const fern = payload.residents.find(r => r.slug === 'res-fern');
            expect(fern?.displayName).toBe('Fern');
            expect(fern?.currentState).toBe('living');
            const oak = payload.residents.find(r => r.slug === 'res-oak');
            expect(oak?.currentState).toBe('deceased');
            expect(oak?.livesCount).toBe(2);
        });
    });
});

function writeRuntimeState(root: string, slug: string, partial: { attention: number; [key: string]: unknown }): void {
    const dir = path.join(root, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'runtime-state.json'),
        JSON.stringify(
            {
                resident: slug.replace(/^res-/, 'res:'),
                tick: 0,
                legacy: { kind: 'gather', progress: {}, complete: false },
                budgets: {
                    minuteStartedAt: '2026-05-23T00:00:00.000Z',
                    dayStartedAt: '2026-05-23T00:00:00.000Z',
                    requestsThisMinute: 0,
                    requestsToday: 0,
                },
                ...partial,
            },
            null,
            2,
        ),
    );
}

function writePortraitJson(root: string, slug: string, portrait: Record<string, unknown>): void {
    const dir = path.join(root, 'library', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'portrait.json'), JSON.stringify(portrait, null, 2));
}

function writeSoul(
    soulsDir: string,
    fileName: string,
    frontmatter: { name: string; display?: string; archetype: string; goals?: string[] },
): void {
    fs.mkdirSync(soulsDir, { recursive: true });
    const lines = [
        '---',
        `name: ${frontmatter.name}`,
        frontmatter.display ? `display: ${frontmatter.display}` : undefined,
        `archetype: ${frontmatter.archetype}`,
        frontmatter.goals && frontmatter.goals.length > 0 ? 'goals:' : undefined,
        ...(frontmatter.goals || []).map(goal => `  - ${goal}`),
        '---',
        '',
        '# Test soul',
        '',
    ].filter((line): line is string => line !== undefined);
    fs.writeFileSync(path.join(soulsDir, fileName), `${lines.join('\n')}\n`);
}
