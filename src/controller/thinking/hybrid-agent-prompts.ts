import type { ActiveGoalState } from '../memory/runtime-state';
import type { Soul, SoulArchetype, SoulFrontmatter } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import type { GameSkillContext } from '../knowledge/game-skill-context';
import { bodyPlaybookPrompt, brainPlaybookPrompt } from './runebench-playbook';

export interface BrainPromptInput {
    soul: Soul;
    perception: Perception;
    activeGoal?: ActiveGoalState;
    commandPrefix: string;
    gameSkill?: Pick<GameSkillContext, 'brainSection' | 'bodySection'>;
    progress?: RuntimeProgressPromptInput;
}

export interface BodyPromptInput {
    soul: Soul;
    perception: Perception;
    activeGoal?: ActiveGoalState;
    commandPrefix: string;
    gameSkill?: Pick<GameSkillContext, 'brainSection' | 'bodySection'>;
    progress?: RuntimeProgressPromptInput;
    visibility: {
        anchor?: { x: number; y: number; level: number };
        returnDue: boolean;
    };
}

export interface RuntimeProgressPromptInput {
    tick: number;
    lastMeaningfulProgressAt?: number;
    stuckSince?: number;
}

export function buildBrainPrompt(input: BrainPromptInput): string {
    return [
        '/think',
        'You are the Brain for an autonomous RuneScape resident. Think strategically, slowly, and in character.',
        'Choose one useful near-term goal. Do not emit game actions. The Body will translate the goal into concrete actions.',
        'Prefer practical old-school RuneScape goals the current engine can actually do:',
        '- Firemaker: gather ordinary logs, then use tinderbox on logs until a fire appears nearby.',
        '- Woodcutter: find ordinary Tree or Dead tree objects, move beside them, and use chop down to gather logs.',
        '- Prayer novice: pick up bones from safe kills, then use the inventory "bury" option on bones.',
        '- Survivor: keep food available, eat when hurt, avoid risky combat without food.',
        '- Local explorer: describe useful nearby NPCs, items, objects, and return near the visibility anchor so Codex can find you.',
        '- Basic combat: only fight safe low-level NPCs when healthy or when attacked; eat or retreat when hurt.',
        '',
        brainPlaybookPrompt(),
        input.gameSkill?.brainSection || '',
        runtimeProgressSection(input.progress, 'brain'),
        soulIdentitySection(input.soul.frontmatter, 'brain'),
        'Return JSON only with this shape:',
        '{"goal":{"id":"short-id","description":"clear current ambition","steps":["step one","step two"],"success":"how we know it worked","ttlTicks":300},"say":"optional public chat <= 160 chars"}',
        '',
        `Resident: ${input.soul.frontmatter.display || input.soul.frontmatter.name}`,
        `Command prefix: ${input.commandPrefix}`,
        `Soul notes:\n${input.soul.body}`,
        `Current goal:\n${JSON.stringify(input.activeGoal || null, null, 2)}`,
        `Perception:\n${summarizePerception(input.perception)}`,
    ]
        .filter(line => line !== '')
        .join('\n');
}

export function buildBodyPrompt(input: BodyPromptInput): string {
    return [
        '/no_think',
        'You are the Body for an autonomous RuneScape resident. Act quickly and concretely.',
        'Use the active Brain goal, current perception, visible actors/items/objects, and available actions.',
        'Return JSON only. Emit at most one action in actions. Prefer typed AgentAction objects over explanations.',
        'Allowed action examples: {"kind":"move_to","target":{"x":3222,"y":3219,"level":0}}, {"kind":"say","text":"..."}, {"kind":"interact","target":...,"option":"talk-to"}, {"kind":"use_item_on_item","itemSlot":0,"targetSlot":1}, {"kind":"item_action","slot":2,"option":"bury"}, {"kind":"attack","target":...}.',
        'When interacting with an object, use one of the option names shown in available actions, such as "chop down".',
        'If addressed in chat, answer or act. If the goal involves an item/tool and matching inventory slots are visible, use them.',
        '',
        bodyPlaybookPrompt(),
        input.gameSkill?.bodySection || '',
        runtimeProgressSection(input.progress, 'body'),
        soulIdentitySection(input.soul.frontmatter, 'body'),
        input.visibility.returnDue && input.visibility.anchor
            ? `Visibility rule: Agent is due to return near ${JSON.stringify(input.visibility.anchor)} so Codex can find him. Prefer moving there unless a chat command or survival need is more important.`
            : 'Visibility rule: stay findable and mention useful intentions in public chat sometimes.',
        '',
        `Resident: ${input.soul.frontmatter.display || input.soul.frontmatter.name}`,
        `Command prefix: ${input.commandPrefix}`,
        `Active Brain goal:\n${JSON.stringify(input.activeGoal || null, null, 2)}`,
        `Perception:\n${summarizePerception(input.perception)}`,
    ]
        .filter(line => line !== '')
        .join('\n');
}

function summarizePerception(perception: Perception): string {
    const compressed = typeof perception.compressed === 'string' ? perception.compressed : undefined;
    if (compressed) {
        return compressed.slice(0, 12000);
    }

    return JSON.stringify(perception, null, 2).slice(0, 12000);
}

function runtimeProgressSection(progress: RuntimeProgressPromptInput | undefined, role: 'brain' | 'body'): string {
    if (!progress || (progress.lastMeaningfulProgressAt === undefined && progress.stuckSince === undefined)) {
        return '';
    }
    const lines = [
        'Runtime progress evidence:',
        `- current tick: ${progress.tick}`,
        `- last meaningful progress tick: ${progress.lastMeaningfulProgressAt ?? 'unknown'}`,
        `- stuck since tick: ${progress.stuckSince ?? 'not stuck'}`,
    ];
    if (progress.stuckSince !== undefined) {
        lines.push(
            role === 'brain'
                ? '- Evidence says the current approach is stuck; choose a different tactic, smaller subgoal, or ask for help in chat.'
                : '- Evidence says the current approach is stuck. Do not repeat the same failed action; try opening a blocker, stepping to a different tile, choosing a nearer target, or saying what blocks you.',
        );
    }
    return lines.join('\n');
}

const BRAIN_ARCHETYPE_DIRECTIVES: Record<SoulArchetype, string> = {
    mentor: 'Archetype: mentor. Choose goals that let you teach or guide. Slow down to name what you are doing and why; steer attention toward residents who could learn from your example. Patience over speed.',
    achiever: 'Archetype: achiever. Choose goals that produce a concrete, measurable step — next level, next item milestone, next quest completion. Celebrate finished steps explicitly.',
    endurer: 'Archetype: endurer. Choose goals that keep you alive, findable, and steady. Eat before risk, return near your anchor when due, persevere through small setbacks instead of abandoning at the first failure.',
};

const BODY_ARCHETYPE_DIRECTIVES: Record<SoulArchetype, string> = {
    mentor: 'Archetype: mentor. When choosing between equivalent actions, prefer the one that lets you teach in chat or demonstrate a step. Patience over speed.',
    achiever: 'Archetype: achiever. When choosing between equivalent actions, prefer the one that produces visible skill XP, an item, or a level. Drive the goal forward.',
    endurer: 'Archetype: endurer. When choosing between equivalent actions, prefer the one that keeps you alive and findable — eat early, retreat instead of pushing, return near anchor when due. Persevere instead of abandoning.',
};

function soulIdentitySection(frontmatter: SoulFrontmatter, role: 'brain' | 'body'): string {
    const lines: string[] = [];

    const archetypeDirective =
        role === 'brain'
            ? BRAIN_ARCHETYPE_DIRECTIVES[frontmatter.archetype] || BRAIN_ARCHETYPE_DIRECTIVES.endurer
            : BODY_ARCHETYPE_DIRECTIVES[frontmatter.archetype] || BODY_ARCHETYPE_DIRECTIVES.endurer;
    lines.push(archetypeDirective);

    const voiceLine = renderVoiceLine(frontmatter.voice);
    if (voiceLine) {
        lines.push(voiceLine);
    }

    if (frontmatter.fears && frontmatter.fears.length > 0) {
        lines.push(
            `Fears (avoid / be wary of, but do not freeze): ${frontmatter.fears
                .map(item => `"${item}"`)
                .join(', ')}.`,
        );
    }

    if (frontmatter.loves && frontmatter.loves.length > 0) {
        lines.push(
            `Loves (seek out or prefer when choices are equivalent): ${frontmatter.loves
                .map(item => `"${item}"`)
                .join(', ')}.`,
        );
    }

    if (frontmatter.goals && frontmatter.goals.length > 0) {
        const numbered = frontmatter.goals
            .map((goal, index) => `${index + 1}) ${goal}`)
            .join(' | ');
        lines.push(
            role === 'brain'
                ? `Long-term ambitions (pursue toward these across ticks, in priority order): ${numbered}.`
                : `Long-term ambitions to pursue: ${numbered}. Prefer actions that move toward goal #1 when no urgent need is in play.`,
        );
    }

    if (frontmatter.alignment && frontmatter.alignment.trim() !== '') {
        lines.push(
            `Alignment (how you treat other residents and humans, and behave under pressure): ${frontmatter.alignment.trim()}.`,
        );
    }

    if (frontmatter.aesthetic && frontmatter.aesthetic.trim() !== '') {
        lines.push(
            `Aesthetic (sensory imagery / vibe to weave into chat and memos): ${frontmatter.aesthetic.trim()}.`,
        );
    }

    return lines.join('\n');
}

function renderVoiceLine(voice: SoulFrontmatter['voice']): string {
    if (!voice) {
        return '';
    }
    const parts: string[] = [];
    if (voice.register && voice.register.trim() !== '') {
        parts.push(`tone "${voice.register.trim()}"`);
    }
    if (voice.quirks && voice.quirks.length > 0) {
        parts.push(`quirks (use sparingly): ${voice.quirks.map(q => `"${q}"`).join(', ')}`);
    }
    if (parts.length === 0) {
        return '';
    }
    return `Voice: speak in ${parts.join('; ')}.`;
}
