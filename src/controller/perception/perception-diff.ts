export interface PerceptionDelta {
    changed: boolean;
    before?: unknown;
    after: unknown;
}

export function diffPerception(before: unknown, after: unknown): PerceptionDelta {
    return {
        changed: JSON.stringify(before) !== JSON.stringify(after),
        before,
        after,
    };
}
