import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface ControllerConfig {
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
    llm: {
        endpoints: Record<string, LlmEndpointConfig>;
    };
}

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
}

const DEFAULT_CONFIG_PATH = 'controller.yml';

export function parseControllerArgs(argv: string[]): ControllerCliOptions {
    let configPath = process.env.CONTROLLER_CONFIG || DEFAULT_CONFIG_PATH;
    let once = false;
    let logEnvelope = false;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--once') {
            once = true;
        } else if (arg === '--log-envelope') {
            logEnvelope = true;
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

    return { configPath, once, logEnvelope };
}

export function loadControllerConfig(configPath = DEFAULT_CONFIG_PATH): ControllerConfig {
    const resolvedPath = path.resolve(process.cwd(), configPath);
    const raw = fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, 'utf8') : '';
    const parsed = raw ? yaml.load(interpolateEnv(raw)) : {};
    const source = isRecord(parsed) ? parsed : {};
    const baseDir = path.dirname(resolvedPath);

    const config: ControllerConfig = {
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
        llm: {
            endpoints: readLlmEndpoints(readPath(source, ['llm', 'endpoints'])),
        },
    };

    return config;
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

function readNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
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
