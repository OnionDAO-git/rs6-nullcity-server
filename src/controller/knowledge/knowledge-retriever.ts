import { estimateTokens } from '../util/token-count';

export interface KnowledgeEntry {
    id: string;
    title: string;
    summary: string;
    topics: string[];
    keywords: string[];
    source: string;
    requiredItems?: string[];
    actions?: string[];
    successSignals?: string[];
}

export interface KnowledgeResult {
    entry: KnowledgeEntry;
    score: number;
    matchedTerms: string[];
}

export interface RetrieveKnowledgeOptions {
    limit?: number;
    minScore?: number;
}

export interface FormatKnowledgeOptions {
    maxChars?: number;
}

export const ENGINE_KNOWLEDGE_ENTRIES: KnowledgeEntry[] = [
    {
        id: 'skill-firemaking-basic',
        title: 'Skill: Firemaking',
        topics: ['firemaking', 'logs', 'tinderbox', 'starter'],
        keywords: ['fire', 'light', 'logs', 'normal logs', 'tinderbox', 'burn', 'campfire', 'use item on item'],
        requiredItems: ['rs:tinderbox', 'rs:logs'],
        actions: ['use_item_on_item'],
        successSignals: ['inventory logs decrease', 'fire object appears nearby', 'message mentions the fire catches'],
        source: 'src/plugins/skills/firemaking/index.ts; src/plugins/skills/firemaking/data.ts; src/plugins/skills/skill-guides/firemaking.json',
        summary:
            'To make a starter fire, use a tinderbox on normal logs. The engine handles this through item-on-item actions and ordinary logs are level 1 Firemaking for 40 XP.',
    },
    {
        id: 'skill-woodcutting-basic',
        title: 'Skill: Woodcutting',
        topics: ['woodcutting', 'trees', 'logs', 'starter'],
        keywords: ['woodcut', 'chop', 'chop down', 'tree', 'dead tree', 'logs', 'axe', 'hatchet', 'ordinary tree'],
        requiredItems: ['axe or hatchet in inventory/equipment'],
        actions: ['move_to', 'interact option "chop down"', 'interact option "chop"'],
        successSignals: ['inventory gains rs:logs', 'tree depletion message', 'woodcutting XP changes'],
        source: 'src/plugins/skills/woodcutting/index.ts; src/plugins/skills/skill-guides/woodcutting.json',
        summary:
            'For level 1 woodcutting, move next to a normal Tree or Dead tree and interact using an available "chop down" or "chop" option. Logs feed firemaking and fletching goals.',
    },
    {
        id: 'skill-fishing-basic',
        title: 'Skill: Fishing',
        topics: ['fishing', 'food', 'starter', 'shrimp'],
        keywords: ['fish', 'fishing', 'shrimp', 'anchovies', 'small net', 'small fishing net', 'net', 'bait', 'rod', 'trout'],
        requiredItems: ['rs:small_fishing_net', 'rs:fishing_rod + bait', 'rs:fly_fishing_rod + feathers'],
        actions: ['move_to', 'interact with fishing spot using the matching method option'],
        successSignals: ['inventory gains raw fish such as shrimp', 'fishing XP changes'],
        source: 'src/plugins/skills/fishing/fishing-data.ts; src/plugins/skills/skill-guides/fishing.json',
        summary:
            'Starter fishing uses a small fishing net at net-capable fishing spots to catch shrimp at level 1. Later methods need matching tools and consumables such as bait or feathers.',
    },
    {
        id: 'skill-mining-basic',
        title: 'Skill: Mining',
        topics: ['mining', 'ore', 'starter'],
        keywords: ['mine', 'mining', 'rock', 'ore', 'copper', 'tin', 'pickaxe', 'pick'],
        requiredItems: ['usable pickaxe in inventory/equipment'],
        actions: ['move_to', 'interact option "mine"'],
        successSignals: ['inventory gains ore', 'rock depletes', 'mining XP changes'],
        source: 'src/plugins/skills/mining/mining.plugin.ts; src/plugins/skills/mining/mining-task.ts; src/plugins/skills/skill-guides/mining.json',
        summary:
            'Mining requires a pickaxe the player can use, then the Body should move beside a visible mineable rock and use the "mine" interaction option.',
    },
    {
        id: 'skill-prayer-basic',
        title: 'Skill: Prayer',
        topics: ['prayer', 'bones', 'combat', 'starter'],
        keywords: ['prayer', 'bury', 'bones', 'bone', 'drop', 'loot', 'chicken', 'cow', 'goblin'],
        requiredItems: ['bones in inventory'],
        actions: ['item_action option "bury"'],
        successSignals: ['bones leave inventory', 'prayer XP changes'],
        source: 'src/plugins/skills/prayer/bury-bones.plugin.ts; data/config/items/bones.json',
        summary:
            'Bones can be buried from inventory with the "bury" item action. Safe early combat can feed prayer by looting ordinary bones from low-risk kills.',
    },
    {
        id: 'skill-magic-basic',
        title: 'Skill: Magic',
        topics: ['magic', 'spells', 'runes', 'combat', 'teleport'],
        keywords: [
            'magic',
            'cast',
            'spell',
            'rune',
            'runes',
            'air',
            'water',
            'earth',
            'fire',
            'mind',
            'chaos',
            'death',
            'wind strike',
            'wave',
            'teleport',
            'alchemy',
            'staff',
            'spellbook',
        ],
        requiredItems: ['rs:mind_rune', 'rs:air_rune (or matching elemental)', 'staff or equivalent rune saving (optional)'],
        actions: ['cast_spell', 'attack', 'use_item_on_item (e.g., high alchemy)'],
        successSignals: ['rune count decreases', 'damage appears on target', 'magic XP changes', 'teleport completes with screen fade'],
        source: 'src/plugins/skills/magic/*; docs/runescape-skill/skills/magic.md; docs/runescape-skill/items.md § Runes',
        summary:
            'Cast spells from the spellbook by consuming runes. Wind Strike (level 1; 1 air + 1 mind rune) is the cheapest starter combat spell. Higher tiers (Bolt → Blast → Wave) need chaos/death/blood runes. Teleports use law runes plus elemental.',
    },
    {
        id: 'skill-ranged-basic',
        title: 'Skill: Ranged',
        topics: ['ranged', 'bow', 'arrow', 'combat', 'starter'],
        keywords: [
            'ranged',
            'range',
            'bow',
            'shortbow',
            'longbow',
            'arrow',
            'arrows',
            'bronze arrow',
            'iron arrow',
            'crossbow',
            'bolt',
            'shoot',
            'fire arrow',
            'safespot',
            'leather',
            'd hide',
            'lowe',
        ],
        requiredItems: ['bow (e.g., rs:shortbow) in equip slot', 'matching arrows (e.g., rs:bronze_arrow) in ammo slot'],
        actions: ['attack', 'move_to safespot or behind obstacle', 'item_action equip on ammo'],
        successSignals: [
            'damage numbers on target',
            'arrow count drops in ammo slot',
            'ranged XP changes',
            'dropped arrows appear on tile after combat',
        ],
        source: 'src/plugins/skills/ranged/*; docs/runescape-skill/skills/ranged.md; docs/runescape-skill/items.md § Bows And Arrows',
        summary:
            'Train Ranged with a bow (shortbow = fast, longbow = longer range) + matching metal arrows. Walk over the tile after combat to recover most dropped arrows. Use safespots (tile separated from target by an obstacle) to fire without melee retaliation.',
    },
    {
        id: 'skill-cooking-basic',
        title: 'Skill: Cooking',
        topics: ['cooking', 'food', 'fire', 'range', 'starter'],
        keywords: [
            'cook',
            'cooking',
            'raw',
            'shrimp',
            'fish',
            'meat',
            'chicken',
            'bread',
            'cake',
            'fire',
            'range',
            'burnt',
            'food',
            'heal',
        ],
        requiredItems: ['raw food (e.g., rs:raw_shrimps)', 'nearby fire or cooking range'],
        actions: ['use_item_on_item (raw food + fire)', 'interact option "cook" on range'],
        successSignals: ['raw item becomes cooked equivalent', 'cooking XP changes', 'inventory food is edible (right-click → eat heals)'],
        source: 'src/plugins/skills/cooking/*; docs/runescape-skill/skills/cooking.md; docs/runescape-skill/items.md § Food',
        summary:
            'Cook raw food on a nearby fire (firemaking output) or on a cooking range like the Lumbridge Castle kitchen. Burnt items have no heal value; discard them. Cooked shrimp heal 3, trout 7, lobster 12, swordfish 14.',
    },
    {
        id: 'skill-smithing-basic',
        title: 'Skill: Smithing',
        topics: ['smithing', 'smelt', 'forge', 'bar', 'furnace', 'anvil', 'starter'],
        keywords: [
            'smith',
            'smithing',
            'smelt',
            'bar',
            'bronze',
            'iron',
            'steel',
            'mithril',
            'adamant',
            'rune',
            'copper',
            'tin',
            'ore',
            'furnace',
            'anvil',
            'hammer',
            'forge',
        ],
        requiredItems: [
            'ore (e.g., rs:copper_ore + rs:tin_ore for bronze)',
            'hammer for forging at anvil (rs:hammer)',
            'bar in inventory when at anvil',
        ],
        actions: ['use_item_on_item (ore on furnace to smelt)', 'use_item_on_item (bar on anvil to forge)', 'interact option "smith"'],
        successSignals: ['ores become bar in inventory', 'bar becomes weapon/armor at anvil', 'smithing XP changes'],
        source: 'src/plugins/skills/smithing/*; docs/runescape-skill/skills/smithing.md; docs/runescape-skill/items.md § Ores / Bars / Smithing chain',
        summary:
            'Smithing has two phases: (1) smelt ore at a furnace (copper + tin → bronze bar at level 1), (2) forge bars on an anvil with a hammer. Iron bar needs level 15 smelt; mithril needs 4 coal + 1 mithril ore at level 50.',
    },
    {
        id: 'skill-trading-basic',
        title: 'Skill: Trading With Players',
        topics: ['trading', 'trade', 'players', 'commerce', 'social'],
        keywords: ['trade', 'trading', 'offer', 'accept', 'decline', 'sell', 'buy', 'gp', 'gold', 'item exchange', 'player', 'safety'],
        requiredItems: ['items or coins to offer'],
        actions: ['trade_request', 'trade_offer_item', 'trade_accept', 'trade_decline'],
        successSignals: [
            'trade window opens for both players',
            'offered items appear in counterparty pane',
            'final accepted exchange transfers items + coins; trade XP not earned (no skill XP for trading)',
        ],
        source: 'src/controller/actions/trading.ts; docs/runescape-skill/skills/trading.md',
        summary:
            'Player-to-player trading is a 5-state FSM: send a trade_request → both confirm → offer items via trade_offer_item → trade_accept (twice) to finalize, or trade_decline to abort. Honor agreed terms; do not change offers after the counterparty has accepted.',
    },
    {
        id: 'combat-safe-basic',
        title: 'Combat: Safe Starter Fights',
        topics: ['combat', 'survival', 'starter', 'food'],
        keywords: ['combat', 'fight', 'attack', 'safe', 'chicken', 'cow', 'goblin', 'rat', 'enemy', 'health', 'food', 'retreat'],
        requiredItems: ['food recommended before fighting anything risky'],
        actions: ['attack', 'item_action eat', 'move_to retreat target'],
        successSignals: ['target dies', 'loot appears', 'combat XP changes', 'health remains safe'],
        source: 'data/config/npcs/*.json; data/config/npc-spawns/**/*.json; src/controller/nervous-system/rules.ts',
        summary:
            'Only start fights with low-risk nearby NPCs when healthy. If health drops or a stronger enemy attacks, eat available food or retreat before continuing the plan.',
    },
    {
        id: 'social-follow-codex',
        title: 'Social: Follow And Report',
        topics: ['social', 'visibility', 'chat', 'debugging'],
        keywords: ['codex', 'follow', 'chat', 'say', 'report', 'visible', 'where', 'find', 'dashboard'],
        actions: ['say', 'move_to'],
        successSignals: ['public chat acknowledges the player', 'agent returns near the visibility anchor', 'dashboard position changes'],
        source: 'src/controller/thinking/hybrid-agent-thinking-module.ts; feat/runebench-systems-design.md',
        summary:
            'When Codex or a player talks to the resident, answer in chat and bias movement toward staying visible. Report the current goal, next action, and blockers in plain public chat.',
    },
    {
        id: 'shops-starter-tools',
        title: 'World: Starter Tool Shops',
        topics: ['shops', 'tools', 'starter', 'gear'],
        keywords: ['shop', 'buy', 'store', 'general store', 'axe', 'pickaxe', 'fishing shop', 'tool', 'lumbridge'],
        actions: ['interact option "trade"', 'buy from shop'],
        successSignals: ['shop interface opens', 'inventory gains requested tool'],
        source: 'data/config/shops/**/*.json; RuneBench wiki shops/*.md as optional reference',
        summary:
            'Tool acquisition should prefer local engine shop data first. Shops are useful recovery targets when a goal needs a missing axe, tinderbox, pickaxe, fishing net, bait, or food.',
    },
    {
        id: 'quests-starter-overview',
        title: 'Quests: Starter Overview',
        topics: ['quests', 'starter', 'progression', 'rewards'],
        keywords: ['quest', 'quests', 'quest log', 'quest journal', 'quest tab', 'quest point', 'qp', 'start a quest', 'how do quests work', 'reward', 'objective'],
        actions: ['interact', 'talk-to quest-giver NPC', 'item_action use required item'],
        successSignals: ['quest log updates with next step', 'quest journal shows new progress line', 'quest tab marks quest in-progress (yellow) or complete (green)', 'reward XP / items / quest points granted on completion'],
        source: 'docs/runescape-skill/quests/; src/plugins/quests/*',
        summary:
            'Quests are NPC-driven side objectives that grant XP, items, and quest points. Start a quest by talking to its quest-giver NPC (often marked with a yellow `!` icon). Quest log (interface tab) shows in-progress steps; talk to NPCs again to advance. Three starter quests are documented: Cook\'s Assistant (Lumbridge), The Restless Ghost (Lumbridge Church), and Romeo & Juliet (Varrock).',
    },
    {
        id: 'quest-cooks-assistant',
        title: "Quest: Cook's Assistant",
        topics: ['quest', 'cooks-assistant', 'cooking', 'lumbridge', 'starter'],
        keywords: ["cook's assistant", 'cook', 'flour', 'egg', 'milk', 'cake', 'lumbridge kitchen', 'duke', 'birthday'],
        requiredItems: ['rs:pot_of_flour (Lumbridge windmill grind wheat)', 'rs:egg (from chicken coop east of Lumbridge)', 'rs:bucket_of_milk (Lumbridge cow field, bucket on cow)'],
        actions: ['interact talk-to Cook', 'move_to Lumbridge Castle Kitchen 3208,3213,0', 'item_action use on player to gather, then trade to Cook'],
        successSignals: ['Cook dialog accepts each ingredient', 'quest log advances', 'quest completes for 300 cooking XP + permanent kitchen range access'],
        source: 'docs/runescape-skill/quests/cooks-assistant.md; src/plugins/quests/cooks-assistant/*',
        summary:
            "Cook's Assistant is the easiest Lumbridge starter quest. Talk to the Cook in Lumbridge Castle Kitchen (3208,3213,0). Bring him flour (windmill), egg (chicken coop), and milk (bucket on cow). Reward: 300 Cooking XP + always-on kitchen range access for higher cooking success rate.",
    },
    {
        id: 'quest-restless-ghost',
        title: 'Quest: The Restless Ghost',
        topics: ['quest', 'restless-ghost', 'prayer', 'lumbridge', 'starter', 'ghostspeak'],
        keywords: ['restless ghost', 'ghost', 'haunted', 'graveyard', 'skull', 'father aereck', 'father urhney', 'lumbridge church', 'wizards tower', 'ghostspeak amulet', 'altar'],
        requiredItems: ['rs:ghostspeak_amulet (from Father Urhney in swamp west of Lumbridge)', 'ghost skull (from haunted coffin in Lumbridge graveyard)'],
        actions: ['interact talk-to Father Aereck', 'move_to Lumbridge Church 3242,3208,0', 'move_to Father Urhney 3147,3175,0 (Wizards Tower swamp)', 'interact open coffin in graveyard', 'item_action place skull on altar'],
        successSignals: ['Father Aereck dialog progresses', 'inventory gains Ghostspeak Amulet', 'inventory gains ghost skull', 'quest completes for 1125 Prayer XP + retain Ghostspeak Amulet'],
        source: 'docs/runescape-skill/quests/restless-ghost.md; src/plugins/quests/restless-ghost/*',
        summary:
            'The Restless Ghost is a Lumbridge starter quest that rewards Prayer XP and the permanent Ghostspeak Amulet (lets you talk to all ghosts). Talk to Father Aereck at Lumbridge Church, then Father Urhney in the swamp west of Lumbridge for the amulet. Find the ghost in the graveyard, recover its skull from a coffin, and place it on the altar.',
    },
    {
        id: 'quest-romeo-and-juliet',
        title: 'Quest: Romeo & Juliet',
        topics: ['quest', 'romeo-and-juliet', 'varrock', 'starter'],
        keywords: ['romeo', 'juliet', 'father lawrence', 'apothecary', 'cadava berries', 'cadava potion', 'varrock', 'message', 'love'],
        requiredItems: ['rs:cadava_berries (from cadava bush southeast of Varrock)', "rs:message (from Romeo)", 'rs:cadava_potion (Apothecary brews from berries)'],
        actions: ['interact talk-to Romeo', 'move_to Varrock Square 3211,3424,0', 'move_to Juliet 3158,3425,0 (west of Varrock)', 'move_to Father Lawrence 3254,3482,0 (Varrock Church)', 'move_to Apothecary 3194,3404,0', 'item_action use cadava potion on Juliet'],
        successSignals: ['Romeo, Juliet, Father Lawrence, and Apothecary dialogs all advance correctly', 'inventory passes through message → berries → potion', 'quest completes for 5 quest points'],
        source: 'docs/runescape-skill/quests/romeo-and-juliet.md; src/plugins/quests/romeo-and-juliet/*',
        summary:
            'Romeo & Juliet is a Varrock starter quest worth 5 quest points (no XP). Romeo at Varrock Square asks you to deliver a message to Juliet west of Varrock. After Father Lawrence proposes a fake-death plan, the Apothecary brews a cadava potion from berries you collect southeast of Varrock; give the potion to Juliet to complete.',
    },
];

const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'has',
    'have',
    'i',
    'in',
    'into',
    'is',
    'it',
    'me',
    'near',
    'of',
    'on',
    'or',
    'the',
    'then',
    'to',
    'use',
    'with',
]);

export function retrieveKnowledge(entries: KnowledgeEntry[], query: string, options: RetrieveKnowledgeOptions = {}): KnowledgeResult[] {
    const limit = options.limit ?? 4;
    const minScore = options.minScore ?? 1;
    const terms = tokenize(query);
    if (!terms.length) {
        return [];
    }

    return entries
        .map(entry => scoreEntry(entry, terms))
        .filter(result => result.score >= minScore)
        .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
        .slice(0, limit);
}

export function renderKnowledgeEntry(entry: KnowledgeEntry): string {
    const sections = [
        `- ${entry.title}: ${entry.summary}`,
        entry.requiredItems?.length ? `  Required: ${entry.requiredItems.join(', ')}` : undefined,
        entry.actions?.length ? `  Actions: ${entry.actions.join(', ')}` : undefined,
        entry.successSignals?.length ? `  Success: ${entry.successSignals.join('; ')}` : undefined,
        `  Source: ${entry.source}`,
    ].filter(Boolean);

    return sections.join('\n');
}

export function enforceKnowledgeBudget(
    entries: KnowledgeEntry[],
    maxTokens: number,
): KnowledgeEntry[] & { budgetTrimmed: boolean; budgetOvershot: boolean } {
    const accepted: KnowledgeEntry[] = [];
    let currentTokens = 0;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const rendered = renderKnowledgeEntry(entry);
        const entryTokens = estimateTokens(rendered);

        if (accepted.length === 0) {
            accepted.push(entry);
            currentTokens += entryTokens;
        } else {
            if (currentTokens < maxTokens && currentTokens + entryTokens - maxTokens <= 200) {
                accepted.push(entry);
                currentTokens += entryTokens;
            }
        }
    }

    const result = accepted as any;
    result.budgetTrimmed = accepted.length < entries.length;
    result.budgetOvershot = currentTokens > maxTokens;
    return result;
}

export function formatKnowledgeForPrompt(results: KnowledgeResult[], options: FormatKnowledgeOptions = {}): string {
    const maxChars = options.maxChars ?? 2400;
    const renderedEntries = results.map(result => renderKnowledgeEntry(result.entry));

    return joinWholeEntries(renderedEntries, maxChars);
}

function joinWholeEntries(entries: string[], maxChars: number): string {
    const accepted: string[] = [];
    for (const entry of entries) {
        const next = [...accepted, entry].join('\n');
        if (next.length > maxChars) {
            break;
        }
        accepted.push(entry);
    }

    return accepted.join('\n');
}

function scoreEntry(entry: KnowledgeEntry, terms: string[]): KnowledgeResult {
    const title = normalize(entry.title);
    const summary = normalize(entry.summary);
    const source = normalize(entry.source);
    const topics = entry.topics.map(normalize);
    const keywords = entry.keywords.map(normalize);
    const requiredItems = (entry.requiredItems || []).flatMap(item => tokenize(item));
    const actions = (entry.actions || []).flatMap(action => tokenize(action));
    const matchedTerms: string[] = [];
    let score = 0;

    for (const term of terms) {
        let matched = false;
        if (topics.some(topic => topic === term || topic.includes(term))) {
            score += 8;
            matched = true;
        }
        if (keywords.some(keyword => keyword === term || keyword.includes(term))) {
            score += 6;
            matched = true;
        }
        if (title.includes(term)) {
            score += 5;
            matched = true;
        }
        if (requiredItems.includes(term)) {
            score += 4;
            matched = true;
        }
        if (actions.includes(term)) {
            score += 3;
            matched = true;
        }
        if (summary.includes(term)) {
            score += 2;
            matched = true;
        }
        if (source.includes(term)) {
            score += 1;
            matched = true;
        }
        if (matched) {
            matchedTerms.push(term);
        }
    }

    return { entry, score, matchedTerms };
}

function tokenize(text: string): string[] {
    const terms = normalize(text)
        .split(/[^a-z0-9:]+/g)
        .map(term => term.trim())
        .filter(term => term.length > 1 && !STOP_WORDS.has(term));

    return Array.from(new Set(terms.flatMap(expandTerm)));
}

function expandTerm(term: string): string[] {
    const expanded = [term];
    if (term.endsWith('s') && term.length > 3) {
        expanded.push(term.slice(0, -1));
    }
    if (term.includes(':')) {
        expanded.push(...term.split(':').filter(Boolean));
    }

    return expanded;
}

function normalize(text: string): string {
    return text.toLowerCase().replace(/_/g, ' ');
}
