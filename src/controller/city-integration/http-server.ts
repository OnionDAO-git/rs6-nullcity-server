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

    if (request.method === 'POST' && path === `${pathPrefix}/proposals`) {
        writeJson(response, 200, await options.service.createSoulProposal(await readJson(request)));
        return;
    }

    if (request.method === 'GET' && path === `${pathPrefix}/proposals`) {
        writeJson(response, 200, await options.service.listSoulProposals());
        return;
    }

    const proposalMatch = path.match(new RegExp(`^${escapeRegExp(pathPrefix)}/proposals/([^/]+)(?:/(fund|approve|reject))?$`));
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
        writeJson(response, 405, { error: `Method ${request.method} not allowed` });
        return;
    }

    const match = path.match(
        new RegExp(
            `^${escapeRegExp(pathPrefix)}/residents/([^/]+)/(attention-grants|gold-burns|messages|wealth|public-snapshot|log|death|library-events)$`,
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

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
