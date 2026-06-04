import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { buildBodyPrompt, buildBrainPrompt } from './hybrid-agent-prompts';

describe('hybrid agent prompts', () => {
    it('injects toolInstructions into the Brain prompt when provided (RIQ-1-1-B)', () => {
        const toolInstructions =
            '\n---\nYou may call ONE tool before your final answer.\nAvailable tools:\n  - lookup_skill: Look up RuneScape knowledge.\n---';
        const prompt = buildBrainPrompt({
            soul: testSoul(),
            perception: perception('Idle.'),
            commandPrefix: '!',
            toolInstructions,
        });
        expect(prompt).toContain('lookup_skill');
        expect(prompt).toContain('ONE tool before your final answer');
    });

    it('omits tool instructions section cleanly when toolInstructions is not provided', () => {
        const prompt = buildBrainPrompt({
            soul: testSoul(),
            perception: perception('Idle.'),
            commandPrefix: '!',
        });
        expect(prompt).not.toContain('ONE tool before your final answer');
    });

    it('injects relevant RuneScape knowledge into Brain prompts', () => {
        const prompt = buildBrainPrompt({
            soul: testSoul(),
            perception: perception('Inventory has tinderbox and logs. Nearby objects include Tree.'),
            activeGoal: {
                id: 'make-fire',
                description: 'Make a fire from normal logs.',
                steps: ['use tinderbox on logs'],
                createdAtTick: 1,
            },
            commandPrefix: '!',
            gameSkill: {
                brainSection: [
                    'Workflow availability:',
                    '- make-fire [can_do_now]: Tinderbox and logs are visible.',
                    'Relevant game knowledge:',
                    '- Skill: Firemaking: use_item_on_item with tinderbox and logs.',
                ].join('\n'),
                bodySection: '',
            },
        });

        expect(prompt).toContain('Relevant game knowledge');
        expect(prompt).toContain('Skill: Firemaking');
        expect(prompt).toContain('use_item_on_item');
    });

    it('injects relevant RuneScape knowledge into Body prompts', () => {
        const prompt = buildBodyPrompt({
            soul: testSoul(),
            perception: perception('Visible fishing spot. Inventory has small fishing net.'),
            activeGoal: {
                id: 'catch-shrimp',
                description: 'Catch shrimp using a small net.',
                createdAtTick: 1,
            },
            commandPrefix: '!',
            gameSkill: {
                brainSection: '',
                bodySection: [
                    'Workflow availability:',
                    '- fishing-starter [can_do_now]: Small fishing net and fishing spot are visible.',
                    'Relevant game knowledge:',
                    '- Skill: Fishing: rs:small_fishing_net catches shrimp at net spots.',
                ].join('\n'),
            },
            visibility: { returnDue: false },
        });

        expect(prompt).toContain('Relevant game knowledge');
        expect(prompt).toContain('Skill: Fishing');
        expect(prompt).toContain('rs:small_fishing_net');
    });

    it('tells the Brain when evidence says the resident is stuck', () => {
        const prompt = buildBrainPrompt({
            soul: testSoul(),
            perception: perception('Still beside the same fence. No inventory or XP changes.'),
            commandPrefix: '!',
            progress: {
                tick: 44,
                lastMeaningfulProgressAt: 19,
                stuckSince: 40,
            },
        });

        expect(prompt).toContain('Runtime progress evidence');
        expect(prompt).toContain('last meaningful progress tick: 19');
        expect(prompt).toContain('stuck since tick: 40');
        expect(prompt).toContain('choose a different tactic');
    });

    it('tells the Body to change tactics when runtime progress is stuck', () => {
        const prompt = buildBodyPrompt({
            soul: testSoul(),
            perception: perception('Still beside the same fence. No inventory or XP changes.'),
            commandPrefix: '!',
            progress: {
                tick: 44,
                lastMeaningfulProgressAt: 19,
                stuckSince: 40,
            },
            visibility: { returnDue: false },
        });

        expect(prompt).toContain('Runtime progress evidence');
        expect(prompt).toContain('stuck since tick: 40');
        expect(prompt).toContain('Do not repeat the same failed action');
    });

    it('injects prompt-visible Memory blocks into Brain and Body prompts', () => {
        const memories = [
            'Patron gift from alice@onion: rs:tinderbox (2026-05-22 10:00:00)',
            'Fact memory (routes.md): - 2026-05-22T11:00:00.000Z Codex taught me the Varrock west bank route.',
        ];
        const brain = buildBrainPrompt({
            soul: testSoul(),
            perception: perception('Idle in Lumbridge.'),
            commandPrefix: '!',
            memories,
        });
        const body = buildBodyPrompt({
            soul: testSoul(),
            perception: perception('Idle in Lumbridge.'),
            commandPrefix: '!',
            memories,
            visibility: { returnDue: false },
        });

        for (const prompt of [brain, body]) {
            expect(prompt).toContain('Memory:');
            expect(prompt).toContain('Persistent resident memory');
            expect(prompt).toContain('alice@onion');
            expect(prompt).toContain('Fact memory (routes.md)');
            expect(prompt).toContain('Varrock west bank route');
            expect(prompt).not.toContain('Recent Library memories');
        }
    });

    it('asks the Brain to write sparse first-person memory notes', () => {
        const prompt = buildBrainPrompt({
            soul: testSoul(),
            perception: perception('Idle in Lumbridge.'),
            commandPrefix: '!',
        });

        expect(prompt).toContain('"memo"');
        expect(prompt).toContain('"rememberFact"');
        expect(prompt).toContain('events/YYYY-MM-DD.md');
        expect(prompt).toContain('first-person memory');
        expect(prompt).toContain('Only include memo or rememberFact');
    });

    it('includes AP/GP/Library hierarchy guardrails in the Brain prompt', () => {
        const prompt = buildBrainPrompt({
            soul: testSoul(),
            perception: perception('Attention is low and there are no visible coins.'),
            commandPrefix: '!',
        });

        expect(prompt).toContain('Needs hierarchy');
        expect(prompt).toMatch(/survive on AP|Attention Points/i);
        expect(prompt).toMatch(/real RuneScape GP|coin/i);
        expect(prompt).toMatch(/Library/i);
    });

    it('includes AP/GP honesty guardrails in the Body prompt', () => {
        const prompt = buildBodyPrompt({
            soul: testSoul(),
            perception: perception('No visible coins. A player asks for payment.'),
            commandPrefix: '!',
            visibility: { returnDue: false },
        });

        expect(prompt).toContain('Never claim or offer GP');
        expect(prompt).toMatch(/must be observed/i);
        expect(prompt).toMatch(/AP/i);
    });

    describe('SOUL identity injection', () => {
        it('injects archetype directive language into the Brain prompt', () => {
            const enduringPrompt = buildBrainPrompt({
                soul: testSoulWith({ archetype: 'endurer' }),
                perception: perception('Idle in Lumbridge.'),
                commandPrefix: '!',
            });
            const mentorPrompt = buildBrainPrompt({
                soul: testSoulWith({ archetype: 'mentor' }),
                perception: perception('Idle in Lumbridge.'),
                commandPrefix: '!',
            });
            const achieverPrompt = buildBrainPrompt({
                soul: testSoulWith({ archetype: 'achiever' }),
                perception: perception('Idle in Lumbridge.'),
                commandPrefix: '!',
            });

            expect(enduringPrompt.toLowerCase()).toMatch(/endur|persever|survive/);
            expect(mentorPrompt.toLowerCase()).toMatch(/teach|guid|mentor/);
            expect(achieverPrompt.toLowerCase()).toMatch(/achiev|goal|accomplish|level/);
        });

        it('injects voice register and quirks into the Brain prompt as directive content', () => {
            const prompt = buildBrainPrompt({
                soul: testSoulWith({
                    voice: {
                        register: 'plain, measured, working-class',
                        quirks: ['ends sentences with a slight pause', 'never says "obviously"'],
                    },
                }),
                perception: perception('Idle.'),
                commandPrefix: '!',
            });

            expect(prompt).toContain('plain, measured, working-class');
            expect(prompt).toContain('ends sentences with a slight pause');
            expect(prompt).toContain('never says "obviously"');
            // Must be framed as instruction, not a JSON dump
            expect(prompt.toLowerCase()).toMatch(/speak|tone|sound like|voice/);
        });

        it('injects voice into the Body prompt so chat actions sound in-character', () => {
            const prompt = buildBodyPrompt({
                soul: testSoulWith({
                    voice: {
                        register: 'gruff, sparse, a little rude',
                        quirks: ['drops articles like a or the'],
                    },
                }),
                perception: perception('Idle.'),
                commandPrefix: '!',
                visibility: { returnDue: false },
            });

            expect(prompt).toContain('gruff, sparse, a little rude');
            expect(prompt).toContain('drops articles like a or the');
            expect(prompt.toLowerCase()).toMatch(/voice|tone|speak/);
        });

        it('injects fears into the Brain prompt as behavior-shaping content', () => {
            const prompt = buildBrainPrompt({
                soul: testSoulWith({
                    fears: ['being forgotten', 'failing in front of Codex'],
                }),
                perception: perception('Idle.'),
                commandPrefix: '!',
            });

            expect(prompt).toContain('being forgotten');
            expect(prompt).toContain('failing in front of Codex');
            expect(prompt.toLowerCase()).toMatch(/fear|avoid|wary|protect/);
        });

        it('injects loves into the Brain prompt as preference-shaping content', () => {
            const prompt = buildBrainPrompt({
                soul: testSoulWith({
                    loves: ['quiet woodcutting', 'the sound of a crackling fire'],
                }),
                perception: perception('Idle.'),
                commandPrefix: '!',
            });

            expect(prompt).toContain('quiet woodcutting');
            expect(prompt).toContain('the sound of a crackling fire');
            expect(prompt.toLowerCase()).toMatch(/love|prefer|drawn to|seek/);
        });

        it('omits identity sections cleanly when fields are absent', () => {
            const prompt = buildBrainPrompt({
                soul: testSoulWith({ voice: undefined, fears: undefined, loves: undefined }),
                perception: perception('Idle.'),
                commandPrefix: '!',
            });

            // No empty "Voice:", "Fears:", "Loves:" header lines
            expect(prompt).not.toMatch(/^Voice:\s*$/m);
            expect(prompt).not.toMatch(/^Fears:\s*$/m);
            expect(prompt).not.toMatch(/^Loves:\s*$/m);
        });

        it('archetype directive appears in the Body prompt so action selection respects it', () => {
            const prompt = buildBodyPrompt({
                soul: testSoulWith({ archetype: 'endurer' }),
                perception: perception('Idle.'),
                commandPrefix: '!',
                visibility: { returnDue: false },
            });

            expect(prompt.toLowerCase()).toMatch(/endur|persever|survive/);
        });

        it('injects long-term goals into the Brain prompt so plan selection respects them', () => {
            const prompt = buildBrainPrompt({
                soul: testSoulWith({
                    goals: ['become a master firemaker', 'find a lost friend in Lumbridge'],
                }),
                perception: perception('Idle.'),
                commandPrefix: '!',
            });

            expect(prompt).toContain('become a master firemaker');
            expect(prompt).toContain('find a lost friend in Lumbridge');
            expect(prompt.toLowerCase()).toMatch(/long-term|ambit|toward|pursue|goal/);
        });

        it('injects alignment into the Brain prompt so social choices respect it', () => {
            const prompt = buildBrainPrompt({
                soul: testSoulWith({
                    alignment: 'loyal to Codex but suspicious of strangers',
                }),
                perception: perception('Idle.'),
                commandPrefix: '!',
            });

            expect(prompt).toContain('loyal to Codex but suspicious of strangers');
            expect(prompt.toLowerCase()).toMatch(/align|treat|toward other|moral|behav/);
        });

        it('injects aesthetic into the Body prompt so chat strings reflect the vibe', () => {
            const prompt = buildBodyPrompt({
                soul: testSoulWith({
                    aesthetic: 'rust and cold iron',
                }),
                perception: perception('Idle.'),
                commandPrefix: '!',
                visibility: { returnDue: false },
            });

            expect(prompt).toContain('rust and cold iron');
            expect(prompt.toLowerCase()).toMatch(/imagery|vibe|aesthetic|colour|color|sensory/);
        });
    });

    describe('brain prompt size budget (S-INFER-3)', () => {
        // A dense embassy scene: 598 floor objects + 40 NPCs + 60 ground items, plus a
        // hot chat event. This is the live shape that produced perceptionBytes:113477
        // and request_timeout/empty brain decisions on a local thinking model.
        function heavyPerception(): Perception {
            const objects = Array.from({ length: 598 }, (_, i) => ({
                objectId: 1276 + (i % 40),
                position: { x: 3200 + (i % 30), y: 3200 + Math.floor(i / 30), level: 0 },
                orientation: i % 4,
            }));
            const npcs = Array.from({ length: 40 }, (_, i) => ({
                id: `npc:${i}`,
                kind: 'npc',
                name: `Goblin ${i}`,
                position: { x: 3210 + i, y: 3215, level: 0 },
                hpFraction: 1,
                combatLevel: 2,
            }));
            const worldItems = Array.from({ length: 60 }, (_, i) => ({
                itemId: 526 + (i % 10),
                amount: 1,
                position: { x: 3208 + i, y: 3220, level: 0 },
            }));
            return {
                tick: 12345,
                resident: {
                    id: 'res:agent',
                    position: { x: 3222, y: 3218, level: 0 },
                    hp: { current: 7, max: 10 },
                    combatLevel: 3,
                    inCombat: false,
                    inventory: Array.from({ length: 28 }, (_, s) => (s < 5 ? { itemId: 1511 + s, amount: 1 } : null)),
                },
                nearby: { players: [], npcs, worldItems, objects },
                events: [{ kind: 'chat', from: 'player:bob', text: 'hello there friend' }],
            } as unknown as Perception;
        }

        it('keeps the assembled Brain prompt well under the timeout budget for a heavy scene', () => {
            const prompt = buildBrainPrompt({
                soul: testSoulWith({
                    goals: ['reach the embassy', 'train firemaking to 15'],
                    fears: ['dying alone'],
                    loves: ['firelight'],
                }),
                perception: heavyPerception(),
                commandPrefix: '::agent',
                memories: Array.from({ length: 10 }, (_, i) => `Memory entry ${i} about routes and patrons and promises.`),
            });
            // The raw perception for this scene is ~110 KB; the OLD prompt was ~18 KB
            // (12 KB of it blind-sliced floor objects). Assert the assembled prompt now
            // fits a budget a 20s-timeout thinking model can actually ingest + answer.
            expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThan(16_000);
        });

        it('preserves the survival spine and goal in a heavy scene (trims breadth, not the spine)', () => {
            const prompt = buildBrainPrompt({
                soul: testSoulWith({ goals: ['reach the embassy and stay alive'] }),
                perception: heavyPerception(),
                commandPrefix: '::agent',
            });
            // Resident state survives.
            expect(prompt).toContain('"hp"');
            expect(prompt).toContain('"inventory"');
            // Nearby NPCs and ground items survive (not crowded out by floor objects).
            expect(prompt).toContain('"npcs"');
            expect(prompt).toContain('"worldItems"');
            // Recent chat event survives.
            expect(prompt).toContain('hello there friend');
            // Soul goal survives.
            expect(prompt).toContain('reach the embassy and stay alive');
        });

        it('caps nearby floor objects so they cannot dominate the prompt', () => {
            const prompt = buildBrainPrompt({
                soul: testSoul(),
                perception: heavyPerception(),
                commandPrefix: '::agent',
            });
            // 598 objects in the scene; the prompt must NOT serialize all of them.
            const objectIdMatches = prompt.match(/"objectId"/g) ?? [];
            expect(objectIdMatches.length).toBeLessThanOrEqual(25);
            // The brain is told the scene is denser than shown.
            expect(prompt).toContain('elidedCount');
        });
    });

    describe('AP/GP economy knowledge injection', () => {
        it('Brain prompt includes AP life-force knowledge when gameSkill section contains it', () => {
            const prompt = buildBrainPrompt({
                soul: testSoul(),
                perception: perception('AP is critically low. Inventory is empty.'),
                activeGoal: {
                    id: 'survive',
                    description: 'My AP is low — I need to ask for patron support or earn GP.',
                    createdAtTick: 1,
                },
                commandPrefix: '!',
                gameSkill: {
                    brainSection: [
                        'Relevant game knowledge:',
                        '- Null City: AP (Attention Points) Is Your Life-Force: AP sustains residents; ask for support when low.',
                        '- Null City: Resident Needs Hierarchy (AP → GP → Soul Goal → Library): survive first, earn GP second.',
                    ].join('\n'),
                    bodySection: '',
                },
            });

            expect(prompt).toContain('AP');
            expect(prompt).toContain('Life-Force');
            expect(prompt).toContain('Needs Hierarchy');
        });

        it('Body prompt includes GP evidence rule when gameSkill section contains it', () => {
            const prompt = buildBodyPrompt({
                soul: testSoul(),
                perception: perception('Human offers AP in exchange for GP. Inventory: no coins.'),
                activeGoal: {
                    id: 'refuse-gp-claim',
                    description: 'I do not have GP — redirect honestly.',
                    createdAtTick: 1,
                },
                commandPrefix: '!',
                gameSkill: {
                    brainSection: '',
                    bodySection: [
                        'Relevant game knowledge:',
                        '- Null City: GP Must Be Real RuneScape Coins (No Hallucinated Payment): NEVER claim GP you do not have.',
                        '  Source: docs/runescape-skill/economy.md § GP Must Be Real Coins',
                    ].join('\n'),
                },
                visibility: { returnDue: false },
            });

            expect(prompt).toContain('Hallucinated Payment');
            expect(prompt).toContain('NEVER');
        });

        it('Brain prompt includes AP-for-GP exchange knowledge when gameSkill section contains it', () => {
            const prompt = buildBrainPrompt({
                soul: testSoul(),
                perception: perception('Inventory has 500 coins. Human wants to trade AP for GP.'),
                activeGoal: {
                    id: 'propose-exchange',
                    description: 'Propose AP-for-GP exchange with confirmed coin evidence.',
                    createdAtTick: 1,
                },
                commandPrefix: '!',
                gameSkill: {
                    brainSection: [
                        'Relevant game knowledge:',
                        '- Null City: AP-for-GP Exchange (Both Sides Need Evidence): both AP credit and GP burn must be confirmed.',
                        '  Source: docs/runescape-skill/economy.md § AP-for-GP Exchange',
                    ].join('\n'),
                    bodySection: '',
                },
            });

            expect(prompt).toContain('AP-for-GP Exchange');
            expect(prompt).toContain('Both Sides Need Evidence');
        });
    });
});

function testSoulWith(overrides: Partial<Soul['frontmatter']>): Soul {
    return {
        ...testSoul(),
        frontmatter: { ...testSoul().frontmatter, ...overrides },
    };
}

function testSoul(): Soul {
    return {
        frontmatter: {
            name: 'res:agent',
            display: 'Agent',
            archetype: 'achiever',
        },
        body: 'A practical resident who tests useful game workflows.',
        sourcePath: '/tmp/res-agent.md',
    };
}

function perception(compressed: string): Perception {
    return {
        tick: 1,
        actor: { id: 'res:agent', type: 'resident' },
        compressed,
    } as Perception;
}
