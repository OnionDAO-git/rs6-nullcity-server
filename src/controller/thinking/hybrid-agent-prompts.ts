import type { ActiveGoalState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';

export interface BrainPromptInput {
    soul: Soul;
    perception: Perception;
    activeGoal?: ActiveGoalState;
    commandPrefix: string;
}

export interface BodyPromptInput {
    soul: Soul;
    perception: Perception;
    activeGoal?: ActiveGoalState;
    commandPrefix: string;
    visibility: {
        anchor?: { x: number; y: number; level: number };
        returnDue: boolean;
    };
}

export function buildBrainPrompt(input: BrainPromptInput): string {
    return [
        '/think',
        'You are the Brain for an autonomous RuneScape resident. Think strategically, slowly, and in character.',
        'Choose one useful near-term goal. Do not emit game actions. The Body will translate the goal into concrete actions.',
        'Prefer practical old-school RuneScape goals the current engine can actually do:',
        '- Firemaker: gather ordinary logs, then use tinderbox on logs until a fire appears nearby.',
        '- Woodcutter: find ordinary Tree or Dead tree objects, move beside them, and use chop down to gather logs.',
        '- Survivor: keep food available, eat when hurt, avoid risky combat without food.',
        '- Local explorer: describe useful nearby NPCs, items, objects, and return near the visibility anchor so Codex can find you.',
        '- Basic combat: only fight safe low-level NPCs when healthy or when attacked; eat or retreat when hurt.',
        'Return JSON only with this shape:',
        '{"goal":{"id":"short-id","description":"clear current ambition","steps":["step one","step two"],"success":"how we know it worked","ttlTicks":300},"say":"optional public chat <= 160 chars"}',
        '',
        `Resident: ${input.soul.frontmatter.display || input.soul.frontmatter.name}`,
        `Command prefix: ${input.commandPrefix}`,
        `Soul notes:\n${input.soul.body}`,
        `Current goal:\n${JSON.stringify(input.activeGoal || null, null, 2)}`,
        `Perception:\n${summarizePerception(input.perception)}`,
    ].join('\n');
}

export function buildBodyPrompt(input: BodyPromptInput): string {
    return [
        '/no_think',
        'You are the Body for an autonomous RuneScape resident. Act quickly and concretely.',
        'Use the active Brain goal, current perception, visible actors/items/objects, and available actions.',
        'Return JSON only. Emit at most one action in actions. Prefer typed AgentAction objects over explanations.',
        'Allowed action examples: {"kind":"move_to","target":{"x":3222,"y":3219,"level":0}}, {"kind":"say","text":"..."}, {"kind":"interact","target":...,"option":"talk-to"}, {"kind":"use_item_on_item","itemSlot":0,"targetSlot":1}, {"kind":"attack","target":...}.',
        'When interacting with an object, use one of the option names shown in available actions, such as "chop down".',
        'If addressed in chat, answer or act. If the goal involves an item/tool and matching inventory slots are visible, use them.',
        input.visibility.returnDue && input.visibility.anchor
            ? `Visibility rule: Agent is due to return near ${JSON.stringify(input.visibility.anchor)} so Codex can find him. Prefer moving there unless a chat command or survival need is more important.`
            : 'Visibility rule: stay findable and mention useful intentions in public chat sometimes.',
        '',
        `Resident: ${input.soul.frontmatter.display || input.soul.frontmatter.name}`,
        `Command prefix: ${input.commandPrefix}`,
        `Active Brain goal:\n${JSON.stringify(input.activeGoal || null, null, 2)}`,
        `Perception:\n${summarizePerception(input.perception)}`,
    ].join('\n');
}

function summarizePerception(perception: Perception): string {
    const compressed = typeof perception.compressed === 'string' ? perception.compressed : undefined;
    if (compressed) {
        return compressed.slice(0, 12000);
    }

    return JSON.stringify(perception, null, 2).slice(0, 12000);
}
