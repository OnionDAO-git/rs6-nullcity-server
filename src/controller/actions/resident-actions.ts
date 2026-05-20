import type { ResidentBody } from '../body/body';
import type { BodyWaitResult } from '../body/body-events';
import type { Perception, PerceptionEvent } from '../transport/message-codecs';
import type { ActionAttempt, ActionEvidence, EffectWaitResult } from './action-attempt';
import type { ActionCoordinator } from './action-coordinator';

export interface ResidentActionsOptions {
    body: ResidentBody;
    coordinator: ActionCoordinator;
}

export interface ResidentActionOptions {
    timeoutMs?: number;
    cause?: string;
    traceId?: string;
    signal?: AbortSignal;
}

export interface Position {
    x: number;
    y: number;
    level?: number;
}

export class ResidentActions {
    constructor(private readonly options: ResidentActionsOptions) {}

    walkTo(target: Position, options: ResidentActionOptions = {}): Promise<ActionAttempt> {
        const afterSeq = this.options.body.getLatestPerceptionSeq();
        const timeoutMs = options.timeoutMs ?? 5000;
        return this.options.coordinator.submit({
            producer: 'active-routine',
            action: { kind: 'move_to', target },
            cause: options.cause || 'walk_to_effect_wait',
            traceId: options.traceId,
            metadata: this.actionMetadata(options.cause || 'walk_to_effect_wait'),
            waitForEffect: async () =>
                perceptionWaitToEffect(
                    await this.options.body.waitForPerception(perception => positionMatches(perceptionPosition(perception), target), {
                        afterSeq,
                        timeoutMs,
                        signal: options.signal,
                    }),
                    perception => ({
                        source: 'perception',
                        detail: { kind: 'position_reached', position: perceptionPosition(perception) },
                    }),
                ),
        });
    }

    say(text: string, options: ResidentActionOptions = {}): Promise<ActionAttempt> {
        const afterSeq = this.options.body.getLatestEventSeq();
        const timeoutMs = options.timeoutMs ?? 3000;
        return this.options.coordinator.submit({
            producer: 'active-routine',
            action: { kind: 'say', text },
            cause: options.cause || 'say_effect_wait',
            traceId: options.traceId,
            metadata: this.actionMetadata(options.cause || 'say_effect_wait'),
            waitForEffect: async () =>
                eventWaitToEffect(
                    await this.options.body.waitForEvent(event => event.kind === 'chat' && event.text === text, {
                        afterSeq,
                        timeoutMs,
                        signal: options.signal,
                    }),
                    event => ({
                        source: 'event',
                        detail: { kind: 'chat_observed', text: event.text },
                    }),
                ),
        });
    }

    private actionMetadata(cause: string): { tick: number; source: 'body'; cause: string } {
        const perception = this.options.body.getLatestPerception();
        return {
            tick: typeof perception?.tick === 'number' ? perception.tick : 0,
            source: 'body',
            cause,
        };
    }
}

function perceptionWaitToEffect(wait: BodyWaitResult<Perception>, evidence: (perception: Perception) => ActionEvidence): EffectWaitResult {
    if (!wait.ok) {
        return { ok: false, reason: wait.reason };
    }
    return { ok: true, evidence: [evidence(wait.observation.value)] };
}

function eventWaitToEffect(wait: BodyWaitResult<PerceptionEvent>, evidence: (event: PerceptionEvent) => ActionEvidence): EffectWaitResult {
    if (!wait.ok) {
        return { ok: false, reason: wait.reason };
    }
    return { ok: true, evidence: [evidence(wait.observation.value)] };
}

function perceptionPosition(perception: Perception): Position | undefined {
    const resident = record(perception.resident);
    const position = record(resident.position);
    if (typeof position.x !== 'number' || typeof position.y !== 'number') {
        return undefined;
    }
    return {
        x: position.x,
        y: position.y,
        level: typeof position.level === 'number' ? position.level : undefined,
    };
}

function positionMatches(position: Position | undefined, target: Position): boolean {
    return (
        Boolean(position) &&
        position?.x === target.x &&
        position.y === target.y &&
        (target.level === undefined || position.level === target.level || position.level === undefined)
    );
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
