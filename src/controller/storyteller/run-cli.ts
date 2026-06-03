#!/usr/bin/env node
/**
 * storyteller:run CLI  (S7b)
 *
 * Calls the model-backed Storyteller on a fixture or latest digest, writes
 * dispatch.json to disk, and prints the result. Requires the model endpoint
 * to be configured via environment variables or defaults to a nooped run.
 *
 * Usage:
 *   npm run storyteller:run -- --fixture
 *   npm run storyteller:run -- --latest
 *   npm run storyteller:run -- --digest-id live-20260530060000
 *   npm run storyteller:run -- --fixture --model-profile storyteller-v1
 *   npm run storyteller:run -- --fixture --output-dir data/controller/storyteller
 *
 * Environment variables (override per-run):
 *   STORYTELLER_LLM_BASE_URL   e.g. http://localhost:11434
 *   STORYTELLER_LLM_API_KEY    optional Bearer token
 *   STORYTELLER_LLM_MODEL      e.g. llama3, qwen2.5-7b
 *   OPENROUTER_API_KEY + OPENROUTER_STORYTELLER_MODEL can be used instead
 *   STORYTELLER_DAILY_COST_CAP_USD  required when any paid endpoint is set
 *
 * Flags:
 *   --fixture                  Use the canonical fixture digest
 *   --latest                   Use latest digest.json from --output-dir
 *   --digest-id <id>           Use a specific persisted digest id from --output-dir
 *   --model-profile <name>     Endpoint/profile key (default: "default")
 *   --output-dir <path>        Where to write artifacts (default: data/controller/storyteller)
 *   --daily-cost-cap-usd <usd> Required when STORYTELLER_LLM_BASE_URL is set; overrides env cap
 */
import path from 'path';
import type { LlmEndpointConfig } from '../config';
import { buildFixtureDigest } from './digest-builder';
import { StorytellerStore } from './store';
import { StorytellerModelClient } from './model-client';
import { preflightStorytellerPaidModelBudget, StorytellerOverseerCliError } from './overseer';
import type { CityEventDigest, StorytellerDispatch } from './types';
import { DEFAULT_STORYTELLER_CONFIG } from './types';

export type StorytellerRunSource = 'none' | 'fixture' | 'latest' | 'digest-id';

export interface StorytellerRunArgs {
    source: StorytellerRunSource;
    modelProfile: string;
    outputDir: string;
    digestId?: string;
    dailyCostCapUsd?: number;
}

export interface StorytellerRunOptions {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    now?: () => Date;
}

export interface StorytellerRunResult {
    digest: CityEventDigest;
    dispatch: StorytellerDispatch;
    artifactDir: string;
}

export class StorytellerRunCliError extends Error {
    constructor(
        public readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'StorytellerRunCliError';
    }
}

export function parseStorytellerRunArgs(
    argv: string[],
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): StorytellerRunArgs {
    let source: StorytellerRunSource = 'none';
    let digestId: string | undefined;
    let modelProfile = env.STORYTELLER_MODEL_PROFILE ?? 'default';
    let outputDir = path.join('data', 'controller', 'storyteller');
    let dailyCostCapUsd = parseOptionalDailyCostCap(env.STORYTELLER_DAILY_COST_CAP_USD, 'STORYTELLER_DAILY_COST_CAP_USD');

    const claimSource = (nextSource: StorytellerRunSource): void => {
        if (source !== 'none') {
            throw new StorytellerRunCliError('conflicting_sources', 'use exactly one of --fixture, --latest, or --digest-id');
        }
        source = nextSource;
    };

    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const next = argv[i + 1];
        if (flag === '--fixture') {
            claimSource('fixture');
        } else if (flag === '--latest') {
            claimSource('latest');
        } else if (flag === '--digest-id') {
            if (!next) throw new StorytellerRunCliError('missing_value', '--digest-id requires a value');
            claimSource('digest-id');
            digestId = next;
            i++;
        } else if (flag === '--model-profile') {
            if (!next) throw new StorytellerRunCliError('missing_value', '--model-profile requires a value');
            modelProfile = next;
            i++;
        } else if (flag === '--output-dir') {
            if (!next) throw new StorytellerRunCliError('missing_value', '--output-dir requires a path');
            outputDir = next;
            i++;
        } else if (flag === '--daily-cost-cap-usd') {
            if (!next) throw new StorytellerRunCliError('missing_value', '--daily-cost-cap-usd requires a number');
            dailyCostCapUsd = parseRequiredDailyCostCap(next, '--daily-cost-cap-usd');
            i++;
        } else if (flag === '--help' || flag === '-h') {
            throw new StorytellerRunCliError('help', usage());
        } else {
            throw new StorytellerRunCliError('unknown_flag', `unknown flag: ${flag}`);
        }
    }

    const parsed: StorytellerRunArgs = { source, modelProfile, outputDir };
    if (digestId !== undefined) parsed.digestId = digestId;
    if (dailyCostCapUsd !== undefined) parsed.dailyCostCapUsd = dailyCostCapUsd;
    return parsed;
}

function buildEndpoints(
    modelProfile: string,
    env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, LlmEndpointConfig> {
    const endpoint = resolveConfiguredEndpoint(env);

    const endpoints: Record<string, LlmEndpointConfig> = {};

    if (endpoint) {
        const endpointCfg: LlmEndpointConfig = {
            baseUrl: endpoint.baseUrl,
            model: endpoint.model,
            timeoutMs: 60_000,
            responseFormat: 'text',
        };
        if (endpoint.apiKey) endpointCfg.apiKey = endpoint.apiKey;
        endpoints[modelProfile] = endpointCfg;
        if (modelProfile !== 'default') {
            endpoints['default'] = endpointCfg;
        }
    } else {
        // No endpoint configured — LlmClient will noop. Dispatch will have needsReview=true.
        endpoints['default'] = { timeoutMs: 60_000 };
        if (modelProfile !== 'default') {
            endpoints[modelProfile] = { timeoutMs: 60_000 };
        }
    }

    return endpoints;
}

function resolveConfiguredEndpoint(env: NodeJS.ProcessEnv | Record<string, string | undefined>):
    | {
          baseUrl: string;
          apiKey?: string;
          model: string;
      }
    | undefined {
    const baseUrl = env.STORYTELLER_LLM_BASE_URL;
    if (baseUrl) {
        return {
            baseUrl,
            apiKey: env.STORYTELLER_LLM_API_KEY || undefined,
            model: env.STORYTELLER_LLM_MODEL || 'llama3',
        };
    }

    if (env.OPENROUTER_API_KEY) {
        return {
            baseUrl: 'https://openrouter.ai/api',
            apiKey: env.OPENROUTER_API_KEY,
            model: env.OPENROUTER_STORYTELLER_MODEL || env.OPENROUTER_HAIKU_MODEL || 'anthropic/claude-3.5-haiku',
        };
    }

    return undefined;
}

function readDigestForRun(args: StorytellerRunArgs, store: StorytellerStore): CityEventDigest {
    if (args.source === 'fixture') {
        return buildFixtureDigest().digest;
    }
    if (args.source === 'latest') {
        const digest = store.readLatestDigest();
        if (!digest) {
            throw new StorytellerRunCliError('digest_not_found', `no digest.json files found in ${args.outputDir}`);
        }
        return digest;
    }
    if (args.source === 'digest-id') {
        if (!args.digestId) {
            throw new StorytellerRunCliError('missing_value', '--digest-id requires a value');
        }
        const digest = store.readDigest(args.digestId);
        if (!digest) {
            throw new StorytellerRunCliError('digest_not_found', `digest '${args.digestId}' not found in ${args.outputDir}`);
        }
        return digest;
    }
    throw new StorytellerRunCliError('missing_source', 'use exactly one of --fixture, --latest, or --digest-id');
}

export async function runStoryteller(args: StorytellerRunArgs, options: StorytellerRunOptions = {}): Promise<StorytellerRunResult> {
    const env = options.env ?? process.env;
    const store = new StorytellerStore(args.outputDir);
    const digest = readDigestForRun(args, store);
    if (hasConfiguredModelEndpoint(env)) {
        runPaidModelBudgetPreflight(args, options);
    }
    const endpoints = buildEndpoints(args.modelProfile, env);
    const config = { ...DEFAULT_STORYTELLER_CONFIG, modelProfile: args.modelProfile };
    const client = new StorytellerModelClient(endpoints);
    const dispatch = await client.run(digest, config, { modelProfile: args.modelProfile });
    store.writeDigest(digest);
    store.writeDispatch(dispatch);

    return {
        digest,
        dispatch,
        artifactDir: path.join(args.outputDir, digest.digestId, ''),
    };
}

function usage(): string {
    return [
        'Usage:',
        '  npm run storyteller:run -- --fixture [--model-profile <name>] [--output-dir <path>]',
        '  npm run storyteller:run -- --latest [--model-profile <name>] [--output-dir <path>]',
        '  npm run storyteller:run -- --digest-id <id> [--model-profile <name>] [--output-dir <path>]',
        '                                        [--daily-cost-cap-usd <usd>]',
        '',
        'Runs the Storyteller model over one digest. Without STORYTELLER_LLM_BASE_URL it writes a nooped dispatch for review.',
        'OPENROUTER_API_KEY + OPENROUTER_STORYTELLER_MODEL are also accepted as a Storyteller endpoint.',
        'When a paid endpoint is set, provide --daily-cost-cap-usd or STORYTELLER_DAILY_COST_CAP_USD.',
    ].join('\n');
}

function parseOptionalDailyCostCap(value: string | undefined, label: string): number | undefined {
    if (value === undefined || value.trim() === '') {
        return undefined;
    }
    return parseRequiredDailyCostCap(value, label);
}

function parseRequiredDailyCostCap(value: string, label: string): number {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new StorytellerRunCliError('invalid_cost_cap', `${label} must be a non-negative number`);
    }
    return parsed;
}

function hasConfiguredModelEndpoint(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
    return !!resolveConfiguredEndpoint(env);
}

function runPaidModelBudgetPreflight(args: StorytellerRunArgs, options: StorytellerRunOptions): void {
    try {
        preflightStorytellerPaidModelBudget({
            outputDir: args.outputDir,
            dailyCostCapUsd: args.dailyCostCapUsd,
            now: options.now,
        });
    } catch (err) {
        if (err instanceof StorytellerOverseerCliError) {
            throw new StorytellerRunCliError(err.code, err.message);
        }
        throw err;
    }
}

async function main(): Promise<void> {
    let args: StorytellerRunArgs;
    try {
        args = parseStorytellerRunArgs(process.argv.slice(2));
    } catch (err) {
        if (err instanceof StorytellerRunCliError) {
            if (err.code === 'help') {
                process.stdout.write(`${err.message}\n`);
                process.exit(0);
            }
            process.stderr.write(`Error: ${err.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        throw err;
    }

    const hasEndpoint = hasConfiguredModelEndpoint(process.env);
    console.log(`[storyteller:run] Digest source: ${args.source}${args.digestId ? ` (${args.digestId})` : ''}`);
    console.log(
        `[storyteller:run] Model profile: "${args.modelProfile}"${hasEndpoint ? '' : ' (no Storyteller model endpoint set — will noop)'}`,
    );
    console.log(`[storyteller:run] Calling model...`);

    let result: StorytellerRunResult;
    try {
        result = await runStoryteller(args);
    } catch (err) {
        if (err instanceof StorytellerRunCliError) {
            process.stderr.write(`Error: ${err.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        throw err;
    }

    const { dispatch } = result;
    console.log(`[storyteller:run] Digest: ${result.digest.digestId}`);
    console.log(`[storyteller:run] Artifacts written to: ${result.artifactDir}`);
    console.log('');
    console.log(`Title:   ${dispatch.publicTitle}`);
    console.log(`Body:    ${dispatch.publicBody}`);
    if (dispatch.publicBullets.length > 0) {
        console.log('Bullets:');
        for (const b of dispatch.publicBullets) console.log(`  - ${b}`);
    }
    console.log('');
    console.log(`Operator summary: ${dispatch.operatorSummary}`);
    console.log(`needsReview: ${dispatch.needsReview}`);
    if (dispatch.reviewReasons && dispatch.reviewReasons.length > 0) {
        console.log('Review reasons:');
        for (const r of dispatch.reviewReasons) console.log(`  - ${r}`);
    }
    console.log(
        `Model: ${args.modelProfile} | Latency: ${dispatch.latencyMs}ms | Tokens in/out: ${dispatch.inputTokens ?? '?'}/${dispatch.outputTokens ?? '?'} | Cost: ${dispatch.estimatedCostUsd !== null ? `$${dispatch.estimatedCostUsd.toFixed(6)}` : 'unknown'} USD`,
    );
}

if (require.main === module) {
    main().catch(err => {
        console.error('[storyteller:run] Fatal error:', err);
        process.exit(1);
    });
}
