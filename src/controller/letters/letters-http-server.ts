import http, { type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import type { LettersStore } from '../patron/letters-store';

/**
 * Read-only HTTP server exposing a human's letter inbox as JSON
 * (workstream EVENT-D2a). Pairs with the EVENT-D1a wiring that landed
 * letters on disk: this is the consumer side that lets a patron read
 * what's been written for them.
 *
 * Design constraints (per docs/strategic-review-2026-05-23-pm.md):
 *   - No auth by default — assumed local-network only at the event venue.
 *   - Optional bearer-token gate for environments that want it.
 *   - Pure node `http`; no Express dependency (mirrors mcp/http-server.ts).
 *   - GET-only; POST/PUT/DELETE return 405.
 *   - Single route under {@link DEFAULT_LETTERS_PATH}; other paths 404.
 *   - Recipient slug is lowered + alnum-stripped by the underlying
 *     LettersStore, so `Alice@Onion` and `alice@onion` share an inbox.
 *
 * Wiring in production: `index.ts` constructs the server when a
 * `--letters-http-port` flag is present, sharing the LettersStore that
 * ControllerHost passed into PatronGateway in EVENT-D1a.
 */
export const DEFAULT_LETTERS_PATH = '/v1/inbox';

export interface LettersHttpAuthOptions {
    /** When set, requests must send `Authorization: Bearer <token>`. */
    bearerToken: string;
}

export interface LettersHttpServerOptions {
    store: LettersStore;
    /** Port to listen on. Pass 0 for an ephemeral port (tests). */
    port: number;
    /** Bind address. Defaults to 127.0.0.1 (local-network only). */
    host?: string;
    /** Route path. Defaults to {@link DEFAULT_LETTERS_PATH}. */
    path?: string;
    auth?: LettersHttpAuthOptions;
}

export interface StartedLettersHttpServer {
    server: Server;
    url: string;
}

export async function startLettersHttpServer(options: LettersHttpServerOptions): Promise<StartedLettersHttpServer> {
    const routePath = normalizePath(options.path || DEFAULT_LETTERS_PATH);
    const bindHost = options.host || '127.0.0.1';

    const server = http.createServer((request, response) => {
        handle(request, response, options, routePath).catch(error => {
            if (!response.headersSent) {
                writeJson(response, 500, { error: error instanceof Error ? error.message : 'inbox request failed' });
            } else if (!response.writableEnded) {
                response.end();
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, bindHost, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address() as AddressInfo;
    return {
        server,
        url: `http://${bindHost}:${address.port}${routePath}`,
    };
}

export async function closeLettersHttpServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
    });
}

async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    options: LettersHttpServerOptions,
    routePath: string,
): Promise<void> {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    if (url.pathname !== routePath) {
        writeJson(response, 404, { error: 'Not Found' });
        return;
    }
    if (request.method !== 'GET') {
        writeJson(response, 405, { error: `Method ${request.method} not allowed` });
        return;
    }

    if (options.auth) {
        const supplied = request.headers.authorization;
        const expected = `Bearer ${options.auth.bearerToken}`;
        if (supplied !== expected) {
            writeJson(response, 401, { error: 'Unauthorized' });
            return;
        }
    }

    const human = url.searchParams.get('human');
    if (!human || human.trim().length === 0) {
        writeJson(response, 400, { error: 'Query parameter `human` is required' });
        return;
    }

    const letters = options.store.readInbox(human);
    writeJson(response, 200, { letters });
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
}

function normalizePath(value: string): string {
    return value.startsWith('/') ? value : `/${value}`;
}
