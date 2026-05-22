export interface PerceptionContext {
    nearbyNpcKeys: string[];
    nearbyObjectKeys: string[];
    currentRegion?: string;
    recentActionKinds: string[];
}

export interface GoalContext {
    targetSkill?: string;
    targetItem?: string;
    targetPlace?: string;
    targetQuest?: string;
}

export function derivePerceptionContext(perception: any): PerceptionContext {
    const nearbyNpcKeys: string[] = [];
    const nearbyObjectKeys: string[] = [];
    let currentRegion: string | undefined = undefined;
    const recentActionKinds: string[] = [];

    if (!perception) {
        return { nearbyNpcKeys, nearbyObjectKeys, currentRegion, recentActionKinds };
    }

    // Helper to safely extract from compressed text
    const compressedText =
        typeof perception.compressed === 'string' ? perception.compressed : typeof perception === 'string' ? perception : '';

    if (compressedText) {
        const lowerText = compressedText.toLowerCase();

        // NPCs
        if (lowerText.includes('chicken')) nearbyNpcKeys.push('rs:chicken');
        if (lowerText.includes('cow')) nearbyNpcKeys.push('rs:cow');
        if (lowerText.includes('goblin')) nearbyNpcKeys.push('rs:goblin');
        if (lowerText.includes('rat') || lowerText.includes('giant rat')) nearbyNpcKeys.push('rs:giant-rat');
        if (lowerText.includes('fishing spot')) nearbyNpcKeys.push('fishing-spot');
        if (lowerText.includes('codex')) nearbyNpcKeys.push('player:codex');

        // Objects
        if (lowerText.includes('tree') || lowerText.includes('chop down')) nearbyObjectKeys.push('tree');
        if (lowerText.includes('fire') || lowerText.includes('campfire')) nearbyObjectKeys.push('fire');

        // Regions
        if (lowerText.includes('lumbridge')) currentRegion = 'lumbridge';
        else if (lowerText.includes('varrock')) currentRegion = 'varrock';
        else if (lowerText.includes('falador')) currentRegion = 'falador';
        else if (lowerText.includes('edgeville')) currentRegion = 'edgeville';
        else if (lowerText.includes('al-kharid')) currentRegion = 'al-kharid';
        else if (lowerText.includes('draynor')) currentRegion = 'draynor-village';
        else if (lowerText.includes('wilderness')) currentRegion = 'wilderness-edge';
    }

    // Structured perception parsing
    if (typeof perception === 'object' && perception !== null) {
        const root = perception;

        const nearby = root.nearby && typeof root.nearby === 'object' ? root.nearby : {};

        // NPC parsing
        if (Array.isArray(nearby.npcs)) {
            for (const npc of nearby.npcs) {
                if (npc && typeof npc === 'object') {
                    if (npc.key) {
                        nearbyNpcKeys.push(String(npc.key));
                    } else if (npc.name) {
                        nearbyNpcKeys.push(String(npc.name).toLowerCase());
                    }
                }
            }
        }

        // Object parsing
        if (Array.isArray(nearby.objects)) {
            for (const obj of nearby.objects) {
                if (obj && typeof obj === 'object') {
                    if (obj.key) {
                        nearbyObjectKeys.push(String(obj.key));
                    }
                    if (obj.objectId !== undefined) {
                        nearbyObjectKeys.push(String(obj.objectId));
                    }
                    if (obj.name) {
                        nearbyObjectKeys.push(String(obj.name).toLowerCase());
                    }
                }
            }
        }

        // Region parsing
        if (root.tile && typeof root.tile === 'object' && typeof root.tile.region === 'string') {
            currentRegion = root.tile.region;
        } else if (root.resident && typeof root.resident === 'object') {
            const res = root.resident;
            if (res.position && typeof res.position === 'object' && typeof res.position.region === 'string') {
                currentRegion = res.position.region;
            }
        }

        // Recent Actions (last 3 action kinds)
        if (Array.isArray(root.recentActions)) {
            const recent = root.recentActions.slice(-3);
            for (const act of recent) {
                if (act && typeof act === 'object' && typeof act.kind === 'string') {
                    recentActionKinds.push(act.kind);
                } else if (typeof act === 'string') {
                    recentActionKinds.push(act);
                }
            }
        }
    }

    return {
        nearbyNpcKeys: Array.from(new Set(nearbyNpcKeys)),
        nearbyObjectKeys: Array.from(new Set(nearbyObjectKeys)),
        currentRegion,
        recentActionKinds: Array.from(new Set(recentActionKinds)),
    };
}

export function deriveGoalContext(goal: any): GoalContext {
    if (!goal) {
        return {};
    }

    let targetSkill: string | undefined = undefined;
    let targetItem: string | undefined = undefined;
    let targetPlace: string | undefined = undefined;
    let targetQuest: string | undefined = undefined;

    const goalId = typeof goal.id === 'string' ? goal.id : '';
    const description = typeof goal.description === 'string' ? goal.description : '';
    const steps = Array.isArray(goal.steps) ? goal.steps.join(' ') : '';

    const textToSearch = `${goalId} ${description} ${steps}`.toLowerCase();

    // 23 RS Skills
    const skills = [
        'attack',
        'strength',
        'defence',
        'hitpoints',
        'ranged',
        'prayer',
        'magic',
        'cooking',
        'woodcutting',
        'fletching',
        'fishing',
        'firemaking',
        'crafting',
        'smithing',
        'mining',
        'herblore',
        'agility',
        'thieving',
        'slayer',
        'farming',
        'runecrafting',
        'construction',
        'hunter',
    ];
    for (const skill of skills) {
        if (textToSearch.includes(skill)) {
            targetSkill = skill;
            break;
        }
    }

    // Fallback implicit mappings to skills
    if (!targetSkill) {
        if (textToSearch.includes('cook') || textToSearch.includes('shrimp')) targetSkill = 'cooking';
        else if (textToSearch.includes('chop') || textToSearch.includes('tree') || textToSearch.includes('logs'))
            targetSkill = 'woodcutting';
        else if (textToSearch.includes('fish') || textToSearch.includes('net')) targetSkill = 'fishing';
        else if (textToSearch.includes('burn') || textToSearch.includes('tinderbox') || textToSearch.includes('fire'))
            targetSkill = 'firemaking';
        else if (textToSearch.includes('mine') || textToSearch.includes('ore') || textToSearch.includes('rock')) targetSkill = 'mining';
        else if (textToSearch.includes('bury') || textToSearch.includes('bones')) targetSkill = 'prayer';
        else if (textToSearch.includes('fight') || textToSearch.includes('attack') || textToSearch.includes('combat'))
            targetSkill = 'hitpoints';
    }

    // Items
    const itemMatches = textToSearch.match(/rs:[a-z0-9_-]+/g);
    if (itemMatches && itemMatches.length > 0) {
        targetItem = itemMatches[0];
    } else {
        const items = ['tinderbox', 'logs', 'shrimp', 'net', 'pickaxe', 'axe', 'bones', 'ore'];
        for (const item of items) {
            if (textToSearch.includes(item)) {
                targetItem = `rs:${item}`;
                break;
            }
        }
    }

    // Places
    const places = ['lumbridge', 'varrock', 'falador', 'edgeville', 'al-kharid', 'draynor'];
    for (const place of places) {
        if (textToSearch.includes(place)) {
            targetPlace = place;
            break;
        }
    }

    // Quests
    const quests = ['cooks-assistant', 'restless-ghost', 'sheep-shearer', 'witchs-potion', 'romeo-and-juliet', 'rune-mysteries'];
    for (const quest of quests) {
        if (textToSearch.includes(quest.replace('-', ' ')) || textToSearch.includes(quest)) {
            targetQuest = quest;
            break;
        }
    }

    return { targetSkill, targetItem, targetPlace, targetQuest };
}
