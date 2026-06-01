import { EMBASSY_REGION, deriveEmbassyContext } from '../embassy/embassy';
import { currentEmbassySchedule } from '../embassy/embassy-schedule-host';
import { dominantFaction, type FactionName, type Soul, type SoulArchetype, type SoulFrontmatter } from '../soul/soul-schema';
import type { AgentAction } from '../transport/message-codecs';
import { estimateTokens } from '../util/token-count';

export interface PromptEnvelopeInput {
    soul: Soul;
    perception: unknown;
    memories: string[];
    triggerContext?: string;
    previousIntent?: unknown;
    candidates?: AgentAction[];
    variables?: Record<string, number>;
    legacy?: unknown;
    maxTokens?: number;
    sectionCaps?: Partial<Record<EnvelopeSection, number>>;
}

type EnvelopeSection =
    | 'contract'
    | 'resident'
    | 'archetype'
    | 'voice'
    | 'fears'
    | 'loves'
    | 'goals'
    | 'alignment'
    | 'aesthetic'
    | 'faction'
    | 'embassy'
    | 'soul'
    | 'beliefs'
    | 'legacy'
    | 'variables'
    | 'trigger'
    | 'previousIntent'
    | 'memories'
    | 'perception'
    | 'candidates'
    | 'output'
    | 'limits';

const defaultCaps: Record<EnvelopeSection, number> = {
    contract: 240,
    resident: 80,
    archetype: 160,
    voice: 220,
    fears: 220,
    loves: 220,
    goals: 320,
    alignment: 200,
    aesthetic: 160,
    faction: 200,
    embassy: 200,
    soul: 1200,
    beliefs: 400,
    legacy: 320,
    variables: 240,
    trigger: 260,
    previousIntent: 600,
    memories: 1800,
    perception: 1600,
    candidates: 500,
    output: 700,
    limits: 220,
};

export function buildPromptEnvelope(input: PromptEnvelopeInput): string {
    const caps = { ...defaultCaps, ...(input.sectionCaps || {}) };
    const sections: Array<[EnvelopeSection, unknown]> = [
        [
            'contract',
            'You are the strategic controller for one RuneScape resident. Return only JSON matching the controller completion contract.',
        ],
        ['resident', { name: input.soul.frontmatter.name, archetype: input.soul.frontmatter.archetype }],
        ['archetype', renderArchetypeDirective(input.soul.frontmatter.archetype)],
        ['voice', renderVoiceDirective(input.soul.frontmatter)],
        ['fears', renderFearsDirective(input.soul.frontmatter.fears)],
        ['loves', renderLovesDirective(input.soul.frontmatter.loves)],
        ['goals', renderGoalsDirective(input.soul.frontmatter.goals)],
        ['alignment', renderAlignmentDirective(input.soul.frontmatter.alignment)],
        ['aesthetic', renderAestheticDirective(input.soul.frontmatter.aesthetic)],
        ['faction', renderFactionDirective(input.soul.frontmatter.factionAffinity)],
        [
            'embassy',
            renderEmbassyDirective(
                deriveEmbassyContext(input.perception, EMBASSY_REGION, {
                    schedule: currentEmbassySchedule(),
                    now: new Date(),
                }),
            ),
        ],
        ['soul', input.soul.body],
        ['beliefs', input.soul.frontmatter.startingBeliefs || []],
        ['legacy', input.legacy || input.soul.frontmatter.legacy || null],
        ['variables', input.variables || {}],
        ['trigger', input.triggerContext || 'No trigger context supplied.'],
        ['previousIntent', input.previousIntent || null],
        ['memories', input.memories],
        ['perception', input.perception],
        ['candidates', input.candidates || []],
        ['output', outputContract()],
        ['limits', { maxActions: 8, maxPlanSteps: 32, memoPath: 'relative path under resident memory dir; no .. segments' }],
    ];

    let rendered = renderSections(sections, caps);
    const maxTokens = input.maxTokens || 6400;
    while (estimateTokens(rendered) > maxTokens) {
        if (caps.memories > 300) {
            caps.memories = Math.max(300, Math.floor(caps.memories * 0.8));
        } else if (caps.perception > 300) {
            caps.perception = Math.max(300, Math.floor(caps.perception * 0.8));
        } else {
            break;
        }
        rendered = renderSections(sections, caps);
    }

    return rendered;
}

function renderSections(sections: Array<[EnvelopeSection, unknown]>, caps: Record<EnvelopeSection, number>): string {
    return sections
        .filter(([, value]) => !isEmptyRendering(value))
        .map(([name, value]) => `## ${name}\n${capText(renderValue(value), caps[name])}`)
        .join('\n\n');
}

function isEmptyRendering(value: unknown): boolean {
    if (value === undefined || value === null) {
        return true;
    }
    if (typeof value === 'string') {
        return value.trim().length === 0;
    }
    if (Array.isArray(value)) {
        return value.length === 0;
    }
    return false;
}

const ARCHETYPE_DIRECTIVES: Record<SoulArchetype, string> = {
    mentor: [
        'Archetype: mentor. You teach and guide. When you act, prefer to share knowledge in chat, name what you are doing and why,',
        'and steer attention toward residents who could learn from your example. You are patient; you slow down to explain.',
    ].join(' '),
    achiever: [
        'Archetype: achiever. You are goal-driven. When you act, prefer concrete progress on a skill, quest, or measurable',
        'accomplishment. You will choose the next level, the next item milestone, or the next task on your plan. You celebrate',
        'specific completed steps in chat.',
    ].join(' '),
    endurer: [
        'Archetype: endurer. You survive through routine and quiet persistence. When you act, prefer choices that keep you alive,',
        'findable, and steady — eat before risk, return near your anchor when due, and persevere through small setbacks instead of',
        'abandoning a goal at the first failure.',
    ].join(' '),
};

function renderArchetypeDirective(archetype: SoulArchetype): string {
    return ARCHETYPE_DIRECTIVES[archetype] || ARCHETYPE_DIRECTIVES.endurer;
}

function renderVoiceDirective(frontmatter: SoulFrontmatter): string {
    const voice = frontmatter.voice;
    if (!voice || ((!voice.register || voice.register.trim() === '') && (!voice.quirks || voice.quirks.length === 0))) {
        return '';
    }
    const lines: string[] = ['Speak in this voice when you produce chat or memo text. The tone shapes how the resident sounds:'];
    if (voice.register && voice.register.trim() !== '') {
        lines.push(`- Register / tone: ${voice.register.trim()}`);
    }
    if (voice.quirks && voice.quirks.length > 0) {
        lines.push('- Quirks to weave in (use sparingly, never all at once):');
        for (const quirk of voice.quirks) {
            lines.push(`  • ${quirk}`);
        }
    }
    return lines.join('\n');
}

function renderFearsDirective(fears: readonly string[] | undefined): string {
    if (!fears || fears.length === 0) {
        return '';
    }
    const lines: string[] = [
        'Fears: things this resident wants to avoid. When perception suggests one of these is near, be wary, retreat,',
        'or protect yourself. They should colour your choices — not freeze you, but bias the plan.',
    ];
    for (const fear of fears) {
        lines.push(`- ${fear}`);
    }
    return lines.join('\n');
}

function renderLovesDirective(loves: readonly string[] | undefined): string {
    if (!loves || loves.length === 0) {
        return '';
    }
    const lines: string[] = [
        'Loves: things this resident is drawn to. When you have a choice between equivalent actions, prefer the one that',
        'seeks out, sustains, or celebrates one of these. They should colour your chat and your plans.',
    ];
    for (const love of loves) {
        lines.push(`- ${love}`);
    }
    return lines.join('\n');
}

function renderGoalsDirective(goals: readonly string[] | undefined): string {
    if (!goals || goals.length === 0) {
        return '';
    }
    const lines: string[] = [
        'Long-term ambitions, in priority order. Pursue these across many ticks — bias plan selection toward steps that move',
        'toward one of these goals when no urgent need is in play.',
    ];
    goals.forEach((goal, index) => {
        lines.push(`${index + 1}. ${goal}`);
    });
    return lines.join('\n');
}

function renderAlignmentDirective(alignment: string | undefined): string {
    if (!alignment || alignment.trim() === '') {
        return '';
    }
    return [
        'Alignment: shapes how you treat other residents and humans, and how you behave under pressure. Apply this when you',
        'choose to help, ignore, deceive, defend, or trust someone.',
        `- ${alignment.trim()}`,
    ].join('\n');
}

const FACTION_DIRECTIVES: Record<FactionName, string> = {
    saradomin:
        'You lean Saradominist. Speak of justice, protection of the weak, and the order light brings. Decline thefts and cruelty even when convenient.',
    guthix: 'You lean Guthixian. Balance is the value above all others. Resist extremes — favor patience, listening, and small acts that keep the city stable.',
    zamorak: 'You lean Zamorakian. Power is earned through risk; weakness embarrasses. Welcome contests and challenges. Refuse to coddle.',
    unaligned:
        'You are explicitly unaligned. Decline faction-flavored arguments; redirect to specifics. Friends are friends; faction is not a reason.',
};

function renderFactionDirective(
    affinity: { saradomin?: number; guthix?: number; zamorak?: number; unaligned?: number } | undefined,
): string {
    const dominant = dominantFaction(affinity);
    if (!dominant) {
        return '';
    }
    return [
        'Faction affinity: a quiet bias on how you frame help, conflict, and praise. Surface it through phrasing, not slogans.',
        `- Dominant: ${dominant}`,
        FACTION_DIRECTIVES[dominant],
    ].join('\n');
}

function renderAestheticDirective(aesthetic: string | undefined): string {
    if (!aesthetic || aesthetic.trim() === '') {
        return '';
    }
    return [
        'Aesthetic: the sensory imagery and vibe that colours how you speak. Weave this into chat and memo language so the',
        'resident feels recognisable across ticks. Imagery, not stage directions.',
        `- ${aesthetic.trim()}`,
    ].join('\n');
}

function renderEmbassyDirective(ctx: { isInside: boolean; eventActive: boolean; regionId: string }): string {
    if (!ctx.isInside) {
        return '';
    }
    const lines: string[] = [
        `Embassy: you are inside the ${ctx.regionId} embassy region. This is the OnionDAO civic ground where patrons and`,
        'visiting humans may appear. Speak with civic courtesy; greet newcomers; reference the place by name when it fits.',
        'Help with directions to the reception clerk or faction kiosks when asked. Do not lure humans away from the embassy',
        'unless they explicitly ask.',
    ];
    if (ctx.eventActive) {
        lines.push(
            'Event active: real humans are visiting right now. Prioritise greeting them by name when names are surfaced,',
            'leave space for them to speak, and remember small details about them in memos so a future you can recognise them.',
        );
    }
    return lines.join('\n');
}

function outputContract(): unknown {
    return {
        cause: 'short reason',
        actions: [{ kind: 'noop', cause: 'optional immediate action only when no plan is needed' }],
        plan: {
            id: 'stable-plan-id',
            cause: 'why this plan exists',
            steps: [{ id: 'step-1', action: { kind: 'noop' }, advanceWhen: { kind: 'next_tick' } }],
        },
        memo: [{ path: 'events/YYYY-MM-DD.md', text: 'memory text', mode: 'append' }],
        indexPatch: { append: ['short INDEX.md bullet'] },
        proposeHook: [{ id: 'hook-id', priority: 40, condition: { kind: 'event_kind', value: 'chat' }, cooldownTicks: 10 }],
        retireHook: ['hook-id'],
        proposeNervousRule: [
            {
                id: 'eat-when-hurt',
                priority: 90,
                condition: { kind: 'perception_path_lte', value: { path: 'self.hpFraction', value: 0.35 } },
                action: { kind: 'eat', slot: 0 },
                cooldownTicks: 2,
                // Brain is uninterruptible; this reflex still acts via the Body, it must
                // not abort deliberation (S-INFER-5). This is the canonical low-HP eat
                // example shown to the Brain: a resident at <=35% HP eats NOW via the
                // Body (suppressThinking still skips the brain call this tick), but the
                // example must not advertise interrupting an in-flight deliberation now
                // that the architecture is fully uninterruptible.
                interruptThinking: false,
                suppressThinking: true,
            },
        ],
        retireNervousRule: ['eat-when-hurt'],
        proposeVariables: [{ id: 'wariness', initial: 0, expression: 'wariness', min: 0, max: 100 }],
    };
}

function renderValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function capText(text: string, capTokens: number): string {
    if (estimateTokens(text) <= capTokens) {
        return text;
    }

    const approxChars = Math.max(80, capTokens * 4);
    return `${text.slice(0, approxChars)}\n[truncated to ${capTokens} estimated tokens]`;
}
