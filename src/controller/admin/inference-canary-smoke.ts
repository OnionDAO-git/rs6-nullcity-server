import type { LlmEndpointConfig } from '../config';
import { loadControllerConfig } from '../config';
import { runInferenceHealthProbe, type InferenceHealthResult } from '../llm/inference-health';

export const DEFAULT_INFERENCE_CANARY_ENDPOINTS = ['default', 'spacetower_qwopus_q4'];

export interface InferenceCanarySmokeCliOptions {
    configPath: string;
    endpointNames: string[];
    timeoutMs: number;
    json: boolean;
    all: boolean;
}

export interface InferenceCanarySmokeOptions {
    endpoints: Record<string, LlmEndpointConfig>;
    endpointNames: string[];
    timeoutMs: number;
    probe?: (options: {
        endpoints: Record<string, LlmEndpointConfig>;
        endpoint: string;
        timeoutMs: number;
    }) => Promise<InferenceHealthResult>;
}

export interface InferenceCanarySmokeReport {
    ok: boolean;
    results: InferenceHealthResult[];
}

export function parseInferenceCanarySmokeArgs(argv: string[]): InferenceCanarySmokeCliOptions {
    const options: InferenceCanarySmokeCliOptions = {
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        endpointNames: [...DEFAULT_INFERENCE_CANARY_ENDPOINTS],
        timeoutMs: readPositiveInteger(
            process.env.CONTROLLER_INFERENCE_CANARY_TIMEOUT_MS || '30000',
            'CONTROLLER_INFERENCE_CANARY_TIMEOUT_MS',
        ),
        json: false,
        all: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--config' || arg === '-c') {
            const next = argv[i + 1];
            if (!next) throw new Error(`${arg} requires a path`);
            options.configPath = next;
            i += 1;
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else if (arg === '--endpoint') {
            const next = argv[i + 1];
            if (!next) throw new Error('--endpoint requires a value');
            addEndpoint(options, next);
            i += 1;
        } else if (arg.startsWith('--endpoint=')) {
            addEndpoint(options, arg.slice('--endpoint='.length));
        } else if (arg === '--endpoints') {
            const next = argv[i + 1];
            if (!next) throw new Error('--endpoints requires a comma-separated list');
            addEndpoints(options, next);
            i += 1;
        } else if (arg.startsWith('--endpoints=')) {
            addEndpoints(options, arg.slice('--endpoints='.length));
        } else if (arg === '--all') {
            options.all = true;
            options.endpointNames = [];
        } else if (arg === '--timeout-ms') {
            const next = argv[i + 1];
            if (!next) throw new Error('--timeout-ms requires a value');
            options.timeoutMs = readPositiveInteger(next, '--timeout-ms');
            i += 1;
        } else if (arg.startsWith('--timeout-ms=')) {
            options.timeoutMs = readPositiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
        } else if (arg === '--json') {
            options.json = true;
        } else {
            throw new Error(`Unknown argument ${arg}`);
        }
    }

    return options;
}

export async function runInferenceCanarySmoke(options: InferenceCanarySmokeOptions): Promise<InferenceCanarySmokeReport> {
    const probe =
        options.probe ||
        ((probeOptions: { endpoints: Record<string, LlmEndpointConfig>; endpoint: string; timeoutMs: number }) =>
            runInferenceHealthProbe({
                endpoints: probeOptions.endpoints,
                endpoint: probeOptions.endpoint,
                timeoutMs: probeOptions.timeoutMs,
            }));

    const results: InferenceHealthResult[] = [];
    for (const endpoint of options.endpointNames) {
        if (!options.endpoints[endpoint]) {
            results.push({
                ok: false,
                status: 'not_configured',
                endpoint,
                error: 'endpoint not found in controller config',
            });
            continue;
        }
        results.push(await probe({ endpoints: options.endpoints, endpoint, timeoutMs: options.timeoutMs }));
    }

    return { ok: results.every(result => result.ok), results };
}

export async function runInferenceCanarySmokeCli(argv: string[]): Promise<number> {
    try {
        const options = parseInferenceCanarySmokeArgs(argv);
        const config = loadControllerConfig(options.configPath);
        const endpointNames = options.all ? Object.keys(config.llm.endpoints) : options.endpointNames;
        const report = await runInferenceCanarySmoke({
            endpoints: config.llm.endpoints,
            endpointNames,
            timeoutMs: options.timeoutMs,
        });

        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            for (const result of report.results) {
                const label = result.ok ? 'PASS' : 'FAIL';
                const latency = result.latencyMs === undefined ? '' : ` ${result.latencyMs}ms`;
                const model = result.model ? ` model=${result.model}` : '';
                const error = result.error ? ` error=${result.error}` : '';
                console.log(`${label} ${result.endpoint} status=${result.status}${latency}${model}${error}`);
            }
        }
        return report.ok ? 0 : 1;
    } catch (error) {
        console.error(`[inference:canary] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

function addEndpoints(options: InferenceCanarySmokeCliOptions, value: string): void {
    const names = value
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
    if (names.length === 0) throw new Error('--endpoints cannot be empty');
    options.endpointNames = names;
    options.all = false;
}

function addEndpoint(options: InferenceCanarySmokeCliOptions, value: string): void {
    const name = value.trim();
    if (!name) throw new Error('--endpoint cannot be empty');
    const stillUsingDefaults =
        options.endpointNames.length === DEFAULT_INFERENCE_CANARY_ENDPOINTS.length &&
        options.endpointNames.every((endpoint, index) => endpoint === DEFAULT_INFERENCE_CANARY_ENDPOINTS[index]);
    if (options.all || stillUsingDefaults) {
        options.endpointNames = [];
    }
    options.all = false;
    if (!options.endpointNames.includes(name)) {
        options.endpointNames.push(name);
    }
}

function readPositiveInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}

if (require.main === module) {
    runInferenceCanarySmokeCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
