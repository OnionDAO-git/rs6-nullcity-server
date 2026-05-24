import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { RuntimeStateStore } from '../memory/runtime-state';
import { reviveResident } from './revive-resident';

describe('reviveResident', () => {
    let tempDir: string;
    let soulsDir: string;
    let memoryDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-revive-resident-test-'));
        soulsDir = path.join(tempDir, 'souls');
        memoryDir = path.join(tempDir, 'memory');
        fs.mkdirSync(soulsDir, { recursive: true });
        fs.mkdirSync(memoryDir, { recursive: true });

        const soulFrontmatter = {
            name: 'res:hans',
            archetype: 'mentor',
            attentionProfile: { startingAttention: 14000, decayCurve: 'gentle' },
            respawnPolicy: 'manual',
        };
        fs.writeFileSync(path.join(soulsDir, 'hans.md'), `---\n${yaml.dump(soulFrontmatter)}---\n# Hans`, 'utf8');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('revives an attention-exhausted manual resident with starter attention and library evidence', () => {
        const store = new RuntimeStateStore(memoryDir);
        const state = store.load('res:hans', 1, 'hero');
        state.tick = 42;
        state.attention = 0;
        state.stuckSince = 37;
        state.cognition = {
            activeMove: {
                target: { x: 3200, y: 3200, level: 0 },
                cause: 'pre_death_move',
                startedAtTick: 35,
                lastTick: 41,
            },
        };
        state.deceased = {
            date: '2026-05-24T12:00:00.000Z',
            tick: 41,
            cause: 'attention_exhausted',
            processed: true,
        };
        store.save(state);

        const result = reviveResident({
            residentName: 'hans',
            soulsDir,
            memoryDir,
            now: () => new Date('2026-05-24T12:30:00.000Z'),
        });

        expect(result).toEqual({
            residentName: 'res:hans',
            revived: true,
            reason: 'revived',
            previousDeceasedCause: 'attention_exhausted',
            respawnPolicy: 'manual',
            attentionBefore: 0,
            attentionAfter: 14000,
            tick: 42,
        });

        const revivedState = store.load('res:hans', 1, 'hero');
        expect(revivedState.deceased).toBeUndefined();
        expect(revivedState.attention).toBe(14000);
        expect(revivedState.stuckSince).toBeUndefined();
        expect(revivedState.cognition?.activeMove).toBeUndefined();

        const timelinePath = path.join(memoryDir, 'library', 'res-hans', 'timeline.jsonl');
        const events = fs
            .readFileSync(timelinePath, 'utf8')
            .trim()
            .split('\n')
            .map(line => JSON.parse(line));
        expect(events).toContainEqual(
            expect.objectContaining({
                kind: 'revival',
                cause: 'operator_revive_attention_exhausted',
                ts: '2026-05-24T12:30:00.000Z',
                tick: 42,
            }),
        );
    });

    it('does not revive a non-attention death unless explicitly forced', () => {
        const store = new RuntimeStateStore(memoryDir);
        const state = store.load('res:hans', 1, 'hero');
        state.attention = 0;
        state.deceased = {
            date: '2026-05-24T12:00:00.000Z',
            tick: 13,
            cause: 'combat_death',
        };
        store.save(state);

        const result = reviveResident({ residentName: 'res:hans', soulsDir, memoryDir });

        expect(result).toMatchObject({
            residentName: 'res:hans',
            revived: false,
            reason: 'blocked_non_attention_death',
            previousDeceasedCause: 'combat_death',
            attentionBefore: 0,
            attentionAfter: 0,
        });

        const unchanged = store.load('res:hans', 1, 'hero');
        expect(unchanged.deceased?.cause).toBe('combat_death');
        expect(fs.existsSync(path.join(memoryDir, 'library', 'res-hans', 'timeline.jsonl'))).toBe(false);
    });

    it('does not revive a never-respawn resident without force even when death was attention exhaustion', () => {
        const neverSoulFrontmatter = {
            name: 'res:never',
            archetype: 'mentor',
            attentionProfile: { startingAttention: 12000, decayCurve: 'gentle' },
            respawnPolicy: 'never',
        };
        fs.writeFileSync(path.join(soulsDir, 'never.md'), `---\n${yaml.dump(neverSoulFrontmatter)}---\n# Never`, 'utf8');
        const store = new RuntimeStateStore(memoryDir);
        const state = store.load('res:never', 1, 'mentor');
        state.attention = 0;
        state.deceased = {
            date: '2026-05-24T12:00:00.000Z',
            tick: 5,
            cause: 'attention_exhausted',
        };
        store.save(state);

        const result = reviveResident({ residentName: 'res:never', soulsDir, memoryDir });

        expect(result).toMatchObject({
            residentName: 'res:never',
            revived: false,
            reason: 'blocked_respawn_policy',
            respawnPolicy: 'never',
            previousDeceasedCause: 'attention_exhausted',
        });
        expect(store.load('res:never', 1, 'mentor').deceased?.cause).toBe('attention_exhausted');
    });

    it('can force-revive a non-attention death and records an explicit force cause', () => {
        const store = new RuntimeStateStore(memoryDir);
        const state = store.load('res:hans', 1, 'mentor');
        state.attention = 7;
        state.deceased = {
            date: '2026-05-24T12:00:00.000Z',
            tick: 13,
            cause: 'combat_death',
        };
        store.save(state);

        const result = reviveResident({
            residentName: 'res:hans',
            soulsDir,
            memoryDir,
            force: true,
            attention: 1000,
            now: () => new Date('2026-05-24T12:45:00.000Z'),
        });

        expect(result).toMatchObject({
            revived: true,
            reason: 'revived',
            previousDeceasedCause: 'combat_death',
            attentionBefore: 7,
            attentionAfter: 1000,
        });
        const revivedState = store.load('res:hans', 1, 'mentor');
        expect(revivedState.deceased).toBeUndefined();
        const timeline = fs.readFileSync(path.join(memoryDir, 'library', 'res-hans', 'timeline.jsonl'), 'utf8');
        expect(timeline).toContain('operator_force_revive');
    });
});
