import type { GameSkillContext } from '../knowledge/game-skill-context';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { ActiveGoalState, RuntimeState } from '../memory/runtime-state';
import type { HybridAgentBehaviorDefinition, Soul } from '../soul/soul-schema';
import type { LibraryUpdater } from '../evidence/library-updater';
import type { PlanStore } from '../intelligence/plan-store';
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

import { directChatAction, isChatRateLimited } from './hybrid-agent-chat';
import {
    SocialReplyCoordinator,
    SOCIAL_REPLY_GLOBAL_CAP,
    SOCIAL_REPLY_TEMPERATURE,
    SOCIAL_REPLY_EXPIRE_TICKS,
    detectSocialReply,
    buildReplyContext,
    buildReplyPrompt,
    formatReply,
    replyFallback,
} from './social-reply';

import {
    dialogueReaction,
    tradeReaction,
    combatReaction,
    combatNarrationAction,
    lowHealthRecoveryAction,
    lowHealthHoldPositionAction,
    presenceBeaconAction,
    agentKeepaliveAction,
    heroKeepaliveAction,
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
    tradeStarterAction,
} from './hybrid-agent-helpers';

export interface HybridAgentThinkingModuleOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
    planStore?: PlanStore;
    libraryUpdater?: LibraryUpdater;
    patronRegistry?: PatronRegistry;
}

const DEFAULT_BRAIN_EVERY_TICKS = 180;
const DEFAULT_BODY_EVERY_TICKS = 8;
// S-INFER-8: generous "inference server is broken" ALARM ceiling (~6x a real q4
// ~40s deliberation), NOT a thinking bound. A brain timeout firing is a RARE
// anomaly → investigate the inference server (src/controller/llm/inference-health.ts
// degradedFlags). Body timeout stays modest (body runs thinking-OFF / fast).
export const DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS = 240_000;
const DEFAULT_BODY_INFERENCE_TIMEOUT_MS = 10_000;
const DEFAULT_GOAL_SHARE_EVERY_TICKS = 120;
const REPEAT_ACTION_BACKOFF_TICKS = 30;
const WORLD_TICK_RESET_DRIFT = 60;
const CRITICAL_ATTENTION_BODY_THRESHOLD = 10;

export class HybridAgentThinkingModule implements ThinkingModule {
    private nextThinkId = 0;
    private readonly activeThinkIds = new Set<number>();
    private readonly cancelledThinkIds = new Map<number, string>();
    private readonly cancelledThinkResults = new Map<number, ThoughtResult>();
    private readonly inflightCompletions = new Map<number, AbortController>();
    private readonly socialReplyCoordinator = new SocialReplyCoordinator(SOCIAL_REPLY_GLOBAL_CAP);

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
                // Combat supersedes a pending/in-flight social reply — never compose a line while attacked.
                this.socialReplyCoordinator.abort(this.options.soul.frontmatter.name);
                const combatCognition = this.cognition();
                combatCognition.socialReplyInFlight = undefined;
                combatCognition.pendingSocialReply = undefined;
                return this.result(combat.actions, combat.cause, 0, false);
            }

            // Conversational reply (social-reply): emit a finished reply (if the asker is still present
            // and it isn't stale) before starting a new one; both run AFTER combat so danger wins.
            const socialEmit = this.maybeEmitSocialReply(perception as HybridPerception);
            if (socialEmit) {
                return socialEmit;
            }

            // A human player named us — fire a detached, off-loop inference and yield this tick (no freeze).
            const socialReply = this.maybeStartSocialReply(perception as HybridPerception);
            if (socialReply) {
                return socialReply;
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

            const residentBusy = (perception as HybridPerception).resident?.busy === true;
            const lowHealthRecovery = lowHealthRecoveryAction(this, perception as HybridPerception);
            if (lowHealthRecovery) {
                if (residentBusy && lowHealthRecovery.action.kind === 'move_to') {
                    return { actions: [], cause: 'resident_busy', nooped: true };
                }
                return this.result([lowHealthRecovery.action], lowHealthRecovery.cause, 0, false);
            }

            if (residentBusy) {
                return { actions: [], cause: 'resident_busy', nooped: true };
            }

            const lowHealthHold = lowHealthHoldPositionAction(this, perception as HybridPerception);
            if (lowHealthHold) {
                return this.result(lowHealthHold.actions, lowHealthHold.cause, 0, lowHealthHold.nooped);
            }

            const combatNarration = combatNarrationAction(this);
            if (combatNarration) {
                return this.result([combatNarration.action], combatNarration.cause, 0, false);
            }

            const starterTrade = tradeStarterAction(this, perception as HybridPerception);
            if (starterTrade) {
                return this.result([starterTrade.action], starterTrade.cause, 0, false);
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
                if (!brainDue || typeof this.options.state.stuckSince === 'number') {
                    const visibility = visibilityStatus(this, perception as HybridPerception);
                    const agentKeepalive = agentKeepaliveAction(this, perception as HybridPerception, visibility);
                    if (agentKeepalive) {
                        return this.result([agentKeepalive], 'agent_keepalive', 0, false);
                    }

                    const heroKeepalive = heroKeepaliveAction(this, perception as HybridPerception, visibility);
                    if (heroKeepalive) {
                        return this.result([heroKeepalive], 'hero_keepalive', 0, false);
                    }

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

    /**
     * Conversational reply — detection step. If a human player named this resident, fire a
     * DETACHED Body-profile inference (never awaited on the decision loop) and yield this tick.
     * The reply lands a few ticks later via commitSocialReply; the resident keeps acting.
     */
    /**
     * Conversational reply — emission step. Speaks a resolved pending reply, but only while it is
     * fresh AND the addressing player is still in perception (no answering empty air after the
     * 3-7-tick inference gap). Otherwise the pending reply is dropped. Records lastSocialReply for
     * the 1-turn follow-up.
     */
    private maybeEmitSocialReply(perception: HybridPerception): ThoughtResult | undefined {
        const cognition = this.cognition();
        const pending = cognition.pendingSocialReply;
        if (!pending) {
            return undefined;
        }
        const tick = this.options.state.tick;
        const askerPresent = (perception.nearby?.players || []).some(player => player.id === pending.speakerId);
        if (tick > pending.expiresAtTick || !askerPresent) {
            cognition.pendingSocialReply = undefined;
            return undefined;
        }
        cognition.pendingSocialReply = undefined;
        cognition.lastSocialReply = { text: pending.text, tick, speaker: pending.speakerId };
        return this.result([{ kind: 'say', text: pending.text, voiceSource: 'inference' }], 'social_reply_emit', 0, false);
    }

    private maybeStartSocialReply(perception: HybridPerception): ThoughtResult | undefined {
        const cognition = this.cognition();
        if (cognition.socialReplyInFlight) {
            return undefined;
        }
        const display = this.options.soul.frontmatter.display ?? displayName(this.options.soul.frontmatter.name);
        const detected = detectSocialReply(perception, cognition.lastDirectChatKey, display);
        if (!detected) {
            return undefined;
        }
        const currentTick = this.options.state.tick;
        const context = buildReplyContext({
            soul: this.options.soul,
            perception,
            activeGoalDescription: cognition.activeGoal?.description,
            speakerName: detected.speakerName,
            speakerId: detected.speakerId,
            chatText: detected.text,
            currentTick,
            lastReply: cognition.lastSocialReply,
        });
        // Rate-limit — but a same-speaker follow-up within the follow-up window bypasses it, so a
        // genuine back-and-forth conversation stays responsive instead of dropping the "why?" beat.
        // The window is re-stamped on each reply, so a sustained 1:1 exchange keeps bypassing; that
        // is intended and bounded by the per-resident in-flight gate + the coordinator cap (it is
        // NOT a single one-shot bypass).
        if (!context.bypassRateLimit && isChatRateLimited(this)) {
            cognition.lastDirectChatKey = detected.key;
            return undefined;
        }
        const slot = this.socialReplyCoordinator.admit(this.options.soul.frontmatter.name, detected.key);
        if (!slot) {
            cognition.lastDirectChatKey = detected.key;
            return undefined;
        }
        cognition.socialReplyInFlight = { key: detected.key, startedAtTick: currentTick };
        cognition.lastDirectChatKey = detected.key;
        (cognition.chatReplyTicks ||= []).push(currentTick);

        try {
            const profile = this.behavior().body;
            void this.options.llm
                .complete({
                    endpoint: this.endpointFor(profile),
                    prompt: buildReplyPrompt(context),
                    temperature: this.temperatureFor(profile, SOCIAL_REPLY_TEMPERATURE),
                    thinking: profile?.thinking ?? false,
                    timeoutMs: this.timeoutFor(profile, DEFAULT_BODY_INFERENCE_TIMEOUT_MS),
                    priority: 4,
                    signal: slot.controller.signal,
                    ...(this.modelFor(profile) ? { model: this.modelFor(profile) } : {}),
                })
                .then(response => this.commitSocialReply(detected.key, formatReply(response.text), detected.speakerId))
                .catch(() => this.commitSocialReply(detected.key, undefined, detected.speakerId));
        } catch {
            // A synchronous failure assembling/dispatching the request must NOT leave the slot
            // held — that would lock the resident out of all future social replies for its life.
            this.socialReplyCoordinator.settle(this.options.soul.frontmatter.name, detected.key);
            cognition.socialReplyInFlight = undefined;
        }

        return { actions: [], cause: 'social_reply_detection', nooped: true };
    }

    /**
     * Conversational reply — resolve step (off-loop). Re-reads the live cognition via
     * `this.cognition()` at resolve time (it does NOT close over the cognition seen at detection),
     * so the write lands on the current state object even if the runtime later swaps it. Checks
     * key-ownership (a superseded/aborted reply is a no-op), stamps freshness at resolve, settles once.
     */
    private commitSocialReply(key: string, text: string | undefined, speakerId: string): void {
        const name = this.options.soul.frontmatter.name;
        const cognition = this.cognition();
        if (cognition.socialReplyInFlight?.key !== key) {
            this.socialReplyCoordinator.settle(name, key);
            return;
        }
        const finalText = text ?? replyFallback(this.options.soul, key);
        cognition.pendingSocialReply = {
            text: finalText,
            expiresAtTick: this.options.state.tick + SOCIAL_REPLY_EXPIRE_TICKS,
            speakerId,
        };
        cognition.socialReplyInFlight = undefined;
        this.socialReplyCoordinator.settle(name, key);
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

    maxTokensFor(profile: any, fallback?: number): number | undefined {
        // S-INFER-2 (D1): a behavior profile maxTokens wins; otherwise the
        // caller's generous default. When this resolves to undefined the
        // LlmClient falls back to the endpoint config maxTokens (then the
        // server default), so the ceiling stays endpoint-configurable without
        // touching the soul schema.
        return profile?.maxTokens ?? fallback;
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
        if (this.activeGoal() && this.options.state.attention <= CRITICAL_ATTENTION_BODY_THRESHOLD) {
            return true;
        }
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
            // A world-tick reset wipes cognition (including socialReplyInFlight). Release any live
            // coordinator slot FIRST — otherwise the in-memory slot + counter outlive the marker and
            // the resident is permanently locked out of conversational replies. abort() is a safe
            // no-op when no slot is held and is key-owned so it can't double-free.
            this.socialReplyCoordinator.abort(this.options.soul.frontmatter.name);
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
