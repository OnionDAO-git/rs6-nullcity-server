import fs from 'fs';
import path from 'path';
import type { CliOptions, GoalName, Position, SimulationConfig } from './types';

const DEFAULT_CONFIG: SimulationConfig = {
    gateway: {
        url: process.env.SIM_GATEWAY_URL || 'ws://127.0.0.1:43595/agent',
        authToken: process.env.SIM_GATEWAY_AUTH_TOKEN || undefined,
        controllerId: process.env.SIM_CONTROLLER_ID || 'nullcity-simulation',
        requestTimeoutMs: 10000,
    },
    residents: {
        prefix: 'res:sim',
        count: 3,
        spawnPosition: undefined,
    },
    runtime: {
        durationMs: 300000,
        actionIntervalTicks: 4,
        autoBirth: true,
        disconnectOnStop: true,
        logFullPerceptions: false,
    },
    paths: {
        stateDir: 'data/simulation',
        logDir: 'data/logs/simulation',
    },
    goals: ['wander', 'collect_items', 'talk_to_npcs', 'socialize', 'work_loop', 'survive'],
};

export function parseCliOptions(argv: string[]): CliOptions {
    const options: CliOptions = {};

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--config' || arg === '-c') {
            options.configPath = requireValue(argv, ++i, arg);
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else if (arg === '--count') {
            options.count = readInteger(requireValue(argv, ++i, arg), arg);
        } else if (arg.startsWith('--count=')) {
            options.count = readInteger(arg.slice('--count='.length), '--count');
        } else if (arg === '--prefix') {
            options.prefix = requireValue(argv, ++i, arg);
        } else if (arg.startsWith('--prefix=')) {
            options.prefix = arg.slice('--prefix='.length);
        } else if (arg === '--duration-ms') {
            options.durationMs = readInteger(requireValue(argv, ++i, arg), arg);
        } else if (arg.startsWith('--duration-ms=')) {
            options.durationMs = readInteger(arg.slice('--duration-ms='.length), '--duration-ms');
        } else if (arg === '--goal') {
            options.goal = readGoal(requireValue(argv, ++i, arg));
        } else if (arg.startsWith('--goal=')) {
            options.goal = readGoal(arg.slice('--goal='.length));
        } else if (arg === '--resident') {
            options.resident = [...(options.resident || []), requireValue(argv, ++i, arg).toLowerCase()];
        } else if (arg.startsWith('--resident=')) {
            options.resident = [...(options.resident || []), arg.slice('--resident='.length).toLowerCase()];
        } else if (arg === '--spawn') {
            options.spawnPosition = readPosition(requireValue(argv, ++i, arg));
        } else if (arg.startsWith('--spawn=')) {
            options.spawnPosition = readPosition(arg.slice('--spawn='.length));
        } else if (arg === '--out') {
            options.outPath = requireValue(argv, ++i, arg);
        } else if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length);
        }
    }

    return options;
}

export function loadSimulationConfig(options: CliOptions = {}): SimulationConfig {
    const fileConfig = options.configPath ? readConfigFile(options.configPath) : {};
    const merged = mergeConfig(DEFAULT_CONFIG, fileConfig);

    if (options.count !== undefined) {
        merged.residents.count = options.count;
    }
    if (options.prefix) {
        merged.residents.prefix = options.prefix;
    }
    if (options.durationMs !== undefined) {
        merged.runtime.durationMs = options.durationMs;
    }
    if (options.spawnPosition) {
        merged.residents.spawnPosition = options.spawnPosition;
    }
    if (options.goal) {
        merged.goals = [options.goal];
    }

    merged.paths.stateDir = path.resolve(process.cwd(), merged.paths.stateDir);
    merged.paths.logDir = path.resolve(process.cwd(), merged.paths.logDir);
    return merged;
}

export function assignmentPath(config: SimulationConfig): string {
    return path.join(config.paths.stateDir, 'assignments.json');
}

export function generatedResidentName(prefix: string, index: number): string {
    const suffix = String(index).padStart(4, '0');
    const name = `${prefix}${suffix}`.toLowerCase();
    if (!/^res:[a-z0-9_]{1,20}$/.test(name)) {
        throw new Error(`Generated resident name is invalid: ${name}`);
    }
    return name;
}

function readConfigFile(configPath: string): Partial<SimulationConfig> {
    const resolvedPath = path.resolve(process.cwd(), configPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Simulation config not found: ${resolvedPath}`);
    }
    return JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as Partial<SimulationConfig>;
}

function mergeConfig(base: SimulationConfig, override: Partial<SimulationConfig>): SimulationConfig {
    return {
        gateway: { ...base.gateway, ...override.gateway },
        residents: { ...base.residents, ...override.residents },
        runtime: { ...base.runtime, ...override.runtime },
        paths: { ...base.paths, ...override.paths },
        goals: override.goals?.length ? override.goals : [...base.goals],
    };
}

function requireValue(argv: string[], index: number, arg: string): string {
    const value = argv[index];
    if (!value) {
        throw new Error(`${arg} requires a value`);
    }
    return value;
}

function readInteger(value: string, arg: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${arg} must be a non-negative integer`);
    }
    return parsed;
}

function readGoal(value: string): GoalName {
    const goal = value as GoalName;
    if (!['wander', 'collect_items', 'talk_to_npcs', 'socialize', 'work_loop', 'survive'].includes(goal)) {
        throw new Error(`Unknown simulation goal: ${value}`);
    }
    return goal;
}

function readPosition(value: string): Position {
    const [x, y, level] = value.split(',').map(part => Number(part.trim()));
    if (!Number.isInteger(x) || !Number.isInteger(y) || (level !== undefined && !Number.isInteger(level))) {
        throw new Error('--spawn must be x,y or x,y,level');
    }
    return level === undefined ? { x, y } : { x, y, level };
}
