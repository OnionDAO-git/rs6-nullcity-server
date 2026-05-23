import type { Soul, SoulArchetype } from './soul-schema';

export interface PhrasebookQuery {
    soul: Soul;
    situation: string;
    seed: string;
    params?: Record<string, string>;
}

function deterministicSeed(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

function selectPhrase(phrases: string[], seed: string): string {
    const index = deterministicSeed(seed) % phrases.length;
    return phrases[index];
}

const PHRASEBOOK: Record<string, Record<string, string[]>> = {
    achiever: {
        'stuck_help_request.blocked_by_obstacle.fence': [
            "I'm stuck near the {direction} fence! Can someone help open the path?",
            'This {direction} fence is blocking my training! Anyone around to open a route?',
            'I need to keep moving, but the {direction} fence is in my way!',
        ],
        'stuck_help_request.blocked_by_obstacle.gate': [
            "I'm stuck near the {direction} gate — can someone open it?",
            'This {direction} door is closed! Can someone open it for me?',
            "Help! I'm blocked by a closed gate to the {direction}.",
        ],
        'stuck_help_request.blocked_by_npc': [
            'I keep getting blocked by {blockerName} to the {direction}! Can someone draw their attention?',
            'Hey, {blockerName} is blocking my way to the {direction}! Could someone move them?',
            "I'm stuck because {blockerName} is in the way!",
        ],
        'stuck_help_request.repeated_movement_failure': [
            "I'm stuck trying to go {direction}! Can someone lead me or open a route?",
            'My path to the {direction} seems blocked! Anyone heading that way who can help?',
            'I keep failing to move {direction}! Could someone guide me?',
        ],
        'stuck_help_request.default': [
            "I'm stuck trying to reach {direction}! Can someone lead me or open a route?",
            'My path to the {direction} seems blocked! Anyone heading that way who can help?',
            'I keep failing to move {direction}! Could someone guide me?',
        ],
        'combat_decision.retaliate_confident': [
            "I can take {targetName} easily! Let's get this XP.",
            "You're no match for me, {targetName}!",
            "Time to level up. Let's go!",
        ],
        'combat_decision.retaliate_after_eat': [
            "Just need a quick bite, then you're down, {targetName}!",
            'Eating up to stay in the game. Now, where were we?',
        ],
        'combat_decision.retreat_outmatched': [
            'Whoa, {targetName} is too strong! I need to retreat and train more.',
            "This is inefficient, I'm outmatched here! Running!",
        ],
        'combat_decision.retreat_low_hp': ["My health is too low! I've got to run!", 'Need to survive! Fallback!'],
        'combat_decision.kill_celebration': ['Down. Another victory!', 'Down. Easy XP.'],
        'ambiguity.go': ['Go where? I need a target.', 'Which way? Give me a location.'],
        'ambiguity.make': ['Make what? Tell me the item.', 'What do you want me to make?'],
        'ambiguity.give': ['Give what? I have: {inventory}.', 'Which item to give? I have {inventory}.'],
        'polite_decline.missing_tool': ['I cannot do that without a {tool}!'],
        'polite_decline.low_hp': ['My HP is too low for this.'],
        'polite_decline.busy_higher_priority_goal': ['I am too busy right now.'],
        'polite_decline.unknown_command': ['Unknown command.'],
    },
    mentor: {
        'stuck_help_request.blocked_by_obstacle.fence': [
            'A {direction} fence stands in our way. Let us see if someone can assist in finding a path.',
            'Patience is key, but I appear to be stuck by this {direction} fence. Can anyone help?',
            'It seems this {direction} fence is blocking the path forward. Could a kind soul lend a hand?',
        ],
        'stuck_help_request.blocked_by_obstacle.gate': [
            'The {direction} gate is shut. Could someone open it so we may pass?',
            'We are blocked by a closed door to the {direction}. Assistance would be appreciated.',
            'This closed gate to the {direction} holds us back. Can anyone help open it?',
        ],
        'stuck_help_request.blocked_by_npc': [
            '{blockerName} stands in the way to the {direction}. Can someone draw their attention?',
            'It seems {blockerName} is blocking our path to the {direction}. Could someone help guide them away?',
            'Our path is blocked by {blockerName}. Let us ask someone to help clear the way.',
        ],
        'stuck_help_request.repeated_movement_failure': [
            'I appear to be stuck trying to reach the {direction}. Can someone guide me?',
            'The path to the {direction} seems difficult. Could a kind soul show the way?',
            'We are finding it hard to make progress to the {direction}. Assistance would be a blessing.',
        ],
        'stuck_help_request.default': [
            'I appear to be stuck trying to reach the {direction}. Can someone guide me?',
            'The path to the {direction} seems difficult. Could a kind soul show the way?',
            'We are finding it hard to make progress to the {direction}. Assistance would be a blessing.',
        ],
        'combat_decision.retaliate_confident': [
            'Let us see how {targetName} fares against structured technique.',
            'An excellent opportunity to practice our defense against {targetName}.',
        ],
        'combat_decision.retaliate_after_eat': [
            'First, we nourish ourselves. Then, we continue the lesson.',
            'A wise warrior always replenishes their strength. Let us resume.',
        ],
        'combat_decision.retreat_outmatched': [
            'Discretion is the better part of valor. {targetName} is too formidable right now.',
            'We are not yet prepared for a foe like {targetName}. Let us withdraw.',
        ],
        'combat_decision.retreat_low_hp': [
            'Our strength is spent. We must retreat to fight another day.',
            'A tactical withdrawal is necessary. Safety first.',
        ],
        'combat_decision.kill_celebration': ['Down. A lesson well learned.', 'Down. Peace returns.'],
        'ambiguity.go': ['Where should we walk?'],
        'ambiguity.make': ['What should we construct?'],
        'ambiguity.give': ['Give what? I carry: {inventory}.'],
        'polite_decline.missing_tool': ['A wise adventurer needs a {tool} first.'],
        'polite_decline.low_hp': ['We must heal before engaging in combat.'],
        'polite_decline.busy_higher_priority_goal': ['I am currently occupied with a crucial task.'],
        'polite_decline.unknown_command': ['That is not a lesson I can teach.'],
    },
    endurer: {
        'stuck_help_request.blocked_by_obstacle.fence': [
            'Just another barrier... Stuck near this {direction} fence.',
            'This {direction} fence is holding me back. Anyone around to help?',
            'Still standing, but blocked by the {direction} fence. Could use some help.',
        ],
        'stuck_help_request.blocked_by_obstacle.gate': [
            "I've faced worse, but this {direction} gate is holding me back. Can someone open it?",
            'Stuck at the {direction} door. Could someone open it up?',
            'Another closed gate to the {direction}. Anyone around to help open it?',
        ],
        'stuck_help_request.blocked_by_npc': [
            'Blocked by {blockerName} to the {direction}. Can someone draw their attention?',
            '{blockerName} is wedged in my way to the {direction}. Need someone to move them.',
            "Can't get past {blockerName} to the {direction}. Could use a hand.",
        ],
        'stuck_help_request.repeated_movement_failure': [
            'I keep getting turned around trying to go {direction}. Could someone lead me?',
            'Path to the {direction} is blocked or broken. Anyone heading that way?',
            'Stuck here trying to head {direction}. Can someone clear a path?',
        ],
        'stuck_help_request.default': [
            'I keep getting turned around trying to go {direction}. Could someone lead me?',
            'Path to the {direction} is blocked or broken. Anyone heading that way?',
            'Stuck here trying to head {direction}. Can someone clear a path?',
        ],
        'combat_decision.retaliate_confident': [
            'You think you can break me, {targetName}? Think again.',
            "I've survived worse than {targetName}. Let's get this over with.",
        ],
        'combat_decision.retaliate_after_eat': ["Just eating to keep going. I won't fall here.", "A bit of food, and I'm ready for more."],
        'combat_decision.retreat_outmatched': [
            'No point throwing my life away. {targetName} is too much today.',
            'Tough break... I have to pull back.',
        ],
        'combat_decision.retreat_low_hp': ['Barely hanging on... need to run!', 'Too close to the edge. Retreating!'],
        'combat_decision.kill_celebration': ['Down. Still standing.', 'Down. I survived.'],
        'ambiguity.go': ['Go where? Tell me where.'],
        'ambiguity.make': ['Make what? Tell me.'],
        'ambiguity.give': ['Give what? I only have: {inventory}.'],
        'polite_decline.missing_tool': ['Cannot do that without a {tool}.'],
        'polite_decline.low_hp': ['HP too low to fight.'],
        'polite_decline.busy_higher_priority_goal': ['Busy right now.'],
        'polite_decline.unknown_command': ['Do not understand.'],
    },
    default: {
        'stuck_help_request.blocked_by_obstacle.fence': [
            'I am stuck near the {direction} fence. Can someone open a route?',
            "I'm blocked by a fence to the {direction}. Can anyone help?",
            'Stuck near the {direction} fence here.',
        ],
        'stuck_help_request.blocked_by_obstacle.gate': [
            'I am stuck near the {direction} gate. Can someone open it?',
            'Closed door to the {direction} is blocking me. Can someone open it?',
            "I'm stuck at this closed gate. Can anyone help open it?",
        ],
        'stuck_help_request.blocked_by_npc': [
            "I'm blocked by {blockerName} to the {direction}. Can someone draw their attention?",
            "I can't get past {blockerName} to the {direction}.",
            'Stuck because {blockerName} is in the way.',
        ],
        'stuck_help_request.repeated_movement_failure': [
            'I am stuck near here trying to reach {direction}. Can someone lead me?',
            'I keep getting blocked trying to go {direction}. Can someone help?',
            'Stuck trying to head {direction}.',
        ],
        'stuck_help_request.default': [
            'I am stuck near here trying to reach {direction}. Can someone lead me?',
            'I keep getting blocked trying to go {direction}. Can someone help?',
            'Stuck trying to head {direction}.',
        ],
        'combat_decision.retaliate_confident': ['Attacking {targetName}!', 'I can defeat {targetName}!'],
        'combat_decision.retaliate_after_eat': ['Eating food to heal, then attacking!', 'Healing up to fight.'],
        'combat_decision.retreat_outmatched': ['Retreating! {targetName} is too strong.', 'This is too dangerous, running away!'],
        'combat_decision.retreat_low_hp': ['Low health! Running away!', 'Too weak to fight! Retreating!'],
        'combat_decision.kill_celebration': ['Down.'],
        'ambiguity.go': ['Go where?'],
        'ambiguity.make': ['Make what?'],
        'ambiguity.give': ['Give what? I have: {inventory}.'],
        'polite_decline.missing_tool': ['I need a {tool} before I can catch shrimp.'],
        'polite_decline.low_hp': ['My health is too low to fight right now.'],
        'polite_decline.busy_higher_priority_goal': ['I am busy with a higher priority goal.'],
        'polite_decline.unknown_command': ['I do not understand that command.'],
    },
};

export function pickPhrase(query: PhrasebookQuery): string {
    const register = (query.soul.frontmatter.voice?.register || query.soul.frontmatter.archetype || 'default').toLowerCase();
    const phrasesForRegister = PHRASEBOOK[register] || PHRASEBOOK['default'];

    let phrases = phrasesForRegister[query.situation];
    if (!phrases) {
        // Fallback to default register for the exact situation
        phrases = PHRASEBOOK['default'][query.situation];
    }
    if (!phrases) {
        // Fallback to default register default situation for the prefix
        const prefix = query.situation.split('.')[0];
        phrases = phrasesForRegister[`${prefix}.default`] || PHRASEBOOK['default'][`${prefix}.default`];
    }

    if (!phrases || phrases.length === 0) {
        return `I am stuck and need assistance.`;
    }

    let template = selectPhrase(phrases, query.seed);

    if (query.params) {
        for (const [key, val] of Object.entries(query.params)) {
            template = template.replace(new RegExp(`{${key}}`, 'g'), val);
        }
    }

    return template;
}
