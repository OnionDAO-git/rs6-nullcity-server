export interface BodyObservation<TValue> {
    seq: number;
    observedAt: number;
    value: TValue;
}

export interface BodyWaitOptions {
    timeoutMs: number;
    afterSeq?: number;
    includeCurrent?: boolean;
    signal?: AbortSignal;
}

export type BodyWaitResult<TValue> = { ok: true; observation: BodyObservation<TValue> } | { ok: false; reason: 'timeout' | 'aborted' };

export type BodyObservationPredicate<TValue> = (value: TValue, observation: BodyObservation<TValue>) => boolean;
