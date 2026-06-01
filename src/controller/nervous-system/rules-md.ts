import fs from 'fs';
import path from 'path';
import { agentActionSchema } from '../transport/message-codecs';
import { type NervousRule, clampNervousRulePriority } from './rules';

export interface NervousRulesMdState {
    rules: NervousRule[];
    retired: string[];
}

const stateFence = '<!-- controller-nervous-rules-json';
const stateFenceEnd = '-->';
const MEMORY_TRADE_DECLINE_COOLDOWN_TICKS = 120;

export function readNervousRulesMd(memoryDir: string): NervousRulesMdState {
    const file = path.join(memoryDir, 'nervous-rules.md');
    if (!fs.existsSync(file)) {
        return { rules: [], retired: [] };
    }

    const raw = fs.readFileSync(file, 'utf8');
    const start = raw.indexOf(stateFence);
    if (start === -1) {
        return { rules: [], retired: [] };
    }

    const end = raw.indexOf(stateFenceEnd, start);
    const encoded = raw.slice(start + stateFence.length, end);
    if (!encoded || end === -1) {
        return { rules: [], retired: [] };
    }

    try {
        const parsed = JSON.parse(encoded.trim()) as Partial<NervousRulesMdState>;
        const retired = Array.isArray(parsed.retired) ? parsed.retired.filter((id): id is string => typeof id === 'string') : [];
        return {
            rules: (Array.isArray(parsed.rules) ? parsed.rules : []).flatMap(rule => normalizeRule(rule, retired)),
            retired,
        };
    } catch {
        return { rules: [], retired: [] };
    }
}

export function upsertNervousRulesMd(memoryDir: string, updates: Partial<NervousRulesMdState>): NervousRulesMdState {
    const current = readNervousRulesMd(memoryDir);
    const retired = new Set([...(current.retired || []), ...(updates.retired || [])]);
    const rulesById = new Map(current.rules.map(rule => [rule.id, rule]));

    for (const rule of updates.rules || []) {
        if (!retired.has(rule.id)) {
            rulesById.set(rule.id, clampNervousRulePriority({ ...rule, source: 'memory' }));
        }
    }
    for (const id of retired) {
        rulesById.delete(id);
    }

    const next = {
        rules: [...rulesById.values()],
        retired: [...retired],
    };
    writeNervousRulesMd(memoryDir, next);
    return next;
}

export function retireNervousRulesMd(memoryDir: string, ids: string[]): NervousRulesMdState {
    return upsertNervousRulesMd(memoryDir, { retired: ids });
}

function writeNervousRulesMd(memoryDir: string, state: NervousRulesMdState): void {
    fs.mkdirSync(memoryDir, { recursive: true });
    const renderedRules =
        state.rules.map(rule => `- ${rule.id} (priority ${rule.priority}, action ${rule.action.kind})`).join('\n') || '- none';
    fs.writeFileSync(
        path.join(memoryDir, 'nervous-rules.md'),
        `# Nervous system rules\n\nThese rules are run on each perception before LLM inference.\n\n## Active rules\n${renderedRules}\n\n${stateFence}\n${JSON.stringify(state, null, 2)}\n${stateFenceEnd}\n`,
    );
}

function normalizeRule(value: unknown, retired: string[]): NervousRule[] {
    if (!isRecord(value) || retired.includes(String(value.id))) {
        return [];
    }
    if (
        typeof value.id !== 'string' ||
        typeof value.priority !== 'number' ||
        !isRecord(value.condition) ||
        typeof value.condition.kind !== 'string'
    ) {
        return [];
    }

    const action = agentActionSchema.safeParse(value.action);
    if (!action.success) {
        return [];
    }
    const cooldownTicks = sanitizedCooldownTicks(value, action.data);
    const interruptThinking = sanitizedInterruptThinking(value, action.data);

    return [
        clampNervousRulePriority({
            id: value.id,
            priority: value.priority,
            condition: { kind: value.condition.kind as NervousRule['condition']['kind'], value: value.condition.value },
            action: action.data,
            cooldownTicks,
            interruptThinking,
            suppressThinking: typeof value.suppressThinking === 'boolean' ? value.suppressThinking : undefined,
            contextHint: typeof value.contextHint === 'string' ? value.contextHint : undefined,
            source: 'memory',
        }),
    ];
}

function sanitizedCooldownTicks(value: Record<string, unknown>, action: NervousRule['action']): number | undefined {
    const cooldownTicks = typeof value.cooldownTicks === 'number' ? value.cooldownTicks : undefined;
    if (!isTradeDeclineMemoryRule(value, action)) {
        return cooldownTicks;
    }
    return Math.max(cooldownTicks || 0, MEMORY_TRADE_DECLINE_COOLDOWN_TICKS);
}

function sanitizedInterruptThinking(value: Record<string, unknown>, action: NervousRule['action']): boolean | undefined {
    if (isTradeDeclineMemoryRule(value, action)) {
        return false;
    }
    return typeof value.interruptThinking === 'boolean' ? value.interruptThinking : undefined;
}

function isTradeDeclineMemoryRule(value: Record<string, unknown>, action: NervousRule['action']): boolean {
    const condition = isRecord(value.condition) ? value.condition : {};
    return action.kind === 'trade_decline' && condition.kind === 'event_kind' && condition.value === 'trade_request';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
