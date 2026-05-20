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

export const SUPPORTED_WORKFLOW_CARDS = [
    'Workflow cards:',
    '- Make fire: if carrying tinderbox and logs, use_item_on_item; if no logs, chop ordinary Tree or Dead tree first.',
    '- Train woodcutting: find nearest ordinary Tree or Dead tree, move beside it, interact with "chop down", then use logs for firemaking.',
    '- Safe combat: choose chicken, cow, rat, giant rat, or goblin; approach, attack, eat if hurt, loot useful drops.',
    '- Train prayer: pick up visible owned/unowned bones, bury carried bones, or get bones from low-risk animals.',
    '- Explore locally: walk to a nearby landmark/NPC/item, say what is visible, and avoid repeating the same spot.',
    '- Follow Codex: keep near the configured player when asked, but pause for survival and direct chat commands.',
].join('\n');

export function brainPlaybookPrompt(): string {
    return [RUNEBENCH_AGENT_LOOP, MEASURABLE_GOALS].join('\n\n');
}

export function bodyPlaybookPrompt(): string {
    return [RUNEBENCH_AGENT_LOOP, AGENT_ACTION_TOOL_SURFACE, SUPPORTED_WORKFLOW_CARDS].join('\n\n');
}
