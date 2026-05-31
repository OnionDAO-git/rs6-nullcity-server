import { createHash } from 'crypto';
import { admitInference, defaultInferenceBudget } from '../llm/budgets';
import { parseCompletion, type ParsedCompletion } from '../llm/completion-parser';
import type { LlmClient } from '../llm/llm-client';
import { Mailbox } from '../llm/mailbox';
import { buildPromptEnvelope } from '../llm/prompt-envelope';
import type { EndTickReason, TrajectoryBuilder } from '../evidence';
import { readHooksMd, retireHooksMd, upsertHooksMd } from '../memory/hooks-md';
import type { MemoryStore } from '../memory/memory-store';
import { type RuntimeState, markDeceased } from '../memory/runtime-state';
import { retireNervousRulesMd, upsertNervousRulesMd } from '../nervous-system/rules-md';
import type { Soul } from '../soul/soul-schema';
import type { AgentAction, Perception, PerceptionEvent } from '../transport/message-codecs';
import { estimateTokens } from '../util/token-count';
import { spendAttention, spendForAction, spendForLlm } from './attention';
import { generateFirstStepCandidates } from './candidates';
import { HookEvaluator } from './hook-evaluator';
import { type HookDefinition, clampHookPriority, systemHooks } from './hooks';
import { LegacyTracker } from './legacy';
import { type SparkModeState, idleMode } from './modes';
import { type Plan, type PlanIntent, installPlan, remainingIntent } from './plan';
import { PlanExecutor } from './plan-executor';
import {
    EXPLORATION_TARGET_COOLDOWN_TICKS,
    PICKUP_TARGET_COOLDOWN_TICKS,
    type BodyActor,
    type BodyPos,
    type BodyWorldItem,
    explorationActorCooldownKey,
    explorationActorFamilyCooldownKey,
    explorationItemCooldownKey,
    explorationObjectCooldownKey,
    explorationPatrolCooldownKey,
    factionLandmarkWorkAction,
    pickupItemKey,
} from './runescape-body-routines';
import { type VariableDefinition, recomputeVariables } from './variables';
import { HERO_TIERS } from '../residents/hero-tier';

const IDLE_INITIATIVE_FIRST_TICK = 120;
const IDLE_INITIATIVE_INTERVAL_TICKS = 120;
const IDLE_INITIATIVE_INTERVAL_MS = 45_000;
const HERO_IDLE_INITIATIVE_INTERVAL_MS = 12_000;
const DEFAULT_SPARK_INFERENCE_TIMEOUT_MS = 75_000;

export interface SparkTickResult {
    actions: AgentAction[];
    cause?: string;
    envelopeTokens?: number;
    nooped: boolean;
    syntheticEvents?: PerceptionEvent[];
    memoUpdates?: number;
    planChange?: unknown;
    chat_reply_emitted?: boolean;
    chat_reply_kind?: 'small_talk' | 'clarifying_question' | 'polite_decline';
    refusalReason?: string;
    chat_reply_suppressed?: 'rate_limited' | 'budget_exhausted';
    voiceSource?: 'phrasebook' | 'inference' | 'scripted';
}

export interface SparkOptions {
    evidence?: TrajectoryBuilder;
    /**
     * Identity of the SPARK module driving this Spark instance. Recorded on
     * every `decision` trajectory line so downstream consumers can attribute
     * inference to a specific reviewed module. Set by `runtime-facets` when
     * resolving the soul's selected module stack.
     */
    moduleIdentity?: { id: string; version: string };
}

export class Spark {
    private readonly hooks = new HookEvaluator();
    private readonly mailbox = new Mailbox();
    private readonly planExecutor = new PlanExecutor();
    private readonly legacy: LegacyTracker;
    private mode: SparkModeState = idleMode('startup');
    private activePlan?: Plan;

    constructor(
        private readonly soul: Soul,
        private readonly state: RuntimeState,
        private readonly memory: MemoryStore,
        private readonly llm: LlmClient,
        private readonly options: SparkOptions = {},
    ) {
        this.legacy = new LegacyTracker(soul, state);
    }

    async tick(perception: Perception): Promise<SparkTickResult> {
        this.state.tick += 1;
        let endReason: EndTickReason = 'tick_complete';
        this.options.evidence?.beginTick(this.state.tick, perception);
        try {
            this.state.attention = spendAttention(
                this.state.attention,
                this.soul.frontmatter.attentionProfile?.decayCurve || 'standard',
                1,
                this.soul.frontmatter.attentionProfile?.floor,
            );
            this.state.variables = recomputeVariables(this.variableDefinitions(), this.state.variables, {
                attention: this.state.attention,
                tick: this.state.tick,
            });

            const legacyUpdate = this.legacy.update(perception);
            if (legacyUpdate.complete) {
                endReason = 'legacy_complete';
                this.options.evidence?.recordLegacy({ cause: legacyUpdate.cause || 'legacy_complete', state: this.state.legacy });
                return {
                    actions: [{ kind: 'logout', cause: legacyUpdate.cause || 'legacy_complete' }],
                    cause: legacyUpdate.cause || 'legacy_complete',
                    nooped: false,
                };
            }

            const memoryDir = this.memory.ensureResident(this.soul.frontmatter.name);
            const [winner] = this.hooks.evaluate(this.allHooks(memoryDir), this.state, perception, this.state.variables);
            this.options.evidence?.recordHook(winner ?? null);
            if (winner?.cause === 'attention_exhausted' || this.state.attention <= 0) {
                markDeceased(this.state, 'attention_exhausted');
                endReason = 'attention_exhausted';
                return {
                    actions: [{ kind: 'logout', cause: 'attention_exhausted' }],
                    cause: 'attention_exhausted',
                    nooped: false,
                };
            }

            let planned = this.advancePlan(perception, winner?.priority ?? -1);
            if (planned) {
                const tier = this.soul.frontmatter.heroProfile?.tier ?? 'background';
                const tierConfig = HERO_TIERS[tier];
                const validActions = planned.actions.filter(action => {
                    if (action.kind === 'trade_resource' && !tierConfig.canTradeResource) {
                        return false;
                    }
                    if (action.kind === 'request_attention' && !tierConfig.canRequestAttention) {
                        return false;
                    }
                    if (action.kind === 'prepare_epitaph' && !tierConfig.canPrepareEpitaph) {
                        return false;
                    }
                    return true;
                });
                if (validActions.length !== planned.actions.length) {
                    planned = {
                        ...planned,
                        actions: validActions,
                        nooped: validActions.length === 0,
                        syntheticEvents: [
                            ...(planned.syntheticEvents || []),
                            {
                                kind: 'nervous_system_decline',
                                reason: `Tier '${tier}' does not permit gated action`,
                            } as any,
                        ],
                    };
                }
                endReason = 'plan_continuation';
                this.options.evidence?.recordPlan({ cause: planned.cause, actionKinds: planned.actions.map(action => action.kind) });
                return planned;
            }

            if (!winner || winner.priority <= 0) {
                const idleInitiative = this.idleInitiative(perception);
                if (idleInitiative) {
                    endReason = 'idle_initiative';
                    return idleInitiative;
                }

                endReason = 'hook_noop';
                return { actions: [], cause: 'hook_noop', nooped: true };
            }

            const budget = admitInference(this.state, defaultInferenceBudget());
            if (!budget.ok) {
                this.options.evidence?.recordBudget(budget);
                endReason = `budget_exhausted:${budget.window || 'unknown'}`;
                return {
                    actions: [],
                    cause: `budget_exhausted:${budget.window}`,
                    nooped: true,
                    syntheticEvents: [
                        {
                            kind: 'budget_exhausted',
                            window: budget.window,
                            retryAt: budget.retryAt?.toISOString(),
                            tick: this.state.tick,
                        },
                    ],
                };
            }

            if (this.activePlan) {
                this.state.previousIntent = remainingIntent(this.activePlan);
                this.activePlan = undefined;
            }

            const request = this.mailbox.start(`${this.soul.frontmatter.name}:${this.state.tick}:${winner.id}`);
            this.mode = { mode: 'deciding', changedAt: new Date(), cause: winner.cause };

            const memories = this.memory.retrieve(this.soul.frontmatter.name, winner.cause);
            const candidates = generateFirstStepCandidates(perception);
            const envelope = buildPromptEnvelope({
                soul: this.soul,
                perception,
                memories,
                candidates,
                triggerContext: winner.contextHint,
                previousIntent: this.state.previousIntent as PlanIntent | undefined,
                variables: this.state.variables,
                legacy: this.legacy.read(),
            });

            const response = await this.llm
                .complete({
                    endpoint: this.soul.frontmatter.model?.endpoint || 'default',
                    prompt: envelope,
                    temperature: this.soul.frontmatter.model?.temperature,
                    thinking: this.soul.frontmatter.model?.thinking,
                    signal: request.controller.signal,
                    timeoutMs: this.soul.frontmatter.model?.timeoutMs ?? DEFAULT_SPARK_INFERENCE_TIMEOUT_MS,
                    priority: winner.priority,
                    ...(this.soul.frontmatter.model?.model ? { model: this.soul.frontmatter.model.model } : {}),
                })
                .then(value => {
                    this.mailbox.finish(request.id, value);
                    return value;
                })
                .catch(error => {
                    this.mailbox.finish(request.id, undefined, error);
                    throw error;
                });

            this.mode = idleMode('decision_complete');
            this.state.attention = spendForLlm(
                this.state.attention,
                response.cancelledBy ? 'aborted' : response.nooped ? 'nooped' : 'complete',
                this.soul.frontmatter.attentionProfile?.floor,
            );

            const parsed = parseCompletion(response.text);
            if (!parsed.ok) {
                this.state.attention = spendForLlm(this.state.attention, 'failed', this.soul.frontmatter.attentionProfile?.floor);
                endReason = 'parse_failed';
                this.options.evidence?.recordDecision({
                    cause: parsed.cause,
                    moduleId: this.options.moduleIdentity?.id,
                    moduleVersion: this.options.moduleIdentity?.version,
                    promptHash: sha256(envelope),
                    completionHash: sha256(response.text),
                    promptTokens: estimateTokens(envelope),
                    completionTokens: estimateTokens(response.text),
                    actionKinds: [],
                });
                return { actions: [], cause: parsed.cause, envelopeTokens: estimateTokens(envelope), nooped: true };
            }

            for (const memo of parsed.memo || []) {
                this.memory.write(this.soul.frontmatter.name, memo.path, memo.text, memo.mode || 'append');
            }
            if (parsed.indexPatch?.append?.length) {
                this.memory.upsertIndexPatch(this.soul.frontmatter.name, parsed.indexPatch.append.join('\n'));
            }
            if (parsed.retireHook?.length) {
                retireHooksMd(memoryDir, parsed.retireHook);
            }
            if (parsed.retireNervousRule?.length) {
                retireNervousRulesMd(memoryDir, parsed.retireNervousRule);
            }
            if (parsed.proposeHook?.length || parsed.proposeVariables?.length) {
                upsertHooksMd(memoryDir, {
                    hooks: parsed.proposeHook,
                    variables: parsed.proposeVariables,
                });
            }
            if (parsed.proposeNervousRule?.length) {
                upsertNervousRulesMd(memoryDir, {
                    rules: parsed.proposeNervousRule,
                });
            }

            let actions = replaceNoopWithCandidate(parsed.actions, candidates);
            let decisionCause = parsed.cause;
            let actionsAlreadySpent = false;
            if (parsed.plan) {
                this.activePlan = installPlan(parsed.plan, this.state.tick, this.state.previousIntent as PlanIntent | undefined);
                this.mode = { mode: 'executing', changedAt: new Date(), cause: parsed.cause };
                const next = this.planExecutor.tick(this.activePlan, { tick: this.state.tick, perception });
                actions = next.action ? replaceNoopWithCandidate([next.action], candidates) : [];
            }

            const syntheticEvents: PerceptionEvent[] = [];
            const tier = this.soul.frontmatter.heroProfile?.tier ?? 'background';
            const tierConfig = HERO_TIERS[tier];
            actions = actions.filter(action => {
                if (action.kind === 'trade_resource' && !tierConfig.canTradeResource) {
                    syntheticEvents.push({
                        kind: 'nervous_system_decline',
                        reason: `Tier '${tier}' does not permit trade_resource`,
                    } as any);
                    return false;
                }
                if (action.kind === 'request_attention' && !tierConfig.canRequestAttention) {
                    syntheticEvents.push({
                        kind: 'nervous_system_decline',
                        reason: `Tier '${tier}' does not permit request_attention`,
                    } as any);
                    return false;
                }
                if (action.kind === 'prepare_epitaph' && !tierConfig.canPrepareEpitaph) {
                    syntheticEvents.push({
                        kind: 'nervous_system_decline',
                        reason: `Tier '${tier}' does not permit prepare_epitaph`,
                    } as any);
                    return false;
                }
                return true;
            });
            if (isEmptyParsedCompletion(parsed, actions)) {
                if (response.cancelledBy) {
                    // S-INFER-2 (D2 / bucket C): the completion is empty because
                    // the think was CANCELLED mid-flight (a reflex interrupt, the
                    // watchdog, attention exhaustion, or a request timeout) — NOT
                    // because the model produced no decision. Record it as
                    // `thinking_cancelled` (carrying the cancel reason) so the
                    // live breakdown never folds an interrupted think into the
                    // empty_completion buckets and inflates the "no decision" rate.
                    decisionCause = cancelledDecisionCause(response.cancelledBy);
                    const idleInitiative = this.idleInitiative(perception);
                    if (idleInitiative) {
                        actions = idleInitiative.actions;
                        actionsAlreadySpent = true;
                        endReason = 'idle_initiative';
                    }
                } else {
                    const idleInitiative = this.idleInitiative(perception);
                    if (idleInitiative) {
                        actions = idleInitiative.actions;
                        decisionCause = 'empty_completion_idle_initiative';
                        actionsAlreadySpent = true;
                        endReason = 'idle_initiative';
                    } else {
                        // S-INFER-1: record WHY the completion was empty using the
                        // salvage classification, so live action logs reveal the
                        // real breakdown (Qwen3 think_only_no_answer vs
                        // schema_mismatch vs truly_empty) instead of a blanket
                        // `empty_completion`. Genuinely-empty completions keep the
                        // bare `empty_completion` cause so existing telemetry/tests
                        // do not break.
                        decisionCause = emptyCompletionCause(parsed.parseClass);
                    }
                }
            }
            decisionCause ??= inferUnnamedCompletionCause(parsed, actions);
            if (actions.length === 0 && this.soul.frontmatter.heroProfile) {
                const visibleCadence = this.idleInitiative(perception);
                if (visibleCadence) {
                    actions = visibleCadence.actions;
                    actionsAlreadySpent = true;
                    decisionCause = `${decisionCause}_idle_initiative`;
                    endReason = 'idle_initiative';
                }
            }
            this.options.evidence?.recordDecision({
                cause: decisionCause,
                moduleId: this.options.moduleIdentity?.id,
                moduleVersion: this.options.moduleIdentity?.version,
                promptHash: sha256(envelope),
                completionHash: sha256(response.text),
                promptTokens: estimateTokens(envelope),
                completionTokens: estimateTokens(response.text),
                actionKinds: actions.map(action => action.kind),
                memoUpdates: parsed.memo?.length || 0,
                planChange: parsed.plan ? { id: parsed.plan.id, steps: parsed.plan.steps.length } : undefined,
            });

            if (!actionsAlreadySpent) {
                for (const action of actions) {
                    this.state.attention = spendForAction(this.state.attention, action.kind, this.soul.frontmatter.attentionProfile?.floor);
                }
            }

            const postActionLegacy = this.legacy.observeActions(actions, perception);
            if (postActionLegacy.complete) {
                actions = [...actions, { kind: 'logout', cause: postActionLegacy.cause || 'legacy_complete' }];
                endReason = 'legacy_complete_post_action';
            }
            actions.forEach((action, index) => this.options.evidence?.recordAction(action, `spark:${this.state.tick}:${index + 1}`));

            return {
                actions,
                cause: decisionCause,
                envelopeTokens: estimateTokens(envelope),
                nooped: actions.length === 0,
                syntheticEvents,
            };
        } finally {
            this.options.evidence?.endTick(endReason);
        }
    }

    private idleInitiative(perception: Perception): SparkTickResult | undefined {
        if (this.state.tick < IDLE_INITIATIVE_FIRST_TICK) {
            return undefined;
        }
        const nowMs = Date.now();
        if (this.idleInitiativeCoolingDown(nowMs)) {
            return undefined;
        }

        const factionWork = factionLandmarkAction(this.soul, this.state, perception);
        const candidate =
            factionWork ||
            heroAnchorPatrolAction(this.soul, this.state) ||
            generateFirstStepCandidates(perception).find(action => action.kind !== 'noop');
        const visiblePulse: AgentAction = {
            kind: 'say',
            text: idleInitiativeSpeech(this.soul),
            cause: 'idle_initiative',
        };
        const candidateCause = factionWork ? candidate?.cause || 'faction_landmark_work' : 'idle_initiative';
        const candidateAction = candidate ? { ...candidate, cause: candidateCause } : undefined;
        const actions: AgentAction[] = candidateAction
            ? candidateAction.kind === 'say'
                ? [candidateAction]
                : [visiblePulse, candidateAction]
            : [visiblePulse];
        if (factionWork && candidateAction) {
            rememberFactionLandmarkAttempt(this.state, candidateAction);
        }
        for (const action of actions) {
            this.state.attention = spendForAction(this.state.attention, action.kind, this.soul.frontmatter.attentionProfile?.floor);
        }
        this.state.lastIdleInitiativeTick = this.state.tick;
        this.state.lastIdleInitiativeAt = new Date(nowMs).toISOString();
        return { actions, cause: 'idle_initiative', nooped: false };
    }

    private idleInitiativeCoolingDown(nowMs: number): boolean {
        const lastTick = this.state.lastIdleInitiativeTick;
        const tickCoolingDown = lastTick !== undefined && this.state.tick - lastTick < IDLE_INITIATIVE_INTERVAL_TICKS;
        const lastAtMs = this.state.lastIdleInitiativeAt ? Date.parse(this.state.lastIdleInitiativeAt) : Number.NaN;
        const wallIntervalMs = this.soul.frontmatter.heroProfile ? HERO_IDLE_INITIATIVE_INTERVAL_MS : IDLE_INITIATIVE_INTERVAL_MS;
        const wallCoolingDown = Number.isFinite(lastAtMs) && nowMs - lastAtMs < wallIntervalMs;

        return tickCoolingDown && wallCoolingDown;
    }

    abortInflight(cause: string): void {
        this.mailbox.abort(cause);
        this.mode = idleMode(cause);
    }

    watchdogFallback(perception: Perception): SparkTickResult {
        this.abortInflight('thinking_watchdog_timeout');
        const factionWork = factionLandmarkAction(this.soul, this.state, perception);
        const action =
            factionWork ||
            heroAnchorPatrolAction(this.soul, this.state) ||
            generateFirstStepCandidates(perception).find(candidate => candidate.kind !== 'noop');
        if (!action) {
            return { actions: [], cause: 'thinking_watchdog_timeout', nooped: true };
        }

        const fallbackAction = { ...action, cause: factionWork ? action.cause || 'faction_landmark_work' : 'watchdog_fallback' };
        const visiblePulse: AgentAction = {
            kind: 'say',
            text: watchdogFallbackSpeech(this.soul),
            cause: 'watchdog_fallback',
        };
        if (factionWork) {
            rememberFactionLandmarkAttempt(this.state, fallbackAction);
        }
        const actions = fallbackAction.kind === 'say' ? [fallbackAction] : [visiblePulse, fallbackAction];
        for (const pendingAction of actions) {
            this.state.attention = spendForAction(this.state.attention, pendingAction.kind, this.soul.frontmatter.attentionProfile?.floor);
        }
        return {
            actions,
            cause: 'watchdog_fallback',
            nooped: false,
        };
    }

    considerInterrupt(perception: Perception): boolean {
        const current = this.mailbox.current();
        if (!current) {
            return false;
        }

        const memoryDir = this.memory.ensureResident(this.soul.frontmatter.name);
        const [winner] = this.hooks.evaluate(this.allHooks(memoryDir), this.state, perception, this.state.variables);
        if (!winner?.hook.interrupt || winner.priority < this.interruptionMargin()) {
            return false;
        }

        this.abortInflight(`interrupted_by:${winner.id}`);
        this.state.previousIntent = remainingIntent(this.activePlan);
        this.activePlan = undefined;
        return true;
    }

    private advancePlan(perception: Perception, hookPriority: number): SparkTickResult | undefined {
        if (!this.activePlan || hookPriority >= this.interruptionMargin()) {
            return undefined;
        }

        const planned = this.planExecutor.tick(this.activePlan, { tick: this.state.tick, perception });
        if (planned.abandoned || planned.complete) {
            this.activePlan = undefined;
            this.mode = idleMode(planned.cause);
        }
        if (!planned.action) {
            return planned.complete ? { actions: [], cause: planned.cause, nooped: true } : undefined;
        }

        this.state.attention = spendForAction(this.state.attention, planned.action.kind, this.soul.frontmatter.attentionProfile?.floor);
        return { actions: [planned.action], cause: this.activePlan?.cause, nooped: false };
    }

    private interruptionMargin(): number {
        return this.mode.mode === 'idle' ? 0 : 10;
    }

    private allHooks(memoryDir: string): HookDefinition[] {
        const soulHooks = (this.soul.frontmatter.hooks || []).map(hook =>
            clampHookPriority({ ...hook, source: 'soul', interrupt: hook.interruptInflight } as HookDefinition, 80),
        );
        return [...systemHooks, ...soulHooks, ...readHooksMd(memoryDir).hooks];
    }

    private variableDefinitions(): VariableDefinition[] {
        return (this.soul.frontmatter.variables || []).map(variable => ({
            id: variable.name,
            initial: variable.initial,
            increment: variable.tick?.find(operation => operation.op === 'increment')?.value,
            decrement: variable.tick?.find(operation => operation.op === 'decrement')?.value,
            decay: variable.tick?.find(operation => operation.op === 'decay')?.value,
            min: variable.tick?.find(operation => operation.op === 'clamp')?.min,
            max: variable.tick?.find(operation => operation.op === 'clamp')?.max,
        }));
    }
}

function replaceNoopWithCandidate(actions: AgentAction[], candidates: AgentAction[]): AgentAction[] {
    const firstCandidate = candidates.find(candidate => candidate.kind !== 'noop');
    if (!firstCandidate || actions.length !== 1 || actions[0].kind !== 'noop') {
        return actions;
    }

    return [firstCandidate];
}

function isEmptyParsedCompletion(parsed: ParsedCompletion, actions: AgentAction[]): boolean {
    return (
        actions.length === 0 &&
        !parsed.cause &&
        !parsed.plan &&
        !parsed.memo?.length &&
        !parsed.indexPatch?.append?.length &&
        !parsed.proposeHook?.length &&
        !parsed.retireHook?.length &&
        !parsed.proposeNervousRule?.length &&
        !parsed.retireNervousRule?.length &&
        !parsed.proposeVariables?.length
    );
}

/**
 * S-INFER-1: map a salvage parse-classification onto the SPARK decisionCause
 * for an otherwise-empty completion. `truly_empty` (and an unset class, for
 * back-compat with callers/parsers that do not yet set it) stays the bare
 * `empty_completion` so existing telemetry/tests keep working; every other
 * class is suffixed so the live action logs distinguish the real reason
 * (e.g. `empty_completion_think_only_no_answer`,
 * `empty_completion_schema_mismatch`).
 */
function emptyCompletionCause(parseClass: ParsedCompletion['parseClass']): string {
    // `clean` (e.g. a well-formed `{}` with no actions) and `truly_empty`
    // (and an unset class) are the ordinary empty completion — keep the bare
    // cause so existing telemetry/tests stay stable. Only the salvage /
    // failure classes that previously hid behind `empty_completion` get a
    // suffix so the live breakdown is visible.
    if (!parseClass || parseClass === 'clean' || parseClass === 'truly_empty') {
        return 'empty_completion';
    }
    return `empty_completion_${parseClass}`;
}

/**
 * S-INFER-2 (D2): build the decisionCause for a think that was CANCELLED rather
 * than empty. A bare `request_timeout` keeps its own historical label (it is a
 * genuine timeout, not a reflex interrupt); every other cancel reason is tagged
 * `thinking_cancelled` so bucket C is visible and distinct from the
 * `empty_completion` buckets in the live action log. The original reason is
 * appended (e.g. `thinking_cancelled:nervous:flee_combat`) for triage.
 */
function cancelledDecisionCause(cancelledBy: string): string {
    const reason = cancelledBy.trim();
    if (!reason || reason === 'request_timeout') {
        return reason || 'thinking_cancelled';
    }
    return `thinking_cancelled:${reason}`;
}

function inferUnnamedCompletionCause(parsed: ParsedCompletion, actions: AgentAction[]): string {
    if (parsed.plan) {
        return 'plan_generated';
    }
    if (actions.length > 0) {
        return parsed.actions.some(action => action.kind === 'noop') ? 'candidate_fallback' : 'completion_action';
    }
    if (
        parsed.proposeHook?.length ||
        parsed.retireHook?.length ||
        parsed.proposeNervousRule?.length ||
        parsed.retireNervousRule?.length ||
        parsed.proposeVariables?.length
    ) {
        return 'completion_self_modification';
    }
    if (parsed.memo?.length || parsed.indexPatch?.append?.length) {
        return 'completion_memory_update';
    }
    return 'completion';
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function watchdogFallbackSpeech(soul: Soul): string {
    const residentName = soul.frontmatter.heroProfile?.publicName || soul.frontmatter.display;
    if (!residentName) {
        return withAuthoredGoal('I am still here; getting my bearings.', soul);
    }

    if (soul.frontmatter.heroProfile?.anchor) {
        return withAuthoredGoal(`Still here as ${residentName}; getting my bearings near my post.`, soul);
    }

    return withAuthoredGoal(`Still here as ${residentName}; getting my bearings.`, soul);
}

function idleInitiativeSpeech(soul: Soul): string {
    const residentName = soul.frontmatter.heroProfile?.publicName || soul.frontmatter.display;
    if (!residentName) {
        return withAuthoredGoal('I am still here; watching the area.', soul);
    }

    return withAuthoredGoal(`Still here as ${residentName}; watching the area.`, soul);
}

function withAuthoredGoal(base: string, soul: Soul): string {
    const goal = soul.frontmatter.goals?.find(value => value.trim().length > 0);
    if (!goal) {
        return base;
    }
    const normalized = goal
        .trim()
        .replace(/^to\s+/i, '')
        .replace(/[.!?]+$/g, '');
    if (!normalized) {
        return base;
    }
    return `${base} I am still trying to ${normalized}.`;
}

function heroAnchorPatrolAction(soul: Soul, state: RuntimeState): AgentAction | undefined {
    const anchor = soul.frontmatter.heroProfile?.anchor;
    if (!anchor) {
        return undefined;
    }

    const patrolOffsets = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
    ];
    const offset = patrolOffsets[Math.abs(state.tick) % patrolOffsets.length];
    return {
        kind: 'move_to',
        target: { x: anchor[0] + offset.x, y: anchor[1] + offset.y, level: anchor[2] },
        range: 1,
        cause: 'watchdog_fallback',
    };
}

function factionLandmarkAction(soul: Soul, state: RuntimeState, perception: Perception): AgentAction | undefined {
    const { factionId, heroProfile } = soul.frontmatter;
    const anchor = heroProfile?.anchor;
    if (!anchor || !factionId || heroProfile?.tier !== 'hero' || soul.frontmatter.legacy?.parameters?.benchmarkTask) {
        return undefined;
    }

    state.cognition ||= {};
    state.cognition.pickupCooldowns ||= {};
    state.cognition.explorationCooldowns ||= {};
    state.cognition.targetFailureCooldowns ||= {};
    return factionLandmarkWorkAction({
        perception,
        factionId,
        landmark: { x: anchor[0], y: anchor[1], level: anchor[2] },
        residentId: state.resident,
        currentTick: state.tick,
        pickupCooldowns: state.cognition.pickupCooldowns,
        explorationCooldowns: state.cognition.explorationCooldowns,
        targetFailureCooldowns: state.cognition.targetFailureCooldowns,
    });
}

function rememberFactionLandmarkAttempt(state: RuntimeState, action: AgentAction): void {
    state.cognition ||= {};
    const item = pickupActionWorldItem(action);
    if (item) {
        const cooldowns = (state.cognition.pickupCooldowns ||= {});
        cooldowns[pickupItemKey(item)] = state.tick;
        pruneCooldowns(cooldowns, state.tick, PICKUP_TARGET_COOLDOWN_TICKS);
    }

    const key = explorationCooldownKeyFromAction(action);
    if (!key) {
        return;
    }

    const cooldowns = (state.cognition.explorationCooldowns ||= {});
    cooldowns[key] = state.tick;
    const actor = actorLike(actionTarget(action));
    if (actor?.kind === 'npc') {
        cooldowns[explorationActorFamilyCooldownKey(actor)] = state.tick;
    }
    pruneCooldowns(cooldowns, state.tick, EXPLORATION_TARGET_COOLDOWN_TICKS);
}

function pruneCooldowns(cooldowns: Record<string, number>, currentTick: number, ttlTicks: number): void {
    for (const [key, tick] of Object.entries(cooldowns)) {
        if (currentTick - tick > ttlTicks) {
            delete cooldowns[key];
        }
    }
}

function explorationCooldownKeyFromAction(action: AgentAction): string | undefined {
    const target = actionTarget(action);
    const directPosition = positionLike(target);
    if (directPosition) {
        return action.cause === 'faction_landmark_return' ? undefined : explorationPatrolCooldownKey(directPosition);
    }

    const actor = actorLike(target);
    if (actor?.kind === 'npc') {
        return explorationActorCooldownKey(actor);
    }

    if (isRecord(target)) {
        const position = positionLike(target.position);
        if (!position) {
            return undefined;
        }
        if (typeof target.objectId === 'number') {
            return explorationObjectCooldownKey({ objectId: target.objectId, position });
        }
        if (typeof target.itemId === 'number' && typeof target.amount === 'number') {
            return explorationItemCooldownKey({
                itemId: target.itemId,
                key: typeof target.key === 'string' ? target.key : undefined,
                amount: target.amount,
                position,
                ownerId: typeof target.ownerId === 'string' ? target.ownerId : undefined,
            });
        }
    }

    return undefined;
}

function pickupActionWorldItem(action: AgentAction): BodyWorldItem | undefined {
    if (action.kind !== 'interact' || !/pick[- ]?up/i.test(String(action.option || ''))) {
        return undefined;
    }

    const target = actionTarget(action);
    if (!isRecord(target)) {
        return undefined;
    }
    const position = positionLike(target.position);
    if (typeof target.itemId !== 'number' || typeof target.amount !== 'number' || !position) {
        return undefined;
    }
    return {
        itemId: target.itemId,
        key: typeof target.key === 'string' ? target.key : undefined,
        amount: target.amount,
        position,
        ownerId: typeof target.ownerId === 'string' ? target.ownerId : undefined,
    };
}

function actionTarget(action: AgentAction): unknown {
    return 'target' in action ? action.target : undefined;
}

function actorLike(value: unknown): BodyActor | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const position = positionLike(value.position);
    if (!position || typeof value.id !== 'string') {
        return undefined;
    }
    const kind = value.kind;
    if (kind !== 'player' && kind !== 'npc' && kind !== 'resident') {
        return undefined;
    }
    return {
        id: value.id,
        kind,
        name: typeof value.name === 'string' ? value.name : undefined,
        key: typeof value.key === 'string' ? value.key : undefined,
        position,
        hpFraction: typeof value.hpFraction === 'number' ? value.hpFraction : undefined,
        combatLevel: typeof value.combatLevel === 'number' ? value.combatLevel : undefined,
    };
}

function positionLike(value: unknown): BodyPos | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const { x, y, level } = value;
    return typeof x === 'number' && typeof y === 'number' && typeof level === 'number' ? { x, y, level } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
