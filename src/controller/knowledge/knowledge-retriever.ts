import { estimateTokens } from '../util/token-count';
import type { PerceptionContext, GoalContext } from './context-derivation';

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
    perceptionContext?: PerceptionContext;
    goalContext?: GoalContext;
    tokenBudget?: number;
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
        keywords: [
            'quest',
            'quests',
            'quest log',
            'quest journal',
            'quest tab',
            'quest point',
            'qp',
            'start a quest',
            'how do quests work',
            'reward',
            'objective',
        ],
        actions: ['interact', 'talk-to quest-giver NPC', 'item_action use required item'],
        successSignals: [
            'quest log updates with next step',
            'quest journal shows new progress line',
            'quest tab marks quest in-progress (yellow) or complete (green)',
            'reward XP / items / quest points granted on completion',
        ],
        source: 'docs/runescape-skill/quests/; src/plugins/quests/*',
        summary:
            "Quests are NPC-driven side objectives that grant XP, items, and quest points. Start a quest by talking to its quest-giver NPC (often marked with a yellow `!` icon). Quest log (interface tab) shows in-progress steps; talk to NPCs again to advance. Three starter quests are documented: Cook's Assistant (Lumbridge), The Restless Ghost (Lumbridge Church), and Romeo & Juliet (Varrock).",
    },
    {
        id: 'quest-cooks-assistant',
        title: "Quest: Cook's Assistant",
        topics: ['quest', 'cooks-assistant', 'cooking', 'lumbridge', 'starter'],
        keywords: ["cook's assistant", 'cook', 'flour', 'egg', 'milk', 'cake', 'lumbridge kitchen', 'duke', 'birthday'],
        requiredItems: [
            'rs:pot_of_flour (Lumbridge windmill grind wheat)',
            'rs:egg (from chicken coop east of Lumbridge)',
            'rs:bucket_of_milk (Lumbridge cow field, bucket on cow)',
        ],
        actions: [
            'interact talk-to Cook',
            'move_to Lumbridge Castle Kitchen 3208,3213,0',
            'item_action use on player to gather, then trade to Cook',
        ],
        successSignals: [
            'Cook dialog accepts each ingredient',
            'quest log advances',
            'quest completes for 300 cooking XP + permanent kitchen range access',
        ],
        source: 'docs/runescape-skill/quests/cooks-assistant.md; src/plugins/quests/cooks-assistant/*',
        summary:
            "Cook's Assistant is the easiest Lumbridge starter quest. Talk to the Cook in Lumbridge Castle Kitchen (3208,3213,0). Bring him flour (windmill), egg (chicken coop), and milk (bucket on cow). Reward: 300 Cooking XP + always-on kitchen range access for higher cooking success rate.",
    },
    {
        id: 'quest-restless-ghost',
        title: 'Quest: The Restless Ghost',
        topics: ['quest', 'restless-ghost', 'prayer', 'lumbridge', 'starter', 'ghostspeak'],
        keywords: [
            'restless ghost',
            'ghost',
            'haunted',
            'graveyard',
            'skull',
            'father aereck',
            'father urhney',
            'lumbridge church',
            'wizards tower',
            'ghostspeak amulet',
            'altar',
        ],
        requiredItems: [
            'rs:ghostspeak_amulet (from Father Urhney in swamp west of Lumbridge)',
            'ghost skull (from haunted coffin in Lumbridge graveyard)',
        ],
        actions: [
            'interact talk-to Father Aereck',
            'move_to Lumbridge Church 3242,3208,0',
            'move_to Father Urhney 3147,3175,0 (Wizards Tower swamp)',
            'interact open coffin in graveyard',
            'item_action place skull on altar',
        ],
        successSignals: [
            'Father Aereck dialog progresses',
            'inventory gains Ghostspeak Amulet',
            'inventory gains ghost skull',
            'quest completes for 1125 Prayer XP + retain Ghostspeak Amulet',
        ],
        source: 'docs/runescape-skill/quests/restless-ghost.md; src/plugins/quests/restless-ghost/*',
        summary:
            'The Restless Ghost is a Lumbridge starter quest that rewards Prayer XP and the permanent Ghostspeak Amulet (lets you talk to all ghosts). Talk to Father Aereck at Lumbridge Church, then Father Urhney in the swamp west of Lumbridge for the amulet. Find the ghost in the graveyard, recover its skull from a coffin, and place it on the altar.',
    },
    {
        id: 'quest-romeo-and-juliet',
        title: 'Quest: Romeo & Juliet',
        topics: ['quest', 'romeo-and-juliet', 'varrock', 'starter'],
        keywords: ['romeo', 'juliet', 'father lawrence', 'apothecary', 'cadava berries', 'cadava potion', 'varrock', 'message', 'love'],
        requiredItems: [
            'rs:cadava_berries (from cadava bush southeast of Varrock)',
            'rs:message (from Romeo)',
            'rs:cadava_potion (Apothecary brews from berries)',
        ],
        actions: [
            'interact talk-to Romeo',
            'move_to Varrock Square 3211,3424,0',
            'move_to Juliet 3158,3425,0 (west of Varrock)',
            'move_to Father Lawrence 3254,3482,0 (Varrock Church)',
            'move_to Apothecary 3194,3404,0',
            'item_action use cadava potion on Juliet',
        ],
        successSignals: [
            'Romeo, Juliet, Father Lawrence, and Apothecary dialogs all advance correctly',
            'inventory passes through message → berries → potion',
            'quest completes for 5 quest points',
        ],
        source: 'docs/runescape-skill/quests/romeo-and-juliet.md; src/plugins/quests/romeo-and-juliet/*',
        summary:
            'Romeo & Juliet is a Varrock starter quest worth 5 quest points (no XP). Romeo at Varrock Square asks you to deliver a message to Juliet west of Varrock. After Father Lawrence proposes a fake-death plan, the Apothecary brews a cadava potion from berries you collect southeast of Varrock; give the potion to Juliet to complete.',
    },
    {
        id: 'monster-chicken-starter',
        title: 'Monster: Chicken (Combat Level 1)',
        topics: ['monster', 'chicken', 'combat', 'starter', 'feathers', 'lumbridge'],
        keywords: ['chicken', 'chickens', 'lumbridge farm', 'feather', 'feathers', 'raw chicken', 'starter combat', 'easy kill'],
        requiredItems: ['no weapon required (fists work); bronze weapon faster'],
        actions: ['attack', 'item_action loot feathers bones raw chicken'],
        successSignals: [
            'target dies in 1-3 hits',
            'inventory gains rs:feather + rs:raw_chicken + rs:bones',
            'combat XP changes (Attack/Strength/Defence + Hitpoints)',
        ],
        source: 'docs/runescape-skill/monsters.md § Chicken; data/config/npcs/chicken.json',
        summary:
            'Chicken (combat level 1, 3 HP, max hit 1, passive) is the safest starter combat target. Spawn cluster: Lumbridge farm coop around 3232,3299 and Falador farm. Drops feathers (stackable, useful for fletching arrows), raw chicken (cook for 3 HP heal), and bones (bury for Prayer XP). Train Attack/Strength/Defence here from level 1-5.',
    },
    {
        id: 'monster-cow-starter',
        title: 'Monster: Cow (Combat Level 2)',
        topics: ['monster', 'cow', 'combat', 'starter', 'cowhide', 'crafting', 'lumbridge'],
        keywords: ['cow', 'cows', 'cowhide', 'raw beef', 'cow field', 'lumbridge cow field', 'leather', 'tanner', 'starter combat'],
        requiredItems: ['bronze weapon recommended (any tier works)'],
        actions: ['attack', 'item_action loot cowhide raw beef bones'],
        successSignals: ['target dies in 4-8 hits', 'inventory gains rs:cowhide + rs:raw_beef + rs:bones', 'combat XP changes'],
        source: 'docs/runescape-skill/monsters.md § Cow; data/config/npcs/cow.json',
        summary:
            'Cow (combat level 2, 8 HP, max hit 1, passive) is the best combo starter target. Spawn cluster: Lumbridge cow field east of the castle around 3253,3275 and Falador cow field. Drops cowhide (tan at Al-Kharid tanner for leather → craft into armour), raw beef (cook for 3 HP heal), and bones. Train Combat 1-10 plus Crafting via leather chain.',
    },
    {
        id: 'monster-goblin-starter',
        title: 'Monster: Goblin (Combat Level 2-5)',
        topics: ['monster', 'goblin', 'combat', 'starter', 'bronze', 'goblin village', 'lumbridge'],
        keywords: ['goblin', 'goblins', 'goblin village', 'bronze dagger', 'bronze spear', 'copper ore', 'aggressive monster'],
        requiredItems: ['bronze or iron weapon', 'food (3+ cooked shrimp for safety)'],
        actions: ['attack', 'item_action loot bronze gear coins bones', 'move_to retreat if HP drops'],
        successSignals: [
            'target dies in 5-10 hits',
            'inventory gains rs:bronze_dagger / rs:bronze_spear / rs:copper_ore / coins / rs:bones',
            'combat XP changes',
        ],
        source: 'docs/runescape-skill/monsters.md § Goblin; data/config/npcs/goblin.json',
        summary:
            'Goblin (combat level 2-5, 5-12 HP, max hit 1-2, AGGRESSIVE to low-level players) is the mid-starter combat target. Spawn cluster: Lumbridge goblin houses (south of castle) and Goblin Village around 2956,3500 north of Falador. Drops bronze gear (dagger/spear), copper ore, coin piles, and bones. Avoid level 5 goblins until your combat is at least 4; carry food.',
    },
    {
        id: 'monster-giant-rat-caution',
        title: 'Monster: Giant Rat (Combat Level 6) — CAUTION',
        topics: ['monster', 'giant-rat', 'combat', 'caution', 'aggressive', 'lumbridge cellar'],
        keywords: ['giant rat', 'giant rats', 'lumbridge cellar', 'sewers', 'aggressive rat', 'mid-tier combat'],
        requiredItems: ['steel weapon recommended', 'food (5+ cooked shrimp or trout)', 'combat level 8+ before engaging'],
        actions: ['attack', 'item_action eat when HP < 50%', 'move_to retreat if HP < 30%'],
        successSignals: [
            'target dies in 6-10 hits',
            'inventory gains rs:bones',
            'combat XP changes',
            'HP never drops below safe threshold',
        ],
        source: 'docs/runescape-skill/monsters.md § Giant Rat; data/config/npcs/giant_rat.json',
        summary:
            'Giant Rat (combat level 6, 7 HP, max hit 1, AGGRESSIVE, hits stack) is a CAUTION-tier combat target. Spawn cluster: Lumbridge cellar lower floor, Varrock sewers, some wilderness fringe lairs. Drops bones only. Engage only at combat level 8 or higher; always carry food and verify a retreat path before entering the spawn area.',
    },
    {
        id: 'place-lumbridge-anchor',
        title: 'Place: Lumbridge (Default Spawn Anchor)',
        topics: ['place', 'lumbridge', 'spawn', 'starter', 'navigation', 'visibility'],
        keywords: ['lumbridge', 'castle', 'kitchen', 'general store', 'bobs axes', 'spawn', 'tutorial', 'church', 'altar', 'home teleport'],
        actions: ['move_to specific coord', 'interact talk-to RuneScape Guide for orientation'],
        successSignals: [
            'position lands inside town square',
            'dashboard position changes',
            'nearby objects show castle / general store / chapel',
        ],
        source: 'docs/runescape-skill/places/lumbridge.md',
        summary:
            "Lumbridge is the default spawn and the safest visibility anchor. Key coords: spawn 3222,3218,0; castle bank top floor 3208,3219,2; castle kitchen 3208,3213,0 (cooking range); general store 3203,3247,0 (tinderbox/pot/jug 1-4 gp); Bob's Brilliant Axes 3231,3203,0; Lumbridge Church 3242,3208,0 (altar restores Prayer); toll gate east 3268,3227,0 (10 gp to Al-Kharid). Use Home Teleport for free return every 5 min.",
    },
    {
        id: 'place-varrock-hub',
        title: 'Place: Varrock (Central Trading Hub)',
        topics: ['place', 'varrock', 'bank', 'shops', 'navigation', 'rune'],
        keywords: [
            'varrock',
            'varrock square',
            'east bank',
            'west bank',
            'aubury',
            'lowes archery',
            'horvik',
            'thessalia',
            'zaff',
            'sawmill',
            'kings palace',
            'reldo',
        ],
        actions: ['move_to specific coord', 'interact trade with shopkeeper'],
        successSignals: ['position lands inside city walls', 'nearby objects show bank booths / shop counters'],
        source: 'docs/runescape-skill/places/varrock.md',
        summary:
            "Varrock is the central trading hub for mid-game progression. Key coords: square 3211,3424,0 (Romeo + market); east bank 3253,3420,0 (closest to Aubury); west bank 3185,3436,0; Aubury's Rune Shop 3253,3401,0 (Air/Water/Earth/Fire/Mind/Body runes + Rune Essence teleport); Lowe's Archery 3233,3424,0; Horvik's Armour 3229,3434,0; Zaff's Staves 3203,3424,0; King Roald 3220,3475,0; Reldo (library) 3211,3492,0. Avoid wilderness ditch north.",
    },
    {
        id: 'place-falador',
        title: 'Place: Falador (Mining + Crafting Hub)',
        topics: ['place', 'falador', 'mining', 'dwarven mine', 'bank', 'navigation'],
        keywords: ['falador', 'dwarven mine', 'mining guild', 'east bank', 'west bank', 'white knights', 'falador park', 'armour shop'],
        actions: ['move_to specific coord', 'interact mine ore at rock'],
        successSignals: ['position lands inside city walls', 'nearby objects show bank booths / mine ladder / shops'],
        source: 'docs/runescape-skill/places/falador.md',
        summary:
            'Falador is the mining hub: Dwarven Mine entrance ladder ~3018,3450,0 (multi-tier ore from copper/tin/iron up to coal/mithril/adamant for higher levels); Mining Guild south entrance ~3017,9740,0 requires 60 Mining. Two banks: east 3013,3355,0 and west 2946,3369,0. Armour shops and White Knight headquarters on the north side. Yew trees just outside the south wall.',
    },
    {
        id: 'place-edgeville',
        title: 'Place: Edgeville (Fast Bank + Prayer Restore)',
        topics: ['place', 'edgeville', 'bank', 'monastery', 'altar', 'prayer', 'fishing', 'wilderness-border'],
        keywords: ['edgeville', 'bank', 'monastery', 'abbot langley', 'altar', 'prayer restore', 'yew', 'fishing', 'border'],
        actions: ['move_to specific coord', 'interact pray at altar'],
        successSignals: ['position lands inside town', 'prayer points restored at altar', 'bank interface opens'],
        source: 'docs/runescape-skill/places/edgeville.md',
        summary:
            'Edgeville is the fastest small-town bank-and-altar pair. Bank 3094,3243,0 (closest bank to Edgeville fishing spot lobster pots and willows). Edgeville Monastery (south of town, ~3056,3484,0) has the Prayer altar that fully restores Prayer points. Yew trees just outside town to the east. Wilderness ditch is ONE TILE NORTH of bank — do not cross unless explicitly told.',
    },
    {
        id: 'place-al-kharid',
        title: 'Place: Al-Kharid (Combat + Tanner + Kebabs)',
        topics: ['place', 'al-kharid', 'tanner', 'warrior', 'combat', 'navigation'],
        keywords: ['al-kharid', 'al kharid', 'tanner', 'warrior', 'kebab', 'karim', 'palace', 'toll gate', 'desert'],
        actions: ['move_to specific coord', 'interact trade tanner with cowhide', 'interact buy kebab'],
        successSignals: ['position lands inside town', 'cowhide becomes leather / soft leather'],
        source: 'docs/runescape-skill/places/al-kharid.md',
        summary:
            "Al-Kharid sits east of Lumbridge across the 10 gp toll gate (3268,3227,0). Key coords: tanner ~3273,3192,0 (tans cowhide to leather 1 gp, soft leather 3 gp); Warrior courtyard ~3290,3179,0 (level 9 warriors — combat training step); Karim's Kebab Shop ~3273,3179,0 (kebab eat to heal ~5 HP); palace north end. Heat damage in the desert south — avoid without waterskins.",
    },
    {
        id: 'place-draynor-village',
        title: 'Place: Draynor Village (Willows + Fishing + Quests)',
        topics: ['place', 'draynor', 'draynor-village', 'willow', 'fishing', 'master-farmer', 'navigation'],
        keywords: [
            'draynor',
            'draynor village',
            'willow',
            'willow tree',
            'fishing spot',
            'master farmer',
            'wise old man',
            'diango',
            'aggie',
            'morgan',
        ],
        actions: ['move_to specific coord', 'interact chop willow', 'interact fish at lure spot'],
        successSignals: ['position lands inside village', 'inventory gains rs:willow_logs or rs:raw_trout'],
        source: 'docs/runescape-skill/places/draynor-village.md',
        summary:
            'Draynor Village is a 5-tile bank-to-willow run: willows ~3088,3236,0 just west of the bank 3094,3243,0. Also has Master Farmer NPC to pickpocket for herb seeds (43 Thieving). Wise Old Man house ~3088,3253,0 for mid-game quest hints. Aggie the witch brews dyes. Draynor Manor north houses Vampire Slayer quest target.',
    },
    {
        id: 'place-wilderness-danger',
        title: 'Place: Wilderness — DANGER (PvP, Item Loss)',
        topics: ['place', 'wilderness', 'pvp', 'danger', 'no-engage', 'avoidance'],
        keywords: ['wilderness', 'wildy', 'pvp', 'pk', 'player killer', 'ditch', 'skull', 'item loss', 'edgeville border'],
        actions: ['NEVER move_to wilderness coords without explicit permission', 'move_to safety southward if accidentally crossed'],
        successSignals: ['position stays SOUTH of the wilderness ditch line', 'no skull icon on player', 'no other player attacks'],
        source: 'docs/runescape-skill/places/wilderness.md',
        summary:
            'The Wilderness is a PvP zone north of Edgeville / Varrock. Crossing the ditch puts you at risk of player-vs-player attack AND lose-on-death of all but 3 items (0 if skulled). DANGER: do not engage past the wilderness ditch unless the maintainer has explicitly told you. If you find yourself in wilderness, run south immediately. PvP combat level brackets restrict who can attack whom but at low levels everyone is fair game.',
    },
    {
        id: 'npc-cook-lumbridge',
        title: 'NPC: Cook (Lumbridge Castle Kitchen)',
        topics: ['npc', 'cook', 'lumbridge', 'quest', 'cooks-assistant', 'cooking'],
        keywords: ['cook', 'lumbridge cook', 'castle kitchen', 'cooks assistant', 'flour', 'egg', 'milk', 'duke birthday cake'],
        actions: ['move_to Lumbridge Castle Kitchen 3208,3213,0', 'interact talk-to Cook'],
        successSignals: ['Cook dialog opens', 'quest log advances on each delivered ingredient', 'quest completes for 300 cooking XP'],
        source: 'docs/runescape-skill/npcs/lumbridge.md § Cook; docs/runescape-skill/quests/cooks-assistant.md',
        summary:
            "The Cook stands inside Lumbridge Castle Kitchen at 3208,3213,0. He is the quest-giver for Cook's Assistant — bring him a pot of flour, an egg, and a bucket of milk for the Duke's birthday cake. Reward: 300 Cooking XP and always-on access to the castle range (higher cooking success). Always approach him with `talk-to`, never `attack`.",
    },
    {
        id: 'npc-father-aereck',
        title: 'NPC: Father Aereck (Lumbridge Church)',
        topics: ['npc', 'father-aereck', 'lumbridge', 'quest', 'restless-ghost', 'prayer'],
        keywords: ['father aereck', 'aereck', 'lumbridge church', 'restless ghost', 'ghost quest', 'haunted graveyard'],
        actions: ['move_to Lumbridge Church 3242,3208,0', 'interact talk-to Father Aereck'],
        successSignals: ['Father Aereck dialog opens', 'quest log starts Restless Ghost', 'altar in same church restores Prayer points'],
        source: 'docs/runescape-skill/npcs/lumbridge.md § Father Aereck; docs/runescape-skill/quests/restless-ghost.md',
        summary:
            'Father Aereck stands inside Lumbridge Church at 3242,3208,0. He is the quest-giver for The Restless Ghost. After talking to him, walk to Father Urhney in the swamp west of Lumbridge (3147,3175,0) for the Ghostspeak Amulet. Reward: 1125 Prayer XP plus permanent Ghostspeak Amulet (lets you talk to all ghosts). The church altar nearby restores Prayer points.',
    },
    {
        id: 'npc-aubury-varrock',
        title: 'NPC: Aubury (Varrock Rune Shop + Rune Essence Teleport)',
        topics: ['npc', 'aubury', 'varrock', 'magic', 'runes', 'runecrafting', 'teleport'],
        keywords: [
            'aubury',
            'rune shop',
            'varrock rune',
            'air rune',
            'water rune',
            'earth rune',
            'fire rune',
            'mind rune',
            'body rune',
            'rune essence',
            'teleport rune essence',
        ],
        actions: ['move_to Varrock Rune Shop 3253,3401,0', 'interact talk-to Aubury for teleport', 'interact trade with Aubury for runes'],
        successSignals: ['rune shop interface opens with elemental + low-level runes', 'teleport completes to Rune Essence mine'],
        source: 'docs/runescape-skill/npcs/varrock.md § Aubury; docs/runescape-skill/skills/magic.md',
        summary:
            'Aubury runs the Varrock Rune Shop at 3253,3401,0 (east-central Varrock). He sells elemental runes (Air, Water, Earth, Fire, Mind, Body) at low per-rune prices. He also teleports the player to the Rune Essence mine after the Rune Mysteries quest — the fastest path to Runecrafting essence supply. Vital NPC for any Magic, Runecrafting, or low-tier combat-spell route.',
    },
    {
        id: 'npc-runescape-guide',
        title: 'NPC: RuneScape Guide (Lumbridge Spawn)',
        topics: ['npc', 'runescape-guide', 'tutorial', 'lumbridge', 'spawn', 'orientation'],
        keywords: ['runescape guide', 'guide', 'tutorial', 'orientation', 'spawn npc', 'how do i play'],
        actions: ['move_to Lumbridge spawn 3222,3218,0', 'interact talk-to RuneScape Guide'],
        successSignals: ['tutorial dialog opens', 'next-step hints appear in dialog box'],
        source: 'docs/runescape-skill/npcs/lumbridge.md § RuneScape Guide',
        summary:
            'The RuneScape Guide stands at the Lumbridge spawn (3222,3218,0). Right-click → `talk-to` for orientation dialog: "Where am I?", "What should I do?", "How do I play?". Useful for new residents who need a basic orientation hook or for residents that lost their way and want anchor-point context. He never attacks and never asks for items.',
    },
    {
        id: 'npc-banker-overview',
        title: 'NPC: Banker (Generic Pattern Across All Banks)',
        topics: ['npc', 'banker', 'bank', 'deposit', 'withdraw', 'storage'],
        keywords: ['banker', 'bank', 'deposit', 'withdraw', 'bank booth', 'bank interface', 'bank vault'],
        actions: [
            'move_to nearest bank coord',
            'interact right-click Banker → Bank',
            'interact right-click Banker → talk-to (alternative)',
        ],
        successSignals: [
            'bank interface opens with full inventory + bank tab',
            'inventory items can be deposited or withdrawn freely',
            'no gp cost',
        ],
        source: 'docs/runescape-skill/npcs/{lumbridge,varrock,draynor-and-wizards-tower}.md § Banker',
        summary:
            'Bankers stand behind bank booths in every major town. Right-click the Banker NPC and choose `Bank` to immediately open the bank interface (bypasses chat). Free service. Key banker coords: Lumbridge Castle top floor 3208,3219,2; Varrock east 3253,3420,0; Varrock west 3185,3436,0; Falador east 3013,3355,0; Falador west 2946,3369,0; Edgeville 3094,3243,0; Draynor 3094,3243,0; Al-Kharid ~3270,3167,0. Use to deposit valuables before risky combat or retrieve stored items.',
    },
    {
        id: 'items-food-overview',
        title: 'Items: Food And Heal Values',
        topics: ['items', 'food', 'heal', 'cooking', 'combat-survival'],
        keywords: [
            'food',
            'heal',
            'hitpoints',
            'hp',
            'shrimp',
            'anchovies',
            'sardine',
            'trout',
            'salmon',
            'tuna',
            'lobster',
            'swordfish',
            'bread',
            'cake',
            'eat',
        ],
        requiredItems: ['cooked food in inventory'],
        actions: ['item_action eat', 'move_to fishing spot then cook on fire/range'],
        successSignals: ['HP increases by food heal value', 'food leaves inventory', 'eat animation plays'],
        source: 'docs/runescape-skill/items.md § Food; docs/runescape-skill/skills/cooking.md',
        summary:
            'Cooked food heals HP. Common heal values: cooked shrimp 3, anchovies 1 (eat several), sardine 4, trout 7, salmon 9, tuna 10, lobster 12, swordfish 14, bread 5, cake 4 per bite (3 bites = 12 HP, 1 slot). NEVER engage combat without at least 3 food in inventory; eat when HP drops below 50%. Burnt items have no heal value — discard.',
    },
    {
        id: 'items-rune-overview',
        title: 'Items: Runes And Magic Costs',
        topics: ['items', 'runes', 'magic', 'rune-shop', 'runecrafting'],
        keywords: [
            'rune',
            'runes',
            'air rune',
            'water rune',
            'earth rune',
            'fire rune',
            'mind rune',
            'chaos rune',
            'death rune',
            'law rune',
            'blood rune',
            'nature rune',
            'cosmic rune',
            'body rune',
        ],
        requiredItems: ['runes matching the target spell recipe'],
        actions: [
            'interact trade with Aubury Varrock for elemental + mind/body',
            'craft runes via Runecrafting at altars',
            'item_action equip staff to save matching elemental rune',
        ],
        successSignals: ['runes appear in inventory (stack 1 slot each)', 'spell casts succeed without "not enough runes" error'],
        source: 'docs/runescape-skill/items.md § Runes; docs/runescape-skill/skills/magic.md; docs/runescape-skill/skills/runecrafting.md',
        summary:
            'Runes are stackable single-slot magic consumables. Categories: elemental (Air, Water, Earth, Fire) at cheapest cost; Mind for Strike tier; Chaos for Bolt; Death for Blast; Blood for Wave; Law for teleports; Nature for alchemy; Cosmic for jewelry enchanting. Aubury Varrock (3253,3401,0) sells elemental + Mind/Body. Self-supply via Runecrafting at altars after the Rune Mysteries quest. Wielding a matching elemental staff (Air Staff, Water Staff, etc.) provides unlimited matching runes free.',
    },
    {
        id: 'items-tool-overview',
        title: 'Items: Starter Tools And Replacement Sources',
        topics: ['items', 'tools', 'general-store', 'starter', 'recovery'],
        keywords: [
            'tool',
            'tools',
            'tinderbox',
            'pot',
            'jug',
            'bucket',
            'bowl',
            'hammer',
            'spade',
            'needle',
            'chisel',
            'shears',
            'knife',
            'lost tool',
            'replacement',
            'general store',
        ],
        requiredItems: ['coins for purchase (1-6 gp per starter tool)'],
        actions: ['move_to Lumbridge General Store 3203,3247,0', 'interact trade with Shopkeeper or Shop Assistant'],
        successSignals: ['shop interface opens', 'inventory gains requested tool', 'coin count drops by listed price'],
        source: 'docs/runescape-skill/items.md § Starter Tools; data/config/shops/lumbridge-general-store.json',
        summary:
            "The Lumbridge General Store (3203,3247,0) is the canonical recovery anchor for lost tools. Prices: tinderbox 1 gp, pot 1 gp, jug 1 gp, shears 1 gp, hammer 1 gp, bucket 2 gp, spade 3 gp, bowl 4 gp, needle (crafting shops) 1 gp, chisel (crafting shops) 1 gp, knife 6 gp. Always restocks. For hatchets see Bob's Brilliant Axes (3231,3203,0). For fishing nets see fishing shops or Wydin Port Sarim.",
    },
    {
        id: 'items-armor-tier-overview',
        title: 'Items: Armor Tiers (Bronze → Rune)',
        topics: ['items', 'armor', 'armour', 'defence', 'tier', 'progression'],
        keywords: [
            'armor',
            'armour',
            'helmet',
            'helm',
            'chainbody',
            'platebody',
            'platelegs',
            'kiteshield',
            'square shield',
            'bronze',
            'iron',
            'steel',
            'mithril',
            'adamant',
            'rune',
            'defence level',
        ],
        requiredItems: ['matching Defence level (Steel 5, Mithril 20, Adamant 30, Rune 40)', 'coins or smithing/drop source for the gear'],
        actions: ['interact trade with Horvik Varrock 3229,3434,0', 'item_action equip from inventory'],
        successSignals: ['armor appears in equip slot', 'defence bonus reflected in equipment screen'],
        source: 'docs/runescape-skill/items.md § Armour By Tier; docs/runescape-skill/skills/smithing.md',
        summary:
            "Armor tiers: bronze (level 1) → iron (1) → steel (5 Defence) → mithril (20) → adamant (30) → rune (40). Pieces per tier: full helm, chainbody (lighter), platebody (heavier, no female restriction in 2006), platelegs, kiteshield, square shield. Horvik's Armour Shop in Varrock (3229,3434,0) sells bronze through steel. Higher tiers come from smithing your own bars or buying from other players.",
    },
    {
        id: 'items-weapon-tier-overview',
        title: 'Items: Weapon Tiers + Scimitar Recommendation',
        topics: ['items', 'weapons', 'scimitar', 'attack', 'tier', 'progression'],
        keywords: [
            'weapon',
            'sword',
            'scimitar',
            'dagger',
            'longsword',
            'mace',
            'battleaxe',
            'spear',
            'halberd',
            'bronze',
            'iron',
            'steel',
            'mithril',
            'adamant',
            'rune',
            'attack level',
        ],
        requiredItems: ['matching Attack level (Steel 5, Mithril 20, Adamant 30, Rune 40)'],
        actions: ['interact trade with Varrock Sword Shop or smith from bar', 'item_action equip weapon'],
        successSignals: [
            'weapon appears in equip slot',
            'attack bonus reflected in equipment screen',
            'attack speed visible during combat',
        ],
        source: 'docs/runescape-skill/items.md § Weapons By Tier; docs/runescape-skill/skills/combat.md',
        summary:
            'Weapon tiers: bronze (Attack level 1) → iron (1) → steel (5 Attack) → mithril (20) → adamant (30) → rune (40). **Scimitar is the recommended melee weapon at every tier** — fast attack speed (4-tick) beats slashing alternatives (sword 5-tick, longsword 6-tick, battleaxe 7-tick) for DPS at all training levels. Iron scimitar at Varrock Sword Shop for ~50 gp is a cheap level-1-to-5 upgrade.',
    },
    {
        id: 'workflow-woodcutting-firemaking-chain',
        title: 'Workflow: Woodcutting → Firemaking Chain',
        topics: ['workflow', 'chain', 'woodcutting', 'firemaking', 'fire', 'starter'],
        keywords: ['chop logs and light fire', 'make fire from tree', 'chop then light', 'log chain', 'firemaking chain', 'tree to fire'],
        requiredItems: ['hatchet/axe in inventory or equipped', 'tinderbox in inventory'],
        actions: [
            'move_to nearby Tree or Dead tree',
            'interact option "chop down" or "chop"',
            'item_action use_item_on_item (tinderbox on logs)',
            'repeat: chop next log → light next fire (inventory of 28 logs = 28 fires)',
        ],
        successSignals: [
            'inventory gains rs:logs after each successful chop (woodcutting XP)',
            'fire object appears nearby after tinderbox use (firemaking XP)',
            'logs leave inventory as each fire is lit',
        ],
        source: 'docs/runescape-skill/starter-workflows.md § Make A Fire; docs/runescape-skill/skills/firemaking.md; docs/runescape-skill/skills/woodcutting.md',
        summary:
            'End-to-end chain: (1) move next to a Tree or Dead tree, (2) interact `chop down` to fill inventory with rs:logs, (3) use_item_on_item with tinderbox on a log to light a fire (rs:logs leaves inventory, fire object appears), (4) chain — light all logs in one spot for batched Firemaking XP. Stop when inventory empties or HP / energy drops too low. Burns BOTH skills in one loop; ideal level 1-15 starter goal.',
    },
    {
        id: 'workflow-fishing-cooking-chain',
        title: 'Workflow: Fishing → Cooking Chain',
        topics: ['workflow', 'chain', 'fishing', 'cooking', 'food', 'starter'],
        keywords: ['catch and cook', 'fish then cook', 'shrimp chain', 'food chain', 'raw to cooked', 'fishing cooking loop'],
        requiredItems: [
            'rs:small_fishing_net (or rs:fishing_rod + bait)',
            'nearby fire OR cooking range (Lumbridge Castle kitchen 3208,3213,0)',
        ],
        actions: [
            'move_to a net-capable fishing spot (Lumbridge swamp 3242,3151 or Draynor)',
            'interact "net" or "lure" on fishing spot',
            'move_to nearby fire or Lumbridge kitchen range',
            'item_action use raw shrimp on fire/range (cook)',
            'repeat: fish → cook → eat or bank',
        ],
        successSignals: [
            'inventory gains rs:raw_shrimps (fishing XP)',
            'raw item becomes cooked equivalent (cooking XP)',
            'inventory has edible food ready for combat',
        ],
        source: 'docs/runescape-skill/starter-workflows.md § Catch Shrimp + Make A Fire; docs/runescape-skill/skills/fishing.md; docs/runescape-skill/skills/cooking.md',
        summary:
            'End-to-end chain: (1) walk to a net fishing spot with small fishing net equipped, (2) interact `net` to catch raw shrimp (or anchovies), (3) walk to a fire (your own from woodcutting chain) or Lumbridge Castle Kitchen 3208,3213,0, (4) use raw food on fire/range to cook. Burnt items have no heal value; discard. This chain produces combat food — always keep 3+ cooked food before any fight.',
    },
    {
        id: 'workflow-combat-prayer-chain',
        title: 'Workflow: Combat → Loot → Prayer Chain',
        topics: ['workflow', 'chain', 'combat', 'prayer', 'bones', 'loot', 'starter'],
        keywords: ['kill loot bury', 'combat prayer chain', 'fight then bury', 'bones prayer xp', 'cow chicken goblin prayer'],
        requiredItems: ['weapon (bronze scimitar minimum)', 'food (3+ cooked items)', 'inventory space for bones'],
        actions: [
            'move_to safe monster (chicken/cow/goblin per monster-*-starter entries)',
            'interact attack target',
            'item_action eat food when HP drops below 50%',
            'item_action loot bones after kill (inventory gains rs:bones)',
            'item_action bury (Prayer XP per bone)',
            'repeat: next target → kill → loot → bury',
        ],
        successSignals: [
            'combat XP changes after each hit (Attack/Strength/Defence/Hitpoints)',
            'inventory gains rs:bones from each kill',
            'Prayer XP changes after each bury',
            'HP never drops below safe threshold (food eaten in time)',
        ],
        source: 'docs/runescape-skill/starter-workflows.md § Combat + Bury Bones; docs/runescape-skill/skills/combat.md; docs/runescape-skill/skills/prayer.md',
        summary:
            'End-to-end chain: (1) approach safe monster (chicken 3HP / cow 8HP / goblin 5-12HP), (2) attack and let auto-retaliate fight, (3) eat food if HP drops below 50%, (4) loot bones after kill, (5) bury bones for Prayer XP. Loops cleanly: 28 inventory slots can hold ~25 bones + 3 food. Burying converts each bone to 4.5 Prayer XP. Combine with combat-safe-basic + prayer-basic entries for full training context.',
    },
    {
        id: 'survival-eat-when-hurt',
        title: 'Survival: Eat When Hurt (HP Threshold Rules)',
        topics: ['survival', 'combat-survival', 'food', 'eat', 'hp', 'reflex'],
        keywords: ['eat', 'hurt', 'low hp', 'low hitpoints', 'health dropping', 'eat food', 'heal up', 'hp threshold'],
        requiredItems: ['cooked food in inventory (3+ before any combat)'],
        actions: [
            'item_action eat (highest-heal food in inventory first)',
            'continue fight if HP >60% after eat',
            'transition to flee if HP <20% after eat',
        ],
        successSignals: [
            'HP increases by food heal value (shrimp 3, trout 7, lobster 12, swordfish 14)',
            'food slot empties',
            'eat animation plays',
            'eating does NOT interrupt auto-retaliate',
        ],
        source: 'docs/runescape-skill/skills/combat.md § Eat And Heal; docs/runescape-skill/items.md § Food',
        summary:
            'HP threshold rules: HP > 60% → keep fighting. HP 30-60% → finish current swing then eat. HP < 30% → eat immediately mid-swing. HP < 20% → eat AND prepare to flee (see survival-flee-when-outmatched). Always eat the highest-heal food in inventory first (swordfish 14 > lobster 12 > tuna 10 > salmon 9 > trout 7 > sardine 4 > shrimp 3). Eating takes 1 tick and does NOT interrupt auto-retaliate. NEVER engage combat without 3+ cooked food.',
    },
    {
        id: 'survival-flee-when-outmatched',
        title: 'Survival: Flee When Outmatched (Retreat Protocol)',
        topics: ['survival', 'flee', 'retreat', 'combat-survival', 'safety', 'narration'],
        keywords: [
            'flee',
            'retreat',
            'run',
            'escape',
            'unsafe',
            'outmatched',
            'too strong',
            'aggressor',
            'safespot',
            'lumbridge bank',
            'embassy',
        ],
        actions: [
            'move_to nearest safe POI (Lumbridge bank 3208,3219,2 / embassy atrium / Edgeville bank)',
            'toggle run mode if energy >30%',
            'say "Retreating — too strong / out of food / low HP" publicly',
            'item_action eat last food during retreat if needed',
        ],
        successSignals: [
            'position moves away from aggressor',
            'combat ends (no more attack animations)',
            'safe POI reached',
            'memory entry logged so Brain does not re-engage immediately',
        ],
        source: 'docs/runescape-skill/skills/combat.md § Run When Outmatched; src/controller/spark/runescape-nervous-rules.ts',
        summary:
            'Trigger conditions: HP < 20%, no food left, OR unexpected aggressor of much higher level (combat level > 2× yours). Action: click far away toward a known safe POI (Lumbridge bank, Edgeville bank, embassy atrium, faction home). Run mode if energy > 30%. Narrate publicly during retreat ("Retreating — too strong" or "Retreating — out of food") so Brain logs the encounter and does not re-engage. Combat survival reflex landed in commit 2bedd776 (Q3-F5 personality).',
    },
    {
        id: 'death-and-recovery',
        title: 'Death And Recovery (Respawn + Reclaim Path)',
        topics: ['death', 'respawn', 'recovery', 'reclaim', 'starter'],
        keywords: ['death', 'died', 'respawn', 'lost items', 'recover', 'reclaim', 'gravestone', 'lumbridge spawn'],
        actions: [
            'move_to Lumbridge spawn 3222,3218,0 (automatic on death)',
            'interact talk-to RuneScape Guide for orientation if disoriented',
            'move_to Bobs Brilliant Axes 3231,3203,0 to replace hatchet',
            'move_to Lumbridge General Store 3203,3247,0 to replace tinderbox/pot/jug/hammer',
            'interact bank if items were deposited before risky activity',
        ],
        successSignals: [
            'respawn animation completes at Lumbridge spawn',
            'inventory shows 3 retained items + nothing else',
            'shops restock visible to player',
            'resumed goal evidence in trajectory.jsonl',
        ],
        source: 'docs/runescape-skill/items.md § Recovery Heuristics; docs/runescape-skill/places/lumbridge.md',
        summary:
            'On non-wilderness death: respawn at Lumbridge spawn 3222,3218,0; keep 3 most valuable items, lose all others (gravestone mechanics may apply in some configurations). On wilderness death with skull: lose ALL items. Reclaim path: (1) bank check at Lumbridge Castle bank 3208,3219,2 for stored items, (2) Bobs Brilliant Axes 3231,3203,0 for hatchet replacement (~16gp bronze), (3) Lumbridge General Store 3203,3247,0 for tinderbox/pot/jug/bucket/hammer (1-4gp each), (4) resume original goal once tools restored.',
    },
    {
        id: 'communication-public-chat-rules',
        title: 'Communication: Public Chat Rules (When To Speak)',
        topics: ['communication', 'social', 'public-chat', 'narration', 'silence'],
        keywords: ['public chat', 'speak', 'say', 'chat', 'narrate', 'announce', 'when to speak', 'silence', 'spam'],
        actions: ['say (only when one of the four conditions below is true)', 'remain silent otherwise'],
        successSignals: [
            'chat history contains only relevant messages',
            'no spam / no low-content "hi" / no redundant narration',
            'players can follow what the resident is doing from chat alone',
        ],
        source: 'docs/runescape-skill/skills/combat.md § When To Ask For Help; src/controller/spark/runescape-nervous-rules.ts (presence beacon)',
        summary:
            'Speak publicly in exactly four conditions: (1) status query from a player ("what are you doing?") — answer with goal + next action + nearest landmark; (2) blocker encountered (no food / gate locked / stuck) — report so a helper can intervene; (3) major completion (quest done / level milestone) — share the achievement; (4) help needed (use the help-request-pattern entry). Otherwise stay silent. Never say "hi"/"hello"/redundant narration of every action; that is spam and crowds out signal.',
    },
    {
        id: 'communication-help-request-pattern',
        title: 'Communication: Help Request Pattern (Actionable Phrasing)',
        topics: ['communication', 'help', 'request', 'trade', 'phrasing'],
        keywords: ['help request', 'ask for help', 'phrasing', 'specific', 'actionable', 'sell', 'trade help', 'need item'],
        actions: [
            'say "Need <count> <item> — anyone selling for <gp>?"',
            'wait 2-3 ticks for response',
            'if no response after 10 ticks, retry with simpler phrasing',
        ],
        successSignals: [
            'another player responds with trade offer',
            'trade interface opens after agreement',
            'help request completes (item received)',
        ],
        source: 'docs/runescape-skill/skills/combat.md § When To Ask For Help; docs/runescape-skill/skills/trading.md',
        summary:
            'A good help request is actionable, specific, and includes payment willingness. Pattern: "Need <count> <item> — anyone selling for <gp>?" Examples: "Need 10 cooked shrimp — anyone selling for 50gp each?" / "Need a bronze hatchet — anyone have a spare?" / "Lost in Falador — can someone show me to the bank?". Do NOT say vague things like "Im hungry" or "I need food" — those force the helper to guess what you want. Always pair help requests with willingness-to-pay or a clear blocker.',
    },
    {
        id: 'communication-respond-to-mention',
        title: 'Communication: Respond To Mention (Acknowledge Quickly)',
        topics: ['communication', 'mention', 'respond', 'social', 'codex', 'visibility'],
        keywords: ['mention', 'mentioned', 'addressed', 'name', 'respond', 'acknowledge', 'codex', 'player talked'],
        actions: [
            'detect player name in incoming chat events',
            'say acknowledgment within 2 ticks',
            'answer the specific question OR say "checking" + return with answer within 5 ticks',
        ],
        successSignals: [
            'chat shows your acknowledgment after the mention',
            'no >5 tick delay between mention and response',
            'player sees that you noticed them',
        ],
        source: 'docs/runescape-skill/skills/combat.md § When To Ask For Help; src/controller/thinking/hybrid-agent-thinking-module.ts (mention detection)',
        summary:
            'When a player addresses you by name (e.g., "res:agent, what are you doing?"), acknowledge within 2 ticks. Pattern: answer the specific question if you can, OR say "checking — one moment" + provide the answer within 5 ticks. Silence after a direct mention reads as ignoring; that breaks the social contract with patrons + observers. If you cannot answer (broken goal, unknown player), say so explicitly rather than going silent.',
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

function cleanId(val: string): string {
    return val
        .toLowerCase()
        .replace(/^(rs:|npc:|player:)/, '')
        .trim();
}

function matchesValue(key: string, val: string): boolean {
    const ck = cleanId(key);
    const cv = cleanId(val);
    if (!ck || !cv) {
        return false;
    }
    return ck === cv || cv.includes(ck) || ck.includes(cv);
}

function matchesAny(key: string, vals: string[] | undefined): boolean {
    if (!vals) {
        return false;
    }
    return vals.some(val => matchesValue(key, val));
}

function checkPerceptionMatch(entry: KnowledgeEntry, context: PerceptionContext): boolean {
    const keysToCheck: string[] = [];
    if (context.nearbyNpcKeys) {
        keysToCheck.push(...context.nearbyNpcKeys);
    }
    if (context.nearbyObjectKeys) {
        keysToCheck.push(...context.nearbyObjectKeys);
    }
    if (context.currentRegion) {
        keysToCheck.push(context.currentRegion);
    }
    if (context.recentActionKinds) {
        keysToCheck.push(...context.recentActionKinds);
    }

    for (const key of keysToCheck) {
        if (matchesValue(key, entry.id)) {
            return true;
        }
        if (matchesAny(key, entry.topics)) {
            return true;
        }
        if (matchesAny(key, entry.keywords)) {
            return true;
        }
        if (matchesAny(key, entry.requiredItems)) {
            return true;
        }
        if (matchesAny(key, entry.actions)) {
            return true;
        }
    }
    return false;
}

function checkGoalMatch(entry: KnowledgeEntry, context: GoalContext): boolean {
    const keysToCheck: string[] = [];
    if (context.targetSkill) {
        keysToCheck.push(context.targetSkill);
    }
    if (context.targetItem) {
        keysToCheck.push(context.targetItem);
    }
    if (context.targetPlace) {
        keysToCheck.push(context.targetPlace);
    }
    if (context.targetQuest) {
        keysToCheck.push(context.targetQuest);
    }

    for (const key of keysToCheck) {
        if (matchesValue(key, entry.id)) {
            return true;
        }
        if (matchesAny(key, entry.topics)) {
            return true;
        }
        if (matchesAny(key, entry.keywords)) {
            return true;
        }
    }
    return false;
}

export function retrieveKnowledge(entries: KnowledgeEntry[], query: string, options: RetrieveKnowledgeOptions = {}): KnowledgeResult[] {
    const limit = options.limit ?? 4;
    const minScore = options.minScore ?? 1;
    const terms = tokenize(query);
    if (!terms.length) {
        return [];
    }

    let scoredResults = entries.map(entry => {
        const result = scoreEntry(entry, terms);
        let score = result.score;
        if (options.perceptionContext && checkPerceptionMatch(entry, options.perceptionContext)) {
            score *= 1.5;
        }
        if (options.goalContext && checkGoalMatch(entry, options.goalContext)) {
            score *= 3.0;
        }
        return {
            ...result,
            score,
        };
    });

    scoredResults = scoredResults
        .filter(result => result.score >= minScore)
        .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));

    if (options.tokenBudget !== undefined) {
        const sortedEntries = scoredResults.map(r => r.entry);
        const budgetedEntries = enforceKnowledgeBudget(sortedEntries, options.tokenBudget);
        const budgetedSet = new Set(budgetedEntries.map(e => e.id));
        const filteredResults = scoredResults.filter(r => budgetedSet.has(r.entry.id));
        const limitedResults = filteredResults.slice(0, limit);
        const finalResults = limitedResults as any;
        finalResults.budgetTrimmed = budgetedEntries.budgetTrimmed;
        finalResults.budgetOvershot = budgetedEntries.budgetOvershot;
        return finalResults;
    }

    const limitedResults = scoredResults.slice(0, limit);
    const finalResults = limitedResults as any;
    finalResults.budgetTrimmed = false;
    finalResults.budgetOvershot = false;
    return finalResults;
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
