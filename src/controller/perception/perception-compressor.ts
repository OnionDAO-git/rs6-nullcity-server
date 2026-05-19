import { estimateTokens } from '../util/token-count';
import { type PerceptionDelta, diffPerception } from './perception-diff';

export interface CompressedPerception {
    baseline?: unknown;
    delta: PerceptionDelta;
    hot: boolean;
    text: string;
}

export class PerceptionCompressor {
    private previous?: unknown;
    private baseline?: unknown;

    compress(next: unknown, maxTokens = 1600): CompressedPerception {
        if (!this.baseline) {
            this.baseline = next;
        }
        const delta = diffPerception(this.previous, next);
        const hot = hasHotEvent(next);
        let payload: CompressedPerception = {
            baseline: hot ? next : this.baseline,
            delta,
            hot,
            text: '',
        };
        payload.text = JSON.stringify(hot ? { current: next, delta } : { baseline: payload.baseline, delta });
        while (estimateTokens(payload.text) > maxTokens && payload.baseline) {
            payload = { ...payload, baseline: undefined, text: JSON.stringify(hot ? { current: next } : { delta }) };
            if (estimateTokens(payload.text) <= maxTokens) {
                break;
            }
            payload.text = payload.text.slice(Math.max(0, payload.text.length - maxTokens * 4));
            break;
        }

        this.previous = next;
        if (estimateTokens(payload.text) > maxTokens) {
            this.baseline = next;
        }
        return payload;
    }
}

function hasHotEvent(value: unknown): boolean {
    const hotKinds = new Set(['hit', 'died', 'death', 'chat', 'trade_request', 'attacked']);
    if (Array.isArray(value)) {
        return value.some(hasHotEvent);
    }
    if (!isRecord(value)) {
        return false;
    }
    const kind = typeof value.kind === 'string' ? value.kind : typeof value.type === 'string' ? value.type : '';
    if (hotKinds.has(kind)) {
        return true;
    }
    return Object.values(value).some(item => Array.isArray(item) && item.some(hasHotEvent));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
