import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { LettersStore } from '../patron/letters-store';
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
    });

    describe('static embassy pages', () => {
        it('serves the wall ticker page from the documented /wall/ route', async () => {
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            const wallPageUrl = server.url.replace('/v1/inbox', '/wall/');

            const response = await get(wallPageUrl);

            expect(response.status).toBe(200);
            expect(response.contentType).toMatch(/text\/html/);
            expect(response.body).toContain('Null City Embassy');
            expect(response.body).toContain('/v1/wall/snapshot');
        });

        it('serves the patron inbox page from the documented /inbox/ route', async () => {
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });
            const inboxPageUrl = server.url.replace('/v1/inbox', '/inbox/');

            const response = await get(inboxPageUrl);

            expect(response.status).toBe(200);
            expect(response.contentType).toMatch(/text\/html/);
            expect(response.body).toContain('Null City Embassy');
            expect(response.body).toContain('/v1/inbox');
        });

        it('also accepts explicit index.html URLs for operator copy/paste', async () => {
            server = await startLettersHttpServer({ store, port: 0, lettersRoot: tmp });

            const wall = await get(server.url.replace('/v1/inbox', '/wall/index.html'));
            const inbox = await get(server.url.replace('/v1/inbox', '/inbox/index.html'));

            expect(wall.status).toBe(200);
            expect(inbox.status).toBe(200);
            expect(wall.contentType).toMatch(/text\/html/);
            expect(inbox.contentType).toMatch(/text\/html/);
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
});
