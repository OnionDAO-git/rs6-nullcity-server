import fs from 'fs';
import path from 'path';
import type { ProposedVariable } from '../llm/completion-parser';
import { type HookDefinition, clampHookPriority } from '../spark/hooks';

export interface HooksMdState {
    hooks: HookDefinition[];
    variables: ProposedVariable[];
    retired: string[];
}

const stateFence = '<!-- controller-hooks-json';
const stateFenceEnd = '-->';

export function readHooksMd(memoryDir: string): HooksMdState {
    const file = path.join(memoryDir, 'hooks.md');
    if (!fs.existsSync(file)) {
        return { hooks: [], variables: [], retired: [] };
    }

    const raw = fs.readFileSync(file, 'utf8');
    const encoded = raw.slice(raw.indexOf(stateFence) + stateFence.length, raw.indexOf(stateFenceEnd, raw.indexOf(stateFence)));
    if (!encoded || raw.indexOf(stateFence) === -1) {
        return { hooks: [], variables: [], retired: [] };
    }

    try {
        const parsed = JSON.parse(encoded.trim()) as Partial<HooksMdState>;
        const retired = Array.isArray(parsed.retired) ? parsed.retired.filter((id): id is string => typeof id === 'string') : [];
        return {
            hooks: (Array.isArray(parsed.hooks) ? parsed.hooks : []).flatMap(hook => normalizeHook(hook, retired)),
            variables: (Array.isArray(parsed.variables) ? parsed.variables : []).flatMap(normalizeVariable),
            retired,
        };
    } catch {
        return { hooks: [], variables: [], retired: [] };
    }
}

export function upsertHooksMd(memoryDir: string, updates: Partial<HooksMdState>): HooksMdState {
    const current = readHooksMd(memoryDir);
    const retired = new Set([...(current.retired || []), ...(updates.retired || [])]);
    const hooksById = new Map(current.hooks.map(hook => [hook.id, hook]));
    for (const hook of updates.hooks || []) {
        if (!retired.has(hook.id)) {
            hooksById.set(hook.id, clampHookPriority({ ...hook, source: 'memory' }, 80));
        }
    }
    for (const id of retired) {
        hooksById.delete(id);
    }

    const variablesById = new Map(current.variables.map(variable => [variable.id, variable]));
    for (const variable of updates.variables || []) {
        variablesById.set(variable.id, variable);
    }

    const next = {
        hooks: [...hooksById.values()],
        variables: [...variablesById.values()],
        retired: [...retired],
    };
    writeHooksMd(memoryDir, next);
    return next;
}

export function retireHooksMd(memoryDir: string, ids: string[]): HooksMdState {
    return upsertHooksMd(memoryDir, { retired: ids });
}

function writeHooksMd(memoryDir: string, state: HooksMdState): void {
    fs.mkdirSync(memoryDir, { recursive: true });
    const renderedHooks = state.hooks.map(hook => `- ${hook.id} (priority ${hook.priority})`).join('\n') || '- none';
    const renderedVariables = state.variables.map(variable => `- ${variable.id}`).join('\n') || '- none';
    fs.writeFileSync(
        path.join(memoryDir, 'hooks.md'),
        `# Controller hooks\n\n## Active hooks\n${renderedHooks}\n\n## Variables\n${renderedVariables}\n\n${stateFence}\n${JSON.stringify(state, null, 2)}\n${stateFenceEnd}\n`,
    );
}

function normalizeHook(value: unknown, retired: string[]): HookDefinition[] {
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
    return [
        clampHookPriority(
            {
                id: value.id,
                priority: value.priority,
                condition: { kind: value.condition.kind as HookDefinition['condition']['kind'], value: value.condition.value },
                cooldownTicks: typeof value.cooldownTicks === 'number' ? value.cooldownTicks : undefined,
                interrupt: typeof value.interrupt === 'boolean' ? value.interrupt : undefined,
                contextHint: typeof value.contextHint === 'string' ? value.contextHint : undefined,
                source: 'memory',
            },
            80,
        ),
    ];
}

function normalizeVariable(value: unknown): ProposedVariable[] {
    if (!isRecord(value) || typeof value.id !== 'string') {
        return [];
    }
    return [
        {
            id: value.id,
            initial: typeof value.initial === 'number' ? value.initial : undefined,
            expression: typeof value.expression === 'string' ? value.expression : undefined,
            min: typeof value.min === 'number' ? value.min : undefined,
            max: typeof value.max === 'number' ? value.max : undefined,
        },
    ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
