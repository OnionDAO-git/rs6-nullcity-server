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
 *   npm run storyteller:run -- --fixture --model-profile storyteller-v1
 *   npm run storyteller:run -- --fixture --output-dir data/controller/storyteller
 *
 * Environment variables (override per-run):
 *   STORYTELLER_LLM_BASE_URL   e.g. http://localhost:11434
 *   STORYTELLER_LLM_API_KEY    optional Bearer token
 *   STORYTELLER_LLM_MODEL      e.g. llama3, qwen2.5-7b
 *
 * Flags:
 *   --fixture                  Use the canonical fixture digest
 *   --model-profile <name>     Endpoint/profile key (default: "default")
 *   --output-dir <path>        Where to write artifacts (default: data/controller/storyteller)
 */
import path from 'path';
import type { LlmEndpointConfig } from '../config';
import { buildFixtureDigest } from './digest-builder';
import { StorytellerStore } from './store';
import { StorytellerModelClient } from './model-client';
import { DEFAULT_STORYTELLER_CONFIG } from './types';

function parseArgs(argv: string[]): { fixture: boolean; modelProfile: string; outputDir: string } {
    let fixture = false;
    let modelProfile = process.env.STORYTELLER_MODEL_PROFILE ?? 'default';
    let outputDir = path.join('data', 'controller', 'storyteller');

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--fixture') {
            fixture = true;
        } else if (argv[i] === '--model-profile' && argv[i + 1]) {
            modelProfile = argv[++i];
        } else if (argv[i] === '--output-dir' && argv[i + 1]) {
            outputDir = argv[++i];
        }
    }

    return { fixture, modelProfile, outputDir };
}

function buildEndpoints(modelProfile: string): Record<string, LlmEndpointConfig> {
    const baseUrl = process.env.STORYTELLER_LLM_BASE_URL;
    const apiKey = process.env.STORYTELLER_LLM_API_KEY ?? undefined;
    const model = process.env.STORYTELLER_LLM_MODEL ?? 'llama3';

    const endpoints: Record<string, LlmEndpointConfig> = {};

    if (baseUrl) {
        const endpointCfg: LlmEndpointConfig = { baseUrl, model, timeoutMs: 60_000 };
        if (apiKey) endpointCfg.apiKey = apiKey;
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

async function main(): Promise<void> {
    const { fixture, modelProfile, outputDir } = parseArgs(process.argv.slice(2));

    if (!fixture) {
        console.error('Error: --fixture is required. Live digest reading is not implemented yet.');
        console.error('Usage: npm run storyteller:run -- --fixture [--model-profile <name>]');
        process.exit(1);
    }

    console.log(`[storyteller:run] Building fixture digest...`);
    const { digest } = buildFixtureDigest();

    const store = new StorytellerStore(outputDir);
    const endpoints = buildEndpoints(modelProfile);
    const config = { ...DEFAULT_STORYTELLER_CONFIG, modelProfile };
    const client = new StorytellerModelClient(endpoints);

    const hasEndpoint = !!process.env.STORYTELLER_LLM_BASE_URL;
    console.log(`[storyteller:run] Model profile: "${modelProfile}"${hasEndpoint ? '' : ' (no STORYTELLER_LLM_BASE_URL set — will noop)'}`);
    console.log(`[storyteller:run] Digest: ${digest.digestId}`);
    console.log(`[storyteller:run] Calling model...`);

    const dispatch = await client.run(digest, config, { modelProfile });

    store.writeDigest(digest);
    store.writeDispatch(dispatch);

    console.log(`[storyteller:run] Artifacts written to: ${path.join(outputDir, digest.digestId, '')}`);
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
        `Model: ${modelProfile} | Latency: ${dispatch.latencyMs}ms | Tokens in/out: ${dispatch.inputTokens ?? '?'}/${dispatch.outputTokens ?? '?'} | Cost: ${dispatch.estimatedCostUsd !== null ? `$${dispatch.estimatedCostUsd.toFixed(6)}` : 'unknown'} USD`,
    );
}

main().catch(err => {
    console.error('[storyteller:run] Fatal error:', err);
    process.exit(1);
});
