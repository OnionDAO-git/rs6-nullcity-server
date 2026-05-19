import type { Soul } from '../soul/soul-schema';
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
        [
            'resident',
            { name: input.soul.frontmatter.name, archetype: input.soul.frontmatter.archetype, voice: input.soul.frontmatter.voice },
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
    return sections.map(([name, value]) => `## ${name}\n${capText(renderValue(value), caps[name])}`).join('\n\n');
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
                interruptThinking: true,
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
