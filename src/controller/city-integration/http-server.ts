import http, { type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { CityIntegrationError, CityIntegrationService } from './service';

export interface CityIntegrationHttpOptions {
    service: CityIntegrationService;
    port: number;
    host?: string;
    pathPrefix?: string;
    bearerToken: string;
}

export interface StartedCityIntegrationHttpServer {
    server: Server;
    url: string;
}

const DEFAULT_CITY_PATH_PREFIX = '/api/nullcity';

export async function startCityIntegrationHttpServer(options: CityIntegrationHttpOptions): Promise<StartedCityIntegrationHttpServer> {
    const bindHost = options.host || '127.0.0.1';
    const pathPrefix = normalizePath(options.pathPrefix || DEFAULT_CITY_PATH_PREFIX).replace(/\/$/, '');
    const server = http.createServer((request, response) => {
        handle(request, response, options, pathPrefix).catch(error => writeError(response, error));
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
        url: `http://${bindHost}:${address.port}${pathPrefix}`,
    };
}

export async function closeCityIntegrationHttpServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
    });
}

async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    options: CityIntegrationHttpOptions,
    pathPrefix: string,
): Promise<void> {
    if (request.headers.authorization !== `Bearer ${options.bearerToken}`) {
        writeJson(response, 401, { error: 'Unauthorized' });
        return;
    }

    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    const path = url.pathname;

    if (request.method === 'POST' && path === `${pathPrefix}/residents`) {
        writeJson(response, 200, await options.service.birthResident(await readJson(request)));
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/economy/digest`) {
        writeJson(response, 200, options.service.economyDigest(readDigestQuery(url)));
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/economy/live`) {
        writeJson(response, 200, options.service.economyLive(readLiveEconomyQuery(url)), { 'Cache-Control': 'max-age=2' });
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/economy/totals`) {
        writeJson(response, 200, options.service.economyTotals(readLiveEconomyQuery(url)));
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/economy/events`) {
        writeJson(response, 200, options.service.economyEvents(readLiveEconomyQuery(url)));
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/economy/residents`) {
        writeJson(response, 200, options.service.economyResidents(readLiveEconomyQuery(url)));
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/economy/listings`) {
        writeJson(response, 200, options.service.economyListings());
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/economy/heartbeat`) {
        writeJson(response, 200, options.service.economyHeartbeat(), { 'Cache-Control': 'max-age=2' });
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/storyteller/latest`) {
        writeJson(response, 200, options.service.storytellerLatest());
        return;
    }

    if (request.method === 'POST' && path === `${pathPrefix}/proposals`) {
        writeJson(response, 200, await options.service.createSoulProposal(await readJson(request)));
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/proposals`) {
        writeJson(response, 200, await options.service.listSoulProposals());
        return;
    }

    const proposalMatch = path.match(new RegExp(`^${escapeRegExp(pathPrefix)}/proposals/([^/]+)(?:/(fund|approve|reject|birth))?$`));
    if (proposalMatch) {
        const proposalId = decodeURIComponent(proposalMatch[1]);
        const action = proposalMatch[2];
        if (request.method === 'GET' && action === undefined) {
            writeJson(response, 200, await options.service.getSoulProposal(proposalId));
            return;
        }
        if (request.method === 'POST' && action === 'fund') {
            writeJson(response, 200, await options.service.fundSoulProposal(proposalId, await readJson(request)));
            return;
        }
        if (request.method === 'POST' && action === 'approve') {
            writeJson(response, 200, await options.service.approveSoulProposal(proposalId, await readJson(request)));
            return;
        }
        if (request.method === 'POST' && action === 'reject') {
            writeJson(response, 200, await options.service.rejectSoulProposal(proposalId, await readJson(request)));
            return;
        }
        if (request.method === 'POST' && action === 'birth') {
            writeJson(response, 200, await options.service.birthFromProposal(proposalId));
            return;
        }
        writeJson(response, 405, { error: `Method ${request.method} not allowed` });
        return;
    }

    if (request.method === 'POST' && path === `${pathPrefix}/goals`) {
        writeJson(response, 201, options.service.createGoalContract(await readJson(request)));
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/goals`) {
        writeJson(response, 200, options.service.listGoalContracts());
        return;
    }

    const goalMatch = path.match(new RegExp(`^${escapeRegExp(pathPrefix)}/goals/([^/]+)(?:/(achieve))?$`));
    if (goalMatch) {
        const goalId = decodeURIComponent(goalMatch[1]);
        const action = goalMatch[2];
        if (request.method === 'GET' && action === undefined) {
            writeJson(response, 200, options.service.getGoalContract(goalId));
            return;
        }
        if (request.method === 'POST' && action === 'achieve') {
            writeJson(response, 200, options.service.markGoalAchieved(goalId, await readJson(request)));
            return;
        }
        writeJson(response, 405, { error: `Method ${request.method} not allowed` });
        return;
    }

    if (request.method === 'POST' && path === `${pathPrefix}/ncri`) {
        writeJson(response, 201, options.service.createNcri(await readJson(request)));
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/ncri`) {
        writeJson(response, 200, options.service.listNcri());
        return;
    }

    const ncriMatch = path.match(new RegExp(`^${escapeRegExp(pathPrefix)}/ncri/([^/]+)(?:/(approve|transfer|redeem))?$`));
    if (ncriMatch) {
        const ncriId = decodeURIComponent(ncriMatch[1]);
        const action = ncriMatch[2] as 'approve' | 'transfer' | 'redeem' | undefined;
        if (request.method === 'GET' && action === undefined) {
            writeJson(response, 200, options.service.getNcri(ncriId));
            return;
        }
        if (request.method === 'POST' && action === 'approve') {
            writeJson(response, 200, options.service.approveNcri(ncriId, await readJson(request)));
            return;
        }
        if (request.method === 'POST' && action === 'transfer') {
            writeJson(response, 200, options.service.transferNcri(ncriId, await readJson(request)));
            return;
        }
        if (request.method === 'POST' && action === 'redeem') {
            writeJson(response, 200, options.service.redeemNcri(ncriId));
            return;
        }
        writeJson(response, 405, { error: `Method ${request.method} not allowed` });
        return;
    }

    const match = path.match(
        new RegExp(
            `^${escapeRegExp(pathPrefix)}/residents/([^/]+)/(attention-grants|ap-gp-exchanges|gold-burns|messages|wealth|public-snapshot|log|death|library-events)$`,
        ),
    );
    if (!match) {
        writeJson(response, 404, { error: 'Not Found' });
        return;
    }

    const resident = decodeURIComponent(match[1]);
    const route = match[2];

    if (request.method === 'POST' && route === 'attention-grants') {
        writeJson(response, 200, await options.service.creditAttention(resident, await readJson(request)));
        return;
    }
    if (request.method === 'POST' && route === 'ap-gp-exchanges') {
        const result = await options.service.exchangeApForGp(resident, await readJson(request));
        writeJson(response, exchangeHttpStatus(result.status), result);
        return;
    }
    if (request.method === 'POST' && route === 'gold-burns') {
        const result = await options.service.burnGold(resident, await readJson(request));
        writeJson(response, result && typeof result === 'object' && (result as { ok?: unknown }).ok === false ? 409 : 200, result);
        return;
    }
    if (request.method === 'POST' && route === 'messages') {
        writeJson(response, 200, await options.service.deliverMessage(resident, await readJson(request)));
        return;
    }
    if (request.method === 'GET' && route === 'wealth') {
        writeJson(response, 200, await options.service.inspectGold(resident));
        return;
    }
    if (request.method === 'GET' && route === 'public-snapshot') {
        writeJson(response, 200, options.service.publicSnapshot(resident));
        return;
    }
    if (request.method === 'GET' && (route === 'log' || route === 'library-events')) {
        writeJson(response, 200, options.service.residentLog(resident));
        return;
    }
    if (request.method === 'GET' && route === 'death') {
        writeJson(response, 200, options.service.residentDeath(resident));
        return;
    }

    writeJson(response, 405, { error: `Method ${request.method} not allowed` });
}

function exchangeHttpStatus(status: unknown): number {
    if (status === 'complete') {
        return 200;
    }
    if (status === 'failed_gp') {
        return 409;
    }
    return 500;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) {
        return {};
    }
    try {
        return JSON.parse(raw);
    } catch {
        throw new CityIntegrationError(400, 'invalid_json');
    }
}

function writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
        response.end();
        return;
    }
    if (error instanceof CityIntegrationError) {
        writeJson(response, error.status, { error: error.code, message: error.message });
        return;
    }
    writeJson(response, 500, { error: error instanceof Error ? error.message : 'city integration request failed' });
}

function writeJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    response.end(JSON.stringify(payload));
}

function normalizePath(value: string): string {
    return value.startsWith('/') ? value : `/${value}`;
}

function readDigestQuery(url: URL): { since?: string; until?: string } {
    const since = url.searchParams.get('since') ?? undefined;
    const until = url.searchParams.get('until') ?? undefined;
    return {
        ...(since !== undefined ? { since } : {}),
        ...(until !== undefined ? { until } : {}),
    };
}

function readLiveEconomyQuery(url: URL): { since?: string; limit?: number; residentLimit?: number } {
    const since = url.searchParams.get('since') ?? undefined;
    const limit = parsePositiveInt(url.searchParams.get('limit'));
    const residentLimit = parsePositiveInt(url.searchParams.get('residentLimit'));
    return {
        ...(since !== undefined ? { since } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(residentLimit !== undefined ? { residentLimit } : {}),
    };
}

function parsePositiveInt(value: string | null): number | undefined {
    if (value === null) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
