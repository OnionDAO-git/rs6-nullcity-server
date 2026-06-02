/**
 * RIQ-2-SMOKE: Phase 2 PlannerPass smoke CLI.
 *
 * Validates that runPlannerPass produces a valid ≥3-stage plan for a given
 * goal when called with a configured LLM profile (planner_haiku or planner_local).
 *
 * Run:
 *   npm run planner:smoke                           (default: Firemaking goal, planner_haiku)
 *   npm run planner:smoke -- --profile planner_local
 *   npm run planner:smoke -- --goal "master Fishing" --goal-id master-fishing
 *   npm run planner:smoke -- --dry-run              (stub LLM, substrate-only, no config needed)
 *   npm run planner:smoke -- --json                 (machine-readable output)
 *
 * Phase 2 acceptance test passes when:
 *   - runPlannerPass returns success=true
 *   - Plan has ≥ PLANNER_PASS_MIN_STAGES (3) stages
 *   - Every stage has at least one requirement and a non-empty successCriteria
 *
 * Live-verify: requires a configured planner profile in controller.yml.
 * Use --dry-run for substrate-only testing in CI/cloud environments.
 */

import { loadControllerConfig } from '../config';
import { LlmClient } from '../llm/llm-client';
import { runPlannerPass, PLANNER_PASS_MIN_STAGES } from '../intelligence/planner-pass';
import type { Plan } from '../intelligence/planner-pass';
import type { LlmEndpointConfig } from '../config';
import type { LlmRequest, LlmResponse } from '../llm/llm-client';

export const PLANNER_SMOKE_DEFAULT_GOAL_ID = 'master-firemaking';
export const PLANNER_SMOKE_DEFAULT_GOAL_DESCRIPTION =
    'master Firemaking — train Firemaking to the highest level achievable through consistent log-burning';
export const PLANNER_SMOKE_DEFAULT_PROFILE = 'planner_haiku';
export const PLANNER_SMOKE_DEFAULT_TIMEOUT_MS = 90_000;
export const PLANNER_SMOKE_DEFAULT_RESIDENT_NAME = 'smoke-resident';

// Dry-run stub: a valid 3-stage plan without calling an LLM.
const DRY_RUN_PLAN_JSON = JSON.stringify({
    stages: [
        {
            id: 'acquire-axe',
            subgoal: 'Obtain a bronze axe from the Lumbridge general store',
            requirements: ['10 GP'],
            successCriteria: 'Bronze axe present in inventory',
        },
        {
            id: 'gather-logs',
            subgoal: 'Chop nearby trees to collect at least 20 normal logs',
            requirements: ['Bronze axe in inventory', 'Reachable tree'],
            successCriteria: 'At least 20 normal logs in inventory',
        },
        {
            id: 'light-fires',
            subgoal: 'Use tinderbox on logs repeatedly until Firemaking XP increases',
            requirements: ['Normal logs in inventory', 'Tinderbox in inventory'],
            successCriteria: 'Firemaking XP increased by at least 100',
        },
    ],
});

export interface PlannerPassSmokeCLIOptions {
    configPath: string;
    goalId: string;
    goalDescription: string;
    profile: string;
    residentName: string;
    timeoutMs: number;
    json: boolean;
    dryRun: boolean;
}

export interface PlannerPassSmokeOptions {
    endpoints: Record<string, LlmEndpointConfig>;
    goalId: string;
    goalDescription: string;
    profile: string;
    residentName: string;
    timeoutMs: number;
    dryRun: boolean;
    /** Injected LlmClient override for testing — replaces endpoint-based construction. */
    llmClientOverride?: LlmClient;
}

export interface PlannerPassSmokeResult {
    ok: boolean;
    goalId: string;
    goalDescription: string;
    profile: string;
    dryRun: boolean;
    stageCount: number;
    stagesWithRequirements: number;
    stagesWithCriteria: number;
    toolCallsMade: number;
    fellBackToRag: boolean;
    elapsedMs: number;
    errorReason?: string;
    plan?: Plan;
}

export function parsePlannerPassSmokeCLIArgs(argv: string[]): PlannerPassSmokeCLIOptions {
    const opts: PlannerPassSmokeCLIOptions = {
        configPath: process.env['CONTROLLER_CONFIG'] ?? 'controller.yml',
        goalId: PLANNER_SMOKE_DEFAULT_GOAL_ID,
        goalDescription: PLANNER_SMOKE_DEFAULT_GOAL_DESCRIPTION,
        profile: PLANNER_SMOKE_DEFAULT_PROFILE,
        residentName: PLANNER_SMOKE_DEFAULT_RESIDENT_NAME,
        timeoutMs: PLANNER_SMOKE_DEFAULT_TIMEOUT_MS,
        json: false,
        dryRun: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--config' || arg === '-c') {
            const next = argv[i + 1];
            if (!next) throw new Error(`${arg} requires a path`);
            opts.configPath = next;
            i++;
        } else if (arg.startsWith('--config=')) {
            opts.configPath = arg.slice('--config='.length);
        } else if (arg === '--goal') {
            const next = argv[i + 1];
            if (!next) throw new Error('--goal requires a description string');
            opts.goalDescription = next;
            i++;
        } else if (arg.startsWith('--goal=')) {
            opts.goalDescription = arg.slice('--goal='.length);
        } else if (arg === '--goal-id') {
            const next = argv[i + 1];
            if (!next) throw new Error('--goal-id requires an id string');
            opts.goalId = next;
            i++;
        } else if (arg.startsWith('--goal-id=')) {
            opts.goalId = arg.slice('--goal-id='.length);
        } else if (arg === '--profile') {
            const next = argv[i + 1];
            if (!next) throw new Error('--profile requires a profile name');
            opts.profile = next;
            i++;
        } else if (arg.startsWith('--profile=')) {
            opts.profile = arg.slice('--profile='.length);
        } else if (arg === '--resident-name') {
            const next = argv[i + 1];
            if (!next) throw new Error('--resident-name requires a name');
            opts.residentName = next;
            i++;
        } else if (arg.startsWith('--resident-name=')) {
            opts.residentName = arg.slice('--resident-name='.length);
        } else if (arg === '--timeout-ms') {
            const next = argv[i + 1];
            if (!next) throw new Error('--timeout-ms requires a number');
            const n = parseInt(next, 10);
            if (Number.isNaN(n) || n <= 0) throw new Error('--timeout-ms must be a positive integer');
            opts.timeoutMs = n;
            i++;
        } else if (arg.startsWith('--timeout-ms=')) {
            const n = parseInt(arg.slice('--timeout-ms='.length), 10);
            if (Number.isNaN(n) || n <= 0) throw new Error('--timeout-ms must be a positive integer');
            opts.timeoutMs = n;
        } else if (arg === '--json') {
            opts.json = true;
        } else if (arg === '--dry-run') {
            opts.dryRun = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return opts;
}

export async function runPlannerPassSmoke(options: PlannerPassSmokeOptions): Promise<PlannerPassSmokeResult> {
    const { goalId, goalDescription, profile, residentName, timeoutMs, dryRun } = options;

    let llmClient: LlmClient;

    if (options.llmClientOverride) {
        llmClient = options.llmClientOverride;
    } else if (dryRun) {
        // Dry-run stub: immediately returns a hard-coded valid plan without an LLM call.
        llmClient = {
            complete: async (_req: LlmRequest): Promise<LlmResponse> => ({
                text: DRY_RUN_PLAN_JSON,
                model: 'dry-run-stub',
                nooped: false,
            }),
        } as unknown as LlmClient;
    } else {
        if (!options.endpoints[profile]) {
            return {
                ok: false,
                goalId,
                goalDescription,
                profile,
                dryRun,
                stageCount: 0,
                stagesWithRequirements: 0,
                stagesWithCriteria: 0,
                toolCallsMade: 0,
                fellBackToRag: false,
                elapsedMs: 0,
                errorReason:
                    `Profile '${profile}' not found in config. ` +
                    'Configure it in controller.yml llm.profiles, ' +
                    'or use --profile planner_local / --dry-run.',
            };
        }
        llmClient = new LlmClient(options.endpoints);
    }

    const result = await runPlannerPass({
        residentName,
        goalId,
        goalDescription,
        tick: 0,
        llmClient,
        request: {
            endpoint: profile,
            timeoutMs,
        },
    });

    const stageCount = result.plan?.stages.length ?? 0;
    const stagesWithRequirements = result.plan?.stages.filter(s => s.requirements.length > 0).length ?? 0;
    const stagesWithCriteria = result.plan?.stages.filter(s => s.successCriteria.length > 0).length ?? 0;

    const metStageMin = stageCount >= PLANNER_PASS_MIN_STAGES;
    const metRequirements = stagesWithRequirements === stageCount && stageCount > 0;
    const metCriteria = stagesWithCriteria === stageCount && stageCount > 0;
    const ok = result.success && metStageMin && metRequirements && metCriteria;

    let errorReason: string | undefined;
    if (!result.success) {
        errorReason = result.error;
    } else if (!ok) {
        const parts: string[] = [];
        if (!metStageMin) parts.push(`${stageCount} stages (need ≥${PLANNER_PASS_MIN_STAGES})`);
        if (!metRequirements) parts.push(`${stagesWithRequirements}/${stageCount} stages have requirements`);
        if (!metCriteria) parts.push(`${stagesWithCriteria}/${stageCount} stages have successCriteria`);
        errorReason = `Plan did not meet acceptance criteria: ${parts.join('; ')}`;
    }

    return {
        ok,
        goalId,
        goalDescription,
        profile,
        dryRun,
        stageCount,
        stagesWithRequirements,
        stagesWithCriteria,
        toolCallsMade: result.toolCallsMade,
        fellBackToRag: result.fellBackToRag,
        elapsedMs: result.elapsedMs,
        errorReason,
        plan: result.plan,
    };
}

export async function runPlannerPassSmokeCLI(argv: string[]): Promise<void> {
    const cliOptions = parsePlannerPassSmokeCLIArgs(argv);

    let endpoints: Record<string, LlmEndpointConfig> = {};
    if (!cliOptions.dryRun) {
        try {
            const config = loadControllerConfig(cliOptions.configPath);
            endpoints = config.llm.endpoints;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (cliOptions.json) {
                process.stdout.write(JSON.stringify({ ok: false, errorReason: `Config load failed: ${msg}` }) + '\n');
            } else {
                process.stderr.write(`[planner:smoke] Config load failed: ${msg}\n`);
                process.stderr.write('Use --dry-run for substrate-only testing without a config.\n');
            }
            process.exit(1);
        }
    }

    const result = await runPlannerPassSmoke({
        endpoints,
        goalId: cliOptions.goalId,
        goalDescription: cliOptions.goalDescription,
        profile: cliOptions.profile,
        residentName: cliOptions.residentName,
        timeoutMs: cliOptions.timeoutMs,
        dryRun: cliOptions.dryRun,
    });

    if (cliOptions.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
        const tag = result.dryRun ? ' (dry-run)' : '';
        if (result.ok) {
            process.stdout.write(
                `[planner:smoke] PASS  goal=${result.goalId}  profile=${result.profile}${tag}\n` +
                    `  stages=${result.stageCount}  toolCalls=${result.toolCallsMade}  elapsedMs=${result.elapsedMs}\n`,
            );
            result.plan?.stages.forEach((stage, i) => {
                process.stdout.write(`  [${i + 1}] ${stage.id}: ${stage.subgoal}\n`);
                process.stdout.write(`      criteria: ${stage.successCriteria}\n`);
            });
        } else {
            process.stderr.write(
                `[planner:smoke] FAIL  goal=${result.goalId}  profile=${result.profile}${tag}\n` +
                    `  reason: ${result.errorReason ?? 'unknown'}\n`,
            );
        }
    }

    process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
    const args = process.argv.slice(2);
    runPlannerPassSmokeCLI(args).catch(err => {
        process.stderr.write(`[planner:smoke] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
    });
}
