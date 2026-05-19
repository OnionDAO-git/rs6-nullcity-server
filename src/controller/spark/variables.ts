export type VariableContext = Record<string, number | boolean | string | undefined>;

export interface VariableDefinition {
    id: string;
    name?: string;
    initial?: string | number;
    expression?: string | number;
    increment?: string | number;
    decrement?: string | number;
    decay?: string | number;
    min?: string | number;
    max?: string | number;
    tick?: Array<{ op: 'set' | 'increment' | 'decrement' | 'decay' | 'clamp'; value?: string | number; min?: number; max?: number }>;
}

export function evaluateScalar(expression: string | number | undefined, context: VariableContext): number {
    if (typeof expression === 'number') {
        return expression;
    }

    if (!expression) {
        return 0;
    }

    const direct = Number(expression);
    if (Number.isFinite(direct)) {
        return direct;
    }

    const value = context[expression];
    if (typeof value === 'number') {
        return value;
    }

    return evaluateArithmetic(expression, context);
}

export function recomputeVariables(
    definitions: VariableDefinition[] | undefined,
    previous: Record<string, number> = {},
    context: VariableContext = {},
): Record<string, number> {
    const next = { ...previous };
    for (const definition of definitions || []) {
        const id = definition.id || definition.name;
        if (!id) {
            continue;
        }
        const mergedContext: VariableContext = { ...context, ...next };
        let value = next[id] ?? (definition.initial !== undefined ? evaluateScalar(definition.initial, mergedContext) : 0);
        if (definition.expression !== undefined) {
            value = evaluateScalar(definition.expression, mergedContext);
        }
        value += evaluateScalar(definition.increment, mergedContext);
        value -= evaluateScalar(definition.decrement, mergedContext);
        value -= evaluateScalar(definition.decay, mergedContext);

        for (const operation of definition.tick || []) {
            if (operation.op === 'set') {
                value = evaluateScalar(operation.value, { ...mergedContext, [id]: value });
            } else if (operation.op === 'increment') {
                value += evaluateScalar(operation.value, { ...mergedContext, [id]: value });
            } else if (operation.op === 'decrement' || operation.op === 'decay') {
                value -= evaluateScalar(operation.value, { ...mergedContext, [id]: value });
            } else if (operation.op === 'clamp') {
                value = clamp(value, operation.min ?? Number.NEGATIVE_INFINITY, operation.max ?? Number.POSITIVE_INFINITY);
            }
        }

        const min = definition.min === undefined ? Number.NEGATIVE_INFINITY : evaluateScalar(definition.min, mergedContext);
        const max = definition.max === undefined ? Number.POSITIVE_INFINITY : evaluateScalar(definition.max, mergedContext);
        next[id] = clamp(value, min, max);
    }

    return next;
}

function evaluateArithmetic(expression: string, context: VariableContext): number {
    if (!/^[\w\s.+\-*/()]+$/.test(expression)) {
        return 0;
    }

    const substituted = expression.replace(/\b[a-zA-Z_][\w-]*\b/g, token => {
        const value = context[token];
        return typeof value === 'number' && Number.isFinite(value) ? String(value) : '0';
    });

    try {
        const result = Function(`"use strict"; return (${substituted});`)() as unknown;
        return typeof result === 'number' && Number.isFinite(result) ? result : 0;
    } catch {
        return 0;
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
