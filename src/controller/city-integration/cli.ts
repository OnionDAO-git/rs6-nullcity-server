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
 *   npm run city:digest -- --memory-root <path> --strict
 *
 * Flags:
 *   --memory-root <p>  REQUIRED. Root containing city-integration/economy-events.jsonl
 *                      and city-integration/goals/*.json.
 *   --since <iso>      Optional inclusive lower bound on event ts (ISO string).
 *   --until <iso>      Optional inclusive upper bound on event ts (ISO string).
 *   --strict           Reject memory-root paths that contain '..' traversal components.
 */
import fs from 'fs';
import path from 'path';
import { buildCityEventDigest } from './city-event-digest';
import { EconomyEventLog } from './economy-event';
import { GoalContractStore } from './goal-contract';

export interface CityDigestCliArgs {
    memoryRoot: string;
    since?: string;
    until?: string;
    /** Reject memory-root paths that contain '..' traversal components. */
    strict?: boolean;
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
    let strict = false;

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
        } else if (flag === '--strict') {
            strict = true;
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
    if (strict) result.strict = true;
    return result;
}

export interface RunCityDigestOptions {
    now?: () => Date;
    /** Override stderr warning sink for testability. Defaults to process.stderr.write. */
    warn?: (msg: string) => void;
}

/**
 * Pure entry point — no process.exit, no console writes. Returns the digest as
 * a JSON string (stable, sorted keys via JSON.stringify with indent). Suitable
 * for tests and callers that want the raw output.
 */
export function runCityDigest(args: CityDigestCliArgs, options: RunCityDigestOptions = {}): string {
    const warn = options.warn ?? ((msg: string) => process.stderr.write(msg + '\n'));
    const now = options.now ?? (() => new Date());

    // --strict: reject paths with '..' traversal components before any fs access
    if (args.strict) {
        const parts = args.memoryRoot.replace(/\\/g, '/').split('/');
        if (parts.some(p => p === '..')) {
            throw new CityDigestCliError('unsafe_path', `--strict: memory-root path must not contain '..' traversals: ${args.memoryRoot}`);
        }
    }

    // Fail fast when the memory root does not exist — prevents silent empty digest
    // from a mis-typed or wrong path.
    if (!fs.existsSync(args.memoryRoot)) {
        throw new CityDigestCliError('memory_root_not_found', `memory root does not exist: ${args.memoryRoot}`);
    }

    // Warn when city-integration/ subdir is absent — helps operators know the
    // path is valid but no events have been written yet.
    const cityIntDir = path.join(args.memoryRoot, 'city-integration');
    if (!fs.existsSync(cityIntDir)) {
        warn(`city:digest: city-integration/ not found in ${args.memoryRoot} — no economy events on record`);
    }

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
        'Usage: npm run city:digest -- --memory-root <path> [--since <iso>] [--until <iso>] [--strict]',
        '',
        'Builds a CityEventDigest from the EconomyEventLog + GoalContractStore under',
        '<path> and prints JSON to stdout. Pure aggregation — no LLM, no invented facts.',
        '',
        'Flags:',
        '  --memory-root <p>  REQUIRED. Path must exist; warns if city-integration/ is absent.',
        '  --since <iso>      Inclusive lower bound on event ts.',
        '  --until <iso>      Inclusive upper bound on event ts.',
        '  --strict           Reject paths containing ".." traversal components.',
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
