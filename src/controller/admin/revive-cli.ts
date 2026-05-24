import { loadControllerConfig } from '../config';
import { reviveResident } from './revive-resident';

export interface ReviveCliOptions {
    residentName: string;
    attention?: number;
    force: boolean;
    configPath: string;
}

export function parseReviveCliArgs(argv: string[]): ReviveCliOptions {
    const options: ReviveCliOptions = {
        residentName: '',
        force: false,
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
        } else if (arg === '--attention') {
            const next = argv[i + 1];
            if (!next) throw new Error('--attention requires a value');
            options.attention = Number(next);
            i += 1;
        } else if (arg.startsWith('--attention=')) {
            options.attention = Number(arg.slice('--attention='.length));
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--config' || arg === '-c') {
            const next = argv[i + 1];
            if (!next) throw new Error(`${arg} requires a path`);
            options.configPath = next;
            i += 1;
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else {
            throw new Error(`Unknown argument ${arg}`);
        }
    }

    if (!options.residentName) {
        throw new Error('--resident <name> is required.');
    }
    if (options.attention !== undefined && (!Number.isInteger(options.attention) || options.attention <= 0)) {
        throw new Error('--attention must be a positive integer when provided.');
    }

    return options;
}

export async function runReviveCli(_argv: string[]): Promise<number> {
    try {
        const options = parseReviveCliArgs(_argv);
        const config = loadControllerConfig(options.configPath);
        const result = reviveResident({
            residentName: options.residentName,
            soulsDir: config.souls.dir,
            memoryDir: config.memory.dir,
            attention: options.attention,
            force: options.force,
        });

        if (result.revived) {
            console.log(
                `[controller:revive] Revived ${result.residentName}; attention ${result.attentionBefore} -> ${result.attentionAfter}; previous death=${result.previousDeceasedCause}.`,
            );
            return 0;
        }

        if (result.reason === 'already_living') {
            console.log(`[controller:revive] ${result.residentName} is already living; attention=${result.attentionAfter}.`);
            return 0;
        }

        if (result.reason === 'blocked_respawn_policy') {
            console.error(
                `[controller:revive] Refusing to revive ${result.residentName}; respawn policy=${result.respawnPolicy}. Use --force for explicit operator override.`,
            );
            return 1;
        }

        console.error(
            `[controller:revive] Refusing to revive ${result.residentName}; death cause=${result.previousDeceasedCause}. Use --force for explicit operator override.`,
        );
        return 1;
    } catch (error) {
        console.error(`[controller:revive] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (require.main === module) {
    runReviveCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
