import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { PatronConfig } from './patron/patron-registry';

export interface ControllerConfig {
    controller: {
        instanceId: string;
    };
    residents: string[];
    gateway: {
        url: string;
        authToken?: string;
        controllerId: string;
    };
    inference: {
        maxConcurrent: number;
    };
    souls: {
        dir: string;
    };
    memory: {
        dir: string;
        qmdBin: string;
    };
    logging: {
        dir: string;
        fullPerceptions: boolean;
    };
    knowledge: {
        dir: string;
        runebenchWikiDir?: string;
        enableSuggestions: boolean;
        emitStdout: boolean;
        storageMode: KnowledgeStorageMode;
    };
    llm: {
        endpoints: Record<string, LlmEndpointConfig>;
    };
    patrons?: PatronConfig[];
}

export type KnowledgeStorageMode = 'ephemeral' | 'persistent-volume' | 'external-store';

export interface LlmEndpointConfig {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    timeoutMs: number;
}

export interface ControllerCliOptions {
    configPath: string;
    once: boolean;
    logEnvelope: boolean;
    mcpHttpPort?: number;
    mcpHttpHost: string;
    mcpHttpPath: string;
    /** Letters inbox HTTP port (EVENT-D2c). Server is only started when this is set. */
    lettersHttpPort?: number;
    lettersHttpHost: string;
    lettersHttpPath: string;
    lettersHttpWallRedact: boolean;
    cityHttpPort?: number;
    cityHttpHost: string;
    cityHttpPathPrefix: string;
    cityHttpToken?: string;
}

const DEFAULT_CONFIG_PATH = 'controller.yml';

export function parseControllerArgs(argv: string[]): ControllerCliOptions {
    let configPath = process.env.CONTROLLER_CONFIG || DEFAULT_CONFIG_PATH;
    let once = readEnvBoolean(process.env.CONTROLLER_ONCE, false);
    let logEnvelope = readEnvBoolean(process.env.CONTROLLER_LOG_ENVELOPE, false);
    let mcpHttpPort = readOptionalPort(process.env.CONTROLLER_MCP_HTTP_PORT, 'CONTROLLER_MCP_HTTP_PORT');
    let mcpHttpHost = process.env.CONTROLLER_MCP_HTTP_HOST || '127.0.0.1';
    let mcpHttpPath = process.env.CONTROLLER_MCP_HTTP_PATH || '/controller/mcp';
    let lettersHttpPort = readOptionalPort(process.env.CONTROLLER_LETTERS_HTTP_PORT, 'CONTROLLER_LETTERS_HTTP_PORT');
    let lettersHttpHost = process.env.CONTROLLER_LETTERS_HTTP_HOST || '127.0.0.1';
    let lettersHttpPath = process.env.CONTROLLER_LETTERS_HTTP_PATH || '/v1/inbox';
    let lettersHttpWallRedact =
        readEnvBoolean(process.env.CONTROLLER_LETTERS_HTTP_WALL_REDACT, false) || readEnvBoolean(process.env.CONTROLLER_WALL_REDACT, false);
    let cityHttpPort = readOptionalPort(process.env.CONTROLLER_CITY_HTTP_PORT, 'CONTROLLER_CITY_HTTP_PORT');
    let cityHttpHost = process.env.CONTROLLER_CITY_HTTP_HOST || '127.0.0.1';
    let cityHttpPathPrefix = process.env.CONTROLLER_CITY_HTTP_PATH_PREFIX || '/api/nullcity';
    let cityHttpToken = readOptionalString(process.env.CONTROLLER_CITY_HTTP_TOKEN || process.env.CITY_DASHBOARD_NULLCITY_TOKEN);

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--once') {
            once = true;
        } else if (arg === '--log-envelope') {
            logEnvelope = true;
        } else if (arg === '--mcp-http-port') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a port`);
            }
            mcpHttpPort = readOptionalPort(next, arg);
            i += 1;
        } else if (arg.startsWith('--mcp-http-port=')) {
            mcpHttpPort = readOptionalPort(arg.slice('--mcp-http-port='.length), '--mcp-http-port');
        } else if (arg === '--mcp-http-host') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a host`);
            }
            mcpHttpHost = next;
            i += 1;
        } else if (arg.startsWith('--mcp-http-host=')) {
            mcpHttpHost = arg.slice('--mcp-http-host='.length);
        } else if (arg === '--mcp-http-path') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a path`);
            }
            mcpHttpPath = next;
            i += 1;
        } else if (arg.startsWith('--mcp-http-path=')) {
            mcpHttpPath = arg.slice('--mcp-http-path='.length);
        } else if (arg === '--letters-http-port') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a port`);
            }
            lettersHttpPort = readOptionalPort(next, arg);
            i += 1;
        } else if (arg.startsWith('--letters-http-port=')) {
            lettersHttpPort = readOptionalPort(arg.slice('--letters-http-port='.length), '--letters-http-port');
        } else if (arg === '--letters-http-host') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a host`);
            }
            lettersHttpHost = next;
            i += 1;
        } else if (arg.startsWith('--letters-http-host=')) {
            lettersHttpHost = arg.slice('--letters-http-host='.length);
        } else if (arg === '--letters-http-path') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a path`);
            }
            lettersHttpPath = next;
            i += 1;
        } else if (arg.startsWith('--letters-http-path=')) {
            lettersHttpPath = arg.slice('--letters-http-path='.length);
        } else if (arg === '--letters-http-wall-redact' || arg === '--wall-redact') {
            lettersHttpWallRedact = true;
        } else if (arg === '--city-http-port') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a port`);
            }
            cityHttpPort = readOptionalPort(next, arg);
            i += 1;
        } else if (arg.startsWith('--city-http-port=')) {
            cityHttpPort = readOptionalPort(arg.slice('--city-http-port='.length), '--city-http-port');
        } else if (arg === '--city-http-host') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a host`);
            }
            cityHttpHost = next;
            i += 1;
        } else if (arg.startsWith('--city-http-host=')) {
            cityHttpHost = arg.slice('--city-http-host='.length);
        } else if (arg === '--city-http-path-prefix') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a path prefix`);
            }
            cityHttpPathPrefix = next;
            i += 1;
        } else if (arg.startsWith('--city-http-path-prefix=')) {
            cityHttpPathPrefix = arg.slice('--city-http-path-prefix='.length);
        } else if (arg === '--city-http-token') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a token`);
            }
            cityHttpToken = next;
            i += 1;
        } else if (arg.startsWith('--city-http-token=')) {
            cityHttpToken = arg.slice('--city-http-token='.length);
        } else if (arg === '--config' || arg === '-c') {
            const next = argv[i + 1];
            if (!next) {
                throw new Error(`${arg} requires a path`);
            }
            configPath = next;
            i += 1;
        } else if (arg.startsWith('--config=')) {
            configPath = arg.slice('--config='.length);
        }
    }

    return {
        configPath,
        once,
        logEnvelope,
        mcpHttpPort,
        mcpHttpHost,
        mcpHttpPath,
        lettersHttpPort,
        lettersHttpHost,
        lettersHttpPath,
        lettersHttpWallRedact,
        cityHttpPort,
        cityHttpHost,
        cityHttpPathPrefix,
        cityHttpToken,
    };
}

export function loadControllerConfig(configPath = DEFAULT_CONFIG_PATH): ControllerConfig {
    const resolvedPath = path.resolve(process.cwd(), configPath);
    const raw = fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, 'utf8') : '';
    const parsed = raw ? yaml.load(interpolateEnv(raw)) : {};
    const source = isRecord(parsed) ? parsed : {};
    const baseDir = path.dirname(resolvedPath);

    const config: ControllerConfig = {
        controller: {
            instanceId: readString(
                readPath(source, ['controller', 'instanceId']),
                process.env.CONTROLLER_INSTANCE_ID || `local-${process.pid}`,
            ),
        },
        residents: readStringArray(source.residents),
        gateway: {
            url: readString(readPath(source, ['gateway', 'url']), 'ws://127.0.0.1:43595'),
            authToken: readOptionalString(readPath(source, ['gateway', 'authToken'])),
            controllerId: readString(readPath(source, ['gateway', 'controllerId']), 'nullcity-controller'),
        },
        inference: {
            maxConcurrent: readNumber(readPath(source, ['inference', 'maxConcurrent']), 8),
        },
        souls: {
            dir: resolveFrom(baseDir, readString(readPath(source, ['souls', 'dir']), './data/souls')),
        },
        memory: {
            dir: resolveFrom(baseDir, readString(readPath(source, ['memory', 'dir']), './data/memory')),
            qmdBin: readString(readPath(source, ['memory', 'qmdBin']), 'qmd'),
        },
        logging: {
            dir: resolveFrom(baseDir, readString(readPath(source, ['logging', 'dir']), './data/logs')),
            fullPerceptions: readBoolean(readPath(source, ['logging', 'fullPerceptions']), false),
        },
        knowledge: {
            dir: resolveFrom(baseDir, readString(readPath(source, ['knowledge', 'dir']), './data/knowledge')),
            runebenchWikiDir: readOptionalResolvedPath(baseDir, readPath(source, ['knowledge', 'runebenchWikiDir'])),
            enableSuggestions: readBoolean(readPath(source, ['knowledge', 'enableSuggestions']), true),
            emitStdout: readBoolean(readPath(source, ['knowledge', 'emitStdout']), true),
            storageMode: readKnowledgeStorageMode(readPath(source, ['knowledge', 'storageMode']), 'persistent-volume'),
        },
        llm: {
            endpoints: readLlmEndpoints(readPath(source, ['llm', 'endpoints'])),
        },
        patrons: readPatronArray(source.patrons),
    };

    return config;
}

export function productionConfigIssues(config: ControllerConfig, env: Record<string, string | undefined> = process.env): string[] {
    if (env.NODE_ENV !== 'production' && env.RAILGUN !== 'true') {
        return [];
    }

    const issues: string[] = [];
    if (!config.controller.instanceId || config.controller.instanceId.startsWith('local-')) {
        issues.push('controller.instanceId must be explicit in production');
    }
    if (!config.gateway.controllerId) {
        issues.push('gateway.controllerId is required in production');
    }
    if (!config.gateway.url || /^ws:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(config.gateway.url)) {
        issues.push('gateway.url must not use a loopback default in production');
    }
    if (config.gateway.url && !/^ws:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(config.gateway.url) && !config.gateway.authToken) {
        issues.push('gateway.authToken is required in production when gateway.url is remote');
    }
    if (!isProductionDurableDir(config.memory.dir)) {
        issues.push('memory.dir must be explicit in production');
    }
    if (!isProductionDurableDir(config.logging.dir)) {
        issues.push('logging.dir must be explicit in production');
    }
    if (!Object.values(config.llm.endpoints).some(endpoint => endpoint.baseUrl)) {
        issues.push('at least one llm endpoint baseUrl is required in production');
    }
    if (config.knowledge.storageMode === 'persistent-volume' && !isProductionDurableDir(config.knowledge.dir)) {
        issues.push('CONTROLLER_KNOWLEDGE_DIR is required in production when storageMode is persistent-volume');
    }

    return issues;
}

export function assertProductionControllerConfig(config: ControllerConfig, env: Record<string, string | undefined> = process.env): void {
    const issues = productionConfigIssues(config, env);
    if (issues.length) {
        throw new Error(`Invalid production controller config:\n- ${issues.join('\n- ')}`);
    }
}

export function sanitizedControllerConfigSummary(config: ControllerConfig): string {
    return [
        `controllerId=${config.gateway.controllerId}`,
        `instanceId=${config.controller.instanceId}`,
        `residents=${config.residents.length}`,
        `knowledgeMode=${config.knowledge.storageMode}`,
        `suggestions=${config.knowledge.enableSuggestions ? 'enabled' : 'disabled'}`,
        `wiki=${config.knowledge.runebenchWikiDir ? 'configured' : 'disabled'}`,
    ].join(' ');
}

function interpolateEnv(raw: string): string {
    return raw.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name: string) => process.env[name] || '');
}

function resolveFrom(baseDir: string, value: string): string {
    return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function readPath(source: Record<string, unknown>, keys: string[]): unknown {
    let current: unknown = source;
    for (const key of keys) {
        if (!isRecord(current)) {
            return undefined;
        }
        current = current[key];
    }
    return current;
}

function readString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOptionalResolvedPath(baseDir: string, value: unknown): string | undefined {
    const stringValue = readOptionalString(value);
    return stringValue ? resolveFrom(baseDir, stringValue) : undefined;
}

function readNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readOptionalPort(value: string | undefined, label: string): number | undefined {
    if (!value) {
        return undefined;
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`${label} must be an integer port between 0 and 65535`);
    }
    return port;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function readEnvBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value.length === 0) {
        return fallback;
    }
    return value === '1' || value.toLowerCase() === 'true';
}

function readKnowledgeStorageMode(value: unknown, fallback: KnowledgeStorageMode): KnowledgeStorageMode {
    return value === 'ephemeral' || value === 'persistent-volume' || value === 'external-store' ? value : fallback;
}

function isProductionDurableDir(value: string): boolean {
    if (!path.isAbsolute(value)) {
        return false;
    }
    return value === '/data' || value.startsWith('/data/');
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readLlmEndpoints(value: unknown): Record<string, LlmEndpointConfig> {
    const endpoints: Record<string, LlmEndpointConfig> = {
        default: { timeoutMs: 30000 },
    };

    if (!isRecord(value)) {
        return endpoints;
    }

    for (const [name, endpoint] of Object.entries(value)) {
        if (!isRecord(endpoint)) {
            continue;
        }

        endpoints[name] = {
            baseUrl: readOptionalString(endpoint.baseUrl),
            apiKey: readOptionalString(endpoint.apiKey),
            model: readOptionalString(endpoint.model),
            timeoutMs: readNumber(endpoint.timeoutMs, 30000),
        };
    }

    return endpoints;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPatronArray(value: unknown): PatronConfig[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const patrons: PatronConfig[] = [];
    for (const item of value) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const handle = typeof item.handle === 'string' ? item.handle : '';
            const kind = typeof item.kind === 'string' ? item.kind : '';
            if (handle && (kind === 'patron_gift' || kind === 'patron_witness' || kind === 'patron_sponsor')) {
                patrons.push({ handle, kind });
            }
        }
    }
    return patrons;
}
