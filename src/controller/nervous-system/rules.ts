import type { RuntimeState } from '../memory/runtime-state';
import type { AgentAction } from '../transport/message-codecs';

export interface NervousCondition {
    kind:
        | 'always'
        | 'attention_lte'
        | 'variable_gte'
        | 'variable_lte'
        | 'event_kind'
        | 'perception_path_exists'
        | 'perception_path_changed'
        | 'perception_path_equals'
        | 'perception_path_gte'
        | 'perception_path_lte'
        | 'contains_text';
    value?: unknown;
}

export interface NervousRule {
    id: string;
    priority: number;
    condition: NervousCondition;
    action: AgentAction;
    cooldownTicks?: number;
    interruptThinking?: boolean;
    suppressThinking?: boolean;
    source?: 'system' | 'soul' | 'memory';
    contextHint?: string;
}

export interface NervousReaction {
    rule: NervousRule;
    action: AgentAction;
    suppressThinking: boolean;
    interruptThinking: boolean;
}

export function clampNervousRulePriority(rule: NervousRule, maxPriority = 100): NervousRule {
    return {
        ...rule,
        priority: Math.max(0, Math.min(maxPriority, Math.trunc(rule.priority))),
    };
}

export function evaluateNervousRules(
    rules: NervousRule[],
    state: RuntimeState,
    perception: unknown,
    variables: Record<string, unknown> = {},
): NervousReaction | undefined {
    const tick = effectiveTick(state, perception);
    const fired = rules
        .filter(rule => {
            const coolingUntil = state.hookCooldowns?.[cooldownKey(rule.id)] || 0;
            return coolingUntil <= tick && conditionMet(rule.condition, state, perception, variables);
        })
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    const rule = fired[0];
    if (!rule) {
        return undefined;
    }

    const cooldownTicks = rule.cooldownTicks || 0;
    if (cooldownTicks > 0) {
        state.hookCooldowns = state.hookCooldowns || {};
        state.hookCooldowns[cooldownKey(rule.id)] = tick + cooldownTicks;
    }

    return {
        rule,
        action: { ...rule.action, cause: rule.action.cause || `nervous:${rule.id}` },
        suppressThinking: rule.suppressThinking !== false,
        interruptThinking: rule.interruptThinking !== false,
    };
}

function conditionMet(condition: NervousCondition, state: RuntimeState, perception: unknown, variables: Record<string, unknown>): boolean {
    const value = condition.value;
    switch (condition.kind) {
        case 'always':
            return true;
        case 'attention_lte':
            return state.attention <= Number(value || 0);
        case 'variable_gte':
            return compareVariable(value, variables, (actual, expected) => actual >= expected);
        case 'variable_lte':
            return compareVariable(value, variables, (actual, expected) => actual <= expected);
        case 'event_kind':
            return hasEventKind(perception, String(value || ''));
        case 'perception_path_exists':
            return readPath(perception, String(value || '')) !== undefined;
        case 'perception_path_changed':
            return pathChanged(perception, String(value || ''));
        case 'perception_path_equals':
            return comparePerceptionPath(value, perception, (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected));
        case 'perception_path_gte':
            return compareNumericPerceptionPath(value, perception, (actual, expected) => actual >= expected);
        case 'perception_path_lte':
            return compareNumericPerceptionPath(value, perception, (actual, expected) => actual <= expected);
        case 'contains_text':
            return JSON.stringify(perception)
                .toLowerCase()
                .includes(String(value || '').toLowerCase());
        default:
            return false;
    }
}

function compareVariable(
    value: unknown,
    variables: Record<string, unknown>,
    compare: (actual: number, expected: number) => boolean,
): boolean {
    const spec = isRecord(value) ? value : {};
    const name = typeof spec.name === 'string' ? spec.name : '';
    const expected = Number(spec.value || 0);
    const actual = Number(variables[name] || 0);
    return Boolean(name) && Number.isFinite(actual) && Number.isFinite(expected) && compare(actual, expected);
}

function comparePerceptionPath(value: unknown, perception: unknown, compare: (actual: unknown, expected: unknown) => boolean): boolean {
    const spec = isRecord(value) ? value : {};
    const path = typeof spec.path === 'string' ? spec.path : '';
    return Boolean(path) && compare(readPath(perception, path), spec.value);
}

function compareNumericPerceptionPath(
    value: unknown,
    perception: unknown,
    compare: (actual: number, expected: number) => boolean,
): boolean {
    return comparePerceptionPath(value, perception, (actual, expected) => {
        const actualNumber = Number(actual);
        const expectedNumber = Number(expected);
        return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && compare(actualNumber, expectedNumber);
    });
}

function pathChanged(perception: unknown, path: string): boolean {
    if (!isRecord(perception)) {
        return false;
    }
    const before = readPath(perception.before, path);
    const after = readPath(perception.after, path) ?? readPath(perception, path);
    return JSON.stringify(before) !== JSON.stringify(after);
}

function hasEventKind(value: unknown, kind: string): boolean {
    if (!kind) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.some(item => hasEventKind(item, kind));
    }
    if (!isRecord(value)) {
        return false;
    }
    if (value.kind === kind || value.type === kind || value.event === kind) {
        return true;
    }
    return Object.values(value).some(item => Array.isArray(item) && item.some(child => hasEventKind(child, kind)));
}

function readPath(value: unknown, dottedPath: string): unknown {
    let current = value;
    for (const part of dottedPath.split('.').filter(Boolean)) {
        if (!isRecord(current)) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}

function effectiveTick(state: RuntimeState, perception: unknown): number {
    const perceptionTick = isRecord(perception) && typeof perception.tick === 'number' ? perception.tick : undefined;
    return perceptionTick ?? state.tick;
}

function cooldownKey(id: string): string {
    return `nervous:${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
