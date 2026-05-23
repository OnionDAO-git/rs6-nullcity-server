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
});
