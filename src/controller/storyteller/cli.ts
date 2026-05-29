#!/usr/bin/env node
/**
 * storyteller:dry-run CLI
 *
 * Builds a CityEventDigest and writes digest.json + summary.txt to disk.
 * Prints the operator summary to stdout.
 * Makes NO model calls — this is a deterministic dry-run gate.
 *
 * Usage:
 *   npm run storyteller:dry-run -- --fixture
 *   npm run storyteller:dry-run -- --fixture --output-dir data/controller/storyteller
 *
 * Flags:
 *   --fixture          Use the canonical fixture digest from digest-builder.ts
 *   --output-dir <d>   Where to write run artifacts (default: data/controller/storyteller)
 */
import path from 'path';
import { buildFixtureDigest } from './digest-builder';
import { StorytellerStore, buildOperatorSummary } from './store';

function parseArgs(argv: string[]): { fixture: boolean; outputDir: string } {
    let fixture = false;
    let outputDir = path.join('data', 'controller', 'storyteller');

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--fixture') {
            fixture = true;
        } else if (argv[i] === '--output-dir' && argv[i + 1]) {
            outputDir = argv[++i];
        }
    }

    return { fixture, outputDir };
}

function main(): void {
    const { fixture, outputDir } = parseArgs(process.argv.slice(2));

    if (!fixture) {
        console.error('Error: --fixture is required. Live digest building from running residents is not implemented yet.');
        console.error('Usage: npm run storyteller:dry-run -- --fixture');
        process.exit(1);
    }

    console.log('[storyteller:dry-run] Building fixture digest...');
    const { digest } = buildFixtureDigest();

    const store = new StorytellerStore(outputDir);
    store.writeDigest(digest);

    const summary = buildOperatorSummary(digest);
    store.writeSummary(digest.digestId, summary);

    console.log(`[storyteller:dry-run] digest.json written to: ${path.join(outputDir, digest.digestId, 'digest.json')}`);
    console.log(`[storyteller:dry-run] summary.txt written to: ${path.join(outputDir, digest.digestId, 'summary.txt')}`);
    console.log('');
    console.log(summary);
}

main();
