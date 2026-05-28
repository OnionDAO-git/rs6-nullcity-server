import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { loadControllerConfig } from '../config';
import { sparkModuleIdentity } from '../spark';
import { standardSparkModules } from '../spark/standard-modules';
import { GatewayClient } from '../transport/gateway-client';
import type { BenchmarkArtifact } from './benchmark-artifact';
import type { BenchmarkRunMode } from './benchmark-artifact';
import { ResidentRuntimeBenchmarkDriver } from './autonomous-runtime';
import { BenchmarkRunner, type BenchmarkTask } from './benchmark-runner';
import { emitVerifierConventions } from './verifier-conventions';
import { COMBAT_PRAYER_10M_TASK_ID, makeCombatPrayer10mBenchmarkTask } from './tasks/combat-prayer-10m';
import { EQUIPMENT_PREP_3M_TASK_ID, makeEquipmentPrep3mBenchmarkTask } from './tasks/equipment-prep-3m';
import { FISHING_COOKING_10M_TASK_ID, makeFishingCooking10mBenchmarkTask } from './tasks/fishing-cooking-10m';
import { EXPLORE_REPORT_5M_TASK_ID, makeExploreReport5mBenchmarkTask } from './tasks/explore-report-5m';
import { FOLLOW_AND_CHAT_5M_TASK_ID, makeFollowAndChat5mBenchmarkTask } from './tasks/follow-and-chat-5m';
import { MAKE_FIRE_5M_TASK_ID, makeFire5mBenchmarkTask } from './tasks/make-fire-5m';
import { MEMORY_RECALL_3M_TASK_ID, makeMemoryRecall3mBenchmarkTask } from './tasks/memory-recall-3m';
import { STARTER_FISHING_5M_TASK_ID, makeStarterFishing5mBenchmarkTask } from './tasks/starter-fishing-5m';
import { TRADING_GIVING_5M_TASK_ID, makeTradingGiving5mBenchmarkTask } from './tasks/trading-giving-5m';
import { WOODCUTTING_FIREMAKING_10M_TASK_ID, makeWoodcuttingFiremaking10mBenchmarkTask } from './tasks/woodcutting-firemaking-10m';

export interface BenchmarkCliOptions {
    taskId: string;
    moduleId: string;
    configPath: string;
    outputDir: string;
    mode: BenchmarkRunMode;
    dryRun: boolean;
}

export interface BenchmarkCliRuntime {
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
}

const DEFAULT_OUTPUT_DIR = 'data/benchmarks';
const DEFAULT_MODULE_ID = 'onion.runescape.standard';
const ALL_TASK_ID = 'all';
const CORE_TASK_IDS = [
    MAKE_FIRE_5M_TASK_ID,
    EXPLORE_REPORT_5M_TASK_ID,
    FOLLOW_AND_CHAT_5M_TASK_ID,
    WOODCUTTING_FIREMAKING_10M_TASK_ID,
    STARTER_FISHING_5M_TASK_ID,
    FISHING_COOKING_10M_TASK_ID,
    EQUIPMENT_PREP_3M_TASK_ID,
    COMBAT_PRAYER_10M_TASK_ID,
    MEMORY_RECALL_3M_TASK_ID,
    TRADING_GIVING_5M_TASK_ID,
];

export function parseBenchmarkCliArgs(argv: string[]): BenchmarkCliOptions {
    const envDryRun = process.env.CONTROLLER_BENCHMARK_DRY_RUN;
    const envMode = process.env.CONTROLLER_BENCHMARK_MODE;
    const options: BenchmarkCliOptions = {
        taskId: process.env.CONTROLLER_BENCHMARK_TASK || '',
        moduleId: process.env.CONTROLLER_BENCHMARK_MODULE || DEFAULT_MODULE_ID,
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        outputDir: process.env.CONTROLLER_BENCHMARK_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
        mode: envMode === 'autonomous' || envMode === 'scripted' ? envMode : 'scripted',
        dryRun: envDryRun === 'true' || envDryRun === '1',
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--task') {
            options.taskId = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--task=')) {
            options.taskId = arg.slice('--task='.length);
        } else if (arg === '--module') {
            options.moduleId = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--module=')) {
            options.moduleId = arg.slice('--module='.length);
        } else if (arg === '--config' || arg === '-c') {
            options.configPath = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else if (arg === '--output' || arg === '--output-dir') {
            options.outputDir = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--output=')) {
            options.outputDir = arg.slice('--output='.length);
        } else if (arg.startsWith('--output-dir=')) {
            options.outputDir = arg.slice('--output-dir='.length);
        } else if (arg === '--mode') {
            options.mode = readMode(readRequiredValue(argv, ++i, arg));
        } else if (arg.startsWith('--mode=')) {
            options.mode = readMode(arg.slice('--mode='.length));
        } else {
            throw new Error(`Unknown benchmark CLI argument ${arg}`);
        }
    }

    if (!options.taskId) {
        throw new Error('--task is required');
    }
    if (!options.moduleId) {
        throw new Error('--module is required');
    }
    return options;
}

export async function runBenchmarkCli(argv: string[], runtime: BenchmarkCliRuntime = {}): Promise<number> {
    const stdout = runtime.stdout || (text => process.stdout.write(text));
    const stderr = runtime.stderr || (text => process.stderr.write(text));

    try {
        const options = parseBenchmarkCliArgs(argv);
        const tasks = tasksById(options.taskId);
        const module = sparkModuleById(options.moduleId);
        if (options.dryRun) {
            const taskSummaries = tasks.map(task => ({ id: task.id, version: task.version }));
            stdout(
                `${JSON.stringify({
                    dryRun: true,
                    mode: options.mode,
                    ...(tasks.length === 1 ? { task: taskSummaries[0] } : { suite: { id: ALL_TASK_ID, tasks: taskSummaries } }),
                    module,
                })}\n`,
            );
            return 0;
        }

        const config = loadControllerConfig(options.configPath);
        const gateway = new GatewayClient({
            url: config.gateway.url,
            authToken: config.gateway.authToken,
            controllerId: `${config.gateway.controllerId}:benchmark`,
            reconnect: false,
        });

        await gateway.connect();
        try {
            await gateway.hello();
            const sparkModules = standardSparkModules();
            const inference = benchmarkInferenceMetadata(config);
            const results: Array<{ taskId: string; status: string; score: number; runId: string; artifactPath: string }> = [];
            for (const task of tasks) {
                const artifact = await new BenchmarkRunner({
                    gateway,
                    task,
                    module,
                    mode: options.mode,
                    autonomousRuntime:
                        options.mode === 'autonomous'
                            ? new ResidentRuntimeBenchmarkDriver({
                                  config,
                                  gateway,
                                  module,
                                  sparkModules,
                              })
                            : undefined,
                    modelProfile: inference?.profileId || inference?.model || 'default',
                    inference,
                    commits: [gitCommit('rs6-nullcity-server')],
                }).run();
                const artifactPath = writeArtifact(options.outputDir, artifact);
                if (tasks.length === 1) {
                    const reward = emitVerifierConventions({ artifact, outputDir: options.outputDir, stdout });
                    stdout(
                        `${JSON.stringify({
                            artifactPath,
                            rewardJsonPath: reward.rewardJsonPath,
                            rewardTxtPath: reward.rewardTxtPath,
                            status: artifact.status,
                            score: artifact.score,
                            runId: artifact.runId,
                        })}\n`,
                    );
                } else {
                    const result = {
                        taskId: artifact.task.id,
                        status: artifact.status,
                        score: artifact.score,
                        runId: artifact.runId,
                        artifactPath,
                    };
                    results.push(result);
                    stdout(`${JSON.stringify({ benchmark: result })}\n`);
                }
            }
            if (tasks.length > 1) {
                const passed = results.filter(result => result.status === 'passed').length;
                const averageScore = results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.score, 0) / results.length;
                stdout(
                    `${JSON.stringify({
                        suite: {
                            id: ALL_TASK_ID,
                            mode: options.mode,
                            module,
                            total: results.length,
                            passed,
                            failed: results.length - passed,
                            averageScore,
                            results,
                        },
                    })}\n`,
                );
            }
        } finally {
            gateway.close();
        }
        return 0;
    } catch (error) {
        stderr(`[controller:bench] ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}

function tasksById(taskId: string): BenchmarkTask[] {
    return taskId === ALL_TASK_ID ? CORE_TASK_IDS.map(taskById) : [taskById(taskId)];
}

function taskById(taskId: string): BenchmarkTask {
    if (taskId === MAKE_FIRE_5M_TASK_ID) {
        return makeFire5mBenchmarkTask();
    }
    if (taskId === EXPLORE_REPORT_5M_TASK_ID) {
        return makeExploreReport5mBenchmarkTask();
    }
    if (taskId === FOLLOW_AND_CHAT_5M_TASK_ID) {
        return makeFollowAndChat5mBenchmarkTask();
    }
    if (taskId === WOODCUTTING_FIREMAKING_10M_TASK_ID) {
        return makeWoodcuttingFiremaking10mBenchmarkTask();
    }
    if (taskId === STARTER_FISHING_5M_TASK_ID) {
        return makeStarterFishing5mBenchmarkTask();
    }
    if (taskId === FISHING_COOKING_10M_TASK_ID) {
        return makeFishingCooking10mBenchmarkTask();
    }
    if (taskId === EQUIPMENT_PREP_3M_TASK_ID) {
        return makeEquipmentPrep3mBenchmarkTask();
    }
    if (taskId === COMBAT_PRAYER_10M_TASK_ID) {
        return makeCombatPrayer10mBenchmarkTask();
    }
    if (taskId === MEMORY_RECALL_3M_TASK_ID) {
        return makeMemoryRecall3mBenchmarkTask();
    }
    if (taskId === TRADING_GIVING_5M_TASK_ID) {
        return makeTradingGiving5mBenchmarkTask();
    }
    throw new Error(`Unknown benchmark task ${taskId}`);
}

function sparkModuleById(moduleId: string) {
    const module = standardSparkModules().find(candidate => candidate.manifest.id === moduleId);
    if (!module) {
        throw new Error(`Unknown SPARK module ${moduleId}`);
    }
    return sparkModuleIdentity(module.manifest);
}

function writeArtifact(outputDir: string, artifact: BenchmarkArtifact): string {
    const resolved = path.resolve(process.cwd(), outputDir);
    fs.mkdirSync(resolved, { recursive: true });
    const artifactPath = path.join(resolved, `${artifact.runId}.json`);
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return artifactPath;
}

function gitCommit(repo: string): BenchmarkArtifact['commits'][number] {
    return {
        repo,
        sha: process.env.GIT_COMMIT || gitOutput(['rev-parse', 'HEAD']) || '0000000',
        branch: process.env.GIT_BRANCH || gitOutput(['branch', '--show-current']) || undefined,
        dirty: process.env.GIT_DIRTY === 'true' ? true : undefined,
    };
}

function gitOutput(args: string[]): string | undefined {
    try {
        const value = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        return value || undefined;
    } catch {
        return undefined;
    }
}

function benchmarkInferenceMetadata(config: ReturnType<typeof loadControllerConfig>): BenchmarkArtifact['inference'] {
    const endpoint = config.llm.profiles?.default || config.llm.endpoints.default;
    if (!endpoint) {
        return undefined;
    }
    return {
        profileId: endpoint.profileId || 'default',
        endpointId: endpoint.endpointId,
        provider: endpoint.provider,
        baseUrl: endpoint.baseUrl,
        model: endpoint.model,
        pricing: endpoint.cost,
    };
}

function readRequiredValue(argv: string[], index: number, arg: string): string {
    const value = argv[index];
    if (!value) {
        throw new Error(`${arg} requires a value`);
    }
    return value;
}

function readMode(value: string): BenchmarkRunMode {
    if (value === 'scripted' || value === 'autonomous') {
        return value;
    }
    throw new Error(`Unknown benchmark mode ${value}`);
}

if (require.main === module) {
    runBenchmarkCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
