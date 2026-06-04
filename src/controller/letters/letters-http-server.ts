import http, { type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import type { InferenceHealthResult } from '../llm/inference-health';
import type { LettersStore } from '../patron/letters-store';
import { PatronStore } from '../patron/patron-store';
import { CURRENCY_NAME } from '../patron/currency-ledger';
import { STANDING_TIERS } from '../patron/standing-ledger';
import { buildWallSnapshot, readGraveyardEntries, readLibraryEntries, redactWallSnapshot } from './wall-snapshot';

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
export const DEFAULT_WALL_PATH = '/v1/wall/snapshot';
export const DEFAULT_HEALTH_PATH = '/v1/health';
export const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
export const DEFAULT_PATRON_BALANCE_PATH = '/v1/patron/balance';
export const DEFAULT_PATRON_STANDING_PATH = '/v1/patron/standing';
export const DEFAULT_PATRON_CHECKIN_PATH = '/v1/patron/checkin';
export const DEFAULT_GRAVEYARD_PATH = '/v1/graveyard';
export const DEFAULT_LIBRARY_PATH = '/v1/library';
/** Which residents this patron has supported (backed by library portrait patronHandles). */
export const DEFAULT_PATRON_RESIDENTS_PATH = '/v1/patron/residents';
/**
 * Dashboard polling endpoint: all letters across every patron since an
 * optional ISO `?since=` timestamp. Enables incremental sync into the
 * dashboard postgres inbox tables without requiring the consumer to know
 * every patron handle in advance. Part of the LB-H2R-1n55 bridge.
 */
export const DEFAULT_ALL_LETTERS_PATH = '/v1/letters/all';

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
    /** Inbox route path. Defaults to {@link DEFAULT_LETTERS_PATH}. */
    path?: string;
    auth?: LettersHttpAuthOptions;
    /**
     * When set, enables the wall ticker route {@link wallPath} that
     * returns a snapshot of recent letters across all patrons. Should
     * be the same root the store writes to (`config.memory.dir`).
     */
    lettersRoot?: string;
    /** Configured residents to include in the public wall roster. */
    residentIds?: readonly string[];
    /** SOUL directory used to fill roster names and fallback ambitions. */
    soulsDir?: string;
    /** Wall ticker route path. Defaults to {@link DEFAULT_WALL_PATH}. */
    wallPath?: string;
    /** Real inference health probe for {@link DEFAULT_HEALTH_PATH}. */
    health?: () => Promise<InferenceHealthResult>;
    /** Maximum time the HTTP health route may wait for the inference probe. */
    healthTimeoutMs?: number;
    /** Health route path. Defaults to {@link DEFAULT_HEALTH_PATH}. */
    healthPath?: string;
    /**
     * When true, the wall snapshot is passed through
     * {@link redactWallSnapshot} before being returned: recipients are
     * masked (e.g. `alice@onion` → `a***@onion`) and letter bodies are
     * cleared. Use at the IRL event so the public projection does not
     * leak per-patron content. The per-patron `/v1/inbox?human=...`
     * route is unaffected — patrons still get full-fidelity content
     * via their own URL. Default `false` preserves the pre-HD-013
     * behavior. See `docs/intelligence-verification-log.md` § E13.
     */
    wallRedact?: boolean;
    /**
     * When set, enables the self-service patron balance and standing routes
     * ({@link DEFAULT_PATRON_BALANCE_PATH} and {@link DEFAULT_PATRON_STANDING_PATH}).
     * Should be the same memory root the controller uses for PatronStore
     * (`config.memory.dir`). HD-016 C/D: self-service balance lookup + tier
     * visibility so attendees can check their own Shards/standing via QR URL.
     */
    patronMemoryRoot?: string;
    /** Test injection for `now` used by the wall snapshot. */
    now?: () => Date;
}

export interface StartedLettersHttpServer {
    server: Server;
    url: string;
}

export async function startLettersHttpServer(options: LettersHttpServerOptions): Promise<StartedLettersHttpServer> {
    const routePath = normalizePath(options.path || DEFAULT_LETTERS_PATH);
    const wallRoutePath = normalizePath(options.wallPath || DEFAULT_WALL_PATH);
    const healthRoutePath = normalizePath(options.healthPath || DEFAULT_HEALTH_PATH);
    const patronBalancePath = normalizePath(DEFAULT_PATRON_BALANCE_PATH);
    const patronStandingPath = normalizePath(DEFAULT_PATRON_STANDING_PATH);
    const patronCheckInPath = normalizePath(DEFAULT_PATRON_CHECKIN_PATH);
    const patronResidentsPath = normalizePath(DEFAULT_PATRON_RESIDENTS_PATH);
    const allLettersPath = normalizePath(DEFAULT_ALL_LETTERS_PATH);
    const bindHost = options.host || '127.0.0.1';

    const graveyardRoutePath = normalizePath(DEFAULT_GRAVEYARD_PATH);

    const libraryRoutePath = normalizePath(DEFAULT_LIBRARY_PATH);

    const server = http.createServer((request, response) => {
        handle(
            request,
            response,
            options,
            routePath,
            wallRoutePath,
            healthRoutePath,
            patronBalancePath,
            patronStandingPath,
            patronCheckInPath,
            graveyardRoutePath,
            libraryRoutePath,
            patronResidentsPath,
            allLettersPath,
        ).catch(error => {
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
    wallRoutePath: string,
    healthRoutePath: string,
    patronBalancePath: string,
    patronStandingPath: string,
    patronCheckInPath: string,
    graveyardRoutePath: string,
    libraryRoutePath: string,
    patronResidentsPath: string,
    allLettersPath: string,
): Promise<void> {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    const isInboxRoute = url.pathname === routePath;
    const isWallRoute = url.pathname === wallRoutePath && options.lettersRoot !== undefined;
    const isHealthRoute = url.pathname === healthRoutePath && options.health !== undefined;
    const isPatronBalanceRoute = url.pathname === patronBalancePath && options.patronMemoryRoot !== undefined;
    const isPatronStandingRoute = url.pathname === patronStandingPath && options.patronMemoryRoot !== undefined;
    const isPatronCheckInRoute = url.pathname === patronCheckInPath && options.patronMemoryRoot !== undefined;
    const isGraveyardRoute = url.pathname === graveyardRoutePath && options.lettersRoot !== undefined;
    const isLibraryRoute = url.pathname === libraryRoutePath && options.lettersRoot !== undefined;
    const isPatronResidentsRoute = url.pathname === patronResidentsPath && options.lettersRoot !== undefined;
    const isAllLettersRoute = url.pathname === allLettersPath;

    if (
        !isInboxRoute &&
        !isWallRoute &&
        !isHealthRoute &&
        !isPatronBalanceRoute &&
        !isPatronStandingRoute &&
        !isPatronCheckInRoute &&
        !isGraveyardRoute &&
        !isLibraryRoute &&
        !isPatronResidentsRoute &&
        !isAllLettersRoute
    ) {
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

    if (isHealthRoute) {
        try {
            const inference = await runHealthWithTimeout(
                options.health as () => Promise<InferenceHealthResult>,
                options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
            );
            writeJson(response, inference.ok ? 200 : 503, {
                ok: inference.ok,
                controller: 'ok',
                inference,
            });
        } catch (error) {
            writeJson(response, 503, {
                ok: false,
                controller: 'ok',
                inference: {
                    ok: false,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
        return;
    }

    if (isGraveyardRoute) {
        const deceased = readGraveyardEntries(options.lettersRoot as string, {
            residentIds: options.residentIds,
            soulsDir: options.soulsDir,
        });
        writeJson(response, 200, { deceased, total: deceased.length, asOf: new Date().toISOString() });
        return;
    }

    if (isLibraryRoute) {
        // Public surface — hide QA fixtures and benchmark synthetics.
        const residents = readLibraryEntries(options.lettersRoot as string, { excludeSynthetic: true });
        writeJson(response, 200, { residents, total: residents.length, asOf: new Date().toISOString() });
        return;
    }

    if (isPatronResidentsRoute) {
        const human = url.searchParams.get('human');
        if (!human || human.trim().length === 0) {
            writeJson(response, 400, { error: 'Query parameter `human` is required' });
            return;
        }
        const humanLower = human.toLowerCase();
        // Re-use readLibraryEntries so QA fixtures and benchmark synthetics are
        // automatically excluded — no ghost-residents in the patron profile.
        const allEntries = readLibraryEntries(options.lettersRoot as string, { excludeSynthetic: true });
        const supported = allEntries.filter(entry => entry.patronHandles.some(h => h.toLowerCase() === humanLower));
        writeJson(response, 200, { residents: supported, total: supported.length, asOf: new Date().toISOString() });
        return;
    }

    if (isWallRoute) {
        const now = options.now ? options.now() : new Date();
        // lettersRoot guaranteed non-undefined here by the isWallRoute check above.
        // Public ticker — collapse duplicate-subject letters (multi-witness epitaphs
        // would otherwise stack 5× on the wall) and hide QA/benchmark residents from
        // the roster panel. Both filters are no-ops when there's nothing to filter.
        const snapshot = buildWallSnapshot(options.lettersRoot as string, {
            now,
            residentIds: options.residentIds,
            soulsDir: options.soulsDir,
            excludeSynthetic: true,
            dedupeBySubject: true,
        });
        // HD-013: optionally pass the snapshot through the public-display
        // redactor before serving it on the wall route.
        writeJson(response, 200, options.wallRedact ? redactWallSnapshot(snapshot) : snapshot);
        return;
    }

    if (isPatronBalanceRoute || isPatronStandingRoute) {
        const human = url.searchParams.get('human');
        if (!human || human.trim().length === 0) {
            writeJson(response, 400, { error: 'Query parameter `human` is required' });
            return;
        }
        // patronMemoryRoot guaranteed non-undefined by the route guard above.
        const store = new PatronStore(options.patronMemoryRoot as string);
        if (isPatronBalanceRoute) {
            const ledger = store.loadCurrency();
            writeJson(response, 200, {
                human,
                balance: ledger.balance(human),
                currency: CURRENCY_NAME,
            });
        } else {
            const faction = url.searchParams.get('faction') || 'embassy';
            const standingLedger = store.loadStanding();
            const points = standingLedger.points(human, faction);
            const tier = standingLedger.currentTier(human, faction);
            const userFacingTier = tier === 'stranger' ? null : tier;
            const tierIdx = STANDING_TIERS.findIndex(t => t.name === tier);
            const nextTierObj = STANDING_TIERS[tierIdx + 1];
            const tierMin = tierIdx >= 0 ? STANDING_TIERS[tierIdx].minPoints : 0;
            writeJson(response, 200, {
                human,
                faction,
                points,
                tier: userFacingTier,
                tierMin,
                nextTier: nextTierObj ? nextTierObj.name : null,
                pointsToNext: nextTierObj ? nextTierObj.minPoints - points : null,
            });
        }
        return;
    }

    if (isPatronCheckInRoute) {
        const human = url.searchParams.get('human');
        if (!human || human.trim().length === 0) {
            writeJson(response, 400, { error: 'Query parameter `human` is required' });
            return;
        }
        // patronMemoryRoot guaranteed non-undefined by the route guard above.
        const store = new PatronStore(options.patronMemoryRoot as string);
        const ledger = store.loadCurrency();
        const tracker = store.loadCheckIn(ledger);
        const checkInResult = tracker.checkIn(human);
        if (checkInResult.credited) {
            store.saveCurrency(ledger);
            store.saveCheckIn(tracker);
        }
        writeJson(response, 200, {
            result: checkInResult.credited ? 'checked_in' : 'already_checked_in',
            shards_earned: checkInResult.shards,
            new_balance: ledger.balance(human),
            currency: CURRENCY_NAME,
        });
        return;
    }

    if (isAllLettersRoute) {
        const sinceParam = url.searchParams.get('since');
        let since: Date | undefined;
        if (sinceParam) {
            since = new Date(sinceParam);
            if (isNaN(since.getTime())) {
                writeJson(response, 400, { error: '`since` must be a valid ISO 8601 timestamp' });
                return;
            }
        }
        const entries = options.store.readAllLetters(since);
        const total = entries.reduce((acc, e) => acc + e.letters.length, 0);
        writeJson(response, 200, {
            entries,
            total,
            asOf: new Date().toISOString(),
            since: since?.toISOString() ?? null,
        });
        return;
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

async function runHealthWithTimeout(health: () => Promise<InferenceHealthResult>, timeoutMs: number): Promise<InferenceHealthResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            health(),
            new Promise<InferenceHealthResult>(resolve => {
                timer = setTimeout(() => {
                    resolve({
                        ok: false,
                        status: 'health_timeout',
                        endpoint: 'letters-http',
                        error: `health probe timed out after ${timeoutMs}ms`,
                    });
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

function normalizePath(value: string): string {
    return value.startsWith('/') ? value : `/${value}`;
}
