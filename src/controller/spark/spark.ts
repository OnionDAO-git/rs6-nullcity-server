import { createHash } from 'crypto';
import { admitInference, defaultInferenceBudget } from '../llm/budgets';
import { parseCompletion } from '../llm/completion-parser';
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
import { type VariableDefinition, recomputeVariables } from './variables';

export interface SparkTickResult {
    actions: AgentAction[];
    cause?: string;
    envelopeTokens?: number;
    nooped: boolean;
    syntheticEvents?: PerceptionEvent[];
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
            this.state.attention = spendAttention(this.state.attention, this.soul.frontmatter.attentionProfile?.decayCurve || 'standard');
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

            const planned = this.advancePlan(perception, winner?.priority ?? -1);
            if (planned) {
                endReason = 'plan_continuation';
                this.options.evidence?.recordPlan({ cause: planned.cause, actionKinds: planned.actions.map(action => action.kind) });
                return planned;
            }

            if (!winner || winner.priority <= 0) {
                endReason = 'hook_noop';
                return { actions: [], nooped: true };
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
                    signal: request.controller.signal,
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
            );

            const parsed = parseCompletion(response.text);
            if (!parsed.ok) {
                this.state.attention = spendForLlm(this.state.attention, 'failed');
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
            if (parsed.plan) {
                this.activePlan = installPlan(parsed.plan, this.state.tick, this.state.previousIntent as PlanIntent | undefined);
                this.mode = { mode: 'executing', changedAt: new Date(), cause: parsed.cause };
                const next = this.planExecutor.tick(this.activePlan, { tick: this.state.tick, perception });
                actions = next.action ? replaceNoopWithCandidate([next.action], candidates) : [];
            }
            this.options.evidence?.recordDecision({
                cause: parsed.cause,
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

            for (const action of actions) {
                this.state.attention = spendForAction(this.state.attention, action.kind);
            }

            const postActionLegacy = this.legacy.observeActions(actions, perception);
            if (postActionLegacy.complete) {
                actions = [...actions, { kind: 'logout', cause: postActionLegacy.cause || 'legacy_complete' }];
                endReason = 'legacy_complete_post_action';
            }
            actions.forEach((action, index) => this.options.evidence?.recordAction(action, `spark:${this.state.tick}:${index + 1}`));

            return {
                actions,
                cause: parsed.cause,
                envelopeTokens: estimateTokens(envelope),
                nooped: response.nooped || actions.length === 0,
            };
        } finally {
            this.options.evidence?.endTick(endReason);
        }
    }

    abortInflight(cause: string): void {
        this.mailbox.abort(cause);
        this.mode = idleMode(cause);
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

        this.state.attention = spendForAction(this.state.attention, planned.action.kind);
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

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
