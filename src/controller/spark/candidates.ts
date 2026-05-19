import type { AgentAction, Perception } from '../transport/message-codecs';

export function generateFirstStepCandidates(perception: Perception, hookId?: string): AgentAction[] {
    const candidates: AgentAction[] = [{ kind: 'noop', cause: 'no_candidate' }];
    if (hookId === 'attention_empty') {
        return [{ kind: 'logout', cause: 'attention_exhausted' }];
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
    return candidates;
}

function hasEvent(value: unknown, kind: string): boolean {
    if (Array.isArray(value)) {
        return value.some(item => hasEvent(item, kind));
    }
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.kind === kind ||
        record.type === kind ||
        Object.values(record).some(item => Array.isArray(item) && item.some(child => hasEvent(child, kind)))
    );
}
