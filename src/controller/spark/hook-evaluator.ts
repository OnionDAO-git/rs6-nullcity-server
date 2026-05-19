import type { RuntimeState } from '../memory/runtime-state';
import type { HookDefinition } from './hooks';

export interface FiredHook {
    id: string;
    priority: number;
    cause: string;
    hook: HookDefinition;
    contextHint?: string;
}

export class HookEvaluator {
    evaluate(hooks: HookDefinition[], state: RuntimeState, perception: unknown, variables: Record<string, unknown> = {}): FiredHook[] {
        const fired: FiredHook[] = [];
        for (const hook of hooks) {
            const coolingUntil = state.hookCooldowns?.[hook.id] || 0;
            if (coolingUntil > state.tick) {
                continue;
            }

            if (conditionMet(hook, state, perception, variables)) {
                fired.push({ id: hook.id, priority: hook.priority, cause: hook.id, hook, contextHint: hook.contextHint });
            }
        }

        const sorted = fired.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
        const [winner, ...shadowed] = sorted;
        if (winner) {
            state.hookCooldowns = state.hookCooldowns || {};
            const cooldownTicks = winner.hook.cooldownTicks || 0;
            if (cooldownTicks > 0) {
                state.hookCooldowns[winner.id] = state.tick + cooldownTicks;
            }
        }

        if (shadowed.length > 0) {
            state.shadowedHooks = [
                ...(state.shadowedHooks || []),
                ...shadowed.map(hook => ({
                    tick: state.tick,
                    id: hook.id,
                    priority: hook.priority,
                    shadowedBy: winner?.id || 'none',
                })),
            ].slice(-100);
        }

        return sorted;
    }
}

function conditionMet(hook: HookDefinition, state: RuntimeState, perception: unknown, variables: Record<string, unknown>): boolean {
    const value = hook.condition.value;
    switch (hook.condition.kind) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
