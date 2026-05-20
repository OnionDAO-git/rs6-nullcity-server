import type { AgentAction, Perception } from '../transport/message-codecs';

export function generateFirstStepCandidates(perception: Perception, hookId?: string): AgentAction[] {
    const candidates: AgentAction[] = [];
    if (hookId === 'attention_empty') {
        return [{ kind: 'logout', cause: 'attention_exhausted' }];
    }
    const position = residentPosition(perception);
    if (position) {
        candidates.push({
            kind: 'move_to',
            target: { x: position.x + 1, y: position.y, level: position.level },
            cause: 'idle_step',
        });
    }
    if (hookId === 'addressed_by_chat' || hasEvent(perception, 'chat')) {
        candidates.push({ kind: 'say', text: 'I hear you.', cause: 'respond_to_chat' });
    }
    if (hookId === 'took_damage' || hasEvent(perception, 'hit')) {
        candidates.push({ kind: 'logout', cause: 'survive_damage' });
    }
    if (hookId === 'trade_request' || hasEvent(perception, 'trade_request')) {
        candidates.push({ kind: 'trade_decline', cause: 'trade_request' });
    }
    if (candidates.length === 0) {
        candidates.push({ kind: 'noop', cause: 'no_candidate' });
    }
    return candidates;
}

function residentPosition(value: unknown): { x: number; y: number; level: number } | undefined {
    if (!isRecord(value) || !isRecord(value.resident) || !isRecord(value.resident.position)) {
        return undefined;
    }

    const { x, y, level } = value.resident.position;
    if (typeof x !== 'number' || typeof y !== 'number') {
        return undefined;
    }

    return { x, y, level: typeof level === 'number' ? level : 0 };
}

function hasEvent(value: unknown, kind: string): boolean {
    if (Array.isArray(value)) {
        return value.some(item => hasEvent(item, kind));
    }
    if (!isRecord(value)) {
        return false;
    }
    return (
        value.kind === kind ||
        value.type === kind ||
        Object.values(value).some(item => Array.isArray(item) && item.some(child => hasEvent(child, kind)))
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
