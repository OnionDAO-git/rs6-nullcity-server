import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { buildBodyPrompt, buildBrainPrompt } from './hybrid-agent-prompts';

describe('hybrid agent prompts', () => {
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
});

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
