import type { GameSkillContext } from '../knowledge/game-skill-context';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { ActiveGoalState, RuntimeState } from '../memory/runtime-state';
import type { HybridAgentBehaviorDefinition, Soul } from '../soul/soul-schema';
import type { AgentAction, Perception } from '../transport/message-codecs';
import { PatronRegistry } from '../patron/patron-registry';
import type { ThinkingModule, ThoughtResult } from './thinking-module';
import { pickPhrase } from '../soul/phrasebook';

import {
    positionLike,
    type Pos,
    type HybridPerception,
    isMoveTo,
    displayName,
    normalizeText,
    positionKey,
    withoutTargetFailedPerception,
    resetClockSensitiveCognition,
} from './hybrid-agent-utils';

import { directChatAction } from './hybrid-agent-chat';

import {
    dialogueReaction,
    tradeReaction,
    combatReaction,
    combatNarrationAction,
    lowHealthRecoveryAction,
    lowHealthHoldPositionAction,
    presenceBeaconAction,
    activeFollowAction,
    followListenHoldAction,
    visibilityStatus,
    preInferenceBodyAction,
    applyBrainTimeoutFallback,
    observeCompletedLocalGoal,
    promptMemories,
    promptMemorySection,
    ensureBenchmarkGoal,
    ensureFactionLandmarkGoal,
    runBrain,
    runBody,
    clearGoalMomentum,
    rememberBodyAction,
    rememberActiveMove,
    isRepeatedAction,
    suppressRepeatedActions,
    pendingDirectTradeAction,
    proactiveTradeAction,
} from './hybrid-agent-helpers';

export interface HybridAgentThinkingModuleOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
    patronRegistry?: PatronRegistry;
}

const DEFAULT_BRAIN_EVERY_TICKS = 180;
const DEFAULT_BODY_EVERY_TICKS = 8;
const DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS = 20_000;
const DEFAULT_BODY_INFERENCE_TIMEOUT_MS = 10_000;
const DEFAULT_GOAL_SHARE_EVERY_TICKS = 120;
const REPEAT_ACTION_BACKOFF_TICKS = 30;
const WORLD_TICK_RESET_DRIFT = 60;

export class HybridAgentThinkingModule implements ThinkingModule {
    private nextThinkId = 0;
    private readonly activeThinkIds = new Set<number>();
    private readonly cancelledThinkIds = new Map<number, string>();
    private readonly cancelledThinkResults = new Map<number, ThoughtResult>();
    private readonly inflightCompletions = new Map<number, AbortController>();

    constructor(public readonly options: HybridAgentThinkingModuleOptions) {}

    async think(perception: Perception, gameSkill?: GameSkillContext): Promise<ThoughtResult> {
        const thinkId = ++this.nextThinkId;
        this.activeThinkIds.add(thinkId);
        let brainDecision: any;
        try {
            this.advanceTick(perception);
            this.cognition().tickTelemetry = undefined;
            ensureBenchmarkGoal(this);
            ensureFactionLandmarkGoal(this);
            observeCompletedLocalGoal(this, perception as HybridPerception);
            const cognition = this.cognition();
            let resumeSay: AgentAction | undefined;
            if (cognition.waitResumeTick !== undefined && this.options.state.tick >= cognition.waitResumeTick) {
                cognition.waitResumeTick = undefined;
                if (cognition.pausedGoal) {
                    cognition.activeGoal = cognition.pausedGoal;
                    cognition.pausedGoal = undefined;
                }
                if (cognition.pausedFollowTarget) {
                    cognition.followTarget = cognition.pausedFollowTarget;
                    cognition.pausedFollowTarget = undefined;
                }
                resumeSay = {
                    kind: 'say',
                    text: pickPhrase({
                        soul: this.options.soul,
                        situation: 'direct_chat_wait.resume',
                        seed: `${this.options.state.tick}`,
                    }),
                    voiceSource: 'phrasebook',
                };
            }

            if (resumeSay) {
                const combat = combatReaction(this, perception as HybridPerception);
                if (combat) {
                    return this.result([...combat.actions, resumeSay], combat.cause, 0, false);
                }
                return this.result([resumeSay], 'direct_chat_wait_resume', 0, false);
            }

            const directChat = await directChatAction(this, perception as HybridPerception, thinkId, { includeSmallTalk: false });
            const directChatCancellation = this.cancelledResult(thinkId, perception as HybridPerception);
            if (directChatCancellation) {
                return directChatCancellation;
            }
            if (directChat) {
                const actions = directChat.prefaceActions ? [...directChat.prefaceActions, directChat.action] : [directChat.action];
                return this.result(actions, directChat.cause, 0, false);
            }

            const combat = combatReaction(this, perception as HybridPerception);
            if (combat) {
                return this.result(combat.actions, combat.cause, 0, false);
            }

            if (cognition.waitResumeTick !== undefined) {
                const beacon = presenceBeaconAction(this, perception as HybridPerception);
                if (beacon) {
                    return this.result([beacon], 'presence_beacon', 0, false);
                }
                return { actions: [], cause: 'wait_hold', nooped: true };
            }

            const dialogue = dialogueReaction(this, perception as HybridPerception);
            if (dialogue) {
                return this.result([dialogue.action], dialogue.cause, 0, false);
            }

            const trade = tradeReaction(this, perception as HybridPerception);
            if (trade) {
                return this.result([trade.action], trade.cause, 0, false);
            }

            const pendingDirectTrade = pendingDirectTradeAction(this, perception as HybridPerception);
            if (pendingDirectTrade) {
                return this.result([pendingDirectTrade.action], pendingDirectTrade.cause, 0, false);
            }

            const proactiveTrade = proactiveTradeAction(this, perception as HybridPerception);
            if (proactiveTrade) {
                return this.result([proactiveTrade.action], proactiveTrade.cause, 0, false);
            }

            if ((perception as HybridPerception).resident?.busy) {
                return { actions: [], cause: 'resident_busy', nooped: true };
            }

            const lowHealthRecovery = lowHealthRecoveryAction(this, perception as HybridPerception);
            if (lowHealthRecovery) {
                return this.result([lowHealthRecovery.action], lowHealthRecovery.cause, 0, false);
            }

            const lowHealthHold = lowHealthHoldPositionAction(this, perception as HybridPerception);
            if (lowHealthHold) {
                return this.result(lowHealthHold.actions, lowHealthHold.cause, 0, lowHealthHold.nooped);
            }

            const combatNarration = combatNarrationAction(this);
            if (combatNarration) {
                return this.result([combatNarration.action], combatNarration.cause, 0, false);
            }

            const activeFollow = activeFollowAction(this, perception as HybridPerception);
            if (activeFollow) {
                return this.result([activeFollow.action], activeFollow.cause, 0, false);
            }

            const followHold = followListenHoldAction(this, perception as HybridPerception);
            if (followHold) {
                return this.result(followHold.actions, followHold.cause, 0, followHold.nooped);
            }

            const brainDue = this.shouldRunBrain();
            if (this.shouldRunBody()) {
                if (!brainDue) {
                    const presenceBeacon = presenceBeaconAction(this, perception as HybridPerception);
                    if (presenceBeacon) {
                        return this.result([presenceBeacon], 'presence_beacon', 0, false);
                    }
                }

                const bodyPerception = withoutTargetFailedPerception(
                    perception as HybridPerception,
                    this.cognition().targetFailureCooldowns,
                    this.options.state.tick,
                );
                const visibility = visibilityStatus(this, bodyPerception);
                const preInference = preInferenceBodyAction(this, bodyPerception, visibility);
                if (preInference) {
                    return this.result(preInference.actions, preInference.cause || 'body_step', 0, preInference.nooped);
                }
            }

            if (!this.activeGoal() || !this.shouldRunBody()) {
                const smallTalk = await directChatAction(this, perception as HybridPerception, thinkId, { includeSmallTalk: true });
                const smallTalkCancellation = this.cancelledResult(thinkId, perception as HybridPerception);
                if (smallTalkCancellation) {
                    return smallTalkCancellation;
                }
                if (smallTalk) {
                    const actions = smallTalk.prefaceActions ? [...smallTalk.prefaceActions, smallTalk.action] : [smallTalk.action];
                    return this.result(actions, smallTalk.cause, 0, false);
                }
            }

            if (brainDue) {
                const brain = await runBrain(this, perception, gameSkill, thinkId);
                const brainCancellation = this.cancelledResult(thinkId, perception as HybridPerception);
                if (brainCancellation) {
                    return brainCancellation;
                }
                brainDecision = brain;
                if (brain.action) {
                    return this.result([brain.action], brain.cause, brain.envelopeTokens, brain.nooped, {
                        memoUpdates: brain.memoUpdates,
                        planChange: brain.planChange,
                    });
                }
            }

            if (!this.shouldRunBody()) {
                return this.result(
                    [],
                    brainDecision?.cause || 'body_wait',
                    brainDecision?.envelopeTokens || 0,
                    brainDecision?.nooped ?? true,
                    {
                        memoUpdates: brainDecision?.memoUpdates,
                        planChange: brainDecision?.planChange,
                    },
                );
            }

            const bodyResult = await runBody(this, perception, gameSkill, thinkId);
            const bodyCancellation = this.cancelledResult(thinkId, perception as HybridPerception);
            if (bodyCancellation) {
                return bodyCancellation;
            }
            return this.result(
                bodyResult.actions,
                bodyResult.cause || 'body_step',
                (bodyResult.envelopeTokens || 0) + (brainDecision?.envelopeTokens || 0),
                bodyResult.nooped,
                {
                    memoUpdates: brainDecision?.memoUpdates,
                    planChange: brainDecision?.planChange,
                },
            );
        } finally {
            this.activeThinkIds.delete(thinkId);
            this.cancelledThinkIds.delete(thinkId);
            this.cancelledThinkResults.delete(thinkId);
            this.inflightCompletions.delete(thinkId);
        }
    }

    considerInterrupt(_perception: Perception): boolean {
        return false;
    }

    stop(cause: string): void {
        for (const thinkId of this.activeThinkIds) {
            this.cancelledThinkIds.set(thinkId, cause);
            this.inflightCompletions.get(thinkId)?.abort(cause);
        }
    }

    onWatchdogTimeout(perception: Perception): ThoughtResult | undefined {
        let fallback: ThoughtResult | undefined;
        for (const thinkId of this.activeThinkIds) {
            if (!this.cancelledThinkIds.has(thinkId)) {
                this.cancelledThinkIds.set(thinkId, 'thinking_watchdog_timeout');
            }
            const result = this.cancelledResult(thinkId, perception as HybridPerception);
            fallback ||= result;
        }
        return fallback;
    }

    complete(thinkId: number, request: Omit<LlmRequest, 'signal'>): Promise<LlmResponse> {
        const cancelled = this.cancelledThinkIds.get(thinkId);
        if (cancelled) {
            return Promise.resolve({ text: '', nooped: true, cancelledBy: cancelled });
        }
        const controller = new AbortController();
        this.inflightCompletions.set(thinkId, controller);
        return this.options.llm.complete({ ...request, signal: controller.signal }).finally(() => {
            if (this.inflightCompletions.get(thinkId) === controller) {
                this.inflightCompletions.delete(thinkId);
            }
        });
    }

    cancelledResult(thinkId: number, perception?: HybridPerception): ThoughtResult | undefined {
        const existing = this.cancelledThinkResults.get(thinkId);
        if (existing) return existing;
        const cause = this.cancelledThinkIds.get(thinkId);
        if (!cause) return undefined;
        const planChange = cause === 'thinking_watchdog_timeout' ? applyBrainTimeoutFallback(this, perception) : undefined;
        const result = { actions: [], syntheticEvents: [], cause, envelopeTokens: 0, nooped: true, planChange };
        this.cancelledThinkResults.set(thinkId, result);
        return result;
    }

    commandPrefix(): string {
        return normalizeText(this.behavior().commandPrefix || displayName(this.options.soul.frontmatter.name));
    }

    behavior(): HybridAgentBehaviorDefinition {
        const behavior = this.options.soul.frontmatter.behavior;
        return behavior?.kind === 'hybrid-agent' ? behavior : { kind: 'hybrid-agent' };
    }

    activeGoal(): ActiveGoalState | undefined {
        const goal = this.cognition().activeGoal;
        return goal && (goal.ttlTicks === undefined || this.options.state.tick - goal.createdAtTick <= goal.ttlTicks) ? goal : undefined;
    }

    pickupCooldowns(): Record<string, number> {
        return (this.cognition().pickupCooldowns ||= {});
    }

    explorationCooldowns(): Record<string, number> {
        return (this.cognition().explorationCooldowns ||= {});
    }

    clearGoalMomentum(): void {
        clearGoalMomentum(this);
    }

    rememberBodyAction(action: AgentAction): void {
        rememberBodyAction(this, action);
    }

    rememberActiveMove(action: AgentAction, here: Pos): void {
        rememberActiveMove(this, action, here);
    }

    isRepeatedAction(action: AgentAction): boolean {
        return isRepeatedAction(this, action);
    }

    heroLandmarkAnchor(): Pos | undefined {
        const anchor = this.options.soul.frontmatter.heroProfile?.anchor;
        return anchor ? { x: anchor[0], y: anchor[1], level: anchor[2] } : this.visibilityAnchor();
    }

    visibilityAnchor(): Pos | undefined {
        const configured = this.behavior().visibilityAnchor || positionLike(this.options.soul.frontmatter.spawnPosition);
        return configured ? { x: configured.x, y: configured.y, level: configured.level ?? 0 } : undefined;
    }

    endpointFor(profile?: any): string {
        return profile?.endpoint || this.options.soul.frontmatter.model?.endpoint || 'default';
    }

    temperatureFor(profile: any, fallback: number): number {
        return profile?.temperature ?? this.options.soul.frontmatter.model?.temperature ?? fallback;
    }

    timeoutFor(profile: any, fallback?: number): number | undefined {
        return profile?.timeoutMs ?? fallback;
    }

    modelFor(profile?: any): string | undefined {
        return profile?.model || this.options.soul.frontmatter.model?.model;
    }

    promptMemories(perception: HybridPerception, role: 'brain' | 'body'): string[] {
        return promptMemories(this, perception, role);
    }

    promptMemorySection(memories: string[], role: 'brain' | 'body'): string {
        return promptMemorySection(memories, role);
    }

    visibilityStatus(perception: Perception): { anchor?: Pos; returnDue: boolean } {
        return visibilityStatus(this, perception);
    }

    deferVisibilityAnchorReturn(): void {
        this.cognition().lastAnchorReturnTick = this.options.state.tick;
    }

    suppressRepeatedActions(actions: AgentAction[]): AgentAction[] {
        return suppressRepeatedActions(this, actions);
    }

    combatReaction(perception: HybridPerception): { actions: AgentAction[]; cause: string } | undefined {
        return combatReaction(this, perception);
    }

    tradeReaction(perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
        return tradeReaction(this, perception);
    }

    private shouldRunBrain(): boolean {
        const cognition = this.cognition();
        if (typeof cognition.brainBackoffUntilTick === 'number' && this.options.state.tick < cognition.brainBackoffUntilTick) {
            return false;
        }

        const goal = this.activeGoal();
        if (!goal) {
            return true;
        }
        return this.options.state.tick - (cognition.lastBrainTick || 0) >= (this.behavior().brainEveryTicks ?? DEFAULT_BRAIN_EVERY_TICKS);
    }

    private shouldRunBody(): boolean {
        return (
            this.options.state.tick - (this.cognition().lastBodyTick || 0) >= (this.behavior().bodyEveryTicks ?? DEFAULT_BODY_EVERY_TICKS)
        );
    }

    cognition() {
        return (this.options.state.cognition ||= {});
    }

    private advanceTick(perception: Perception): void {
        const perceptionTick = typeof perception.tick === 'number' ? perception.tick : 0;
        if (perceptionTick > 0 && this.options.state.tick - perceptionTick > WORLD_TICK_RESET_DRIFT) {
            resetClockSensitiveCognition(this.options.state, perceptionTick);
            this.options.state.tick = perceptionTick;
            return;
        }
        this.options.state.tick = Math.max(this.options.state.tick + 1, perceptionTick);
    }

    private result(
        actions: AgentAction[],
        cause: string,
        envelopeTokens: number,
        nooped: boolean,
        extra: Partial<ThoughtResult> = {},
    ): ThoughtResult {
        const telemetry = this.cognition().tickTelemetry;
        return {
            actions,
            cause,
            envelopeTokens,
            nooped: nooped || actions.length === 0,
            ...telemetry,
            ...extra,
        };
    }
}
