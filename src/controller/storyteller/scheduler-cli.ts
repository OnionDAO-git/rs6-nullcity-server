#!/usr/bin/env node
import {
    StorytellerSchedulerCliError,
    parseStorytellerSchedulerArgs,
    runStorytellerSchedulerTick,
    runStorytellerSchedulerWatch,
    usage,
} from './scheduler';
import { loadStorytellerLocalEnv } from './local-env';

async function main(): Promise<void> {
    loadStorytellerLocalEnv();
    let args;
    try {
        args = parseStorytellerSchedulerArgs(process.argv.slice(2));
    } catch (err) {
        if (err instanceof StorytellerSchedulerCliError) {
            if (err.code === 'help') {
                process.stdout.write(`${err.message}\n`);
                process.exit(0);
            }
            process.stderr.write(`Error: ${err.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        throw err;
    }

    if (args.mode === 'watch') {
        console.log(`[storyteller:scheduler] Watch mode every ${(args.intervalMs / 60_000).toFixed(1)}m`);
        await runStorytellerSchedulerWatch(args);
        return;
    }

    const result = await runStorytellerSchedulerTick(args);
    console.log(`[storyteller:scheduler] Window: ${result.windowStart} -> ${result.windowEnd}`);
    console.log(`[storyteller:scheduler] Digest: ${result.digestId}`);
    console.log(`[storyteller:scheduler] Model: ${result.modelStatus}`);
    console.log(`[storyteller:scheduler] Decision: ${result.row.decision}`);
    console.log(`[storyteller:scheduler] Reason: ${result.row.reason}`);
    if (result.row.artifactDir) {
        console.log(`[storyteller:scheduler] Artifacts: ${result.row.artifactDir}`);
    }
}

if (require.main === module) {
    main().catch(err => {
        if (err instanceof StorytellerSchedulerCliError) {
            process.stderr.write(`Error: ${err.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        console.error('[storyteller:scheduler] Fatal error:', err);
        process.exit(1);
    });
}
