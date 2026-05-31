import fs from 'fs';
import os from 'os';
import path from 'path';
import { canInteract } from './interact-resident';
import { loadControllerConfig } from '../config';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { AgentAction, Perception } from '../transport/message-codecs';

jest.mock('../config', () => ({
    loadControllerConfig: jest.fn(),
}));

describe('canInteract precondition validation', () => {
    let tmpSoulsDir: string;
    let tmpMemoryDir: string;

    beforeEach(() => {
        tmpSoulsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-souls-'));
        tmpMemoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-memory-'));

        (loadControllerConfig as jest.Mock).mockReturnValue({
            souls: { dir: tmpSoulsDir, discoverResidents: true },
            memory: { dir: tmpMemoryDir },
        });
    });

    afterEach(() => {
        fs.rmSync(tmpSoulsDir, { recursive: true, force: true });
        fs.rmSync(tmpMemoryDir, { recursive: true, force: true });
    });

    function makeState(resident = 'res:agent'): RuntimeState {
        return {
            resident,
            attention: 5000,
            tick: 1,
            legacy: { kind: 'mentor', progress: {}, complete: false },
            budgets: { minuteStartedAt: '', dayStartedAt: '', requestsThisMinute: 0, requestsToday: 0 },
        };
    }

    function makeSoul(name = 'res:agent', factionId?: string): Soul {
        return {
            frontmatter: {
                name,
                archetype: 'mentor',
                factionId,
            },
            body: '# standard soul',
            sourcePath: path.join(tmpSoulsDir, `${name.replace(/^res:/, '')}.md`),
        };
    }

    function writeSoulFile(name: string, factionId?: string) {
        const fileContent = `---
name: ${name}
archetype: mentor
${factionId ? `factionId: ${factionId}` : ''}
---
# ${name}
`;
        const fileName = `${name.replace(/^res:/, '')}.md`;
        fs.writeFileSync(path.join(tmpSoulsDir, fileName), fileContent);
    }

    function makePerception(options: {
        selfHp?: { current: number; max: number };
        selfInventory?: Array<{ itemId: number; key?: string; amount: number } | null>;
        selfSkills?: Record<string, { xp: number; level: number } | number>;
        npcs?: Array<{ id: string; kind: string; name?: string; position: { x: number; y: number; level: number }; hpFraction?: number }>;
        players?: Array<{
            id: string;
            kind: string;
            name?: string;
            position: { x: number; y: number; level: number };
            hpFraction?: number;
        }>;
    }): Perception {
        return {
            tick: 1,
            resident: {
                hp: options.selfHp || { current: 10, max: 10 },
                inventory: options.selfInventory || [],
                skills: options.selfSkills || {},
                position: { x: 3200, y: 3200, level: 0 },
            },
            nearby: {
                npcs: options.npcs || [],
                players: options.players || [],
            },
        };
    }

    it('returns empty array for non-interact actions', () => {
        const state = makeState();
        const soul = makeSoul();
        const action: AgentAction = { kind: 'noop' };
        const perception = makePerception({});
        expect(canInteract(state, action, perception, soul)).toEqual([]);
    });

    it('fails if target is not visible', () => {
        const state = makeState();
        const soul = makeSoul();
        const action: AgentAction = { kind: 'whisper', to: 'res:pip', text: 'hello' };
        const perception = makePerception({ npcs: [] });
        const result = canInteract(state, action, perception, soul);
        expect(result).toContain('Target res:pip is not visible');
    });

    it('fails if target is deceased', () => {
        const state = makeState();
        const soul = makeSoul();
        const action: AgentAction = { kind: 'gift', target: 'res:pip', artifact: 'rs:shrimp', quantity: 1 };
        const perception = makePerception({
            npcs: [{ id: 'res:pip', kind: 'resident', name: 'Pip', position: { x: 3200, y: 3200, level: 0 }, hpFraction: 0 }],
        });
        const result = canInteract(state, action, perception, soul);
        expect(result).toContain('Target res:pip is deceased');
    });

    it('fails if target is marked deceased in state store', () => {
        const state = makeState();
        const soul = makeSoul();
        const action: AgentAction = { kind: 'challenge_duel', target: 'res:pip' };
        const perception = makePerception({
            npcs: [{ id: 'res:pip', kind: 'resident', name: 'Pip', position: { x: 3200, y: 3200, level: 0 }, hpFraction: 1.0 }],
        });

        // Write target's state as deceased
        const pipDir = path.join(tmpMemoryDir, 'res-pip');
        fs.mkdirSync(pipDir, { recursive: true });
        fs.writeFileSync(
            path.join(pipDir, 'runtime-state.json'),
            JSON.stringify({
                resident: 'res:pip',
                deceased: { date: '2026-05-25', tick: 1, cause: 'attention_exhausted' },
            }),
        );

        const result = canInteract(state, action, perception, soul);
        expect(result).toContain('Target res:pip is deceased');
    });

    describe('whisper specific checks', () => {
        it('validates text length and content', () => {
            const state = makeState();
            const soul = makeSoul();
            const perception = makePerception({
                players: [{ id: 'player:james', kind: 'player', name: 'James', position: { x: 3200, y: 3200, level: 0 } }],
            });

            // Empty whisper
            let action: AgentAction = { kind: 'whisper', to: 'player:james', text: '   ' };
            expect(canInteract(state, action, perception, soul)).toContain('Whisper text cannot be empty');

            // Too long whisper
            const longText = 'a'.repeat(257);
            action = { kind: 'whisper', to: 'player:james', text: longText };
            expect(canInteract(state, action, perception, soul)).toContain('Whisper text exceeds 256 characters');

            // Valid whisper
            action = { kind: 'whisper', to: 'player:james', text: 'Hello James!' };
            expect(canInteract(state, action, perception, soul)).toEqual([]);
        });
    });

    describe('gift specific checks', () => {
        it('validates quantity and inventory availability', () => {
            const state = makeState();
            const soul = makeSoul();
            const perception = makePerception({
                npcs: [{ id: 'res:pip', kind: 'resident', name: 'Pip', position: { x: 3200, y: 3200, level: 0 } }],
                selfInventory: [{ itemId: 317, key: 'rs:raw_shrimp', amount: 3 }],
            });

            // Quantity less than 1
            let action: AgentAction = { kind: 'gift', target: 'res:pip', artifact: 'rs:raw_shrimp', quantity: 0 };
            expect(canInteract(state, action, perception, soul)).toContain('Gift quantity must be at least 1');

            // Item not in inventory
            action = { kind: 'gift', target: 'res:pip', artifact: 'rs:raw_anchovies', quantity: 1 };
            expect(canInteract(state, action, perception, soul)).toContain(
                'Insufficient inventory for artifact rs:raw_anchovies: has 0, needs 1',
            );

            // Item quantity insufficient
            action = { kind: 'gift', target: 'res:pip', artifact: 'rs:raw_shrimp', quantity: 5 };
            expect(canInteract(state, action, perception, soul)).toContain(
                'Insufficient inventory for artifact rs:raw_shrimp: has 3, needs 5',
            );

            // Sufficient quantity
            action = { kind: 'gift', target: 'res:pip', artifact: 'rs:raw_shrimp', quantity: 2 };
            expect(canInteract(state, action, perception, soul)).toEqual([]);
        });
    });

    describe('assist_skill specific checks', () => {
        it('validates duration ticks and skill levels', () => {
            const state = makeState();
            const soul = makeSoul();

            // Setup resident Pip and write target level details to memory
            const pipDir = path.join(tmpMemoryDir, 'res-pip');
            fs.mkdirSync(pipDir, { recursive: true });
            // Pip level 15 fishing (using level_up events in skills.md)
            fs.writeFileSync(
                path.join(pipDir, 'skills.md'),
                `- 2026-05-25T20:00:00.000Z {"kind":"level_up","skill":"fishing","level":15}\n`,
            );

            const perception = makePerception({
                npcs: [{ id: 'res:pip', kind: 'resident', name: 'Pip', position: { x: 3200, y: 3200, level: 0 } }],
                selfSkills: { fishing: { xp: 0, level: 19 } }, // self level 19
            });

            // Invalid duration
            let action: AgentAction = { kind: 'assist_skill', target: 'res:pip', skill: 'fishing', durationTicks: 11 };
            expect(canInteract(state, action, perception, soul)).toContain('Assist duration must be between 1 and 10 ticks');

            // Insufficient level (19 < 15 + 5)
            action = { kind: 'assist_skill', target: 'res:pip', skill: 'fishing', durationTicks: 5 };
            expect(canInteract(state, action, perception, soul)).toContain(
                'Self fishing level (19) is insufficient to assist target level (15)',
            );

            // Sufficient level (self 20 >= 15 + 5)
            const highPerception = makePerception({
                npcs: [{ id: 'res:pip', kind: 'resident', name: 'Pip', position: { x: 3200, y: 3200, level: 0 } }],
                selfSkills: { fishing: { xp: 0, level: 20 } },
            });
            expect(canInteract(state, action, highPerception, soul)).toEqual([]);
        });

        it('defaults to pass when target is a player', () => {
            const state = makeState();
            const soul = makeSoul();
            const perception = makePerception({
                players: [{ id: 'player:james', kind: 'player', name: 'James', position: { x: 3200, y: 3200, level: 0 } }],
                selfSkills: { fishing: { xp: 0, level: 1 } },
            });

            const action: AgentAction = { kind: 'assist_skill', target: 'player:james', skill: 'fishing', durationTicks: 5 };
            expect(canInteract(state, action, perception, soul)).toEqual([]);
        });
    });

    describe('challenge_duel specific checks', () => {
        it('validates HP, same faction, and stake checks', () => {
            // Write Pip's soul to let SoulLoader find it
            writeSoulFile('res:pip', 'foundry');

            // Self is in foundry, target is in foundry
            const state = makeState();
            const selfSoul = makeSoul('res:agent', 'foundry');

            const perception = makePerception({
                npcs: [{ id: 'res:pip', kind: 'resident', name: 'Pip', position: { x: 3200, y: 3200, level: 0 }, hpFraction: 1.0 }],
                selfHp: { current: 10, max: 10 },
            });

            // Fails due to same faction (both foundry)
            let action: AgentAction = { kind: 'challenge_duel', target: 'res:pip' };
            expect(canInteract(state, action, perception, selfSoul)).toContain('Cannot duel a resident from the same faction (foundry)');

            // Setup different faction for target (Pip in bureau)
            writeSoulFile('res:pip', 'bureau');

            // Self HP <= 25%
            const lowSelfPerception = makePerception({
                npcs: [{ id: 'res:pip', kind: 'resident', name: 'Pip', position: { x: 3200, y: 3200, level: 0 }, hpFraction: 1.0 }],
                selfHp: { current: 2, max: 10 },
            });
            expect(canInteract(state, action, lowSelfPerception, selfSoul)).toContain('Self HP is too low for a duel (20%)');

            // Target HP <= 25%
            const lowTargetPerception = makePerception({
                npcs: [{ id: 'res:pip', kind: 'resident', name: 'Pip', position: { x: 3200, y: 3200, level: 0 }, hpFraction: 0.2 }],
                selfHp: { current: 10, max: 10 },
            });
            expect(canInteract(state, action, lowTargetPerception, selfSoul)).toContain('Target HP is too low for a duel (20%)');

            // Stake validation
            action = {
                kind: 'challenge_duel',
                target: 'res:pip',
                stake: { artifact: 'rs:raw_shrimp', quantity: 2 },
            };

            // Insufficient stake inventory
            expect(canInteract(state, action, perception, selfSoul)).toContain(
                'Insufficient inventory for duel stake rs:raw_shrimp: has 0, needs 2',
            );

            // Sufficient stake inventory
            const stakePerception = makePerception({
                npcs: [{ id: 'res:pip', kind: 'resident', name: 'Pip', position: { x: 3200, y: 3200, level: 0 }, hpFraction: 1.0 }],
                selfHp: { current: 10, max: 10 },
                selfInventory: [{ itemId: 317, key: 'rs:raw_shrimp', amount: 2 }],
            });
            expect(canInteract(state, action, stakePerception, selfSoul)).toEqual([]);
        });
    });
});
