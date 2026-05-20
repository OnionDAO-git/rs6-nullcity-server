export const RUNEBENCH_AGENT_LOOP = [
    'RuneBench-style loop:',
    '- Start with one concrete action that can work now.',
    '- Observe the result before escalating into a longer routine.',
    '- Prefer measurable progress over vague wandering.',
    '- If an action fails or repeats without progress, change tactic quickly.',
].join('\n');

export const MEASURABLE_GOALS = [
    'Measurable goals:',
    '- Woodcutting: reach a visible ordinary Tree or Dead tree, chop it, and gain logs or XP.',
    '- Firemaking: use tinderbox on logs and confirm a nearby fire or item change.',
    '- Combat/Prayer: fight only safe low-level NPCs, loot bones, then bury bones.',
    '- Exploration: move to a new visible landmark, identify useful NPCs/items/objects, and report the next action.',
    '- Trading/social: respond to trusted players, approach when too far, and use the trade actions deliberately.',
].join('\n');

export const AGENT_ACTION_TOOL_SURFACE = [
    'AgentAction tool surface:',
    '- move_to: walk toward coordinates; use range 1-2 for objects, NPCs, and players.',
    '- interact object/NPC/item: use visible option text such as "chop down", "talk-to", "attack", or "pick-up".',
    '- use_item_on_item: combine inventory slots, for example tinderbox plus logs.',
    '- item_action: use inventory options such as "bury", "eat", "wield", "wear", or "drop".',
    '- attack/eat: fight safe targets only when healthy; eat food before danger gets urgent.',
    '- say: keep observers oriented with location, goal, and next step.',
    '- trade_request/trade_offer_item/trade_accept/trade_decline: trade only with trusted or directly instructed players.',
].join('\n');

export interface WorkflowCard {
    id: string;
    title: string;
    when: string;
    nextSteps: string[];
    actionKinds: string[];
    measurableOutcome: string;
    knowledgeIds: string[];
}

export const SUPPORTED_WORKFLOWS: WorkflowCard[] = [
    {
        id: 'make-fire',
        title: 'Make fire',
        when: 'Use when the resident has or can gather normal logs and should prove tool/item use.',
        nextSteps: ['If carrying tinderbox and logs, use_item_on_item.', 'If no logs, chop ordinary Tree or Dead tree first.'],
        actionKinds: ['use_item_on_item', 'move_to', 'interact'],
        measurableOutcome: 'logs are consumed, fire appears nearby, or firemaking XP/messages change',
        knowledgeIds: ['skill-firemaking-basic', 'skill-woodcutting-basic'],
    },
    {
        id: 'train-woodcutting',
        title: 'Train woodcutting',
        when: 'Use when an ordinary Tree or Dead tree is visible or the resident needs logs.',
        nextSteps: ['Find nearest ordinary Tree or Dead tree.', 'Move beside it.', 'Interact with "chop down" or "chop".'],
        actionKinds: ['move_to', 'interact'],
        measurableOutcome: 'inventory gains logs or woodcutting XP/messages change',
        knowledgeIds: ['skill-woodcutting-basic'],
    },
    {
        id: 'safe-combat',
        title: 'Safe combat',
        when: 'Use when a nearby low-risk NPC is visible, health is safe, and food/survival rules allow combat.',
        nextSteps: [
            'Choose chicken, cow, rat, giant rat, or goblin.',
            'Approach and attack.',
            'Eat if hurt.',
            'Loot useful drops after the kill.',
        ],
        actionKinds: ['move_to', 'attack', 'item_action', 'interact'],
        measurableOutcome: 'target dies, loot appears, or combat/prayer supplies improve without unsafe HP',
        knowledgeIds: ['combat-safe-basic', 'skill-prayer-basic'],
    },
    {
        id: 'train-prayer',
        title: 'Train prayer',
        when: 'Use when bones are visible or carried, especially after safe combat.',
        nextSteps: [
            'Pick up visible owned or unowned bones.',
            'Use the inventory "bury" option on carried bones.',
            'If no bones exist, get bones from low-risk animals.',
        ],
        actionKinds: ['interact', 'item_action', 'attack'],
        measurableOutcome: 'bones leave inventory or prayer XP/messages change',
        knowledgeIds: ['skill-prayer-basic', 'combat-safe-basic'],
    },
    {
        id: 'explore-locally',
        title: 'Explore locally',
        when: 'Use when no immediate skill target is available or the resident needs new options.',
        nextSteps: [
            'Walk to a nearby landmark, NPC, object, or item.',
            'Say what is visible and what looks useful.',
            'Avoid repeating the same spot.',
        ],
        actionKinds: ['move_to', 'say'],
        measurableOutcome: 'position changes, new useful entities become visible, or chat reports a concrete next action',
        knowledgeIds: ['social-follow-codex'],
    },
    {
        id: 'follow-codex',
        title: 'Follow Codex',
        when: 'Use when Codex asks to meet, follow, observe, or debug the resident.',
        nextSteps: [
            'Move near the configured player or visibility anchor.',
            'Answer direct chat.',
            'Pause only for survival or explicit higher-priority commands.',
        ],
        actionKinds: ['move_to', 'say', 'trade_request'],
        measurableOutcome: 'resident is visible to Codex and chat explains current goal/blocker',
        knowledgeIds: ['social-follow-codex'],
    },
];

export const SUPPORTED_WORKFLOW_CARDS = renderWorkflowCards(SUPPORTED_WORKFLOWS);

export function brainPlaybookPrompt(): string {
    return [RUNEBENCH_AGENT_LOOP, MEASURABLE_GOALS].join('\n\n');
}

export function bodyPlaybookPrompt(): string {
    return [RUNEBENCH_AGENT_LOOP, AGENT_ACTION_TOOL_SURFACE, SUPPORTED_WORKFLOW_CARDS].join('\n\n');
}

function renderWorkflowCards(workflows: WorkflowCard[]): string {
    return [
        'Workflow cards:',
        ...workflows.map(
            workflow =>
                `- ${workflow.title}: ${workflow.nextSteps.join(' ')} Action kinds: ${workflow.actionKinds.join(', ')}. Outcome: ${workflow.measurableOutcome}. Knowledge: ${workflow.knowledgeIds.join(', ')}.`,
        ),
    ].join('\n');
}
