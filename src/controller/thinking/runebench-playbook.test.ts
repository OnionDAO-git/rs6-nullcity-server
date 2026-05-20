import { bodyPlaybookPrompt, SUPPORTED_WORKFLOWS } from './runebench-playbook';

describe('RuneBench playbook', () => {
    it('keeps supported workflows structured for prompts and future routines', () => {
        expect(SUPPORTED_WORKFLOWS).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'make-fire',
                    measurableOutcome: expect.stringContaining('fire'),
                    actionKinds: expect.arrayContaining(['use_item_on_item']),
                    knowledgeIds: expect.arrayContaining(['skill-firemaking-basic']),
                }),
                expect.objectContaining({
                    id: 'safe-combat',
                    actionKinds: expect.arrayContaining(['attack', 'item_action']),
                    knowledgeIds: expect.arrayContaining(['combat-safe-basic', 'skill-prayer-basic']),
                }),
            ]),
        );
    });

    it('renders workflow cards into the Body prompt playbook', () => {
        const prompt = bodyPlaybookPrompt();

        expect(prompt).toContain('Workflow cards:');
        expect(prompt).toContain('Make fire:');
        expect(prompt).toContain('Action kinds: use_item_on_item');
        expect(prompt).toContain('Knowledge: skill-firemaking-basic');
        expect(prompt).toContain('RuneBench-style loop');
    });
});
