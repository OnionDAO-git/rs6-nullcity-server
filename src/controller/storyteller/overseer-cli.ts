#!/usr/bin/env node
import { parseStorytellerOverseerArgs, runStorytellerOverseerTick, StorytellerOverseerCliError, usage } from './overseer';

function main(): void {
    let args;
    try {
        args = parseStorytellerOverseerArgs(process.argv.slice(2));
    } catch (err) {
        if (err instanceof StorytellerOverseerCliError) {
            if (err.code === 'help') {
                process.stdout.write(`${err.message}\n`);
                process.exit(0);
            }
            process.stderr.write(`Error: ${err.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        throw err;
    }

    if (!args.tick) {
        process.stderr.write(`Error: --tick is required\n\n${usage()}\n`);
        process.exit(1);
    }

    try {
        const result = runStorytellerOverseerTick(args);
        console.log(`[storyteller:overseer] Digest: ${result.row.digestId}`);
        console.log(`[storyteller:overseer] Decision: ${result.row.decision}`);
        console.log(`[storyteller:overseer] Reason: ${result.row.reason}`);
        console.log(`[storyteller:overseer] Fingerprint: ${result.row.fingerprint}`);
        if (result.row.artifactDir) {
            console.log(`[storyteller:overseer] Artifacts: ${result.row.artifactDir}`);
        }
        console.log(`[storyteller:overseer] Ledger row: ${result.row.rowId}`);
    } catch (err) {
        if (err instanceof StorytellerOverseerCliError) {
            process.stderr.write(`Error: ${err.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        throw err;
    }
}

if (require.main === module) {
    main();
}
