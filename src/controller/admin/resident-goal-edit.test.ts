import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { goalEditResident, parseGoalEditCliArgs } from './resident-goal-edit';

const MINIMAL_SOUL_FRONTMATTER = {
    name: 'res:qa-woodcutter',
    archetype: 'achiever',
    attentionProfile: { decayCurve: 'standard' },
    orientationGoal: {
        id: 'master-woodcutting',
        description: 'Master woodcutting and supply the city with logs.',
        tier: 'pursue',
    },
};

const SOUL_WITHOUT_ORIENTATION = {
    name: 'res:qa-angler',
    archetype: 'achiever',
    attentionProfile: { decayCurve: 'standard' },
};

describe('parseGoalEditCliArgs', () => {
    it('parses --resident, --id, --description flags', () => {
        const opts = parseGoalEditCliArgs(['--resident', 'res:hans', '--id', 'slay-kbd', '--description', 'Kill the King Black Dragon.']);
        expect(opts.residentName).toBe('res:hans');
        expect(opts.goalId).toBe('slay-kbd');
        expect(opts.description).toBe('Kill the King Black Dragon.');
        expect(opts.tier).toBeUndefined();
        expect(opts.clear).toBe(false);
    });

    it('parses --tier flag', () => {
        const opts = parseGoalEditCliArgs(['--resident=r', '--id=g', '--description=d', '--tier=pursue']);
        expect(opts.tier).toBe('pursue');
    });

    it('accepts all valid tier values', () => {
        for (const tier of ['earn', 'pursue', 'reflect'] as const) {
            const opts = parseGoalEditCliArgs(['--resident=r', '--id=g', '--description=d', `--tier=${tier}`]);
            expect(opts.tier).toBe(tier);
        }
    });

    it('throws on invalid tier', () => {
        expect(() => parseGoalEditCliArgs(['--resident=r', '--id=g', '--description=d', '--tier=survive'])).toThrow(
            'must be one of: earn, pursue, reflect',
        );
    });

    it('parses --clear flag', () => {
        const opts = parseGoalEditCliArgs(['--resident=r', '--clear']);
        expect(opts.clear).toBe(true);
        expect(opts.goalId).toBe('');
        expect(opts.description).toBe('');
    });

    it('allows --id and --description to be omitted when --clear is set', () => {
        expect(() => parseGoalEditCliArgs(['--resident=r', '--clear'])).not.toThrow();
    });

    it('throws when --resident is missing', () => {
        expect(() => parseGoalEditCliArgs(['--id=g', '--description=d'])).toThrow('--resident <name> is required');
    });

    it('throws when --id is missing without --clear', () => {
        expect(() => parseGoalEditCliArgs(['--resident=r', '--description=d'])).toThrow('--id <goal-id> is required');
    });

    it('throws when --description is missing without --clear', () => {
        expect(() => parseGoalEditCliArgs(['--resident=r', '--id=g'])).toThrow('--description <text> is required');
    });

    it('throws on unknown flag', () => {
        expect(() => parseGoalEditCliArgs(['--resident=r', '--id=g', '--description=d', '--foo'])).toThrow('Unknown argument: --foo');
    });
});

describe('goalEditResident', () => {
    let tempDir: string;
    let soulsDir: string;
    let memoryDir: string;
    const fixedNow = new Date('2026-05-31T15:00:00.000Z');

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-goal-edit-test-'));
        soulsDir = path.join(tempDir, 'souls');
        memoryDir = path.join(tempDir, 'memory');
        fs.mkdirSync(soulsDir, { recursive: true });
        fs.mkdirSync(memoryDir, { recursive: true });

        writeSoulFile('qa-woodcutter.md', MINIMAL_SOUL_FRONTMATTER);
        writeSoulFile('qa-angler.md', SOUL_WITHOUT_ORIENTATION);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function writeSoulFile(filename: string, frontmatter: Record<string, unknown>, body = '# body'): void {
        fs.writeFileSync(path.join(soulsDir, filename), `---\n${yaml.dump(frontmatter)}---\n${body}`, 'utf8');
    }

    function readSoulFrontmatter(filename: string): Record<string, unknown> {
        const raw = fs.readFileSync(path.join(soulsDir, filename), 'utf8');
        const end = raw.indexOf('\n---', 3);
        return yaml.load(raw.slice(3, end).trim()) as Record<string, unknown>;
    }

    function readTimeline(residentName: string): Array<Record<string, unknown>> {
        const slug = residentName.replace(/^res:/, 'res-');
        const p = path.join(memoryDir, 'library', slug, 'timeline.jsonl');
        if (!fs.existsSync(p)) return [];
        return fs
            .readFileSync(p, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line) as Record<string, unknown>);
    }

    it('updates orientation goal in soul YAML and records audit event', () => {
        const result = goalEditResident({
            residentName: 'res:qa-woodcutter',
            soulsDir,
            memoryDir,
            newGoal: { id: 'slay-kbd', description: 'Kill the King Black Dragon.', tier: 'pursue' },
            tick: 100,
            now: () => fixedNow,
        });

        expect(result.residentName).toBe('res:qa-woodcutter');
        expect(result.previousGoalId).toBe('master-woodcutting');
        expect(result.newGoalId).toBe('slay-kbd');
        expect(result.ts).toBe('2026-05-31T15:00:00.000Z');
        expect(result.tick).toBe(100);

        const fm = readSoulFrontmatter('qa-woodcutter.md') as { orientationGoal?: Record<string, unknown> };
        expect(fm.orientationGoal).toEqual({
            id: 'slay-kbd',
            description: 'Kill the King Black Dragon.',
            tier: 'pursue',
        });

        const events = readTimeline('res:qa-woodcutter');
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe('orientation_goal_edited');
        expect(events[0].previousGoalId).toBe('master-woodcutting');
        expect(events[0].newGoalId).toBe('slay-kbd');
        expect(events[0].newGoalDescription).toBe('Kill the King Black Dragon.');
        expect(events[0].newGoalTier).toBe('pursue');
        expect(events[0].reason).toBe('operator_edit');
        expect(events[0].significanceReasons).toEqual(['orientation:goal_edited']);
    });

    it('sets orientation goal on a soul that had none', () => {
        const result = goalEditResident({
            residentName: 'res:qa-angler',
            soulsDir,
            memoryDir,
            newGoal: { id: 'master-fishing', description: 'Become the best fisher in Null City.' },
            now: () => fixedNow,
        });

        expect(result.previousGoalId).toBeUndefined();
        expect(result.newGoalId).toBe('master-fishing');

        const fm = readSoulFrontmatter('qa-angler.md') as { orientationGoal?: Record<string, unknown> };
        expect(fm.orientationGoal).toEqual({ id: 'master-fishing', description: 'Become the best fisher in Null City.' });

        const events = readTimeline('res:qa-angler');
        expect(events[0].previousGoalId).toBeUndefined();
        expect(events[0].newGoalId).toBe('master-fishing');
        expect(events[0].newGoalTier).toBeUndefined();
    });

    it('clears orientation goal from soul with --clear', () => {
        const result = goalEditResident({
            residentName: 'res:qa-woodcutter',
            soulsDir,
            memoryDir,
            clear: true,
            now: () => fixedNow,
        });

        expect(result.previousGoalId).toBe('master-woodcutting');
        expect(result.newGoalId).toBeUndefined();

        const fm = readSoulFrontmatter('qa-woodcutter.md') as { orientationGoal?: unknown };
        expect(fm.orientationGoal).toBeUndefined();

        const events = readTimeline('res:qa-woodcutter');
        expect(events[0].kind).toBe('orientation_goal_edited');
        expect(events[0].previousGoalId).toBe('master-woodcutting');
        expect(events[0].newGoalId).toBeUndefined();
        expect(events[0].newGoalDescription).toBeUndefined();
        expect(events[0].newGoalTier).toBeUndefined();
        expect(events[0].reason).toBe('operator_edit');
    });

    it('preserves soul body text after edit', () => {
        writeSoulFile('qa-woodcutter.md', MINIMAL_SOUL_FRONTMATTER, '# Woodcutter\nHe chops logs all day.');
        goalEditResident({
            residentName: 'res:qa-woodcutter',
            soulsDir,
            memoryDir,
            newGoal: { id: 'new-goal', description: 'New goal.' },
            now: () => fixedNow,
        });
        const raw = fs.readFileSync(path.join(soulsDir, 'qa-woodcutter.md'), 'utf8');
        expect(raw).toContain('# Woodcutter\nHe chops logs all day.');
    });

    it('normalizes resident name without res: prefix', () => {
        const result = goalEditResident({
            residentName: 'qa-woodcutter',
            soulsDir,
            memoryDir,
            newGoal: { id: 'new-id', description: 'New goal.' },
            now: () => fixedNow,
        });
        expect(result.residentName).toBe('res:qa-woodcutter');
    });

    it('throws when residentName is empty', () => {
        expect(() =>
            goalEditResident({
                residentName: '',
                soulsDir,
                memoryDir,
                newGoal: { id: 'g', description: 'd' },
                now: () => fixedNow,
            }),
        ).toThrow('residentName is required');
    });

    it('throws when newGoal is absent and clear is false', () => {
        expect(() => goalEditResident({ residentName: 'res:qa-woodcutter', soulsDir, memoryDir, now: () => fixedNow })).toThrow(
            'newGoal is required',
        );
    });

    it('throws when newGoal.id is empty', () => {
        expect(() =>
            goalEditResident({
                residentName: 'res:qa-woodcutter',
                soulsDir,
                memoryDir,
                newGoal: { id: '', description: 'd' },
                now: () => fixedNow,
            }),
        ).toThrow('newGoal.id must be non-empty');
    });

    it('throws when newGoal.description is empty', () => {
        expect(() =>
            goalEditResident({
                residentName: 'res:qa-woodcutter',
                soulsDir,
                memoryDir,
                newGoal: { id: 'g', description: '' },
                now: () => fixedNow,
            }),
        ).toThrow('newGoal.description must be non-empty');
    });

    it('does not write soul file when validation fails (schema guard)', () => {
        // Tier 'survive' is rejected by the schema.
        expect(() =>
            goalEditResident({
                residentName: 'res:qa-woodcutter',
                soulsDir,
                memoryDir,
                newGoal: { id: 'g', description: 'd', tier: 'survive' as 'earn' },
                now: () => fixedNow,
            }),
        ).toThrow();

        // Soul file should be unchanged.
        const fm = readSoulFrontmatter('qa-woodcutter.md') as { orientationGoal?: Record<string, unknown> };
        expect((fm.orientationGoal as Record<string, unknown>)?.id).toBe('master-woodcutting');
    });
});
