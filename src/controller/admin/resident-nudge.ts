import { loadControllerConfig } from '../config';
import { LibraryUpdater } from '../evidence';

export interface NudgeResidentOptions {
    residentName: string;
    text: string;
    memoryDir: string;
    tick?: number;
    now?: () => Date;
}

export interface NudgeResidentResult {
    residentName: string;
    text: string;
    ts: string;
    tick: number;
}

export interface NudgeCliOptions {
    residentName: string;
    text: string;
    configPath: string;
}

export function nudgeResident(options: NudgeResidentOptions): NudgeResidentResult {
    if (!options.residentName) {
        throw new Error('residentName is required');
    }
    if (!options.text || !options.text.trim()) {
        throw new Error('nudge text must be non-empty');
    }

    const residentName = normalizeResidentName(options.residentName);
    const now = options.now ?? (() => new Date());
    const ts = now().toISOString();
    const tick = options.tick ?? 0;

    const updater = new LibraryUpdater(residentName, options.memoryDir, { now });
    updater.observeOrientationNudge({ kind: 'orientation_nudge', ts, tick, text: options.text.trim() });

    return { residentName, text: options.text.trim(), ts, tick };
}

export function parseNudgeCliArgs(argv: string[]): NudgeCliOptions {
    const options: NudgeCliOptions = {
        residentName: process.env.CONTROLLER_NUDGE_RESIDENT || '',
        text: process.env.CONTROLLER_NUDGE_TEXT || '',
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--resident') {
            const next = argv[i + 1];
            if (!next) throw new Error('--resident requires a value');
            options.residentName = next;
            i += 1;
        } else if (arg.startsWith('--resident=')) {
            options.residentName = arg.slice('--resident='.length);
        } else if (arg === '--text') {
            const next = argv[i + 1];
            if (!next) throw new Error('--text requires a value');
            options.text = next;
            i += 1;
        } else if (arg.startsWith('--text=')) {
            options.text = arg.slice('--text='.length);
        } else if (arg === '--config' || arg === '-c') {
            const next = argv[i + 1];
            if (!next) throw new Error(`${arg} requires a path`);
            options.configPath = next;
            i += 1;
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.residentName) throw new Error('--resident <name> is required');
    if (!options.text) throw new Error('--text <nudge> is required');

    return options;
}

export async function runNudgeCli(argv: string[]): Promise<number> {
    try {
        const opts = parseNudgeCliArgs(argv);
        const config = loadControllerConfig(opts.configPath);
        const result = nudgeResident({
            residentName: opts.residentName,
            text: opts.text,
            memoryDir: config.memory.dir,
        });
        console.log(`[resident:nudge] Nudged ${result.residentName} at ${result.ts}: "${result.text}"`);
        return 0;
    } catch (error) {
        console.error(`[resident:nudge] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

function normalizeResidentName(name: string): string {
    return name.startsWith('res:') ? name : `res:${name}`;
}

if (require.main === module) {
    runNudgeCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
