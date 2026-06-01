import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadControllerConfig } from '../config';
import { LibraryUpdater } from '../evidence';
import { SoulLoader } from '../soul/soul-loader';
import { validateSoulFrontmatter, type SoulOrientationGoal } from '../soul/soul-schema';

export interface GoalEditResidentOptions {
    residentName: string;
    soulsDir: string;
    memoryDir: string;
    /** New orientation goal. Omit (or set `clear: true`) to remove the orientation. */
    newGoal?: SoulOrientationGoal;
    /** If true, remove orientation goal from soul (newGoal is ignored). */
    clear?: boolean;
    tick?: number;
    now?: () => Date;
}

export interface GoalEditResidentResult {
    residentName: string;
    previousGoalId: string | undefined;
    newGoalId: string | undefined;
    soulPath: string;
    ts: string;
    tick: number;
}

export interface GoalEditCliOptions {
    residentName: string;
    goalId: string;
    description: string;
    tier: 'earn' | 'pursue' | 'reflect' | undefined;
    clear: boolean;
    configPath: string;
}

/**
 * Edit (or clear) a resident's soul orientation goal and record an audit
 * event in the Library timeline. Operators are the only callers; residents
 * cannot rewrite their own goal (per S-GOAL design, §Abandon condition).
 *
 * The soul YAML file is written back atomically: the frontmatter is updated
 * and the body text is preserved. `validateSoulFrontmatter` runs on the
 * updated frontmatter before writing to reject invalid values.
 */
export function goalEditResident(options: GoalEditResidentOptions): GoalEditResidentResult {
    if (!options.residentName) {
        throw new Error('residentName is required');
    }
    if (!options.clear && !options.newGoal) {
        throw new Error('newGoal is required unless --clear is set');
    }
    if (options.newGoal && !options.newGoal.id.trim()) {
        throw new Error('newGoal.id must be non-empty');
    }
    if (options.newGoal && !options.newGoal.description.trim()) {
        throw new Error('newGoal.description must be non-empty');
    }

    const residentName = normalizeResidentName(options.residentName);
    const loader = new SoulLoader(options.soulsDir);
    const soul = loader.load(residentName);

    const previousGoalId = soul.frontmatter.orientationGoal?.id;
    const updatedFrontmatter = { ...soul.frontmatter };

    if (options.clear) {
        delete updatedFrontmatter.orientationGoal;
    } else {
        updatedFrontmatter.orientationGoal = options.newGoal;
    }

    // Validate before writing — surfacing schema errors before any disk change.
    validateSoulFrontmatter(updatedFrontmatter, soul.sourcePath);

    writeSoulFile(soul.sourcePath, updatedFrontmatter, soul.body);

    const now = options.now ?? (() => new Date());
    const ts = now().toISOString();
    const tick = options.tick ?? 0;

    const updater = new LibraryUpdater(residentName, options.memoryDir, { now });
    updater.observeOrientationGoalEdited({
        kind: 'orientation_goal_edited',
        ts,
        tick,
        previousGoalId,
        newGoalId: options.clear ? undefined : options.newGoal?.id,
        newGoalDescription: options.clear ? undefined : options.newGoal?.description,
        newGoalTier: options.clear ? undefined : options.newGoal?.tier,
        reason: 'operator_edit',
    });

    return {
        residentName,
        previousGoalId,
        newGoalId: options.clear ? undefined : options.newGoal?.id,
        soulPath: soul.sourcePath,
        ts,
        tick,
    };
}

export function parseGoalEditCliArgs(argv: string[]): GoalEditCliOptions {
    const options: GoalEditCliOptions = {
        residentName: process.env.CONTROLLER_GOAL_EDIT_RESIDENT || '',
        goalId: '',
        description: '',
        tier: undefined,
        clear: false,
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
        } else if (arg === '--id') {
            const next = argv[i + 1];
            if (!next) throw new Error('--id requires a value');
            options.goalId = next;
            i += 1;
        } else if (arg.startsWith('--id=')) {
            options.goalId = arg.slice('--id='.length);
        } else if (arg === '--description') {
            const next = argv[i + 1];
            if (!next) throw new Error('--description requires a value');
            options.description = next;
            i += 1;
        } else if (arg.startsWith('--description=')) {
            options.description = arg.slice('--description='.length);
        } else if (arg === '--tier') {
            const next = argv[i + 1];
            if (!next) throw new Error('--tier requires a value');
            options.tier = validateTier(next);
            i += 1;
        } else if (arg.startsWith('--tier=')) {
            options.tier = validateTier(arg.slice('--tier='.length));
        } else if (arg === '--clear') {
            options.clear = true;
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
    if (!options.clear) {
        if (!options.goalId) throw new Error('--id <goal-id> is required (or use --clear)');
        if (!options.description) throw new Error('--description <text> is required (or use --clear)');
    }

    return options;
}

export async function runGoalEditCli(argv: string[]): Promise<number> {
    try {
        const opts = parseGoalEditCliArgs(argv);
        const config = loadControllerConfig(opts.configPath);

        const result = goalEditResident({
            residentName: opts.residentName,
            soulsDir: config.souls.dir,
            memoryDir: config.memory.dir,
            newGoal: opts.clear ? undefined : { id: opts.goalId, description: opts.description, tier: opts.tier },
            clear: opts.clear,
        });

        if (result.newGoalId) {
            console.log(
                `[resident:goal-edit] ${result.residentName}: orientation set to "${result.newGoalId}"` +
                    (result.previousGoalId ? ` (was "${result.previousGoalId}")` : ' (new)') +
                    `. Soul: ${result.soulPath}`,
            );
        } else {
            console.log(
                `[resident:goal-edit] ${result.residentName}: orientation cleared` +
                    (result.previousGoalId ? ` (was "${result.previousGoalId}")` : '') +
                    `. Soul: ${result.soulPath}`,
            );
        }
        return 0;
    } catch (error) {
        console.error(`[resident:goal-edit] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

function normalizeResidentName(name: string): string {
    return name.startsWith('res:') ? name : `res:${name}`;
}

function validateTier(raw: string): 'earn' | 'pursue' | 'reflect' {
    if (raw === 'earn' || raw === 'pursue' || raw === 'reflect') {
        return raw;
    }
    throw new Error(`--tier must be one of: earn, pursue, reflect (got "${raw}")`);
}

/**
 * Write an updated soul frontmatter back to the source path, preserving the
 * body text verbatim. Uses a write-then-rename approach so partial writes don't
 * leave a corrupt soul file.
 */
function writeSoulFile(sourcePath: string, frontmatter: Record<string, unknown>, body: string): void {
    const yamlText = yaml.dump(frontmatter, { lineWidth: 120, quotingType: '"', forceQuotes: false });
    const content = `---\n${yamlText}---\n${body}`;
    const tmpPath = `${sourcePath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, sourcePath);
}

if (require.main === module) {
    runGoalEditCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
