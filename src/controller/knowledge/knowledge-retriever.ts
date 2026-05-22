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
