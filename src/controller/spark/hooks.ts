export interface HookCondition {
    kind:
        | 'always'
        | 'attention_lte'
        | 'variable_gte'
        | 'variable_lte'
        | 'event_kind'
        | 'perception_path_exists'
        | 'perception_path_changed'
        | 'contains_text';
    value?: unknown;
}

export interface HookDefinition {
    id: string;
    priority: number;
    condition: HookCondition;
    cooldownTicks?: number;
    interrupt?: boolean;
    source?: 'system' | 'soul' | 'memory';
    contextHint?: string;
}

export const systemHooks: HookDefinition[] = (
    [
        {
            id: 'attention_empty',
            priority: 100,
            condition: { kind: 'attention_lte', value: 0 },
        },
        {
            id: 'took_damage',
            priority: 95,
            condition: { kind: 'event_kind', value: 'hit' },
            cooldownTicks: 1,
            interrupt: true,
            contextHint: 'The resident was hit or damaged. Prioritize survival and source identification.',
        },
        {
            id: 'death_seen',
            priority: 95,
            condition: { kind: 'event_kind', value: 'died' },
            cooldownTicks: 1,
            interrupt: true,
            contextHint: 'A death event is present in the current perception.',
        },
        {
            id: 'addressed_by_chat',
            priority: 85,
            condition: { kind: 'event_kind', value: 'chat' },
            cooldownTicks: 2,
            interrupt: true,
            contextHint: 'Recent chat may be directed at the resident. Respond in character if appropriate.',
        },
        {
            id: 'trade_request',
            priority: 80,
            condition: { kind: 'event_kind', value: 'trade_request' },
            cooldownTicks: 4,
            interrupt: true,
            contextHint: 'A trade request requires an accept, decline, or social response decision.',
        },
        {
            id: 'new_actor_or_chunk',
            priority: 45,
            condition: { kind: 'perception_path_changed', value: 'nearby' },
            cooldownTicks: 5,
            contextHint: 'Nearby actors or location context changed. Consider updating memory and intent.',
        },
        {
            id: 'idle_reflection',
            priority: 30,
            condition: { kind: 'always' },
            cooldownTicks: 25,
            contextHint: 'No urgent hook fired. Reflect briefly and choose a low-cost next step.',
        },
    ] as HookDefinition[]
).map(hook => ({ ...hook, source: 'system' as const }));

export function clampHookPriority(hook: HookDefinition, maxPriority = 80): HookDefinition {
    return {
        ...hook,
        priority: Math.max(0, Math.min(maxPriority, Math.trunc(hook.priority))),
    };
}
