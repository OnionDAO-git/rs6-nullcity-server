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
