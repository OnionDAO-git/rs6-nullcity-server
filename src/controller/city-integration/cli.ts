#!/usr/bin/env node
/**
 * city:digest CLI
 *
 * Builds a CityEventDigest from the EconomyEventLog + GoalContractStore under
 * the given memoryRoot and prints the result as JSON to stdout. Pure
 * aggregation — no LLM, no invented facts.
 *
 * Usage:
 *   npm run city:digest -- --memory-root <path>
 *   npm run city:digest -- --memory-root <path> --since 2026-05-29T00:00:00.000Z
 *   npm run city:digest -- --memory-root <path> --since <iso> --until <iso>
 *
 * Flags:
 *   --memory-root <p>  REQUIRED. Root containing city-integration/economy-events.jsonl
 *                      and city-integration/goals/*.json.
 *   --since <iso>      Optional inclusive lower bound on event ts (ISO string).
 *   --until <iso>      Optional inclusive upper bound on event ts (ISO string).
 */
import { buildCityEventDigest } from './city-event-digest';
import { EconomyEventLog } from './economy-event';
import { GoalContractStore } from './goal-contract';

export interface CityDigestCliArgs {
    memoryRoot: string;
    since?: string;
    until?: string;
}

export class CityDigestCliError extends Error {
    constructor(
        public readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'CityDigestCliError';
    }
}

export function parseCityDigestArgs(argv: string[]): CityDigestCliArgs {
    let memoryRoot: string | undefined;
    let since: string | undefined;
    let until: string | undefined;

    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const next = argv[i + 1];
        if (flag === '--memory-root') {
            if (!next) {
                throw new CityDigestCliError('missing_value', '--memory-root requires a path argument');
            }
            memoryRoot = next;
            i++;
        } else if (flag === '--since') {
            if (!next) {
                throw new CityDigestCliError('missing_value', '--since requires an ISO timestamp');
            }
            since = next;
            i++;
        } else if (flag === '--until') {
            if (!next) {
                throw new CityDigestCliError('missing_value', '--until requires an ISO timestamp');
            }
            until = next;
            i++;
        } else if (flag === '--help' || flag === '-h') {
            throw new CityDigestCliError('help', usage());
        } else {
            throw new CityDigestCliError('unknown_flag', `unknown flag: ${flag}`);
        }
    }

    if (!memoryRoot) {
        throw new CityDigestCliError('missing_memory_root', '--memory-root is required');
    }

    const result: CityDigestCliArgs = { memoryRoot };
    if (since !== undefined) result.since = since;
    if (until !== undefined) result.until = until;
    return result;
}

export interface RunCityDigestOptions {
    now?: () => Date;
}

/**
 * Pure entry point — no process.exit, no console writes. Returns the digest as
 * a JSON string (stable, sorted keys via JSON.stringify with indent). Suitable
 * for tests and callers that want the raw output.
 */
export function runCityDigest(args: CityDigestCliArgs, options: RunCityDigestOptions = {}): string {
    const now = options.now ?? (() => new Date());
    const log = new EconomyEventLog(args.memoryRoot);
    const goals = new GoalContractStore(args.memoryRoot);

    const events = log.readAll();
    const goalsList = goals.list();

    const digest = buildCityEventDigest(events, {
        generatedAt: now().toISOString(),
        ...(args.since !== undefined ? { windowStart: args.since } : {}),
        ...(args.until !== undefined ? { windowEnd: args.until } : {}),
        goals: goalsList,
    });

    return JSON.stringify(digest, null, 2);
}

function usage(): string {
    return [
        'Usage: npm run city:digest -- --memory-root <path> [--since <iso>] [--until <iso>]',
        '',
        'Builds a CityEventDigest from the EconomyEventLog + GoalContractStore under',
        '<path> and prints JSON to stdout. Pure aggregation — no LLM, no invented facts.',
    ].join('\n');
}

function main(): void {
    let args: CityDigestCliArgs;
    try {
        args = parseCityDigestArgs(process.argv.slice(2));
    } catch (err) {
        if (err instanceof CityDigestCliError) {
            if (err.code === 'help') {
                process.stdout.write(`${err.message}\n`);
                process.exit(0);
            }
            process.stderr.write(`Error: ${err.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        throw err;
    }

    const json = runCityDigest(args);
    process.stdout.write(`${json}\n`);
}

// Run main() only when invoked directly (not when imported by tests).
if (require.main === module) {
    main();
}
