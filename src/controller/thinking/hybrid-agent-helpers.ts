import type { AgentAction, Perception } from '../transport/message-codecs';
import type { Soul, HybridAgentBehaviorDefinition } from '../soul/soul-schema';
import { buildBodyPrompt, buildBrainPrompt } from './hybrid-agent-prompts';
import { estimateTokens } from '../util/token-count';
import { parseCompletion } from '../llm/completion-parser';
import type { GameSkillContext } from '../knowledge/game-skill-context';
import type { ThoughtResult } from './thinking-module';
import type { RuntimeState, ActiveGoalState, ActiveMoveState } from '../memory/runtime-state';
import {
    isRecord,
    positionLike,
    actorLike,
    positionsEqual,
    isMoveTo,
    actionTargetPosition,
    objectTileMoveTarget,
    positionKey,
    isTargetFailureCooldownActive,
    withoutTargetFailedPerception,
    TARGET_FAILURE_COOLDOWN_TICKS,
    type Pos,
    type Item,
    type WorldItem,
    type Actor,
    type ActiveTrade,
    type HybridPerception,
    targetFailureKeys,
    targetFailureKey,
    worldItemLike,
    stepToward,
    shouldRememberNpcFamilyTargetFailure,
} from './hybrid-agent-utils';
import {
    firstFoodSlot,
    isLowHealth,
    lowHealthRecoveryAction as bodyLowHealthRecoveryAction,
    nearestLowHealthRecoveryWaypoint,
    combatTrainingAction,
    prayerTrainingAction,
    explorationAction,
    opportunisticPickupAction,
    npcTalkAction,
    itemLabel,
    explorationPatrolCooldownKey,
    explorationActorCooldownKey,
    explorationActorFamilyCooldownKey,
    explorationObjectCooldownKey,
    explorationItemCooldownKey,
    localPatrolDirections,
    patrolDirectionIndex,
    explorationPatrolTarget,
    actionWithCause,
    distance,
    hasNearbyFire,
    isExplorationOnCooldown,
    safeCombatTarget,
    findSlot,
    levelOneWoodcuttingAction,
    starterMiningAction,
    cooksAssistantQuestAction,
    cooksAssistantStartAction,
    starterFishingCookingAction as bodyStarterFishingCookingAction,
    starterFishingRouteAction,
    factionLandmarkWorkAction,
    pickupItemKey,
    buryBonesAction,
    starterFishingAction,
    firemakingAction,
    acquireWoodcuttingAxeAction,
    planStageRouter,
    type OpenGoalContext,
    stuckRecoveryPatrolTarget,
    isUsefulGroundItem,
    usefulGroundItemPriority,
    isEdibleFood,
    INTERACTION_APPROACH_RADIUS,
    LOW_HEALTH_RECOVERY_WAYPOINT_RANGE,
    COOKING_HEAT_OBJECT_IDS,
    LEVEL_ONE_TREE_IDS,
    EXPLORATION_PATROL_STEP_DISTANCE,
    EXPLORATION_PATROL_MAX_DISTANCE,
    isPickupOnCooldown,
    isOwnedByAnotherActor,
    isStaleSelfOwnedLog,
    COIN_ITEM_IDS,
    LUMBRIDGE_CASTLE_RANGE as BODY_LUMBRIDGE_CASTLE_RANGE,
    LUMBRIDGE_STARTER_FISHING_SPOTS as BODY_LUMBRIDGE_STARTER_FISHING_SPOTS,
    STARTER_FISHING_ROUTE_MAX_DISTANCE as BODY_STARTER_FISHING_ROUTE_MAX_DISTANCE,
    STARTER_FISHING_SPOT_DISCOVERY_RANGE as BODY_STARTER_FISHING_SPOT_DISCOVERY_RANGE,
} from '../spark/runescape-body-routines';
export { distance };
import {
    isFiremakingLog,
    isWoodcuttingAxe,
    isTinderbox,
    isSmallFishingNet,
    isStarterRawFish,
    isBones,
    hasWoodcuttingAxe,
    hasSmallFishingNet,
    isSafeCombatTarget,
} from '../spark/runescape-workflows';
import {
    latestCombatAttacker,
    fleeTarget,
    stuckOpenObstacleAction,
    stuckBlockerReportAction,
    shouldEmitPresenceBeacon,
    stuckHelpRequestAction,
    OPENABLE_OBSTACLE_IDS,
} from '../spark/runescape-nervous-rules';
import {
    summarizeGoalForSpeech,
    firemakingGoal,
    isFiremakingGoal,
    isWoodcuttingTrainingGoal,
    isStarterFishingGoal,
    isMiningGoal,
    isCooksAssistantStartGoal,
    isCooksAssistantQuestGoal,
    starterFishingGoal,
    miningGoal,
    isCombatTrainingGoal,
    isPrayerTrainingGoal,
    isFactionLandmarkWorkGoal,
    isDedicatedExplorationGoal,
    isExplorationGoal,
    cleanSpeech,
    woodcuttingGoal,
    prayerGoal,
    explorationGoal,
    isStandaloneFiremakingGoal,
    isFollowGoal,
    factionLandmarkWorkGoal,
    parseBrainCompletionDetailed,
    goalId,
    goalPoolForBenchmark,
    buildResidentNeedsContext,
    selectCandidateGoals,
    benchmarkGoalForTask,
    gpPickupGoal,
} from '../spark/runescape-brain-planner';
import { currentTier } from '../spark/needs-hierarchy';
import { pickPhrase } from '../soul/phrasebook';
import {
    actorName,
    isFishingSpot,
    latestTradeRequest,
    latestDialogueEvent,
    isChatRateLimited,
    recordChatReplyEmit,
    tradeRequestOrApproach,
    tradeAcceptAction,
    actorMatchesName,
    safeTradeOfferSlot,
} from './hybrid-agent-chat';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import { admitPlannerCall, acquireGlobalPlannerSlot, releaseGlobalPlannerSlot } from '../llm/budgets';
import { runPlannerToolLoop, defaultToolRegistry, defaultTools, buildToolInstructions } from '../intelligence/planner-tool-loop';
import type { PlanStore } from '../intelligence/plan-store';
import { advancePlan, blockCurrentStage, runPlannerPass, currentStage as currentPlanStage } from '../intelligence/planner-pass';
import { evaluateSuccessPredicate } from '../intelligence/plan-predicates';
import type { LibraryUpdater } from '../evidence/library-updater';

// --- Shared Constants ---
export const DEFAULT_GOAL_SHARE_EVERY_TICKS = 600;
export const DEFAULT_RETURN_TO_ANCHOR_EVERY_TICKS = 600;
export const DEFAULT_RETURN_TO_ANCHOR_RADIUS = 12;
export const PRESENCE_BEACON_VARIETY_AFTER_TICKS = 1000;
export const COMBAT_AREA_ANCHOR_RECOVERY_DISTANCE = 28;
export const REPEAT_ACTION_BACKOFF_TICKS = 30;
export const ROUTINE_OPPORTUNISTIC_PICKUP_MAX_DISTANCE = 6;
export const MOVE_COMMIT_TICKS = 24;
export const MOVE_STUCK_STATIONARY_OBSERVATIONS = 2;
export const SOCIAL_KEEPALIVE_EVERY_TICKS = 36;
export const TRADE_KEEPALIVE_EVERY_TICKS = 60;
export const AGENT_KEEPALIVE_EVERY_TICKS = 60;
export const HERO_KEEPALIVE_EVERY_TICKS = 60;
export const TRADE_STARTER_OFFER_COOLDOWN_TICKS = 120;
const COOKS_ASSISTANT_QUEST_ID = 'rs:cooks_assistant';
const COOKS_ASSISTANT_DIALOGUE_SEQUENCE: AgentAction[] = [
    { kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_choice', optionIndex: 0, cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_choice', optionIndex: 0, cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_choice', optionIndex: 3, cause: 'cooks_assistant_dialogue_step' },
    { kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' },
];
const COOKS_ASSISTANT_HAND_IN_DIALOGUE_SEQUENCE: AgentAction[] = Array.from({ length: 24 }, () => ({
    kind: 'dialogue_continue',
    cause: 'cooks_assistant_hand_in_dialogue_step',
}));
export const MOVE_STUCK_NON_IMPROVING_OBSERVATIONS = 4;
export const MOVE_STUCK_NON_CLOSING_TICKS = 96;
export const MOVE_STUCK_EQUAL_DISTANCE_DETOUR_OBSERVATIONS = 3;

export interface HelperContext {
    options: {
        soul: Soul;
        state: RuntimeState;
        memory: any;
        llm: any;
        patronRegistry?: any;
        /** RIQ-3-2: per-resident durable plan store; absent for residents without planner config. */
        planStore?: PlanStore;
        /** RIQ-3-3: Library updater for plan lifecycle events; absent until wired from ResidentRuntime. */
        libraryUpdater?: LibraryUpdater;
    };
    cognition(): any;
    commandPrefix(): string;
    activeGoal(): ActiveGoalState | undefined;
    pickupCooldowns(): Record<string, number>;
    explorationCooldowns(): Record<string, number>;
    clearGoalMomentum(): void;
    rememberBodyAction(action: AgentAction): void;
    rememberActiveMove(action: AgentAction, here: Pos): void;
    isRepeatedAction(action: AgentAction): boolean;
    behavior(): HybridAgentBehaviorDefinition;
    heroLandmarkAnchor(): Pos | undefined;
    visibilityAnchor(): Pos | undefined;
    endpointFor(profile?: any): string;
    temperatureFor(profile: any, fallback: number): number;
    timeoutFor(profile: any, fallback?: number): number | undefined;
    maxTokensFor(profile: any, fallback?: number): number | undefined;
    modelFor(profile?: any): string | undefined;
    complete(thinkId: number, request: any): Promise<any>;
    cancelledResult(thinkId: number, perception?: HybridPerception): any;
    promptMemories(perception: HybridPerception, role: 'brain' | 'body'): string[];
    promptMemorySection(memories: string[], role: 'brain' | 'body'): string;
    visibilityStatus(perception: any): { anchor?: Pos; returnDue: boolean };
    deferVisibilityAnchorReturn(): void;
    suppressRepeatedActions(actions: AgentAction[]): AgentAction[];

    // Add reactions as context callbacks to allow cross-delegation
    combatReaction(perception: HybridPerception): { actions: AgentAction[]; cause: string } | undefined;
    tradeReaction(perception: HybridPerception): { action: AgentAction; cause: string } | undefined;
}

export function dialogueReaction(ctx: HelperContext, perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
    const event = latestDialogueEvent(perception);
    if (!event) {
        return undefined;
    }

    const options = Array.isArray(event.options) ? event.options : [];
    const action: AgentAction =
        options.length > 0
            ? { kind: 'dialogue_choice', optionIndex: 0, cause: 'dialogue_choice_first' }
            : { kind: 'dialogue_continue', cause: 'dialogue_continue' };

    ctx.rememberBodyAction(action);
    return { action, cause: action.cause || 'dialogue_reaction' };
}

export function tradeReaction(ctx: HelperContext, perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
    const request = latestTradeRequest(perception);
    if (request && isTrustedTradePartner(ctx, request)) {
        const action = tradeRequestOrApproach(perception, request, 'trade_reciprocate_trusted_request');
        if (action && !ctx.isRepeatedAction(action)) {
            ctx.rememberBodyAction(action);
            return { action, cause: action.cause || 'trade_reciprocate_trusted_request' };
        }
    }

    const trade = perception.resident?.activeTrade;
    if (!trade) {
        return undefined;
    }

    if (trade.partner && !isTrustedTradePartner(ctx, trade.partner)) {
        const action: AgentAction = { kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' };
        if (ctx.isRepeatedAction(action)) {
            return undefined;
        }
        ctx.rememberBodyAction(action);
        return { action, cause: 'trade_decline_untrusted_partner' };
    }

    const offerSlot = (trade.ours?.length || 0) === 0 ? safeTradeOfferSlot(perception.resident?.inventory || []) : undefined;
    const action =
        offerSlot !== undefined
            ? { kind: 'trade_offer_item', inventorySlot: offerSlot, amount: 1, cause: 'trade_offer_safe_item' }
            : tradeAcceptAction(trade);
    if (!action || ctx.isRepeatedAction(action)) {
        return undefined;
    }

    ctx.rememberBodyAction(action);
    return { action, cause: action.cause || 'trade_reaction' };
}

export function currentFollowTarget(ctx: HelperContext): { name?: string; id?: string; kind?: string } | undefined {
    const target = ctx.cognition().followTarget;
    if (target?.paused && (target.name || target.id || ctx.cognition().manualPauseSinceTick !== undefined)) {
        return undefined;
    }
    if (target?.name || target?.id) {
        return target;
    }

    const configured = ctx.behavior().followPlayer;
    return configured ? { name: configured } : undefined;
}

export function isTrustedTradePartner(ctx: HelperContext, actor: Actor): boolean {
    const trusted = ctx.behavior().followPlayer;
    const followTarget = currentFollowTarget(ctx);
    return Boolean(
        (trusted && actorMatchesName(actor, trusted)) ||
            (followTarget?.id && actor.id === followTarget.id) ||
            (followTarget?.name && actorMatchesName(actor, followTarget.name)),
    );
}

export function combatReaction(ctx: HelperContext, perception: HybridPerception): { actions: AgentAction[]; cause: string } | undefined {
    const cognition = ctx.cognition();
    const inCombat = !!perception.resident?.inCombat;

    // Track episode status
    if (inCombat) {
        cognition.consecutiveNonCombatTicks = 0;
        if (!cognition.combatEpisodeActive) {
            cognition.combatEpisodeActive = true;
            cognition.combatEpisodeNarrated = false;
            cognition.combatEndCelebrated = false;
        }
    } else {
        if (cognition.combatEpisodeActive) {
            cognition.consecutiveNonCombatTicks = (cognition.consecutiveNonCombatTicks || 0) + 1;
            if (cognition.consecutiveNonCombatTicks >= 3) {
                cognition.combatEpisodeActive = false;
                if (!cognition.combatEndCelebrated) {
                    cognition.combatEndCelebrated = true;
                    const text = pickPhrase({
                        soul: ctx.options.soul,
                        situation: 'combat_decision.kill_celebration',
                        seed: `${ctx.options.state.tick}`,
                    });
                    return { actions: [{ kind: 'say', text }], cause: 'combat_kill_celebration' };
                }
            }
        }
    }

    const visibleAggressors = getVisibleAggressors(perception);
    const recentAttacker = latestCombatAttacker(perception);
    let target: Actor | undefined;
    if (visibleAggressors.length > 0) {
        const here = perception.resident?.position;
        target = here ? selectPreferredAggressor(visibleAggressors, here) : visibleAggressors[0];
    } else {
        target = recentAttacker || perception.resident?.combatTarget || undefined;
    }

    if (!target) {
        return undefined;
    }

    const foodSlot = firstFoodSlot(perception.resident?.inventory || []);
    const onlyStaleCombatTarget =
        !inCombat && visibleAggressors.length === 0 && !recentAttacker && target === perception.resident?.combatTarget;
    if (onlyStaleCombatTarget && isLowHealth(perception) && foodSlot === undefined) {
        return undefined;
    }

    let action: AgentAction;
    if (target.kind === 'player') {
        action = {
            kind: 'say',
            text: `${actorName(target)} is attacking me. Tell me "${ctx.commandPrefix()} attack ${actorName(target)}" if I should fight back.`,
        };
    } else if (isLowHealth(perception)) {
        action =
            foodSlot === undefined
                ? { kind: 'move_to', target: fleeTarget(perception), cause: 'combat_retreat' }
                : { kind: 'eat', slot: foodSlot, cause: 'combat_eat_before_retaliating' };
    } else if (
        !isSafeCombatTarget(target) ||
        (target.combatLevel !== undefined &&
            perception.resident?.combatLevel !== undefined &&
            target.combatLevel > perception.resident.combatLevel + 5)
    ) {
        action = { kind: 'move_to', target: fleeTarget(perception), cause: 'combat_retreat' };
    } else if (sameCombatActor(target, perception.resident?.combatTarget ?? undefined) && inCombat) {
        return { actions: [], cause: 'combat_hold' };
    } else {
        action = { kind: 'attack', target, cause: 'combat_retaliate' };
    }

    if (ctx.isRepeatedAction(action)) {
        return undefined;
    }

    ctx.rememberBodyAction(action);

    const resultActions = [action];
    if (target.kind !== 'player' && !cognition.combatEpisodeNarrated) {
        cognition.combatEpisodeNarrated = true;
        const decision = classifyCombatDecision(perception, target, foodSlot);
        const text = pickPhrase({
            soul: ctx.options.soul,
            situation: `combat_decision.${decision}`,
            seed: `${ctx.options.state.tick}`,
            params: { targetName: actorName(target) },
        });
        resultActions.push({ kind: 'say', text });
    }

    return { actions: resultActions, cause: action.cause || 'combat_reaction' };
}

export function combatNarrationAction(ctx: HelperContext): { action: AgentAction; cause: string } | undefined {
    const pending = ctx.cognition().pendingCombatNarration;
    if (!pending) {
        return undefined;
    }

    ctx.cognition().pendingCombatNarration = undefined;
    if (ctx.options.state.tick - pending.setAtTick > 80) {
        return undefined;
    }

    return {
        action: { kind: 'say', text: pending.text },
        cause: pending.cause,
    };
}

export function queueCombatNarration(ctx: HelperContext, action: AgentAction, target: Actor): void {
    let text: string | undefined;
    if (target.kind === 'player') {
        return;
    }
    if (action.kind === 'eat') {
        text = `I am hurt, so I am eating before I keep fighting ${actorName(target)}.`;
    } else if (action.kind === 'move_to' && action.cause === 'combat_retreat') {
        text = `I am hurt and have no food, so I am retreating from ${actorName(target)}.`;
    } else if (action.kind === 'attack' && action.cause === 'combat_retaliate') {
        text = `${actorName(target)} attacked me, so I am fighting back.`;
    }

    if (!text) {
        return;
    }

    ctx.cognition().pendingCombatNarration = {
        text,
        cause: 'combat_survival_narration',
        setAtTick: ctx.options.state.tick,
    };
}

export function lowHealthRecoveryAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    const hasCarriedFood = firstFoodSlot(perception.resident?.inventory || []) !== undefined;
    if (!isLowHealth(perception) || (goal && isCombatTrainingGoal(goal) && hasCarriedFood)) {
        return undefined;
    }
    const action = bodyLowHealthRecoveryAction(
        perception,
        ctx.options.state.resident,
        hasCarriedFood ? undefined : ctx.cognition().pickupCooldowns,
        ctx.options.state.tick,
        ctx.cognition().targetFailureCooldowns,
    );
    if (action) {
        if (ctx.isRepeatedAction(action)) {
            return undefined;
        }
        ctx.rememberBodyAction(action);
        return { action, cause: action.cause || 'low_health_recovery' };
    }

    const here = perception.resident?.position;
    const anchor = ctx.visibilityAnchor();
    if (goal && isCombatTrainingGoal(goal) && !hasCarriedFood && here && anchor) {
        const recoveryWaypoint = nearestLowHealthRecoveryWaypoint(here);
        const anchorLooksLikeCombatArea = distance(anchor, recoveryWaypoint) >= COMBAT_AREA_ANCHOR_RECOVERY_DISTANCE;
        if (anchorLooksLikeCombatArea && distance(here, recoveryWaypoint) <= LOW_HEALTH_RECOVERY_WAYPOINT_RANGE) {
            return undefined;
        }
        if (anchorLooksLikeCombatArea) {
            const recoveryAction: AgentAction = {
                kind: 'move_to',
                target: recoveryWaypoint,
                range: LOW_HEALTH_RECOVERY_WAYPOINT_RANGE,
                cause: 'low_health_seek_safe_recovery',
            };
            ctx.rememberBodyAction(recoveryAction);
            return { action: recoveryAction, cause: 'low_health_seek_safe_recovery' };
        }
    }

    const radius = ctx.behavior().returnToAnchorRadius ?? DEFAULT_RETURN_TO_ANCHOR_RADIUS;
    if (!anchor || !here || distance(here, anchor) <= radius) {
        return undefined;
    }

    const returnAction: AgentAction = { kind: 'move_to', target: anchor, range: radius, cause: 'low_health_return_to_anchor' };
    ctx.rememberBodyAction(returnAction);
    return { action: returnAction, cause: 'low_health_return_to_anchor' };
}

export function lowHealthHoldPositionAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { actions: AgentAction[]; cause: string; nooped: boolean } | undefined {
    if (!isLowHealth(perception) || firstFoodSlot(perception.resident?.inventory || []) !== undefined) {
        return undefined;
    }

    const cognition = ctx.cognition();
    const tick = ctx.options.state.tick;
    cognition.lastBodyTick = tick;

    // Distinguish stranded (at waypoint, no food path) from generic hold.
    const here = perception.resident?.position;
    const recoveryWaypoint = here ? nearestLowHealthRecoveryWaypoint(here) : undefined;
    const atWaypoint =
        here !== undefined && recoveryWaypoint !== undefined && distance(here, recoveryWaypoint) <= LOW_HEALTH_RECOVERY_WAYPOINT_RANGE;
    const cause = atWaypoint ? 'low_health_stranded' : 'low_health_hold_position';

    const interval = ctx.behavior().shareGoalsEveryTicks ?? DEFAULT_GOAL_SHARE_EVERY_TICKS;
    if (
        !shouldEmitPresenceBeacon({
            tick,
            hasActiveGoal: ctx.activeGoal() !== undefined,
            lastBeaconTick: cognition.lastPresenceBeaconTick,
            lastGoalShareTick: cognition.lastGoalShareTick,
            interval,
        })
    ) {
        return {
            actions: [{ kind: 'noop', cause: 'low_health_heal_wait' }],
            cause,
            nooped: false,
        };
    }

    // Consume the presence beacon slot to prevent unrelated goal-sharing while stranded.
    cognition.lastPresenceBeaconTick = tick;
    cognition.lastGoalShareTick = tick;

    // Extra dedup: "I am hurt at X,Y" speech fires at most once per 10 intervals (~10 min
    // at default cadence). Without this, the same text repeats on every beacon fire (~2 min).
    const speechDedup = interval * 10;
    const lastSpeech = cognition.lastLowHealthSpeechTick;
    if (lastSpeech !== undefined && tick - lastSpeech < speechDedup) {
        return {
            actions: [{ kind: 'noop', cause: 'low_health_heal_wait' }],
            cause: 'low_health_heal_wait',
            nooped: false,
        };
    }

    cognition.lastLowHealthSpeechTick = tick;
    return {
        actions: [{ kind: 'say', text: lowHealthHoldSpeech(perception) }],
        cause,
        nooped: false,
    };
}

export function lowHealthHoldSpeech(perception: HybridPerception): string {
    const here = perception.resident?.position;
    return (
        cleanSpeech(`I am hurt${here ? ` at ${here.x},${here.y}` : ''}. Holding near safety until I find food or heal.`) ||
        'I am hurt. Holding near safety until I find food or heal.'
    );
}

export function presenceBeaconPhase(ctx: HelperContext): 0 | 1 | 2 | 3 {
    if (ctx.options.state.tick < PRESENCE_BEACON_VARIETY_AFTER_TICKS) {
        return 0;
    }
    const interval = Math.max(1, ctx.behavior().shareGoalsEveryTicks ?? DEFAULT_GOAL_SHARE_EVERY_TICKS);
    return (Math.floor(ctx.options.state.tick / interval) % 4) as 0 | 1 | 2 | 3;
}

export function presenceBeaconAction(ctx: HelperContext, perception: HybridPerception): AgentAction | undefined {
    const cognition = ctx.cognition();
    if (
        !shouldEmitPresenceBeacon({
            tick: ctx.options.state.tick,
            hasActiveGoal: ctx.activeGoal() !== undefined,
            lastBeaconTick: cognition.lastPresenceBeaconTick,
            lastGoalShareTick: cognition.lastGoalShareTick,
            interval: ctx.behavior().shareGoalsEveryTicks ?? DEFAULT_GOAL_SHARE_EVERY_TICKS,
        })
    ) {
        return undefined;
    }

    const phase = presenceBeaconPhase(ctx);
    const includeNextStep = phase === 0;
    const includeGoal = phase !== 3;
    const text = statusSpeech(ctx, perception, presenceBeaconPrefix(ctx, perception), includeNextStep, includeGoal);

    // Suppress consecutive-identical PUBLIC beacons: the live audit saw the same
    // beacon line repeated up to 94x in a row. Only emit when the spoken text
    // changes (or after the timing gate's longer cooldown re-fires it later with
    // a different phrase). Scoped to the presence/status beacon path only —
    // combat/command/social-reply say-actions never flow through here.
    if (cognition.lastPresenceBeaconText === text) {
        return undefined;
    }

    cognition.lastPresenceBeaconTick = ctx.options.state.tick;
    cognition.lastGoalShareTick = ctx.options.state.tick;
    cognition.lastPresenceBeaconText = text;
    return { kind: 'say', text };
}

// Maps the presence-beacon phase to a phrasebook situation key. The nearby
// perception read-out ("Nearby I see 17 trees and 8 items") is deliberately NOT
// folded into the public say string — it read as debug telemetry in the live
// chat feed, the same reason raw tile coords were dropped (see composeStatusLine).
// presenceNearbySummary() stays available for the operator/digest/telemetry path.
function presenceBeaconSituation(phase: 0 | 1 | 2 | 3): string {
    switch (phase) {
        case 1:
            return 'presence_beacon.idle';
        case 2:
            return 'presence_beacon.scouting';
        case 3:
            return 'presence_beacon.route';
        default:
            return 'presence_beacon.online';
    }
}

export function presenceBeaconPrefix(ctx: HelperContext, perception: HybridPerception): string {
    const warmingUp = ctx.options.state.tick < PRESENCE_BEACON_VARIETY_AFTER_TICKS;
    const phase = warmingUp ? 0 : presenceBeaconPhase(ctx);
    const soul = ctx.options.soul;
    const display = soul.frontmatter.display || soul.frontmatter.name;
    // Deterministic, seeded by resident+tick — NO LLM call, no added latency.
    const seed = `${soul.frontmatter.name}:${ctx.options.state.tick}`;
    return pickPhrase({
        soul,
        situation: presenceBeaconSituation(phase),
        seed,
        params: { display },
    });
}

export function presenceNearbySummary(perception: HybridPerception): string | undefined {
    const treeCount = (perception.nearby?.objects || []).filter(object => LEVEL_ONE_TREE_IDS.has(object.objectId)).length;
    const itemCount = perception.nearby?.worldItems?.length || 0;
    const npcCount = perception.nearby?.npcs?.length || 0;
    const playerCount = perception.nearby?.players?.length || 0;
    const parts = [
        countPhrase(treeCount, 'tree'),
        countPhrase(itemCount, 'item'),
        countPhrase(npcCount, 'NPC', 'NPCs'),
        countPhrase(playerCount, 'player'),
    ].filter((part): part is string => Boolean(part));
    return joinSpeechList(parts.slice(0, 3));
}

export function socialKeepaliveAction(
    ctx: HelperContext,
    perception: HybridPerception,
    visibility: { anchor?: Pos; returnDue: boolean },
): AgentAction | undefined {
    if (ctx.commandPrefix() !== 'social' || visibility.returnDue) {
        return undefined;
    }
    if ((perception.nearby?.players || []).length > 0) {
        return undefined;
    }

    const cognition = ctx.cognition();
    const tick = ctx.options.state.tick;
    const last = cognition.lastSocialKeepaliveTick;
    if (typeof last === 'number' && tick - last < SOCIAL_KEEPALIVE_EVERY_TICKS) {
        return undefined;
    }

    cognition.lastSocialKeepaliveTick = tick;
    return {
        kind: 'say',
        text: cleanSpeech('No tester visible. Say "social help" for follow, status, wait, stop, trade, or where I am.'),
        cause: 'social_keepalive',
    };
}

export function agentKeepaliveAction(
    ctx: HelperContext,
    perception: HybridPerception,
    visibility: { anchor?: Pos; returnDue: boolean },
): AgentAction | undefined {
    if (ctx.commandPrefix() !== 'agent' || visibility.returnDue || typeof ctx.options.state.stuckSince !== 'number') {
        return undefined;
    }
    if (ctx.cognition().activeMove) {
        return undefined;
    }
    if ((perception.nearby?.players || []).length > 0) {
        return undefined;
    }

    const cognition = ctx.cognition();
    const tick = ctx.options.state.tick;
    const last = cognition.lastAgentKeepaliveTick;
    if (typeof last !== 'number') {
        cognition.lastAgentKeepaliveTick = tick;
        return undefined;
    }
    if (typeof last === 'number' && tick - last < AGENT_KEEPALIVE_EVERY_TICKS) {
        return undefined;
    }

    cognition.lastAgentKeepaliveTick = tick;
    return {
        kind: 'say',
        text: cleanSpeech('Agent online. No tester visible. Say "agent status" or "agent help" to check my goal, location, and next step.'),
        cause: 'agent_keepalive',
    };
}

const HERO_KEEPALIVE_EXCLUDED_PREFIXES = new Set(['agent', 'social', 'trade']);

export function heroKeepaliveAction(
    ctx: HelperContext,
    perception: HybridPerception,
    visibility: { anchor?: Pos; returnDue: boolean },
): AgentAction | undefined {
    if (
        HERO_KEEPALIVE_EXCLUDED_PREFIXES.has(ctx.commandPrefix()) ||
        visibility.returnDue ||
        typeof ctx.options.state.stuckSince !== 'number'
    ) {
        return undefined;
    }
    if (ctx.cognition().activeMove) {
        return undefined;
    }
    if ((perception.nearby?.players || []).length > 0) {
        return undefined;
    }

    const cognition = ctx.cognition();
    const tick = ctx.options.state.tick;
    const last = cognition.lastHeroKeepaliveTick;
    if (typeof last !== 'number') {
        cognition.lastHeroKeepaliveTick = tick;
        return undefined;
    }
    if (tick - last < HERO_KEEPALIVE_EVERY_TICKS) {
        return undefined;
    }

    cognition.lastHeroKeepaliveTick = tick;
    const display = ctx.options.soul.frontmatter.display || ctx.commandPrefix();
    return {
        kind: 'say',
        text: cleanSpeech(`${display} here. No observers visible. Here if you need me.`),
        cause: 'hero_keepalive',
    };
}

export function tradeStarterAction(ctx: HelperContext, perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
    if (ctx.commandPrefix() !== 'trade') {
        return undefined;
    }

    const cognition = ctx.cognition();
    if (cognition.manualPauseSinceTick !== undefined || cognition.waitResumeTick !== undefined) {
        return undefined;
    }
    if (perception.resident?.activeTrade || perception.resident?.inCombat || isLowHealth(perception)) {
        return undefined;
    }
    if (safeTradeOfferSlot(perception.resident?.inventory || []) === undefined) {
        return undefined;
    }

    const tick = ctx.options.state.tick;
    const targetState = currentFollowTarget(ctx);
    if (!targetState?.name && !targetState?.id) {
        return undefined;
    }

    const target = (perception.nearby?.players || []).find(player => {
        return (targetState.id && player.id === targetState.id) || (targetState.name && actorMatchesName(player, targetState.name));
    });
    if (target) {
        const cooldownKey = `trade-starter-offer:${actorName(target).toLowerCase()}`;
        const cooldowns = (ctx.options.state.hookCooldowns ||= {});
        if (tick < (cooldowns[cooldownKey] || 0)) {
            return undefined;
        }

        const action = tradeRequestOrApproach(perception, target, 'trade_starter_offer');
        if (!action || ctx.isRepeatedAction(action)) {
            return undefined;
        }
        if (action.kind === 'trade_request') {
            cooldowns[cooldownKey] = tick + TRADE_STARTER_OFFER_COOLDOWN_TICKS;
        }

        ctx.rememberBodyAction(action);
        const here = perception.resident?.position;
        if (action.kind === 'move_to' && here) {
            ctx.rememberActiveMove(action, here);
        } else {
            cognition.activeMove = undefined;
        }
        return { action, cause: action.cause || 'trade_starter_offer' };
    }

    const last = cognition.lastTradeKeepaliveTick;
    if (typeof last === 'number' && tick - last < TRADE_KEEPALIVE_EVERY_TICKS) {
        return undefined;
    }

    const action: AgentAction = {
        kind: 'say',
        text: 'I have starter supplies ready. Say "trade trade me" to trade, or "trade inventory" to inspect them.',
        cause: 'trade_keepalive',
    };
    cognition.lastTradeKeepaliveTick = tick;
    cognition.activeMove = undefined;
    ctx.rememberBodyAction(action);
    return { action, cause: 'trade_keepalive' };
}

export function statusSpeech(
    ctx: HelperContext,
    perception: HybridPerception,
    prefix: string,
    includeNextStep = false,
    includeGoal = true,
): string {
    const cognition = ctx.cognition();
    const next = includeNextStep
        ? (visibilityReturnNextStep(ctx, perception) ??
          nextStepSuggestion(perception, ctx.options.state.resident, ctx.activeGoal(), {
              currentTick: ctx.options.state.tick,
              pickupCooldowns: cognition.pickupCooldowns,
              explorationCooldowns: cognition.explorationCooldowns,
              targetFailureCooldowns: cognition.targetFailureCooldowns,
              lastScoutingSkillOpportunityTick: cognition.lastScoutingSkillOpportunityTick,
              interactWithOpenables: false,
          }))
        : undefined;
    const goal = includeGoal
        ? summarizeGoalForSpeech(ctx.activeGoal()?.description || 'staying findable and looking for useful actions', Boolean(next))
        : undefined;
    const need = survivalNeedSpeech(perception);
    return composeStatusLine({ prefix, goal, next, need });
}

/**
 * Assemble a resident's spoken status line from its parts. Deliberately omits
 * raw tile coordinates — `at 3231,3202` read as debug output in the live chat
 * feed (the dashboard map already shows position). Keeps the line legible for
 * human viewers: "<prefix>. Goal: <goal>. Next: <next><need>".
 */
export function composeStatusLine(parts: { prefix: string; goal?: string; next?: string; need: string }): string {
    const { prefix, goal, next, need } = parts;
    return cleanSpeech(goal ? `${prefix}. Goal: ${goal}.${next ? ` Next: ${next}` : ''}${need}` : `${prefix}.${need}`) || prefix;
}

export function visibilityReturnNextStep(ctx: HelperContext, perception: HybridPerception): string | undefined {
    const active = ctx.cognition().activeMove;
    const anchor = ctx.visibilityAnchor();
    const here = perception.resident?.position;
    if (!active || active.cause !== 'return_to_visibility_anchor' || !anchor || !here) {
        return undefined;
    }
    const radius = ctx.behavior().returnToAnchorRadius ?? DEFAULT_RETURN_TO_ANCHOR_RADIUS;
    if (distance(here, anchor) <= radius) {
        return undefined;
    }
    return `return toward my findable point at ${anchor.x},${anchor.y}.`;
}

export function survivalNeedSpeech(perception: HybridPerception): string {
    if (!isLowHealth(perception)) {
        return '';
    }
    if (firstFoodSlot(perception.resident?.inventory || []) !== undefined) {
        return ' Need: hurt and eating before danger.';
    }
    return ' Need: food or time to heal before fighting.';
}

export function nextStepSuggestion(
    perception: HybridPerception,
    residentId?: string,
    goal?: ActiveGoalState,
    cooldowns?: {
        currentTick?: number;
        pickupCooldowns?: Record<string, number>;
        explorationCooldowns?: Record<string, number>;
        targetFailureCooldowns?: Record<string, number>;
        lastScoutingSkillOpportunityTick?: number;
        interactWithOpenables?: boolean;
    },
): string | undefined {
    const currentTick = cooldowns?.currentTick ?? perception.tick ?? 0;
    const effectivePerception = withoutTargetFailedPerception(perception, cooldowns?.targetFailureCooldowns, currentTick);
    const here = effectivePerception.resident?.position;
    if (!here) {
        return undefined;
    }

    const routine = routineNextStepSuggestion(effectivePerception, here, goal);
    if (routine) {
        return routine;
    }

    const suppressFiremakingLogPickup = hasNearbyFire(effectivePerception);
    const item = (effectivePerception.nearby?.worldItems || [])
        .filter(
            candidate =>
                !(suppressFiremakingLogPickup && isFiremakingLog(candidate)) &&
                !isStaleSelfOwnedLog(candidate, residentId, effectivePerception.resident?.id) &&
                isUsefulGroundItem(candidate) &&
                !isOwnedByAnotherActor(candidate, residentId, effectivePerception.resident?.id) &&
                !isPickupOnCooldown(candidate, cooldowns?.pickupCooldowns, currentTick) &&
                !isExplorationOnCooldown(explorationItemCooldownKey(candidate), cooldowns?.explorationCooldowns, currentTick),
        )
        .sort((a, b) => {
            const priority = usefulGroundItemPriority(a) - usefulGroundItemPriority(b);
            return priority !== 0 ? priority : distance(here, a.position) - distance(here, b.position);
        })[0];
    if (item) {
        return `pick up ${itemLabel(item)} at ${item.position.x},${item.position.y}.`;
    }

    if (shouldPreviewExplorationNextStep(goal, cooldowns, currentTick)) {
        const exploration = explorationAction(
            effectivePerception,
            undefined,
            residentId,
            cooldowns?.pickupCooldowns,
            currentTick,
            cooldowns?.explorationCooldowns,
            { interactWithOpenables: cooldowns?.interactWithOpenables },
        );
        const explorationStep = explorationActionNextStepSuggestion(exploration);
        if (explorationStep) {
            return explorationStep;
        }
    }

    const workflowFallback = workflowGoalNextStepSuggestion(effectivePerception, here, goal);
    if (workflowFallback !== undefined) {
        return workflowFallback || undefined;
    }

    const safeTarget = safeCombatTarget(effectivePerception);
    if (safeTarget) {
        return `fight the safe ${actorName(safeTarget)} at ${safeTarget.position.x},${safeTarget.position.y}.`;
    }

    const fishingSpot = (effectivePerception.nearby?.npcs || [])
        .filter(isFishingSpot)
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (fishingSpot && hasSmallFishingNet(effectivePerception)) {
        return `fish at ${fishingSpot.position.x},${fishingSpot.position.y} with my small net.`;
    }

    const npc = (effectivePerception.nearby?.npcs || [])
        .filter(
            candidate =>
                !isExplorationOnCooldown(explorationActorCooldownKey(candidate), cooldowns?.explorationCooldowns, currentTick) &&
                !isExplorationOnCooldown(explorationActorFamilyCooldownKey(candidate), cooldowns?.explorationCooldowns, currentTick),
        )
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (npc) {
        return `talk to ${actorName(npc)} at ${npc.position.x},${npc.position.y}.`;
    }

    const tree = (effectivePerception.nearby?.objects || [])
        .filter(object => LEVEL_ONE_TREE_IDS.has(object.objectId))
        .filter(object => !isExplorationOnCooldown(explorationObjectCooldownKey(object), cooldowns?.explorationCooldowns, currentTick))
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (tree) {
        return `chop the tree at ${tree.position.x},${tree.position.y}.`;
    }

    if (cooldowns?.interactWithOpenables ?? true) {
        const obstacle = (effectivePerception.nearby?.objects || [])
            .filter(object => OPENABLE_OBSTACLE_IDS.has(object.objectId))
            .filter(object => !isExplorationOnCooldown(explorationObjectCooldownKey(object), cooldowns?.explorationCooldowns, currentTick))
            .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
        if (obstacle) {
            return `open the door or gate at ${obstacle.position.x},${obstacle.position.y}.`;
        }
    }

    const player = (effectivePerception.nearby?.players || []).sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (player) {
        return `stay near ${actorName(player)} and answer commands.`;
    }

    return undefined;
}

export function routineNextStepSuggestion(perception: HybridPerception, here: Pos, goal?: ActiveGoalState): string | undefined {
    if (!goal || (!isFiremakingGoal(goal) && !isWoodcuttingTrainingGoal(goal))) {
        return undefined;
    }

    const inventory = perception.resident?.inventory || [];
    if (isFiremakingGoal(goal) && findSlot(inventory, isTinderbox) !== undefined && findSlot(inventory, isFiremakingLog) !== undefined) {
        return 'use tinderbox on logs.';
    }

    const tree = (perception.nearby?.objects || [])
        .filter(object => LEVEL_ONE_TREE_IDS.has(object.objectId))
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (tree && hasWoodcuttingAxe(perception)) {
        return `chop the tree at ${tree.position.x},${tree.position.y}.`;
    }

    return undefined;
}

export function workflowGoalNextStepSuggestion(perception: HybridPerception, here: Pos, goal?: ActiveGoalState): string | null | undefined {
    if (!goal) {
        return undefined;
    }

    if (isStarterFishingGoal(goal)) {
        if (!hasSmallFishingNet(perception)) {
            return 'find a small fishing net.';
        }
        const inventory = perception.resident?.inventory || [];
        if (findSlot(inventory, isStarterRawFish) !== undefined) {
            const heatSource = (perception.nearby?.objects || [])
                .filter(object => COOKING_HEAT_OBJECT_IDS.has(object.objectId))
                .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
            if (heatSource) {
                return `cook my raw fish at ${heatSource.position.x},${heatSource.position.y}.`;
            }
            if (findSlot(inventory, isTinderbox) !== undefined && findSlot(inventory, isFiremakingLog) !== undefined) {
                return 'make a cooking fire for my raw fish.';
            }
            return 'find a fire or range to cook my raw fish.';
        }
        const fishingSpot = (perception.nearby?.npcs || [])
            .filter(isFishingSpot)
            .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
        return fishingSpot
            ? `fish at ${fishingSpot.position.x},${fishingSpot.position.y} with my small net.`
            : 'look for a Fishing spot to net shrimp.';
    }

    if (isCombatTrainingGoal(goal)) {
        const safeTarget = safeCombatTarget(perception);
        return safeTarget
            ? `fight the safe ${actorName(safeTarget)} at ${safeTarget.position.x},${safeTarget.position.y}.`
            : 'look for a safe low-level creature to fight.';
    }

    if (isFiremakingGoal(goal) || isWoodcuttingTrainingGoal(goal)) {
        const tree = (perception.nearby?.objects || [])
            .filter(object => LEVEL_ONE_TREE_IDS.has(object.objectId))
            .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
        const hasAxe = hasWoodcuttingAxe(perception);

        if (isFiremakingGoal(goal)) {
            if (tree && !hasAxe) {
                return 'find a woodcutting axe to gather logs.';
            }
            return null;
        }

        if (!hasAxe) {
            return 'find a woodcutting axe.';
        }
        return 'look for an ordinary tree to chop.';
    }

    return undefined;
}

export function shouldPreviewExplorationNextStep(goal: ActiveGoalState | undefined, cooldowns: any, currentTick: number): boolean {
    if (!goal || !isExplorationGoal(goal)) {
        return false;
    }
    if (currentTick - goal.createdAtTick < SCOUTING_SKILL_OPPORTUNITY_MIN_GOAL_AGE_TICKS) {
        return true;
    }
    const lastSkillOpportunity = cooldowns?.lastScoutingSkillOpportunityTick || 0;
    return lastSkillOpportunity > 0 && currentTick - lastSkillOpportunity < SCOUTING_SKILL_OPPORTUNITY_COOLDOWN_TICKS;
}

export function explorationActionNextStepSuggestion(action: AgentAction | undefined): string | undefined {
    if (!action) {
        return undefined;
    }

    const target = modelActionTarget(action);
    const targetText = target ? `${target.x},${target.y}` : undefined;
    if (action.cause === 'explore_tree_stand') {
        return targetText ? `scout the tree stand at ${targetText}.` : 'scout a nearby tree stand.';
    }
    if (action.cause === 'explore_visible_object') {
        return targetText ? `check the landmark at ${targetText}.` : 'check a nearby landmark.';
    }
    if (action.cause === 'explore_visible_item') {
        return targetText ? `check the item at ${targetText}.` : 'check a nearby item.';
    }
    if (action.cause === 'explore_patrol') {
        return targetText ? `patrol toward ${targetText}.` : 'patrol nearby.';
    }
    if (action.cause === 'explore_talk_to_npc') {
        const targetActor = 'target' in action ? actorLike(action.target) : undefined;
        if (targetActor) {
            return `talk to ${actorName(targetActor)} at ${targetActor.position.x},${targetActor.position.y}.`;
        }
        return targetText ? `walk toward a nearby NPC at ${targetText}.` : 'talk to a nearby NPC.';
    }
    return undefined;
}

export function isLocalRoutineCause(cause: string, action: AgentAction): boolean {
    if (action.kind === 'use_item_on_item') {
        return false;
    }
    return /woodcutting_level1_routine|firemaking_fallback|firemaking_gather_logs|starter_fishing_missing_heat/i.test(
        `${cause} ${action.cause || ''}`,
    );
}

export function routineLoopFamily(cause: string, action: AgentAction): string {
    const label = `${cause} ${action.cause || ''}`;
    if (/starter_fishing_missing_heat/i.test(label)) {
        return 'starter-fishing-cooking';
    }
    if (/woodcutting|firemaking/i.test(label)) {
        return 'woodcutting-firemaking';
    }
    return cause;
}

export function isConcreteExplorationOverride(action: AgentAction): boolean {
    return /explore_talk_to_npc|opportunistic_pickup|explore_visible_item/i.test(String(action.cause || ''));
}

export function isStuckRecoveryAction(action: AgentAction): boolean {
    if (action.kind === 'say') {
        return false;
    }
    return /explore_talk_to_npc|explore_visible_object|explore_tree_stand|explore_open_obstacle|explore_patrol/i.test(
        String(action.cause || ''),
    );
}

export function targetFailureAwarePatrolTarget(
    perception: HybridPerception,
    here: Pos,
    anchor: Pos | undefined,
    currentTick: number,
    explorationCooldowns: Record<string, number>,
    targetFailureCooldowns?: Record<string, number>,
): Pos | undefined {
    const blockedTiles = objectOccupiedTiles(perception);
    const baseTarget = explorationPatrolTarget(here, anchor, currentTick, explorationCooldowns, blockedTiles);
    if (!stuckPatrolCandidateUnavailable(baseTarget, here, blockedTiles, targetFailureCooldowns, currentTick)) {
        return baseTarget;
    }

    let fallback: Pos | undefined;
    for (let step = EXPLORATION_PATROL_STEP_DISTANCE; step <= EXPLORATION_PATROL_MAX_DISTANCE; step += EXPLORATION_PATROL_STEP_DISTANCE) {
        const directions = localPatrolDirections(step);
        const startIndex = patrolDirectionIndex(here, currentTick, directions.length);
        const candidates = directions.map(direction => ({ x: here.x + direction.dx, y: here.y + direction.dy, level: here.level }));
        for (let offset = 0; offset < candidates.length; offset += 1) {
            const candidate = candidates[(startIndex + offset) % candidates.length];
            if (stuckPatrolCandidateUnavailable(candidate, here, blockedTiles, targetFailureCooldowns, currentTick)) {
                continue;
            }
            fallback ??= candidate;
            if (!isExplorationOnCooldown(explorationPatrolCooldownKey(candidate), explorationCooldowns, currentTick)) {
                return candidate;
            }
        }
    }

    return fallback;
}

export function stuckPreInferencePatrolTarget(
    perception: HybridPerception,
    here: Pos,
    anchor: Pos | undefined,
    currentTick: number,
    explorationCooldowns: Record<string, number>,
    targetFailureCooldowns?: Record<string, number>,
): Pos | undefined {
    const blockedTiles = objectOccupiedTiles(perception);
    let fallback: Pos | undefined;
    const nearbyCandidates = [
        { x: here.x + 1, y: here.y, level: here.level },
        { x: here.x, y: here.y + 1, level: here.level },
        { x: here.x - 1, y: here.y, level: here.level },
        { x: here.x, y: here.y - 1, level: here.level },
    ];
    const startIndex = Math.abs(here.x * 31 + here.y * 17 + currentTick) % nearbyCandidates.length;
    for (let offset = 0; offset < nearbyCandidates.length; offset += 1) {
        const candidate = nearbyCandidates[(startIndex + offset) % nearbyCandidates.length];
        if (stuckPatrolCandidateUnavailable(candidate, here, blockedTiles, targetFailureCooldowns, currentTick)) {
            continue;
        }
        fallback ??= candidate;
        if (!isExplorationOnCooldown(explorationPatrolCooldownKey(candidate), explorationCooldowns, currentTick)) {
            return candidate;
        }
    }

    if (fallback) {
        return fallback;
    }

    const target = explorationPatrolTarget(here, anchor, currentTick, explorationCooldowns, blockedTiles);
    if (!stuckPatrolCandidateUnavailable(target, here, blockedTiles, targetFailureCooldowns, currentTick)) {
        return target;
    }

    return fallback;
}

export function objectOccupiedTiles(perception: HybridPerception): ReadonlySet<string> | undefined {
    const objects = perception.nearby?.objects || [];
    if (objects.length === 0) {
        return undefined;
    }
    return new Set(objects.map(object => positionKey(object.position)));
}

export function stuckPatrolCandidateUnavailable(
    candidate: Pos,
    here: Pos,
    blockedTiles: ReadonlySet<string> | undefined,
    targetFailureCooldowns: Record<string, number> | undefined,
    currentTick: number,
): boolean {
    return (
        positionsEqual(candidate, here) ||
        Boolean(blockedTiles?.has(positionKey(candidate))) ||
        isTargetFailureCooldownActive(candidate, targetFailureCooldowns, currentTick)
    );
}

export function moveTargetFailureCooldownActive(
    action: AgentAction | undefined,
    targetFailureCooldowns: Record<string, number> | undefined,
    currentTick: number,
): boolean {
    if (!action || action.kind !== 'move_to' || !('target' in action)) {
        return false;
    }
    const target = positionLike(action.target);
    return Boolean(target && isTargetFailureCooldownActive(target, targetFailureCooldowns, currentTick));
}

export function shouldPreferScoutingSkillOpportunity(action: AgentAction | undefined): boolean {
    if (!action) {
        return true;
    }
    return /explore_talk_to_npc|explore_visible_object|explore_tree_stand|explore_patrol/i.test(String(action.cause || ''));
}

export function modelActionTarget(action: AgentAction): Pos | undefined {
    if (action.kind === 'move_to' && 'target' in action) {
        return positionLike(action.target);
    }

    return actionTargetPosition(action);
}

export function sameMoveIntent(action: AgentAction, active: ActiveMoveState): boolean {
    if (action.kind !== 'move_to') {
        return false;
    }

    const target = positionLike(action.target);
    const range = typeof action.range === 'number' ? action.range : 0;
    return Boolean(target && positionsEqual(target, active.target) && range === (active.range ?? 0));
}

export function shouldInterruptActiveMove(action: AgentAction): boolean {
    return /^(say|use_item_on_item|item_action|trade_request|trade_offer_item|trade_accept|trade_decline)$/.test(action.kind);
}

export function moveIntentAction(active: ActiveMoveState, cause: string): AgentAction {
    return {
        kind: 'move_to',
        target: active.target,
        range: active.range ?? 0,
        cause,
    };
}

export function firstGoalCoordinate(text: string, fallbackLevel: number): Pos | undefined {
    const patterns = [
        /x\s*[:=]\s*(\d{3,5})\D{0,24}y\s*[:=]\s*(\d{3,5})(?:\D{0,24}(?:level|z)\s*[:=]\s*(\d+))?/i,
        /(?:at|to|near|toward|target)?\s*(\d{3,5})\s*,\s*(\d{3,5})(?:\s*,\s*(?:level|z)?\s*(\d+))?/i,
    ];

    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (!match) {
            continue;
        }
        const x = Number(match[1]);
        const y = Number(match[2]);
        const level = match[3] === undefined ? fallbackLevel : Number(match[3]);
        if (Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(level) && x >= 1000 && y >= 1000) {
            return { x, y, level };
        }
    }

    return undefined;
}

// --- Helper Utilities internally needed ---
export function actionTarget(action: AgentAction): unknown {
    return 'target' in action ? action.target : undefined;
}

function countPhrase(count: number, singular: string, plural = `${singular}s`): string | undefined {
    if (count <= 0) {
        return undefined;
    }
    return `${count} ${count === 1 ? singular : plural}`;
}

function joinSpeechList(parts: string[]): string | undefined {
    if (parts.length === 0) {
        return undefined;
    }
    if (parts.length === 1) {
        return parts[0];
    }
    if (parts.length === 2) {
        return `${parts[0]} and ${parts[1]}`;
    }
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function getVisibleAggressors(perception: HybridPerception): Actor[] {
    const attackers = new Set<string>();
    for (const event of perception.events || []) {
        if (['hit_taken', 'hit', 'attacked'].includes(String(event.kind || ''))) {
            const attacker = actorLike(event.from);
            if (attacker) {
                attackers.add(attacker.id);
            }
        }
    }
    const nearbyActors = [...(perception.nearby?.npcs || []), ...(perception.nearby?.players || [])];
    return nearbyActors.filter(actor => attackers.has(actor.id));
}

function selectPreferredAggressor(aggressors: Actor[], residentPos: Pos): Actor {
    if (aggressors.length === 0) {
        throw new Error('selectPreferredAggressor called with empty aggressors array');
    }
    const sorted = [...aggressors].sort((a, b) => {
        const hpA = a.hpFraction !== undefined ? a.hpFraction : 1.0;
        const hpB = b.hpFraction !== undefined ? b.hpFraction : 1.0;
        if (hpA !== hpB) {
            return hpA - hpB;
        }

        const lvlA = a.combatLevel !== undefined ? a.combatLevel : 0;
        const lvlB = b.combatLevel !== undefined ? b.combatLevel : 0;
        if (lvlA !== lvlB) {
            return lvlA - lvlB;
        }

        const distA = distance(a.position, residentPos);
        const distB = distance(b.position, residentPos);
        return distA - distB;
    });
    return sorted[0];
}

function sameCombatActor(left: Actor | undefined, right: Actor | undefined): boolean {
    if (!left || !right) {
        return false;
    }
    return left.id === right.id;
}

function classifyCombatDecision(
    perception: HybridPerception,
    target: Actor,
    foodSlot: number | undefined,
): 'retaliate_confident' | 'retaliate_after_eat' | 'retreat_outmatched' | 'retreat_low_hp' {
    const ownHpFraction = (perception.resident?.hp?.current || 0) / (perception.resident?.hp?.max || 1);
    const targetHpFraction = target.hpFraction !== undefined ? target.hpFraction : 1.0;
    const ownCombatLevel = perception.resident?.combatLevel || 1;
    const targetCombatLevel = target.combatLevel || 1;

    if (ownHpFraction < 0.15 || (ownHpFraction <= 0.3 && foodSlot === undefined)) {
        return 'retreat_low_hp';
    }

    if (ownHpFraction < 0.3 || !isSafeCombatTarget(target) || targetCombatLevel > ownCombatLevel + 5) {
        return 'retreat_outmatched';
    }

    if (ownHpFraction >= 0.3 && ownHpFraction <= 0.6 && foodSlot !== undefined) {
        return 'retaliate_after_eat';
    }

    if (ownHpFraction > 0.6 && targetHpFraction < ownHpFraction && isSafeCombatTarget(target)) {
        return 'retaliate_confident';
    }

    return 'retaliate_confident';
}

function isFiremakingIntent(command: string, fullText: string): boolean {
    return (
        /^(make a fire|make fire|light a fire|light fire|start a fire|burn logs|firemaking)\b/.test(command) ||
        /\b(make a fire|make fire|light a fire|light fire|start a fire|firemaking)\b/.test(fullText)
    );
}

const ESSENTIAL_TOOL_KEY_PATTERN = /(tinderbox|axe|pickaxe)/i;

// --- EXPORTED HELPER METHODS EXTRACTED FROM ORCHESTRATOR ---

export const LUMBRIDGE_STARTER_FISHING_SPOTS = [...BODY_LUMBRIDGE_STARTER_FISHING_SPOTS];
export const LUMBRIDGE_CASTLE_RANGE = BODY_LUMBRIDGE_CASTLE_RANGE;
export const STARTER_FISHING_ROUTE_MAX_DISTANCE = BODY_STARTER_FISHING_ROUTE_MAX_DISTANCE;
export const STARTER_FISHING_SPOT_DISCOVERY_RANGE = BODY_STARTER_FISHING_SPOT_DISCOVERY_RANGE;
export const VISIBILITY_ANCHOR_RETURN_STEP_DISTANCE = 8;
export const VISIBILITY_ANCHOR_RETURN_DIRECT_DISTANCE = 24;
export const SCOUTING_ANCHOR_RETURN_MIN_GOAL_AGE_TICKS = 120;
export const SCOUTING_ANCHOR_RETURN_MIN_DISTANCE = 32;
export const SCOUTING_SKILL_OPPORTUNITY_MIN_GOAL_AGE_TICKS = 120;
export const SCOUTING_SKILL_OPPORTUNITY_COOLDOWN_TICKS = 900;
export const PICKUP_TARGET_COOLDOWN_TICKS = 600;
export const EXPLORATION_TARGET_COOLDOWN_TICKS = 600;
export const MAX_PROMPT_MEMORIES = 6;
export const MAX_PROMPT_MEMORY_CHARS = 360;
export const DEFAULT_FOLLOW_RADIUS = 2;
export const BRAIN_TIMEOUT_BACKOFF_TICKS = 600;

/**
 * Default TTL (ticks) applied to a Brain-authored goal when the model omits
 * `ttlTicks`. Matches the dominant hard-coded factory norm (600). LLM goals
 * frequently omit a TTL, and {@link goalExpired} treats an undefined TTL as
 * "never expires" — which made unsatisfiable goals ("Follow Codex" when Codex
 * is absent, "Find an axe" when none exists) immortal, leaving residents stuck.
 * A bounded default lets every goal self-retire so the Brain re-plans.
 */
export const DEFAULT_BRAIN_GOAL_TTL_TICKS = 600;

/**
 * Resolve the effective TTL for a Brain-authored goal. Non-positive / non-finite
 * model values are treated as omitted and fall back to the bounded default.
 */
export function resolveBrainGoalTtl(modelTtl: number | undefined): number {
    return typeof modelTtl === 'number' && Number.isFinite(modelTtl) && modelTtl > 0 ? modelTtl : DEFAULT_BRAIN_GOAL_TTL_TICKS;
}

export function goalExpired(ctx: HelperContext, goal: ActiveGoalState): boolean {
    return goal.ttlTicks !== undefined && ctx.options.state.tick - goal.createdAtTick > goal.ttlTicks;
}

export function goalExpiresBefore(goal: ActiveGoalState, tick: number): boolean {
    return goal.ttlTicks !== undefined && goal.createdAtTick + goal.ttlTicks < tick;
}

export function fireLitEventObserved(perception: HybridPerception): boolean {
    return (perception.events || []).some(event => {
        const kind = typeof event.kind === 'string' ? event.kind : '';
        const text = typeof event.text === 'string' ? event.text.toLowerCase() : '';
        return kind === 'fire_lit' || /fire catches|logs begin to burn/.test(text);
    });
}

export function pickupActionWorldItem(action: AgentAction): WorldItem | undefined {
    const candidate = action as { option?: unknown; target?: unknown };
    if (action.kind !== 'interact' || !/pick[- ]?up/i.test(String(candidate.option || ''))) {
        return undefined;
    }

    return worldItemLike(candidate.target);
}

export function shouldLetInteractionPipelineApproach(action: AgentAction): boolean {
    if (action.kind === 'attack') {
        return true;
    }
    return Boolean(pickupActionWorldItem(action));
}

export function explorationCooldownKeyFromAction(action: AgentAction): string | undefined {
    if (!/explore|opportunistic_pickup|routine_loop_break|stuck_move_recovery|stuck_open_obstacle/i.test(String(action.cause || ''))) {
        return undefined;
    }
    if (!('target' in action) || !isRecord(action.target)) {
        return undefined;
    }

    const directPosition = positionLike(action.target);
    if (directPosition) {
        return explorationPatrolCooldownKey(directPosition);
    }

    const actor = actorLike(action.target);
    if (actor?.kind === 'npc') {
        return explorationActorCooldownKey(actor);
    }

    const position = positionLike(action.target.position);
    if (!position) {
        return undefined;
    }
    if (typeof action.target.objectId === 'number') {
        return explorationObjectCooldownKey({ objectId: action.target.objectId, position });
    }
    if (typeof action.target.itemId === 'number' && typeof action.target.amount === 'number') {
        return explorationItemCooldownKey({
            itemId: action.target.itemId,
            key: typeof action.target.key === 'string' ? action.target.key : undefined,
            amount: action.target.amount,
            position,
            ownerId: typeof action.target.ownerId === 'string' ? action.target.ownerId : undefined,
        });
    }

    return undefined;
}

import { retireNervousRulesMd, upsertNervousRulesMd } from '../nervous-system/rules-md';

export function preInferenceResult(
    ctx: HelperContext,
    action: AgentAction,
    cause: string,
    perception: HybridPerception,
    visibility: { anchor?: Pos; returnDue: boolean },
): ThoughtResult | undefined {
    let actions = [action];
    let resultCause = cause;
    const stabilized = stabilizedMoveAction(ctx, actions[0], perception, visibility.anchor);
    if (stabilized) {
        actions = [stabilized.action];
        resultCause = stabilized.cause;
    }

    actions = suppressRepeatedActions(ctx, actions);
    if (actions.length === 0) {
        return undefined;
    }
    ctx.cognition().lastBodyTick = ctx.options.state.tick;
    return {
        actions,
        cause: resultCause,
        envelopeTokens: 0,
        nooped: false,
    };
}

export function goalCoordinateMoveAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    const here = perception.resident?.position;
    if (!goal || !here) {
        return undefined;
    }

    const goalText = `${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`;
    if (!/move|walk|go to|travel|tree|chop|wood|logs|fish|combat|attack|bone|bury/i.test(goalText)) {
        return undefined;
    }

    const target = firstGoalCoordinate(goalText, here.level);
    if (!target || distance(here, target) <= 1) {
        return undefined;
    }

    return {
        action: { kind: 'move_to', target, range: 1, cause: 'goal_coordinate_move' },
        cause: 'goal_coordinate_move',
    };
}

export function explorationOrSkillOpportunityAction(
    ctx: HelperContext,
    perception: HybridPerception,
    anchor?: Pos,
): { action: AgentAction; cause: string } | undefined {
    let exploreAction = explorationAction(
        perception,
        anchor,
        ctx.options.state.resident,
        ctx.pickupCooldowns(),
        ctx.options.state.tick,
        ctx.explorationCooldowns(),
        { interactWithOpenables: false },
    );
    if (moveTargetFailureCooldownActive(exploreAction, ctx.cognition().targetFailureCooldowns, ctx.options.state.tick)) {
        const here = perception.resident?.position;
        if (!here) {
            exploreAction = undefined;
        } else {
            const patrolTarget = targetFailureAwarePatrolTarget(
                perception,
                here,
                anchor,
                ctx.options.state.tick,
                ctx.explorationCooldowns(),
                ctx.cognition().targetFailureCooldowns,
            );
            exploreAction = patrolTarget
                ? {
                      kind: 'move_to',
                      target: patrolTarget,
                      range: distance(here, patrolTarget) <= 1 ? 0 : 1,
                      cause: 'explore_patrol',
                  }
                : undefined;
        }
    }
    const opportunity = scoutingSkillOpportunityAction(ctx, perception);
    if (opportunity && shouldPreferScoutingSkillOpportunity(exploreAction)) {
        return opportunity;
    }
    if (!exploreAction || exploreAction.cause === 'explore_patrol') {
        const anchorReturn = scoutingAnchorReturnAction(ctx, perception, anchor);
        if (anchorReturn) {
            return anchorReturn;
        }
    }
    if (!exploreAction) {
        return undefined;
    }
    return {
        action: exploreAction,
        cause: exploreAction.cause === 'opportunistic_pickup' ? 'opportunistic_pickup' : 'exploration_fallback',
    };
}

export function scoutingAnchorReturnAction(
    ctx: HelperContext,
    perception: HybridPerception,
    anchor?: Pos,
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    const here = perception.resident?.position;
    if (!goal || !isExplorationGoal(goal) || !here || !anchor) {
        return undefined;
    }
    if (ctx.options.state.tick - goal.createdAtTick < SCOUTING_ANCHOR_RETURN_MIN_GOAL_AGE_TICKS) {
        return undefined;
    }

    const radius = ctx.behavior().returnToAnchorRadius ?? DEFAULT_RETURN_TO_ANCHOR_RADIUS;
    if (distance(here, anchor) <= Math.max(SCOUTING_ANCHOR_RETURN_MIN_DISTANCE, radius * 2)) {
        return undefined;
    }

    const farFromAnchor = distance(here, anchor) > VISIBILITY_ANCHOR_RETURN_DIRECT_DISTANCE;
    return {
        action: {
            kind: 'move_to',
            target: farFromAnchor ? stepToward(here, anchor, VISIBILITY_ANCHOR_RETURN_STEP_DISTANCE) : anchor,
            ...(farFromAnchor ? { range: 1 } : {}),
            cause: 'return_to_visibility_anchor',
        },
        cause: 'return_to_visibility_anchor',
    };
}

export function scoutingSkillOpportunityAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    if (!goal || !isExplorationGoal(goal)) {
        return undefined;
    }
    if (ctx.options.state.tick - goal.createdAtTick < SCOUTING_SKILL_OPPORTUNITY_MIN_GOAL_AGE_TICKS) {
        return undefined;
    }

    const cognition = ctx.cognition();
    const last = cognition.lastScoutingSkillOpportunityTick || 0;
    if (last > 0 && ctx.options.state.tick - last < SCOUTING_SKILL_OPPORTUNITY_COOLDOWN_TICKS) {
        return undefined;
    }

    const fireAction = firemakingAction(perception);
    if (fireAction) {
        ctx.clearGoalMomentum();
        cognition.activeGoal = firemakingGoal(ctx.options.state.tick);
        cognition.lastScoutingSkillOpportunityTick = ctx.options.state.tick;
        cognition.lastGoalShareTick = undefined;
        return { action: actionWithCause(fireAction, 'scouting_firemaking_opportunity'), cause: 'scouting_firemaking_opportunity' };
    }

    const woodcuttingAction = levelOneWoodcuttingAction(perception);
    if (woodcuttingAction) {
        ctx.clearGoalMomentum();
        cognition.activeGoal = woodcuttingGoal(ctx.options.state.tick);
        cognition.lastScoutingSkillOpportunityTick = ctx.options.state.tick;
        cognition.lastGoalShareTick = undefined;
        return {
            action: actionWithCause(woodcuttingAction, 'scouting_woodcutting_opportunity'),
            cause: 'scouting_woodcutting_opportunity',
        };
    }

    return undefined;
}

export function fallbackAction(
    ctx: HelperContext,
    perception: Perception,
    visibility: { anchor?: Pos; returnDue: boolean },
): { action: AgentAction; cause: string } | undefined {
    const view = perception as HybridPerception;
    const goal = ctx.activeGoal();
    const prayerAction =
        goal && /prayer|bone|bones|bury/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`)
            ? prayerTrainingAction(view, ctx.cognition().targetFailureCooldowns, ctx.options.state.tick)
            : undefined;
    if (prayerAction) {
        return { action: prayerAction, cause: prayerAction.cause || 'prayer_bury_bones' };
    }

    const combatAction =
        goal && isCombatTrainingGoal(goal)
            ? combatTrainingAction(view, ctx.pickupCooldowns(), ctx.options.state.tick, ctx.cognition().targetFailureCooldowns)
            : undefined;
    if (combatAction) {
        return { action: combatAction, cause: combatAction.cause || 'combat_training' };
    }

    const miningAction = starterMiningGoalAction(ctx, view);
    if (miningAction) {
        return miningAction;
    }

    const cooksAssistantAction = cooksAssistantGoalAction(ctx, view);
    if (cooksAssistantAction) {
        return cooksAssistantAction;
    }

    const starterFishing = starterFishingGoalAction(ctx, view);
    if (starterFishing) {
        return starterFishing;
    }

    const fireAction =
        goal && !isStarterFishingGoal(goal) && /fire|burn|logs|tinderbox|light/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`)
            ? firemakingAction(view)
            : undefined;
    if (fireAction) {
        return { action: fireAction, cause: 'firemaking_fallback' };
    }

    const explorationFallback =
        goal && isExplorationGoal(goal) ? explorationOrSkillOpportunityAction(ctx, view, visibility.anchor) : undefined;
    if (explorationFallback) {
        return explorationFallback;
    }

    const anchorReturn = goal ? fallbackVisibilityAnchorReturnAction(ctx, view, visibility) : undefined;
    if (anchorReturn) {
        return anchorReturn;
    }

    const follow = followAction(ctx, view);
    if (follow) {
        return { action: follow, cause: 'follow_player_fallback' };
    }

    const fallbackAnchorReturn = visibilityAnchorReturnAction(ctx, view, visibility);
    if (fallbackAnchorReturn) {
        return fallbackAnchorReturn;
    }

    return undefined;
}

export function starterMiningGoalAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    if (!goal || !isMiningGoal(goal)) {
        return undefined;
    }

    const action = starterMiningAction(perception, ctx.cognition().targetFailureCooldowns, ctx.options.state.tick);
    return action ? { action, cause: action.cause || 'starter_mining' } : undefined;
}

export function cooksAssistantGoalAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    if (!isCooksAssistantQuestGoal(goal)) {
        ctx.cognition().pendingQuestDialogue = undefined;
        return undefined;
    }

    const dialogueAction = pendingCooksAssistantDialogueAction(ctx, perception);
    if (dialogueAction) {
        return { action: dialogueAction, cause: dialogueAction.cause || 'cooks_assistant_dialogue_step' };
    }

    const action = isCooksAssistantStartGoal(goal)
        ? cooksAssistantStartAction(perception, ctx.cognition().targetFailureCooldowns, ctx.options.state.tick)
        : cooksAssistantQuestAction(perception, ctx.cognition().targetFailureCooldowns, ctx.options.state.tick);
    if (action?.kind === 'interact' && /cooks_assistant_(talk_to_cook|hand_in_ingredients)/.test(action.cause || '')) {
        ctx.cognition().pendingQuestDialogue = {
            questId: COOKS_ASSISTANT_QUEST_ID,
            phase: action.cause === 'cooks_assistant_hand_in_ingredients' ? 'hand_in' : 'start',
            step: 0,
            startedAtTick: ctx.options.state.tick,
            updatedAtTick: ctx.options.state.tick,
        };
    }
    return action ? { action, cause: action.cause || 'cooks_assistant_start' } : undefined;
}

function pendingCooksAssistantDialogueAction(ctx: HelperContext, perception: HybridPerception): AgentAction | undefined {
    const cognition = ctx.cognition();
    const pending = cognition.pendingQuestDialogue;
    if (!pending || pending.questId !== COOKS_ASSISTANT_QUEST_ID) {
        return undefined;
    }

    if (pending.phase === 'hand_in' && cooksAssistantQuestComplete(perception)) {
        cognition.pendingQuestDialogue = undefined;
        return undefined;
    }

    const sequence = pending.phase === 'hand_in' ? COOKS_ASSISTANT_HAND_IN_DIALOGUE_SEQUENCE : COOKS_ASSISTANT_DIALOGUE_SEQUENCE;
    const action = sequence[pending.step];
    if (!action) {
        cognition.pendingQuestDialogue = undefined;
        clearCooksAssistantTargetFailures(cognition.targetFailureCooldowns);
        return undefined;
    }

    const nextStep = pending.step + 1;
    if (nextStep >= sequence.length) {
        cognition.pendingQuestDialogue = undefined;
        clearCooksAssistantTargetFailures(cognition.targetFailureCooldowns);
    } else {
        cognition.pendingQuestDialogue = {
            ...pending,
            step: nextStep,
            updatedAtTick: ctx.options.state.tick,
        };
    }
    return action;
}

function cooksAssistantQuestComplete(perception: HybridPerception): boolean {
    const quest = perception.resident?.quests?.[COOKS_ASSISTANT_QUEST_ID];
    return quest?.complete === true || quest?.progress === 'complete';
}

function cooksAssistantQuestStarted(perception: HybridPerception): boolean {
    const quest = perception.resident?.quests?.[COOKS_ASSISTANT_QUEST_ID];
    if (!quest) {
        return false;
    }
    return quest.complete === true || quest.progress === 'complete' || (typeof quest.progress === 'number' && quest.progress >= 50);
}

function clearCooksAssistantTargetFailures(targetFailureCooldowns: Record<string, number> | undefined): void {
    if (!targetFailureCooldowns) {
        return;
    }
    for (const key of Object.keys(targetFailureCooldowns)) {
        if (/cook|lumbridge_castle_cook/i.test(key)) {
            delete targetFailureCooldowns[key];
        }
    }
}

export function starterFishingGoalAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    if (!goal || !isStarterFishingGoal(goal)) {
        return undefined;
    }

    const cookingAction = starterFishingCookingAction(ctx, perception);
    if (cookingAction) {
        return { action: cookingAction, cause: cookingAction.cause || 'starter_fishing_cooking' };
    }

    const bankRecoveryAction = starterFishingBankRecoveryAction(ctx, perception);
    if (bankRecoveryAction) {
        return { action: bankRecoveryAction, cause: bankRecoveryAction.cause || 'starter_fishing_reposition_to_bank' };
    }

    const fishingAction = starterFishingRouteAction(perception);
    if (fishingAction) {
        if (moveTargetFailureCooldownActive(fishingAction, ctx.cognition().targetFailureCooldowns, ctx.options.state.tick)) {
            const fallback = explorationOrSkillOpportunityAction(ctx, perception, ctx.visibilityAnchor());
            if (fallback) {
                return {
                    action: actionWithCause(fallback.action, 'starter_fishing_route_blocked'),
                    cause: 'starter_fishing_route_blocked',
                };
            }
            return {
                action: {
                    kind: 'say',
                    text: 'I cannot reach the Lumbridge starter fishing spots right now. I am going to look for another opening.',
                    cause: 'starter_fishing_route_blocked',
                },
                cause: 'starter_fishing_route_blocked',
            };
        }
        return { action: fishingAction, cause: fishingAction.cause || 'starter_fishing' };
    }

    return undefined;
}

export function starterFishingBankRecoveryAction(ctx: HelperContext, perception: HybridPerception): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here || !hasSmallFishingNet(perception)) {
        return undefined;
    }

    const failedLumbridgeSpot = LUMBRIDGE_STARTER_FISHING_SPOTS.some(position => targetFailureCooldownActive(ctx, position));
    if (!failedLumbridgeSpot || nearStarterFishingDiscovery(ctx, here)) {
        return undefined;
    }
    const routeTarget = starterFishingRecoveryRouteTarget(ctx, here);
    if (!routeTarget) {
        return undefined;
    }
    if (
        here.level !== routeTarget.level ||
        distance(here, routeTarget) > STARTER_FISHING_ROUTE_MAX_DISTANCE ||
        targetFailureCooldownActive(ctx, routeTarget)
    ) {
        return undefined;
    }

    return {
        kind: 'move_to',
        target: routeTarget,
        range: STARTER_FISHING_SPOT_DISCOVERY_RANGE,
        cause: 'starter_fishing_reposition_to_bank',
    };
}

export function nearStarterFishingDiscovery(ctx: HelperContext, here: Pos): boolean {
    return LUMBRIDGE_STARTER_FISHING_SPOTS.some(position => distance(here, position) <= STARTER_FISHING_SPOT_DISCOVERY_RANGE);
}

export function starterFishingRecoveryRouteTarget(ctx: HelperContext, here: Pos): Pos | undefined {
    return [...LUMBRIDGE_STARTER_FISHING_SPOTS]
        .filter(position => !targetFailureCooldownActive(ctx, position))
        .sort((a, b) => distance(here, a) - distance(here, b))[0];
}

export function visibilityAnchorReturnAction(
    ctx: HelperContext,
    perception: HybridPerception,
    visibility: { anchor?: Pos; returnDue: boolean },
): { action: AgentAction; cause: string } | undefined {
    if (!visibility.returnDue || !visibility.anchor) {
        return undefined;
    }

    const here = perception.resident?.position;
    const farFromAnchor = here ? distance(here, visibility.anchor) > VISIBILITY_ANCHOR_RETURN_DIRECT_DISTANCE : false;
    const target = farFromAnchor ? stepToward(here!, visibility.anchor, VISIBILITY_ANCHOR_RETURN_STEP_DISTANCE) : visibility.anchor;

    return {
        action: {
            kind: 'move_to',
            target,
            ...(farFromAnchor ? { range: 1 } : {}),
            cause: 'return_to_visibility_anchor',
        },
        cause: 'return_to_visibility_anchor',
    };
}

export function hardVisibilityAnchorReturnAction(
    ctx: HelperContext,
    perception: HybridPerception,
    visibility: { anchor?: Pos; returnDue: boolean },
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    const here = perception.resident?.position;
    if (!goal || !isExplorationGoal(goal) || !here || !visibility.anchor || !visibility.returnDue) {
        return undefined;
    }

    const radius = ctx.behavior().returnToAnchorRadius ?? DEFAULT_RETURN_TO_ANCHOR_RADIUS;
    const hardReturnDistance = Math.max(80, radius * 10);
    if (distance(here, visibility.anchor) <= hardReturnDistance) {
        return undefined;
    }

    return visibilityAnchorReturnAction(ctx, perception, visibility);
}

export function fallbackVisibilityAnchorReturnAction(
    ctx: HelperContext,
    perception: HybridPerception,
    visibility: { anchor?: Pos; returnDue: boolean },
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    if (goal && isExplorationGoal(goal)) {
        return hardVisibilityAnchorReturnAction(ctx, perception, visibility);
    }

    return visibilityAnchorReturnAction(ctx, perception, visibility);
}

export function repeatedExplorationReportOverride(
    ctx: HelperContext,
    actions: AgentAction[],
    perception: HybridPerception,
): AgentAction | undefined {
    const action = actions[0];
    if (action?.kind !== 'say') {
        return undefined;
    }

    const cognition = ctx.cognition();
    const lastReport = cognition.lastExplorationReportTick;
    const EXPLORATION_REPORT_COOLDOWN_TICKS = 80;
    if (lastReport === undefined || ctx.options.state.tick - lastReport >= EXPLORATION_REPORT_COOLDOWN_TICKS) {
        cognition.lastExplorationReportTick = ctx.options.state.tick;
        return undefined;
    }

    return explorationAction(
        perception,
        ctx.visibilityAnchor(),
        ctx.options.state.resident,
        ctx.pickupCooldowns(),
        ctx.options.state.tick,
        ctx.explorationCooldowns(),
        { interactWithOpenables: false },
    );
}

export function explorationRoutineOverride(
    ctx: HelperContext,
    actions: AgentAction[],
    perception: HybridPerception,
): AgentAction | undefined {
    const reportOverride = repeatedExplorationReportOverride(ctx, actions, perception);
    if (reportOverride) {
        return reportOverride;
    }

    if (ctx.cognition().activeMove) {
        return undefined;
    }

    const localAction = explorationAction(
        perception,
        ctx.visibilityAnchor(),
        ctx.options.state.resident,
        ctx.pickupCooldowns(),
        ctx.options.state.tick,
        ctx.explorationCooldowns(),
        { interactWithOpenables: false },
    );
    if (!localAction) {
        return undefined;
    }

    const action = actions[0];
    if (!action) {
        return localAction;
    }
    if (action.kind === 'say') {
        return undefined;
    }

    const here = perception.resident?.position;
    const target = modelActionTarget(action);
    const evidenceSaysStuck = typeof ctx.options.state.stuckSince === 'number';
    const EXPLORATION_MODEL_TARGET_MAX_DISTANCE = 6;
    if (
        here &&
        target &&
        distance(here, target) > EXPLORATION_MODEL_TARGET_MAX_DISTANCE &&
        (evidenceSaysStuck || isConcreteExplorationOverride(localAction)) &&
        !ctx.isRepeatedAction(localAction)
    ) {
        return localAction;
    }

    return undefined;
}

export function targetFailureCooldownActive(ctx: HelperContext, target: Pos): boolean {
    return isTargetFailureCooldownActive(target, ctx.cognition().targetFailureCooldowns, ctx.options.state.tick);
}

export function starterFishingCookingAction(ctx: HelperContext, perception: HybridPerception): AgentAction | undefined {
    const action = bodyStarterFishingCookingAction(perception);
    if (
        action?.kind === 'say' &&
        action.cause === 'starter_fishing_missing_heat' &&
        targetFailureCooldownActive(ctx, LUMBRIDGE_CASTLE_RANGE)
    ) {
        return {
            kind: 'say',
            text: 'I can see the Lumbridge range, but I cannot reach it from here. I need logs, an axe, or someone to open a path.',
            cause: 'starter_fishing_missing_heat',
        };
    }
    if (
        !action ||
        action.kind !== 'move_to' ||
        (action.cause !== 'starter_fishing_find_range' && action.cause !== 'starter_fishing_reach_castle_entrance')
    ) {
        return action;
    }

    const target = (action as { target?: Partial<Pos> }).target;
    if (typeof target?.x !== 'number' || typeof target.y !== 'number') {
        return action;
    }

    const position = { x: target.x, y: target.y, level: typeof target.level === 'number' ? target.level : 0 };
    if (!targetFailureCooldownActive(ctx, position)) {
        return action;
    }

    return {
        kind: 'say',
        text: 'I can see the Lumbridge range, but I cannot reach it from here. I need logs, an axe, or someone to open a path.',
        cause: 'starter_fishing_missing_heat',
    };
}

export function anchorReturnSkillInterruption(
    ctx: HelperContext,
    perception: HybridPerception,
    active: ActiveMoveState,
): { action: AgentAction; cause: string } | undefined {
    if (active.cause !== 'return_to_visibility_anchor') {
        return undefined;
    }
    const isStruggling = typeof ctx.options.state.stuckSince === 'number' || (active.stationaryCount || 0) > 0;
    if (!isStruggling) {
        return undefined;
    }

    const opportunity = scoutingSkillOpportunityAction(ctx, perception);
    if (!opportunity) {
        return undefined;
    }

    ctx.deferVisibilityAnchorReturn();
    return opportunity;
}

export function chunkedAnchorReturnContinuation(
    ctx: HelperContext,
    here: Pos,
    active: ActiveMoveState,
    anchor?: Pos,
): { action: AgentAction; cause: string } | undefined {
    const finalTarget = anchor || active.target;
    if (active.cause !== 'return_to_visibility_anchor' || distance(here, finalTarget) <= VISIBILITY_ANCHOR_RETURN_DIRECT_DISTANCE) {
        return undefined;
    }

    const action: AgentAction = {
        kind: 'move_to',
        target: stepToward(here, finalTarget, VISIBILITY_ANCHOR_RETURN_STEP_DISTANCE),
        range: 1,
        cause: 'return_to_visibility_anchor',
    };
    ctx.rememberActiveMove(action, here);
    return { action, cause: 'return_to_visibility_anchor' };
}

export function stuckMoveRecoveryAction(
    ctx: HelperContext,
    perception: HybridPerception,
    here: Pos,
    active: ActiveMoveState,
    anchor?: Pos,
): { action: AgentAction; cause: string } | undefined {
    if (active.cause === 'return_to_visibility_anchor') {
        ctx.deferVisibilityAnchorReturn();
    }

    const obstacle = stuckOpenObstacleAction(perception, here, active, ctx.explorationCooldowns(), ctx.options.state.tick);
    if (obstacle) {
        ctx.cognition().activeMove = undefined;
        return { action: obstacle, cause: 'stuck_open_obstacle' };
    }

    rememberBlockedExplorationTarget(ctx, perception, active.target);
    rememberBlockedActionTarget(ctx, perception, active.target, active.cause);

    const localSkill = anchorReturnSkillInterruption(ctx, perception, active);
    if (localSkill) {
        return localSkill;
    }

    const blocker = stuckBlockerReportAction(perception, here, active);
    if (blocker && !ctx.isRepeatedAction(blocker)) {
        return { action: blocker, cause: 'stuck_blocker_report' };
    }

    const helpRequest = stuckHelpRequestAction(here, active, perception, ctx.options.soul);
    if (helpRequest && !ctx.isRepeatedAction(helpRequest)) {
        ctx.cognition().activeMove = undefined;
        return { action: helpRequest, cause: 'stuck_help_request' };
    }

    const localAction = explorationAction(
        perception,
        anchor,
        ctx.options.state.resident,
        ctx.pickupCooldowns(),
        ctx.options.state.tick,
        ctx.explorationCooldowns(),
        { interactWithOpenables: false },
    );
    const recovery =
        localAction && isConcreteExplorationOverride(localAction)
            ? localAction
            : {
                  kind: 'move_to',
                  target: stuckRecoveryPatrolTarget(here, active.target, ctx.options.state.tick, anchor),
                  range: 1,
                  cause: 'stuck_move_recovery',
              };
    const action = actionWithCause(recovery, 'stuck_move_recovery');
    ctx.rememberActiveMove(action, here);
    return { action, cause: 'stuck_move_recovery' };
}

export function approachDistantInteraction(
    ctx: HelperContext,
    actions: AgentAction[],
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const action = actions[0];
    if (action?.kind === 'move_to' && typeof action.range === 'number') {
        return undefined;
    }
    if (action && shouldLetInteractionPipelineApproach(action)) {
        return undefined;
    }
    const here = perception.resident?.position;
    const interactionTarget = action ? actionTargetPosition(action) : undefined;
    const moveTarget = action ? objectTileMoveTarget(action, perception) : undefined;
    const target = interactionTarget || moveTarget;
    if (!here || !target || distance(here, target) <= INTERACTION_APPROACH_RADIUS) {
        return undefined;
    }

    return {
        action: { kind: 'move_to', target, range: INTERACTION_APPROACH_RADIUS, cause: 'approach_interaction_target' },
        cause: 'approach_interaction_target',
    };
}

export function nonRepeatedFallbackAction(
    ctx: HelperContext,
    perception: Perception,
    visibility: { anchor?: Pos; returnDue: boolean },
): { action: AgentAction; cause: string } | undefined {
    const fallback = fallbackAction(ctx, perception, visibility);
    if (!fallback || ctx.isRepeatedAction(fallback.action)) {
        return undefined;
    }

    ctx.rememberBodyAction(fallback.action);
    return fallback;
}

export function routineLoopBreakAction(
    ctx: HelperContext,
    action: AgentAction,
    cause: string,
    perception: HybridPerception,
    anchor?: Pos,
): { action: AgentAction; cause: string } | undefined {
    if (!isLocalRoutineCause(cause, action)) {
        return undefined;
    }

    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const cognition = ctx.cognition();
    const key = `${routineLoopFamily(cause, action)}|${positionKey(here)}`;
    cognition.routineLoopCount = cognition.routineLoopKey === key ? (cognition.routineLoopCount || 0) + 1 : 1;
    cognition.routineLoopKey = key;

    const lastBreakTick = cognition.lastRoutineLoopBreakTick || 0;
    const evidenceSaysStuck = typeof ctx.options.state.stuckSince === 'number';
    const ROUTINE_LOOP_BREAK_ACTIONS = 3;
    const ROUTINE_LOOP_BREAK_COOLDOWN_TICKS = 90;
    if (
        (!evidenceSaysStuck && cognition.routineLoopCount < ROUTINE_LOOP_BREAK_ACTIONS) ||
        (lastBreakTick > 0 && ctx.options.state.tick - lastBreakTick < ROUTINE_LOOP_BREAK_COOLDOWN_TICKS)
    ) {
        return undefined;
    }

    cognition.routineLoopCount = 0;
    cognition.routineLoopKey = undefined;
    cognition.lastRoutineLoopBreakTick = ctx.options.state.tick;

    const label = `${cause} ${action.cause || ''}`;
    const explore = explorationAction(
        perception,
        anchor,
        ctx.options.state.resident,
        ctx.pickupCooldowns(),
        ctx.options.state.tick,
        ctx.explorationCooldowns(),
        { interactWithNpcs: !/starter_fishing_missing_heat/i.test(label), interactWithOpenables: false },
    );
    return {
        action: explore
            ? actionWithCause(explore, 'routine_loop_break')
            : { kind: 'say', text: 'I have worked this spot for a while. I am going to scout nearby.', cause: 'routine_loop_break' },
        cause: 'routine_loop_break',
    };
}

export function activeFollowAction(ctx: HelperContext, perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
    const target = currentFollowTarget(ctx);
    const goal = ctx.activeGoal();
    if (!target?.name || (!ctx.cognition().followTarget?.name && !isFollowGoal(goal))) {
        return undefined;
    }

    const action = followAction(ctx, perception, 'follow_player_active');
    return action ? { action, cause: 'follow_player_active' } : undefined;
}

export function followListenHoldAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { actions: AgentAction[]; cause: string; nooped: boolean } | undefined {
    const goal = ctx.activeGoal();
    const targetState = currentFollowTarget(ctx);
    if (!goal || !isFollowGoal(goal) || !targetState?.name) {
        return undefined;
    }

    const beacon = presenceBeaconAction(ctx, perception);
    if (beacon) {
        return { actions: [beacon], cause: 'presence_beacon', nooped: false };
    }

    return { actions: [], cause: 'follow_listen_hold', nooped: true };
}

export function followAction(ctx: HelperContext, perception: HybridPerception, cause = 'follow_player_fallback'): AgentAction | undefined {
    const targetState = currentFollowTarget(ctx);
    const targetName = targetState?.name;
    const here = perception.resident?.position;
    if (!targetName || !here) {
        return undefined;
    }

    const target = (perception.nearby?.players || []).find(player => {
        return (targetState?.id && player.id === targetState.id) || actorMatchesName(player, targetName);
    });
    const followRadius = ctx.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS;
    if (!target || distance(here, target.position) <= followRadius) {
        return undefined;
    }

    return {
        kind: 'move_to',
        target: target.position,
        range: followRadius,
        cause,
    };
}

export function proactiveTradeAction(ctx: HelperContext, perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
    const tier = ctx.options.soul.frontmatter.heroProfile?.tier ?? 'background';
    if (tier === 'background') {
        return undefined;
    }

    const registry = ctx.options.patronRegistry;
    if (!registry) {
        return undefined;
    }

    const resident = perception.resident;
    const inventory = resident?.inventory || [];

    const item = inventory.find(item => {
        if (!item) return false;
        const key = (item.key || '').toLowerCase();
        return item.itemId === 1511 || key.includes('logs') || item.itemId === 526 || key.includes('bones');
    });
    if (!item) {
        return undefined;
    }

    const players = perception.nearby?.players || [];
    const patron = players.find(p => p.name && registry.isPatron(p.name));
    if (!patron || !patron.name) {
        return undefined;
    }

    const currentTick = ctx.options.state.tick;
    const cooldownKey = `proactive-trade:${patron.name.toLowerCase()}`;
    const cooldowns = (ctx.options.state.hookCooldowns ||= {});
    const cooldownUntil = cooldowns[cooldownKey] || 0;
    if (currentTick < cooldownUntil) {
        return undefined;
    }

    cooldowns[cooldownKey] = currentTick + 100;

    const artifactStr = item.itemId === 1511 ? 'logs' : item.itemId === 526 ? 'bones' : item.key || String(item.itemId);

    return {
        action: {
            kind: 'trade_resource',
            target: { humanHandle: patron.name },
            artifact: artifactStr,
            quantity: 1,
            note: 'hero_gift',
            cause: 'proactive_patron_gift',
        },
        cause: 'proactive_patron_gift',
    };
}

export function pendingDirectTradeAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const pending = ctx.cognition().pendingDirectTrade;
    if (!pending) {
        return undefined;
    }
    if (ctx.options.state.tick - pending.setAtTick > 80) {
        ctx.cognition().pendingDirectTrade = undefined;
        return undefined;
    }
    if (perception.resident?.activeTrade) {
        ctx.cognition().pendingDirectTrade = undefined;
        return undefined;
    }

    const here = perception.resident?.position;
    const target = resolvePendingDirectTradeTarget(ctx, perception, pending.target);
    if (!here || !target) {
        return undefined;
    }
    if (distance(here, target.position) > 1) {
        return {
            action: { kind: 'move_to', target: target.position, range: 1, cause: 'direct_chat_trade' },
            cause: 'direct_chat_trade',
        };
    }

    ctx.cognition().pendingDirectTrade = undefined;
    return { action: { kind: 'trade_request', target, cause: 'direct_chat_trade' }, cause: 'direct_chat_trade' };
}

export function rememberPendingDirectTrade(ctx: HelperContext, target: Actor | undefined): void {
    if (!target || target.kind === 'npc') {
        return;
    }
    ctx.cognition().pendingDirectTrade = {
        target: {
            id: target.id,
            kind: target.kind,
            name: target.name,
            key: target.key,
            position: target.position,
            hpFraction: target.hpFraction,
            combatLevel: target.combatLevel,
        },
        setAtTick: ctx.options.state.tick,
    };
}

export function resolvePendingDirectTradeTarget(ctx: HelperContext, perception: HybridPerception, pending: any): Actor | undefined {
    const visible = (perception.nearby?.players || []).find(
        actor => actor.id === pending.id || actorMatchesName(actor, pending.name || pending.id),
    );
    if (visible) {
        return visible;
    }
    return actorLike(pending);
}

export function rememberPickupAttempt(ctx: HelperContext, action: AgentAction): void {
    const item = pickupActionWorldItem(action);
    if (!item) {
        return;
    }

    const cooldowns = ctx.pickupCooldowns();
    cooldowns[pickupItemKey(item)] = ctx.options.state.tick;
    for (const [key, tick] of Object.entries(cooldowns)) {
        if (ctx.options.state.tick - tick > PICKUP_TARGET_COOLDOWN_TICKS) {
            delete cooldowns[key];
        }
    }
}

export function rememberExplorationAttempt(ctx: HelperContext, action: AgentAction): void {
    const key = explorationCooldownKeyFromAction(action);
    if (!key) {
        return;
    }

    const cooldowns = ctx.explorationCooldowns();
    cooldowns[key] = ctx.options.state.tick;
    const actor = 'target' in action ? actorLike(action.target) : undefined;
    if (actor?.kind === 'npc') {
        cooldowns[explorationActorFamilyCooldownKey(actor)] = ctx.options.state.tick;
    }
    for (const [cooldownKey, tick] of Object.entries(cooldowns)) {
        if (ctx.options.state.tick - tick > EXPLORATION_TARGET_COOLDOWN_TICKS) {
            delete cooldowns[cooldownKey];
        }
    }
}

export function rememberBlockedExplorationTarget(ctx: HelperContext, perception: HybridPerception, target: Pos): void {
    const cooldowns = ctx.explorationCooldowns();
    cooldowns[explorationPatrolCooldownKey(target)] = ctx.options.state.tick;

    for (const object of perception.nearby?.objects || []) {
        if (positionsEqual(object.position, target)) {
            cooldowns[explorationObjectCooldownKey(object)] = ctx.options.state.tick;
        }
    }
    for (const item of perception.nearby?.worldItems || []) {
        if (positionsEqual(item.position, target)) {
            cooldowns[explorationItemCooldownKey(item)] = ctx.options.state.tick;
        }
    }
    for (const actor of [...(perception.nearby?.npcs || []), ...(perception.nearby?.players || [])]) {
        if (positionsEqual(actor.position, target)) {
            cooldowns[explorationActorCooldownKey(actor)] = ctx.options.state.tick;
        }
    }

    for (const [cooldownKey, tick] of Object.entries(cooldowns)) {
        if (ctx.options.state.tick - tick > EXPLORATION_TARGET_COOLDOWN_TICKS) {
            delete cooldowns[cooldownKey];
        }
    }
}

export function rememberBlockedActionTarget(ctx: HelperContext, perception: HybridPerception, target: Pos, cause?: string): void {
    const cooldowns = (ctx.cognition().targetFailureCooldowns ||= {});
    const remember = (candidate: unknown): void => {
        if (!isRecord(candidate)) {
            return;
        }
        const position = positionLike(candidate.position);
        if (!position || !positionsEqual(position, target)) {
            return;
        }
        const keys = shouldRememberNpcFamilyTargetFailure(candidate, cause) ? targetFailureKeys(candidate) : [targetFailureKey(candidate)];
        for (const key of keys) {
            if (key) {
                cooldowns[key] = ctx.options.state.tick;
            }
        }
    };

    for (const object of perception.nearby?.objects || []) {
        remember(object);
    }
    for (const item of perception.nearby?.worldItems || []) {
        remember(item);
    }
    for (const actor of [...(perception.nearby?.npcs || []), ...(perception.nearby?.players || [])]) {
        remember(actor);
    }

    for (const [cooldownKey, tick] of Object.entries(cooldowns)) {
        if (ctx.options.state.tick - (tick as number) > TARGET_FAILURE_COOLDOWN_TICKS) {
            delete cooldowns[cooldownKey];
        }
    }
}

export function promptMemories(ctx: HelperContext, perception: HybridPerception, role: 'brain' | 'body'): string[] {
    const goal = ctx.activeGoal();
    const eventText = (perception.events || [])
        .map(event => (typeof event.text === 'string' ? event.text : ''))
        .filter(Boolean)
        .slice(-3)
        .join(' ');
    const nearbyActors = [
        ...(perception.nearby?.players || []),
        ...(perception.nearby?.npcs || []),
        ...(perception.nearby?.worldItems || []),
    ]
        .map(actor => ('name' in actor ? actor.name : undefined) || actor.key || '')
        .filter(Boolean)
        .slice(0, 8)
        .join(' ');
    const query = [role, goal?.description, ...(goal?.steps || []), eventText, nearbyActors].filter(Boolean).join(' ') || role;
    try {
        return ctx.options.memory
            .retrieve(ctx.options.soul.frontmatter.name, query, MAX_PROMPT_MEMORIES)
            .map((memory: string) => memory.trim())
            .filter(Boolean)
            .slice(0, MAX_PROMPT_MEMORIES);
    } catch {
        return [];
    }
}

export function promptMemorySection(memories: string[], role: 'brain' | 'body'): string {
    const lines = memories
        .map(memory => `- ${memory.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_MEMORY_CHARS)}`)
        .filter(line => line.length > 2);
    if (lines.length === 0) {
        return '';
    }
    return [
        'Memory:',
        'Persistent resident memory: qmd facts, Library notes, patron events, route/social promises, and unfinished story threads.',
        role === 'brain'
            ? 'Use these as continuity: keep promises, remember patrons/players, and bias goal choice toward unfinished story threads.'
            : 'Use these as continuity: if you speak or act, respect recent promises, patrons, and unfinished player requests.',
        ...lines,
    ].join('\n');
}

export function visibilityStatus(ctx: HelperContext, perception: Perception): { anchor?: Pos; returnDue: boolean } {
    const behavior = ctx.behavior();
    const anchor = ctx.visibilityAnchor();
    if (!anchor) {
        return { returnDue: false };
    }

    const here = (perception as HybridPerception).resident?.position;
    const interval = behavior.returnToAnchorEveryTicks ?? DEFAULT_RETURN_TO_ANCHOR_EVERY_TICKS;
    if (!here || interval <= 0) {
        return { anchor, returnDue: false };
    }

    const last = ctx.cognition().lastAnchorReturnTick || 0;
    const radius = behavior.returnToAnchorRadius ?? DEFAULT_RETURN_TO_ANCHOR_RADIUS;
    return {
        anchor,
        returnDue: ctx.options.state.tick - last >= interval && distance(here, anchor) > radius,
    };
}

export function suppressRepeatedActions(ctx: HelperContext, actions: AgentAction[]): AgentAction[] {
    const action = actions[0];
    if (!action) {
        return actions;
    }

    if (ctx.isRepeatedAction(action)) {
        return [];
    }

    ctx.rememberBodyAction(action);
    return actions;
}

export function ensureBenchmarkGoal(ctx: HelperContext): void {
    const benchmarkTask = ctx.options.soul.frontmatter.legacy?.parameters?.benchmarkTask;
    const benchmark = benchmarkGoalForTask(benchmarkTask, ctx.options.state.tick);
    if (!benchmark) {
        return;
    }

    // S-AUDIT-FIX-3 (F3 / QA-20260530-013): the needs-hierarchy ranker now
    // governs benchmark seeding. The candidate pool is [benchmark, survival]
    // (see `goalPoolForBenchmark` for the source provenance + tag taxonomy),
    // and `selectCandidateGoals` re-orders by `currentTier(needsContext)`.
    //
    // S-GOAL-1 extension: when the soul has a `frontmatter.orientationGoal`
    // ("north star"), the goal pool gains an orientation candidate and the
    // ranker bonus biases candidates that match the orientation (by id or
    // by tier-tag). At higher tiers (PURSUE / EARN / REFLECT) the
    // orientation candidate can win, replacing the generic benchmark with
    // the soul's chosen direction. Survival still wins in survive band
    // because the ranker's survive-tier alignment bonus dwarfs the
    // orientation bonus.
    //
    // Conservative wire-up for residents WITHOUT orientation: we only
    // override the benchmark when the tier computes to `'survive'`. The
    // planner does not yet have a live GP snapshot, so EARN-tier overrides
    // for non-oriented residents would be based on a stale `gpEstimate=0`
    // default. Oriented residents opt in to the broader ranker behavior
    // by declaring `orientationGoal` in their soul YAML.
    const cognition = ctx.cognition();
    const orientationGoal = ctx.options.soul.frontmatter.orientationGoal;
    const needsContext = buildResidentNeedsContext({
        attention: ctx.options.state.attention,
        attentionFloor: ctx.options.soul.frontmatter.attentionProfile?.floor,
        hasActiveGoal: Boolean(cognition.activeGoal),
        orientationGoal,
        // S-GOAL-FOLLOW-1 D2: forward the resident's current active goal id
        // so the ranker keeps it sticky when a rival candidate scores within
        // HYSTERESIS_DELTA, preventing tick-to-tick goal thrash.
        currentActiveGoalId: cognition.activeGoal?.id,
    });
    let goal = benchmark;
    const tier = currentTier(needsContext);
    const shouldRank = tier === 'survive' || Boolean(orientationGoal);
    if (shouldRank) {
        // Pool composition rules:
        //   - survive band (any soul): include the survival fallback so a
        //     low-AP resident's survive-aligned tag can win.
        //   - non-survive band WITH orientation: drop the survival fallback
        //     so the orientation candidate's id-match bonus is not
        //     out-scored by the survival candidate's tier-alignment under
        //     the stale `gpEstimate=0` default (which falsely puts every
        //     resident in EARN tier until live GP is plumbed). When AP
        //     drops back into the survive band the pool reverts to
        //     including survival via the tier check above.
        const pool =
            orientationGoal && tier !== 'survive'
                ? goalPoolForBenchmark(benchmarkTask, ctx.options.state.tick, { orientationGoal }).filter(
                      c => c.id !== gpPickupGoal(ctx.options.state.tick).id,
                  )
                : goalPoolForBenchmark(benchmarkTask, ctx.options.state.tick, { orientationGoal });
        const ranked = selectCandidateGoals(pool, { needsContext });
        const winner = ranked[0];
        if (winner) {
            goal = (winner as (typeof pool)[number]).goal;
        }
    }

    if (!cognition.activeGoal || cognition.activeGoal.id !== goal.id || goalExpired(ctx, cognition.activeGoal)) {
        ctx.clearGoalMomentum();
        cognition.activeGoal = goal;
        cognition.lastPresenceBeaconTick ??= ctx.options.state.tick;
        cognition.lastGoalShareTick ??= ctx.options.state.tick;
    }
    if (benchmarkTask === 'memory-write-recall-10m') {
        cognition.lastBodyTick ??= ctx.options.state.tick;
        return;
    }
    cognition.lastBrainTick = ctx.options.state.tick;
}

export function ensureFactionLandmarkGoal(ctx: HelperContext): void {
    if (ctx.options.soul.frontmatter.legacy?.parameters?.benchmarkTask) {
        return;
    }
    const { factionId, heroProfile } = ctx.options.soul.frontmatter;
    if (!factionId || heroProfile?.tier !== 'hero') {
        return;
    }

    const cognition = ctx.cognition();
    if (cognition.activeGoal && !isFactionLandmarkWorkGoal(cognition.activeGoal) && !goalExpired(ctx, cognition.activeGoal)) {
        return;
    }

    const goal = factionLandmarkWorkGoal(factionId, ctx.options.state.tick);
    if (!cognition.activeGoal || cognition.activeGoal.id !== goal.id || goalExpired(ctx, cognition.activeGoal)) {
        ctx.clearGoalMomentum();
        cognition.activeGoal = goal;
        cognition.lastPresenceBeaconTick ??= ctx.options.state.tick;
        cognition.lastGoalShareTick = undefined;
        cognition.lastBrainTick ??= ctx.options.state.tick;
    }
}

export function applyBrainSideEffects(ctx: HelperContext, text: string): { memoUpdates: number } {
    const parsed = parseCompletion(text);
    if (!parsed.ok) {
        return { memoUpdates: 0 };
    }

    const memoryDir = ctx.options.memory.ensureResident(ctx.options.soul.frontmatter.name);
    for (const memo of parsed.memo || []) {
        ctx.options.memory.write(ctx.options.soul.frontmatter.name, memo.path, memo.text, memo.mode || 'append');
    }
    for (const fact of parsed.rememberFact || []) {
        ctx.options.memory.rememberFact(ctx.options.soul.frontmatter.name, fact.topic, fact.fact, fact.reason);
    }
    if (parsed.indexPatch?.append?.length) {
        ctx.options.memory.upsertIndexPatch(ctx.options.soul.frontmatter.name, parsed.indexPatch.append.join('\n'));
    }
    if (parsed.retireNervousRule?.length) {
        retireNervousRulesMd(memoryDir, parsed.retireNervousRule);
    }
    if (parsed.proposeNervousRule?.length) {
        upsertNervousRulesMd(memoryDir, { rules: parsed.proposeNervousRule });
    }
    return { memoUpdates: (parsed.memo?.length || 0) + (parsed.rememberFact?.length || 0) };
}

export function goalRoutineOverride(
    ctx: HelperContext,
    actions: AgentAction[],
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const goal = ctx.activeGoal();
    if (!goal) {
        return undefined;
    }

    const goalText = `${goal.description} ${(goal.steps || []).join(' ')}`;
    if (isFactionLandmarkWorkGoal(goal)) {
        const factionWork = factionLandmarkWorkAction({
            perception,
            factionId: ctx.options.soul.frontmatter.factionId,
            landmark: ctx.heroLandmarkAnchor(),
            residentId: ctx.options.state.resident,
            pickupCooldowns: ctx.pickupCooldowns(),
            currentTick: ctx.options.state.tick,
            explorationCooldowns: ctx.explorationCooldowns(),
            targetFailureCooldowns: ctx.cognition().targetFailureCooldowns,
        });
        if (factionWork) {
            return { action: factionWork, cause: factionWork.cause || 'faction_landmark_work' };
        }
    }

    if (isPrayerTrainingGoal(goal)) {
        const prayerAction = prayerTrainingAction(perception, ctx.cognition().targetFailureCooldowns, ctx.options.state.tick);
        if (prayerAction) {
            return { action: prayerAction, cause: prayerAction.cause || 'prayer_training' };
        }
    }

    if (isCombatTrainingGoal(goal)) {
        const combatAction = combatTrainingAction(
            perception,
            ctx.pickupCooldowns(),
            ctx.options.state.tick,
            ctx.cognition().targetFailureCooldowns,
        );
        if (combatAction) {
            return { action: combatAction, cause: combatAction.cause || 'combat_training' };
        }
    }

    if (isWoodcuttingTrainingGoal(goal) && !isFiremakingGoal(goal)) {
        const fireAction = firemakingAction(perception);
        if (fireAction) {
            ctx.clearGoalMomentum();
            ctx.cognition().activeGoal = firemakingGoal(ctx.options.state.tick);
            return { action: actionWithCause(fireAction, 'woodcutting_chain_firemaking'), cause: 'woodcutting_chain_firemaking' };
        }
    }

    if (isStarterFishingGoal(goal)) {
        const starterFishing = starterFishingGoalAction(ctx, perception);
        if (starterFishing) {
            return starterFishing;
        }
    }

    if (isMiningGoal(goal)) {
        const miningAction = starterMiningGoalAction(ctx, perception);
        if (miningAction) {
            return miningAction;
        }
    }

    if (isCooksAssistantQuestGoal(goal)) {
        const cooksAssistantAction = cooksAssistantGoalAction(ctx, perception);
        if (cooksAssistantAction) {
            return cooksAssistantAction;
        }
    }

    if (isApGpLibraryStrategyGoal(goal)) {
        const strategyAction = apGpLibraryStrategyGoalAction(ctx, perception);
        if (strategyAction) {
            return strategyAction;
        }
    }

    const fireGoalLike = !isStarterFishingGoal(goal) && /fire|burn|logs|tinderbox|light/i.test(goalText);
    if (fireGoalLike) {
        const fireAction = firemakingAction(perception);
        if (fireAction) {
            return { action: fireAction, cause: 'firemaking_fallback' };
        }
    }

    const opportunity = opportunisticPickupAction(
        perception,
        ctx.options.state.resident,
        ROUTINE_OPPORTUNISTIC_PICKUP_MAX_DISTANCE,
        ctx.pickupCooldowns(),
        ctx.options.state.tick,
        ctx.explorationCooldowns(),
    );
    if (opportunity) {
        return { action: opportunity, cause: 'opportunistic_pickup' };
    }

    if (actions.length > 0 && isDedicatedExplorationGoal(goal)) {
        const explorationOverride = explorationRoutineOverride(ctx, actions, perception);
        if (explorationOverride) {
            return { action: explorationOverride, cause: 'exploration_fallback' };
        }
    }

    if (fireGoalLike) {
        const explicitWoodcuttingGoalId = /woodcut|chop/i.test(goal.id);
        const acquireAxe = explicitWoodcuttingGoalId ? undefined : acquireWoodcuttingAxeAction(perception);
        if (acquireAxe) {
            return { action: acquireAxe, cause: acquireAxe.cause || 'firemaking_acquire_axe' };
        }
        const woodcutting = explicitWoodcuttingGoalId ? undefined : levelOneWoodcuttingAction(perception);
        if (woodcutting) {
            return { action: woodcutting, cause: 'firemaking_gather_logs' };
        }
    }

    if (!/ordinary|tree|chop|wood|logs/i.test(goalText)) {
        return undefined;
    }

    const woodcutting = levelOneWoodcuttingAction(perception);
    return woodcutting ? { action: woodcutting, cause: woodcutting.cause || 'woodcutting_level1_routine' } : undefined;
}

function isApGpLibraryStrategyGoal(goal: ActiveGoalState): boolean {
    return goal.id === 'ap-gp-library-strategy';
}

function apGpLibraryStrategyGoalAction(
    ctx: HelperContext,
    perception: HybridPerception,
): { action: AgentAction; cause: string } | undefined {
    const pickup = opportunisticPickupAction(
        perception,
        ctx.options.state.resident,
        ROUTINE_OPPORTUNISTIC_PICKUP_MAX_DISTANCE,
        undefined,
        ctx.options.state.tick,
        undefined,
        ctx.cognition().targetFailureCooldowns,
    );
    if (pickup) {
        return { action: pickup, cause: pickup.cause || 'opportunistic_pickup' };
    }

    const carriedGp = carriedGpAmount(perception.resident?.inventory);
    if (carriedGp <= 0) {
        return undefined;
    }

    const cognition = ctx.cognition();
    const tick = ctx.options.state.tick;
    if (
        typeof cognition.lastApGpStrategySayTick === 'number' &&
        tick - cognition.lastApGpStrategySayTick < (ctx.behavior().shareGoalsEveryTicks ?? DEFAULT_GOAL_SHARE_EVERY_TICKS)
    ) {
        return undefined;
    }

    cognition.lastApGpStrategySayTick = tick;
    return {
        action: {
            kind: 'say',
            text: `AP is low, so I secured ${carriedGp} GP first. Library strategy: keep Attention alive, gather coins, then spend GP toward the Soul goal.`,
            cause: 'ap_gp_library_strategy',
        },
        cause: 'ap_gp_library_strategy',
    };
}

function carriedGpAmount(inventory: Array<Item | null> | undefined): number {
    return (inventory || []).reduce((total, item) => {
        if (!item) {
            return total;
        }
        const isCoin = COIN_ITEM_IDS.has(item.itemId) || /coins?/i.test(item.key || '');
        return isCoin ? total + (Number.isFinite(item.amount) ? item.amount : 1) : total;
    }, 0);
}

export function stabilizedMoveAction(
    ctx: HelperContext,
    action: AgentAction | undefined,
    perception: HybridPerception,
    anchor?: Pos,
): { action: AgentAction; cause: string } | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const cognition = ctx.cognition();
    const active = cognition.activeMove;
    if (active && targetFailureCooldownActive(ctx, active.target)) {
        cognition.activeMove = undefined;
    }
    if (active && cognition.activeMove === active) {
        if (active.lastTick === ctx.options.state.tick) {
            if (
                action?.kind === 'move_to' &&
                !sameMoveIntent(action, active) &&
                ctx.options.state.tick - active.startedAtTick < MOVE_COMMIT_TICKS
            ) {
                return { action: moveIntentAction(active, 'continue_move'), cause: 'continue_move' };
            }
            return undefined;
        }

        if (action && shouldInterruptActiveMove(action)) {
            cognition.activeMove = undefined;
            return undefined;
        }
        const currentDistance = distance(here, active.target);
        if (currentDistance <= (active.range ?? 0)) {
            cognition.activeMove = undefined;
        } else {
            const currentPositionKey = positionKey(here);
            const changedPosition = active.lastPositionKey !== currentPositionKey;
            const stationaryCount = changedPosition ? 0 : (active.stationaryCount || 0) + 1;
            const hasClosingBaseline = typeof active.bestDistance === 'number' || typeof active.lastImprovedTick === 'number';
            const previousBestDistance =
                typeof active.bestDistance === 'number'
                    ? active.bestDistance
                    : typeof active.lastDistance === 'number'
                      ? Math.min(active.lastDistance, currentDistance)
                      : currentDistance;
            const closedDistance = currentDistance < previousBestDistance;
            const equalDistanceDetour =
                changedPosition && typeof active.lastDistance === 'number' && currentDistance === active.lastDistance;
            const bestDistance = closedDistance ? currentDistance : previousBestDistance;
            const lastImprovedTick = closedDistance
                ? ctx.options.state.tick
                : typeof active.lastImprovedTick === 'number'
                  ? active.lastImprovedTick
                  : ctx.options.state.tick;
            const visiblyBlocked = !changedPosition || currentDistance > previousBestDistance;
            const nonImprovingCount = closedDistance
                ? 0
                : equalDistanceDetour
                  ? 0
                  : hasClosingBaseline && visiblyBlocked
                    ? (active.nonImprovingCount || 0) + 1
                    : active.nonImprovingCount || 0;
            const equalDistanceDetourCount = closedDistance ? 0 : equalDistanceDetour ? (active.equalDistanceDetourCount || 0) + 1 : 0;
            const updated = {
                ...active,
                lastTick: ctx.options.state.tick,
                lastPositionKey: currentPositionKey,
                stationaryCount,
                lastDistance: currentDistance,
                bestDistance,
                lastImprovedTick,
                nonImprovingCount,
                equalDistanceDetourCount,
            };
            cognition.activeMove = updated;

            if (typeof ctx.options.state.stuckSince === 'number') {
                if (active.cause === 'stuck_move_recovery') {
                    const helpRequest = stuckHelpRequestAction(here, updated, perception, ctx.options.soul);
                    if (helpRequest && !ctx.isRepeatedAction(helpRequest)) {
                        cognition.activeMove = undefined;
                        return { action: helpRequest, cause: 'stuck_help_request' };
                    }
                } else {
                    const recovery = stuckMoveRecoveryAction(ctx, perception, here, updated, anchor);
                    if (recovery) {
                        return recovery;
                    }
                }
            }

            if (
                stationaryCount >= MOVE_STUCK_STATIONARY_OBSERVATIONS ||
                (ctx.options.state.tick - lastImprovedTick >= MOVE_STUCK_NON_CLOSING_TICKS &&
                    (nonImprovingCount >= MOVE_STUCK_NON_IMPROVING_OBSERVATIONS ||
                        equalDistanceDetourCount >= MOVE_STUCK_EQUAL_DISTANCE_DETOUR_OBSERVATIONS))
            ) {
                return stuckMoveRecoveryAction(ctx, perception, here, updated, anchor);
            }

            const interruptedAnchorReturn = anchorReturnSkillInterruption(ctx, perception, updated);
            if (interruptedAnchorReturn) {
                return interruptedAnchorReturn;
            }

            const chunkedAnchorReturn = chunkedAnchorReturnContinuation(ctx, here, updated, anchor);
            if (chunkedAnchorReturn) {
                return chunkedAnchorReturn;
            }

            if (
                action?.kind === 'move_to' &&
                !sameMoveIntent(action, updated) &&
                ctx.options.state.tick - updated.startedAtTick < MOVE_COMMIT_TICKS
            ) {
                return { action: moveIntentAction(updated, 'continue_move'), cause: 'continue_move' };
            }

            if (action?.kind === 'move_to' && sameMoveIntent(action, updated)) {
                return undefined;
            }
        }
    }

    if (action?.kind === 'move_to') {
        ctx.rememberActiveMove(action, here);
    } else if (action) {
        cognition.activeMove = undefined;
    }

    return undefined;
}

export function preInferenceBodyAction(
    ctx: HelperContext,
    perception: HybridPerception,
    visibility: { anchor?: Pos; returnDue: boolean },
): ThoughtResult | undefined {
    const routine = goalRoutineOverride(ctx, [], perception);
    if (routine) {
        const loopBreak = routineLoopBreakAction(ctx, routine.action, routine.cause, perception, visibility.anchor);
        return preInferenceResult(ctx, loopBreak?.action || routine.action, loopBreak?.cause || routine.cause, perception, visibility);
    }

    const activeMove = stabilizedMoveAction(ctx, undefined, perception, visibility.anchor);
    if (activeMove) {
        return preInferenceResult(ctx, activeMove.action, activeMove.cause, perception, visibility);
    }

    const coordinateMove = goalCoordinateMoveAction(ctx, perception);
    if (coordinateMove) {
        return preInferenceResult(ctx, coordinateMove.action, coordinateMove.cause, perception, visibility);
    }

    const socialKeepalive = socialKeepaliveAction(ctx, perception, visibility);
    if (socialKeepalive) {
        return preInferenceResult(ctx, socialKeepalive, 'social_keepalive', perception, visibility);
    }

    const agentKeepalive = agentKeepaliveAction(ctx, perception, visibility);
    if (agentKeepalive) {
        return preInferenceResult(ctx, agentKeepalive, 'agent_keepalive', perception, visibility);
    }

    if (typeof ctx.options.state.stuckSince === 'number') {
        const here = perception.resident?.position;
        const goalAction = starterFishingGoalAction(ctx, perception);
        if (
            goalAction &&
            !moveTargetFailureCooldownActive(goalAction.action, ctx.cognition().targetFailureCooldowns, ctx.options.state.tick)
        ) {
            if (visibility.returnDue) {
                ctx.deferVisibilityAnchorReturn();
            }
            return preInferenceResult(ctx, goalAction.action, goalAction.cause, perception, visibility);
        }

        const exploratory = explorationAction(
            perception,
            visibility.anchor,
            ctx.options.state.resident,
            ctx.pickupCooldowns(),
            ctx.options.state.tick,
            ctx.explorationCooldowns(),
            { interactWithOpenables: false },
        );
        const targetFailureCooldowns = ctx.cognition().targetFailureCooldowns;
        let recovery: AgentAction | undefined;
        const exploratoryTarget = exploratory?.kind === 'move_to' ? positionLike(exploratory.target) : undefined;
        const widePatrolProbe = Boolean(
            exploratory?.cause === 'explore_patrol' && exploratoryTarget && here && distance(here, exploratoryTarget) > 1,
        );
        if (
            exploratory &&
            isStuckRecoveryAction(exploratory) &&
            !widePatrolProbe &&
            !moveTargetFailureCooldownActive(exploratory, targetFailureCooldowns, ctx.options.state.tick)
        ) {
            recovery = exploratory;
        } else if (here) {
            const target = stuckPreInferencePatrolTarget(
                perception,
                here,
                visibility.anchor,
                ctx.options.state.tick,
                ctx.explorationCooldowns(),
                targetFailureCooldowns,
            );
            if (target) {
                recovery = {
                    kind: 'move_to',
                    target,
                    range: distance(here, target) <= 1 ? 0 : 1,
                    cause: 'stuck_pre_inference_explore',
                };
            }
        }
        if (recovery) {
            if (visibility.returnDue) {
                ctx.deferVisibilityAnchorReturn();
            }
            return preInferenceResult(
                ctx,
                actionWithCause(recovery, 'stuck_pre_inference_explore'),
                'stuck_pre_inference_explore',
                perception,
                visibility,
            );
        }
    }

    const cognition = ctx.cognition();
    const brainBackedOff = typeof cognition.brainBackoffUntilTick === 'number' && ctx.options.state.tick < cognition.brainBackoffUntilTick;
    const goal = ctx.activeGoal();
    const explore =
        brainBackedOff && goal && isExplorationGoal(goal)
            ? explorationOrSkillOpportunityAction(ctx, perception, visibility.anchor)
            : undefined;
    if (explore) {
        const anchorReturn = hardVisibilityAnchorReturnAction(ctx, perception, visibility);
        if (anchorReturn) {
            return preInferenceResult(ctx, anchorReturn.action, anchorReturn.cause, perception, visibility);
        }

        return preInferenceResult(ctx, explore.action, explore.cause, perception, visibility);
    }

    return undefined;
}

export function brainTimeoutFallbackGoal(perception: HybridPerception | undefined, tick: number): ActiveGoalState {
    if (perception && firemakingAction(perception)) {
        return firemakingGoal(tick);
    }
    if (perception && starterFishingAction(perception)) {
        return starterFishingGoal(tick);
    }
    if (perception && starterMiningAction(perception)) {
        return miningGoal(tick);
    }
    if (perception && buryBonesAction(perception)) {
        return prayerGoal(tick);
    }
    return explorationGoal(tick);
}

export function applyBrainTimeoutFallback(ctx: HelperContext, perception?: HybridPerception): unknown {
    const cognition = ctx.cognition();
    cognition.lastBrainTick = ctx.options.state.tick;
    cognition.brainBackoffUntilTick = ctx.options.state.tick + BRAIN_TIMEOUT_BACKOFF_TICKS;
    const goal = ctx.activeGoal();
    if (goal && !goalExpiresBefore(goal, cognition.brainBackoffUntilTick)) {
        return undefined;
    }

    ctx.clearGoalMomentum();
    cognition.activeGoal = brainTimeoutFallbackGoal(perception, ctx.options.state.tick);
    cognition.lastGoalShareTick = undefined;
    return {
        id: cognition.activeGoal.id,
        steps: cognition.activeGoal.steps?.length || 0,
        source: 'brain_timeout_fallback',
    };
}

export function observeCompletedLocalGoal(ctx: HelperContext, perception: HybridPerception): void {
    if (ctx.options.soul.frontmatter.legacy?.parameters?.benchmarkTask) {
        return;
    }
    const goal = ctx.activeGoal();
    if (!goal || !isStandaloneFiremakingGoal(goal) || !fireLitEventObserved(perception)) {
        return;
    }

    ctx.clearGoalMomentum();
    const cognition = ctx.cognition();
    cognition.activeGoal = explorationGoal(ctx.options.state.tick);
    cognition.lastGoalShareTick = undefined;
}

// S-INFER-8: the brain request timeout is a GENEROUS "inference server is broken"
// ALARM ceiling, NOT a thinking bound. Real q4 qwopus full-envelope thinking is
// ~40s; 240s is ~6x that, with headroom for the future deliberative planner. A
// brain timeout firing is a RARE anomaly meaning "investigate the inference
// server" (see src/controller/llm/inference-health.ts degradedFlags), not routine.
// Do NOT lower this to throttle thinking. The Body timeout stays modest (body runs
// thinking-OFF / fast) so a genuinely stuck body call still times out quickly.
export const DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS = 240_000;
const DEFAULT_BODY_INFERENCE_TIMEOUT_MS = 10_000;

/**
 * S-INFER-2 (D1): explicit completion-token ceiling for the BRAIN call.
 *
 * Thinking stays ON (behavior.brain.thinking ?? true). A reasoning model spends
 * tokens on its `<think>` trace BEFORE the final JSON goal/say. With no ceiling
 * the run is bounded only by the server's unknown default + the 20s timeout; if
 * that default is small the answer is truncated mid-think and the salvage path
 * sees reasoning-only text → `think_only_no_answer` (a bogus "no decision").
 *
 * 4096 (S-INFER-4 B, raised from 1536) comfortably fits a thinking model's
 * full <think> reasoning trace PLUS the compact goal/say JSON the Brain emits
 * (steps + success + a short say line). The slow qwopus brain spends most of
 * its ~40s budget on the <think> trace; 1536 risked truncating mid-think so the
 * salvage path saw reasoning-only text → a bogus `think_only_no_answer`. 4096
 * still stays well under a local quantized model's context budget so the prompt
 * envelope is never crowded out. Endpoint config (`llm.endpoints.*.maxTokens`)
 * can override per deployment; a per-request value (here) wins over the endpoint
 * default inside LlmClient. Body keeps its own smaller ceiling.
 */
const DEFAULT_BRAIN_MAX_TOKENS = 4096;

function shouldShareGoal(ctx: HelperContext): boolean {
    const interval = ctx.behavior().shareGoalsEveryTicks ?? DEFAULT_GOAL_SHARE_EVERY_TICKS;
    if (interval <= 0) {
        return true;
    }
    const lastShared = ctx.cognition().lastGoalShareTick;
    return lastShared === undefined || ctx.options.state.tick - lastShared >= interval;
}

// Per-process lock: tracks residents with a PlannerPass currently in flight so
// concurrent runBrain calls don't double-trigger the deliberative planner.
const _plannerPassInFlight = new Set<string>();

/**
 * RIQ-3-6: Tick budget for plan stage routing.
 *
 * When the Body routes actions for a stage but the stage never emits
 * stage_done or stage_blocked (e.g. the router recognises the subgoal but
 * the resident cannot acquire the required item in the game world), this
 * in-memory counter tracks how many ticks the stage has been routing.  Once
 * STAGE_TICK_BUDGET ticks elapse the stage is force-blocked so the Planner
 * can replan with updated knowledge.
 *
 * Key: `${residentId}:${plan.createdAtTick}:${stage.id}`.  Including
 * createdAtTick means each replan gets fresh tracking even when the new plan
 * reuses the same stage id strings.  The Map is reset on controller restart
 * (acceptable — a restart is a legitimate reason to give a stage a fresh
 * budget).
 */
export const STAGE_TICK_BUDGET = 200;

/**
 * RIQ-5-2: Ticks to wait before retrying a PlannerPass after a failure.
 * 200 ticks ≈ 3 min at 1 tick/s; prevents rapid-retry budget exhaustion when
 * the planner endpoint is flaky or times out.
 */
export const PLANNER_FAILURE_BACKOFF_TICKS = 200;

const _stageActiveSinceTick = new Map<string, number>();
/** RIQ-4-3: last tick an action was dispatched for an open-goal stage (for action_result advance). */
const _stageLastDispatchTick = new Map<string, number>();

/**
 * RIQ-3-2: PlannerPass trigger.
 *
 * Runs before the per-tick goal picker. Checks whether the resident needs a
 * new deliberative plan (first run, plan completed, or current stage blocked)
 * and, if so, invokes runPlannerPass via the soul's `behavior.planner` profile.
 *
 * No-ops when:
 *   - No planStore is configured in the context
 *   - The soul has no orientationGoal
 *   - The behavior has no `planner` profile (planner profile = opt-in)
 *   - A PlannerPass is already in flight for this resident
 *   - The active plan is healthy (active + current stage not blocked)
 */
export async function maybeTriggerPlannerPass(ctx: HelperContext, thinkId?: number): Promise<void> {
    const { planStore } = ctx.options;
    if (!planStore) return;

    const soul = ctx.options.soul;
    const orientationGoal = soul.frontmatter.orientationGoal;
    if (!orientationGoal) return;

    const behavior = ctx.behavior() as HybridAgentBehaviorDefinition;
    const plannerProfile = behavior.planner;
    if (!plannerProfile) return;

    const residentId = ctx.options.state.resident;
    if (_plannerPassInFlight.has(residentId)) return;

    // RIQ-5-2: exponential-free but bounded backoff after a failed PlannerPass.
    // Prevents rapid-retry budget burn when the planner endpoint is flaky.
    const backoffUntil = ctx.options.state.cognition?.plannerFailureBackoffUntilTick;
    if (backoffUntil !== undefined && ctx.options.state.tick < backoffUntil) return;

    const plan = planStore.load(residentId);
    const stage = plan ? currentPlanStage(plan) : undefined;
    // RIQ-5-4: include goal-mismatch so a plan made for the old orientationGoal is
    // invalidated when the operator edits the soul (via `resident:goal-edit`).
    const goalChanged = plan !== null && plan !== undefined && plan.goalId !== orientationGoal.id;
    // S-GOAL-4: if an orientation stall fired AFTER the current plan was created, the Brain
    // should replan with a fresh approach. This connects the per-tick stall tracker (which
    // writes orientationStalledAt to CognitiveState) to the deliberative planner.
    const stalledSinceLastPlan = plan != null && (ctx.options.state.cognition?.orientationStalledAt ?? -1) > plan.createdAtTick;
    const needsReplan =
        !plan ||
        plan.status === 'completed' ||
        plan.status === 'abandoned' ||
        stage?.status === 'blocked' ||
        goalChanged ||
        stalledSinceLastPlan;
    if (!needsReplan) return;

    // RIQ-5-3: global concurrency cap — acquire slot BEFORE admitting budget so
    // residents denied a slot are never charged against their daily budget.
    // At most MAX_CONCURRENT_PLANNER_CALLS in-flight; denied residents skip this
    // tick and retry on the next brain cycle (natural stagger, no queue needed).
    if (!acquireGlobalPlannerSlot()) return;

    // S-PLAN-BUDGET-1: guard the paid planner (planner_haiku ~$0.016/call) against
    // runaway re-planning loops. Deny and log when the daily limit is reached.
    // Slot is released here so other residents can proceed on the same tick.
    const plannerBudget = admitPlannerCall(ctx.options.state);
    if (!plannerBudget.ok) {
        releaseGlobalPlannerSlot();
        process.stderr.write(
            `[RIQ-3-2] Planner budget exhausted for ${residentId}: ` + `${plannerBudget.callsToday}/${plannerBudget.max} calls today\n`,
        );
        return;
    }

    _plannerPassInFlight.add(residentId);
    const plannerLlmAdapter = {
        complete: async (req: LlmRequest): Promise<LlmResponse> => {
            return ctx.complete(thinkId || 0, {
                ...req,
                endpoint: ctx.endpointFor(plannerProfile),
                temperature: ctx.temperatureFor(plannerProfile, 0.3),
                thinking: plannerProfile.thinking ?? false,
                timeoutMs: ctx.timeoutFor(plannerProfile, 90_000),
                ...(ctx.modelFor(plannerProfile) ? { model: ctx.modelFor(plannerProfile) } : {}),
            });
        },
    } as unknown as LlmClient;

    try {
        const result = await runPlannerPass({
            residentName: soul.frontmatter.display || residentId,
            goalId: orientationGoal.id,
            goalDescription: orientationGoal.description,
            tick: ctx.options.state.tick,
            llmClient: plannerLlmAdapter,
            request: { endpoint: ctx.endpointFor(plannerProfile), priority: 3 },
        });
        if (result.success && result.plan) {
            planStore.save(residentId, result.plan);
            // RIQ-5-2: clear any prior failure backoff on a successful plan.
            if (ctx.options.state.cognition?.plannerFailureBackoffUntilTick !== undefined) {
                ctx.options.state.cognition.plannerFailureBackoffUntilTick = undefined;
            }
            // S-GOAL-4: clear orientation stall flag so we don't keep replanning every cycle.
            if (ctx.options.state.cognition?.orientationStalledAt !== undefined) {
                ctx.options.state.cognition.orientationStalledAt = undefined;
            }
            // RIQ-3-3: emit plan lifecycle Library event so the Storyteller can narrate
            // when a resident forms or adapts their multi-stage plan.
            const { libraryUpdater } = ctx.options;
            if (libraryUpdater) {
                const ts = new Date().toISOString();
                const stageSubgoals = result.plan.stages.map(s => s.subgoal);
                if (!plan) {
                    libraryUpdater.observePlanCreated({
                        kind: 'plan_created',
                        ts,
                        tick: ctx.options.state.tick,
                        goalId: result.plan.goalId,
                        goalDescription: result.plan.goalDescription,
                        stageCount: result.plan.stages.length,
                        stageSubgoals,
                    });
                } else {
                    const replannedReason = goalChanged
                        ? 'goal_changed'
                        : stalledSinceLastPlan
                          ? 'orientation_stalled'
                          : plan.status !== 'active'
                            ? plan.status
                            : `stage_blocked:${currentPlanStage(plan)?.id ?? 'unknown'}`;
                    libraryUpdater.observePlanReplanned({
                        kind: 'plan_replanned',
                        ts,
                        tick: ctx.options.state.tick,
                        goalId: result.plan.goalId,
                        goalDescription: result.plan.goalDescription,
                        stageCount: result.plan.stages.length,
                        stageSubgoals,
                        replannedReason,
                    });
                }
            }
        } else {
            // RIQ-5-2: back off before retrying so a flaky endpoint cannot burn the
            // daily budget in seconds (budget: 10 calls/day; backoff: 200 ticks ≈ 3 min).
            ctx.options.state.cognition = ctx.options.state.cognition ?? {};
            ctx.options.state.cognition.plannerFailureBackoffUntilTick = ctx.options.state.tick + PLANNER_FAILURE_BACKOFF_TICKS;
            process.stderr.write(`[RIQ-3-2] PlannerPass failed for ${residentId}: ${result.error ?? 'unknown'}\n`);
        }
    } catch (err) {
        // RIQ-5-2: also back off on thrown errors (network timeouts, parse failures).
        ctx.options.state.cognition = ctx.options.state.cognition ?? {};
        ctx.options.state.cognition.plannerFailureBackoffUntilTick = ctx.options.state.tick + PLANNER_FAILURE_BACKOFF_TICKS;
        process.stderr.write(`[RIQ-3-2] PlannerPass threw for ${residentId}: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
        releaseGlobalPlannerSlot();
        _plannerPassInFlight.delete(residentId);
    }
}

export async function runBrain(
    ctx: HelperContext,
    perception: Perception,
    gameSkill?: GameSkillContext,
    thinkId?: number,
): Promise<{
    action?: AgentAction;
    cause: string;
    envelopeTokens: number;
    nooped: boolean;
    memoUpdates?: number;
    planChange?: unknown;
}> {
    // RIQ-3-2: trigger deliberative PlannerPass before per-tick goal-picking
    // when the resident has an orientationGoal and a planner profile configured.
    await maybeTriggerPlannerPass(ctx, thinkId);

    const behavior = ctx.behavior();
    // RIQ-1-1-C: include lookup_wiki when GameSkillContext has wiki entries loaded.
    const wikiSearch = gameSkill?.wikiSearch;
    const brainTools = defaultTools(wikiSearch);
    const toolInstructions = buildToolInstructions(brainTools);
    const prompt = buildBrainPrompt({
        soul: ctx.options.soul,
        perception,
        activeGoal: ctx.activeGoal(),
        commandPrefix: ctx.commandPrefix(),
        gameSkill,
        progress: {
            tick: ctx.options.state.tick,
            lastMeaningfulProgressAt: ctx.options.state.lastMeaningfulProgressAt,
            stuckSince: ctx.options.state.stuckSince,
        },
        memories: ctx.promptMemories(perception as HybridPerception, 'brain'),
        toolInstructions,
    });

    // RIQ-1-1-B/C: route the brain completion through the planner tool loop so the
    // Brain can emit a lookup_skill or lookup_wiki call before its final goal/say JSON.
    // The adapter wraps ctx.complete so the loop respects the existing abort/cancel machinery.
    let lastRawResponse: LlmResponse = { text: '', nooped: false };
    const brainLlmAdapter = {
        complete: async (req: LlmRequest): Promise<LlmResponse> => {
            const resp = await ctx.complete(thinkId || 0, req);
            lastRawResponse = resp;
            return resp;
        },
    } as unknown as LlmClient;
    const brainRequest: LlmRequest = {
        endpoint: ctx.endpointFor(behavior.brain),
        prompt,
        temperature: ctx.temperatureFor(behavior.brain, 0.7),
        thinking: behavior.brain?.thinking ?? true,
        timeoutMs: ctx.timeoutFor(behavior.brain, DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS),
        // S-INFER-2 (D1): give the THINKING model an explicit ceiling that fits
        // its <think> reasoning AND the final goal/say JSON. Endpoint/profile
        // config can override; falls back through LlmClient to the endpoint
        // maxTokens then the server default when neither is set.
        maxTokens: ctx.maxTokensFor(behavior.brain, DEFAULT_BRAIN_MAX_TOKENS),
        priority: 5,
        ...(ctx.modelFor(behavior.brain) ? { model: ctx.modelFor(behavior.brain) } : {}),
    };
    const toolLoopResult = await runPlannerToolLoop({
        llmClient: brainLlmAdapter,
        request: brainRequest,
        tools: brainTools,
        toolRegistry: defaultToolRegistry(wikiSearch),
    });
    const response = { ...lastRawResponse, text: toolLoopResult.finalText };

    if (response.cancelledBy === 'request_timeout') {
        // S-INFER-8: the brain REQUEST timeout (240s) is a generous "inference server
        // is broken" alarm, NOT a thinking bound — real q4 qwopus thinking is ~40s, so
        // hitting 240s is a RARE anomaly. Log it LOUD as a degraded-inference signal,
        // not routine. The real fast "server dead" detector is the health probe in
        // src/controller/llm/inference-health.ts (degradedFlags); investigate there.
        const brainTimeoutMs = ctx.timeoutFor(behavior.brain, DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS);
        console.warn(
            `[inference-alarm] brain inference request_timeout after ${brainTimeoutMs ?? DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS}ms — ` +
                'the inference server may be degraded (real q4 thinking is ~40s; this ceiling is 240s). ' +
                'Investigate the inference server (see src/controller/llm/inference-health.ts degradedFlags).',
        );
    }
    const cancellation = ctx.cancelledResult(thinkId || 0, perception as HybridPerception);
    if (cancellation) {
        return {
            cause: cancellation.cause || 'thinking_cancelled',
            envelopeTokens: cancellation.envelopeTokens || 0,
            nooped: cancellation.nooped,
            planChange: cancellation.planChange,
        };
    }

    const detailed = parseBrainCompletionDetailed(response.text);
    const parsed = detailed.completion;
    // S-INFER-1: when the Brain produced no usable goal/say, surface WHY via
    // the salvage classification instead of a blanket 'brain_goal' noop, so
    // live action logs reveal the real breakdown (think_only_no_answer vs
    // schema_mismatch vs truly_empty vs a salvaged recovery). Only the
    // genuinely-empty branches below consult this; recovered completions keep
    // their existing 'brain_goal' cause.
    const emptyBrainCause = `brain_${detailed.classification}`;
    const sideEffects = applyBrainSideEffects(ctx, response.text);
    ctx.cognition().lastBrainTick = ctx.options.state.tick;
    ctx.cognition().brainBackoffUntilTick = undefined;
    let planChange: unknown;

    if (parsed.goal) {
        const cognition = ctx.cognition();
        const nextGoalId = parsed.goal.id || goalId(parsed.goal.description);
        if (cognition.activeGoal?.id && cognition.activeGoal.id !== nextGoalId) {
            ctx.clearGoalMomentum();
        }
        ctx.cognition().activeGoal = {
            id: nextGoalId,
            description: parsed.goal.description,
            steps: parsed.goal.steps,
            success: parsed.goal.success,
            ttlTicks: resolveBrainGoalTtl(parsed.goal.ttlTicks),
            createdAtTick: ctx.options.state.tick,
        };
        planChange = { id: nextGoalId, steps: parsed.goal.steps?.length || 0 };
    }

    const say = cleanSpeech(parsed.say);
    if (say && shouldShareGoal(ctx)) {
        ctx.cognition().lastGoalShareTick = ctx.options.state.tick;
        return {
            action: { kind: 'say', text: say },
            cause: parsed.cause || 'brain_goal',
            envelopeTokens: estimateTokens(prompt),
            nooped: response.nooped,
            memoUpdates: sideEffects.memoUpdates,
            planChange,
        };
    }

    // No say emitted. If a goal WAS set this is a normal brain_goal beat; if
    // nothing usable was parsed, report the precise salvage classification so
    // the controller's decision log distinguishes think_only_no_answer /
    // schema_mismatch / truly_empty / salvaged_lenient instead of guessing.
    const fallbackCause = parsed.goal ? parsed.cause || 'brain_goal' : parsed.cause || emptyBrainCause;
    return {
        cause: fallbackCause,
        envelopeTokens: estimateTokens(prompt),
        nooped: response.nooped && !parsed.goal,
        memoUpdates: sideEffects.memoUpdates,
        planChange,
    };
}

export async function runBody(
    ctx: HelperContext,
    perception: Perception,
    gameSkill?: GameSkillContext,
    thinkId?: number,
): Promise<ThoughtResult> {
    const bodyPerception = withoutTargetFailedPerception(
        perception as HybridPerception,
        ctx.cognition().targetFailureCooldowns,
        ctx.options.state.tick,
    );
    const behavior = ctx.behavior();
    const visibility = visibilityStatus(ctx, bodyPerception);
    const preInference = preInferenceBodyAction(ctx, bodyPerception, visibility);
    if (preInference) {
        return preInference;
    }

    const routedPlanStage = routeActivePlanStage(ctx, bodyPerception);
    if (routedPlanStage) {
        return routedPlanStage;
    }

    const prompt = buildBodyPrompt({
        soul: ctx.options.soul,
        perception: bodyPerception,
        activeGoal: ctx.activeGoal(),
        commandPrefix: ctx.commandPrefix(),
        gameSkill,
        progress: {
            tick: ctx.options.state.tick,
            lastMeaningfulProgressAt: ctx.options.state.lastMeaningfulProgressAt,
            stuckSince: ctx.options.state.stuckSince,
        },
        memories: ctx.promptMemories(bodyPerception, 'body'),
        visibility,
    });
    const response = await ctx.complete(thinkId || 0, {
        endpoint: ctx.endpointFor(behavior.body),
        prompt,
        temperature: ctx.temperatureFor(behavior.body, 0.15),
        thinking: behavior.body?.thinking ?? false,
        timeoutMs: ctx.timeoutFor(behavior.body, DEFAULT_BODY_INFERENCE_TIMEOUT_MS),
        priority: 2,
        ...(ctx.modelFor(behavior.body) ? { model: ctx.modelFor(behavior.body) } : {}),
    });
    const cancellation = ctx.cancelledResult(thinkId || 0, bodyPerception);
    if (cancellation) {
        return cancellation;
    }
    ctx.cognition().lastBodyTick = ctx.options.state.tick;

    const parsed = parseCompletion(response.text);
    let actions = parsed.ok ? parsed.actions.filter(action => action.kind !== 'noop').slice(0, 1) : [];
    let cause = parsed.ok ? parsed.cause || 'body_step' : parsed.cause || 'body_parse_failed';
    const routine = goalRoutineOverride(ctx, actions, bodyPerception);
    if (routine) {
        const loopBreak = routineLoopBreakAction(ctx, routine.action, routine.cause, bodyPerception, visibility.anchor);
        actions = [loopBreak?.action || routine.action];
        cause = loopBreak?.cause || routine.cause;
    }
    const approach = approachDistantInteraction(ctx, actions, bodyPerception);
    if (approach) {
        actions = [approach.action];
        cause = approach.cause;
    }
    const stabilizeMove = () => {
        const stableMove = stabilizedMoveAction(ctx, actions[0], bodyPerception, visibility.anchor);
        if (stableMove) {
            actions = [stableMove.action];
            cause = stableMove.cause;
        }
    };
    stabilizeMove();

    const modelSuggestedAction = actions.length > 0;
    actions = suppressRepeatedActions(ctx, actions);
    if (actions.length === 0 && !modelSuggestedAction) {
        const fallback = nonRepeatedFallbackAction(ctx, bodyPerception, visibility);
        if (fallback) {
            actions = [fallback.action];
            cause = fallback.cause;
            stabilizeMove();
        }
    }
    if (actions.length === 0 && modelSuggestedAction) {
        const fallback = nonRepeatedFallbackAction(ctx, bodyPerception, { ...visibility, returnDue: false });
        if (fallback) {
            actions = [fallback.action];
            cause = fallback.cause;
            stabilizeMove();
        }
    }
    if (actions.some(action => action.cause === 'return_to_visibility_anchor' || isMoveTo(action, visibility.anchor))) {
        ctx.cognition().lastAnchorReturnTick = ctx.options.state.tick;
    }

    return {
        actions,
        cause,
        envelopeTokens: estimateTokens(prompt),
        nooped: response.nooped || actions.length === 0,
    };
}

function routeActivePlanStage(ctx: HelperContext, bodyPerception: HybridPerception): ThoughtResult | undefined {
    const planStore = ctx.options.planStore;
    if (!planStore) {
        return undefined;
    }

    const residentId = ctx.options.soul.frontmatter.name;
    if (!residentId) {
        return undefined;
    }

    const plan = planStore.load(residentId);
    if (!plan || plan.status !== 'active') {
        return undefined;
    }

    const stage = currentPlanStage(plan);
    if (!stage || stage.status !== 'active') {
        return undefined;
    }

    const currentTick = ctx.options.state.tick;

    // RIQ-3-6: stage tick-budget key.  createdAtTick scopes the tracking to
    // this specific plan so a replan gets a fresh budget even if stage ids repeat.
    const stageKey = `${residentId}:${plan.createdAtTick}:${stage.id}`;

    // RIQ-4-3: build openGoalCtx from CognitiveState for open-goal stages.
    // lastActionResult uses _stageLastDispatchTick as a proxy: if an action was
    // dispatched for this stage last tick, treat it as a non-null result so
    // 'action_result' steps advance on the following tick.
    const cognition = ctx.cognition();
    const stepIdx = (cognition.primitiveStepIdxByStageId as Record<string, number> | undefined)?.[stage.id] ?? 0;
    const prevDispatchTick = _stageLastDispatchTick.get(stageKey);
    const lastActionResult = prevDispatchTick != null && prevDispatchTick === currentTick - 1 ? { tick: prevDispatchTick } : undefined;
    const openGoalCtx: OpenGoalContext | undefined = stage.steps && stage.steps.length > 0 ? { stepIdx, lastActionResult } : undefined;

    const routed = planStageRouter(stage, bodyPerception, openGoalCtx);

    if (!routed) {
        return undefined;
    }

    if (routed.planSignal === 'stage_done') {
        // RIQ-4-3: for open-goal stages with a successPredicate, evaluate before marking done.
        if (stage.successPredicate) {
            const stageStartedAt = _stageActiveSinceTick.get(stageKey);
            const predicateMet = evaluateSuccessPredicate(stage.successPredicate, bodyPerception, stageStartedAt);
            if (!predicateMet) {
                _stageActiveSinceTick.delete(stageKey);
                _stageLastDispatchTick.delete(stageKey);
                if (cognition.primitiveStepIdxByStageId) {
                    delete (cognition.primitiveStepIdxByStageId as Record<string, number>)[stage.id];
                }
                planStore.save(residentId, blockCurrentStage(plan));
                ctx.options.libraryUpdater?.observePlanStageBlocked({
                    kind: 'plan_stage_blocked',
                    ts: new Date().toISOString(),
                    tick: currentTick,
                    goalId: plan.goalId,
                    stageId: stage.id,
                    stageSubgoal: stage.subgoal,
                });
                return {
                    actions: [],
                    cause: `plan_stage_pred_unmet:${stage.id}`,
                    envelopeTokens: 0,
                    nooped: true,
                    planChange: { goalId: plan.goalId, stageId: stage.id, signal: 'stage_blocked' },
                };
            }
        }
        _stageActiveSinceTick.delete(stageKey);
        _stageLastDispatchTick.delete(stageKey);
        planStore.save(residentId, advancePlan(plan));
        // RIQ-A1-OBS: emit stage-done Library event so normal-life-audit can count completions.
        ctx.options.libraryUpdater?.observePlanStageDone({
            kind: 'plan_stage_done',
            ts: new Date().toISOString(),
            tick: currentTick,
            goalId: plan.goalId,
            stageId: stage.id,
            stageSubgoal: stage.subgoal,
        });
        // RIQ-4-4: for open-goal plans with authored steps, emit a narratable progress event.
        if ((plan.goalClass ?? 'runescape_skill') !== 'runescape_skill' && stage.steps && stage.steps.length > 0) {
            ctx.options.libraryUpdater?.observeOpenGoalProgress({
                kind: 'open_goal_progress',
                ts: new Date().toISOString(),
                tick: currentTick,
                goalId: plan.goalId,
                stageId: stage.id,
                goalClass: plan.goalClass!,
                note: stage.subgoal,
            });
        }
        return {
            actions: [],
            cause: `plan_stage_done:${stage.id}`,
            envelopeTokens: 0,
            nooped: true,
            planChange: { goalId: plan.goalId, stageId: stage.id, signal: 'stage_done' },
        };
    }

    if (routed.planSignal === 'stage_blocked') {
        _stageActiveSinceTick.delete(stageKey);
        _stageLastDispatchTick.delete(stageKey);
        if (cognition.primitiveStepIdxByStageId) {
            delete (cognition.primitiveStepIdxByStageId as Record<string, number>)[stage.id];
        }
        planStore.save(residentId, blockCurrentStage(plan));
        // RIQ-A1-OBS: emit stage-blocked Library event so normal-life-audit can count blocks.
        ctx.options.libraryUpdater?.observePlanStageBlocked({
            kind: 'plan_stage_blocked',
            ts: new Date().toISOString(),
            tick: currentTick,
            goalId: plan.goalId,
            stageId: stage.id,
            stageSubgoal: stage.subgoal,
        });
        return {
            actions: [],
            cause: `plan_stage_blocked:${stage.id}`,
            envelopeTokens: 0,
            nooped: true,
            planChange: { goalId: plan.goalId, stageId: stage.id, signal: 'stage_blocked' },
        };
    }

    if (routed.action) {
        // RIQ-3-6: track the first tick this stage routed an action.
        if (!_stageActiveSinceTick.has(stageKey)) {
            _stageActiveSinceTick.set(stageKey, currentTick);
        }
        // If the stage has been routing without completing for STAGE_TICK_BUDGET ticks,
        // force-block it so the planner can replan with updated knowledge.
        const startedAt = _stageActiveSinceTick.get(stageKey)!;
        if (currentTick - startedAt >= STAGE_TICK_BUDGET) {
            _stageActiveSinceTick.delete(stageKey);
            _stageLastDispatchTick.delete(stageKey);
            if (cognition.primitiveStepIdxByStageId) {
                delete (cognition.primitiveStepIdxByStageId as Record<string, number>)[stage.id];
            }
            planStore.save(residentId, blockCurrentStage(plan));
            ctx.options.libraryUpdater?.observePlanStageBlocked({
                kind: 'plan_stage_blocked',
                ts: new Date().toISOString(),
                tick: currentTick,
                goalId: plan.goalId,
                stageId: stage.id,
                stageSubgoal: stage.subgoal,
            });
            return {
                actions: [],
                cause: `plan_stage_blocked:${stage.id}`,
                envelopeTokens: 0,
                nooped: true,
                planChange: { goalId: plan.goalId, stageId: stage.id, signal: 'stage_blocked' },
            };
        }
        // RIQ-4-3: persist updated open-goal step index and record dispatch tick.
        if (routed.nextStepIdx !== undefined) {
            if (!cognition.primitiveStepIdxByStageId) {
                cognition.primitiveStepIdxByStageId = {};
            }
            (cognition.primitiveStepIdxByStageId as Record<string, number>)[stage.id] = routed.nextStepIdx;
        }
        _stageLastDispatchTick.set(stageKey, currentTick);
        return {
            actions: [routed.action],
            cause: `plan_stage:${stage.id}`,
            envelopeTokens: 0,
            nooped: false,
            planChange: { goalId: plan.goalId, stageId: stage.id, routed: true },
        };
    }

    return undefined;
}

export function clearGoalMomentum(ctx: HelperContext): void {
    const cognition = ctx.cognition();
    cognition.activeMove = undefined;
    cognition.lastBodyActionKey = undefined;
    cognition.lastBodyActionTick = undefined;
    cognition.routineLoopKey = undefined;
    cognition.routineLoopCount = 0;
}

export function rememberBodyAction(ctx: HelperContext, action: AgentAction): void {
    const key = JSON.stringify(action);
    const cognition = ctx.cognition();
    cognition.lastBodyActionKey = key;
    cognition.lastBodyActionTick = ctx.options.state.tick;
    rememberPickupAttempt(ctx, action);
    rememberExplorationAttempt(ctx, action);
}

export function rememberActiveMove(ctx: HelperContext, action: AgentAction, here: Pos): void {
    if (action.kind !== 'move_to') {
        return;
    }

    const target = positionLike(action.target);
    if (!target) {
        return;
    }

    const targetDistance = distance(here, target);
    ctx.cognition().activeMove = {
        target,
        range: typeof action.range === 'number' ? action.range : 0,
        cause: typeof action.cause === 'string' ? action.cause : undefined,
        startedAtTick: ctx.options.state.tick,
        lastTick: ctx.options.state.tick,
        lastPositionKey: positionKey(here),
        stationaryCount: 0,
        lastDistance: targetDistance,
        bestDistance: targetDistance,
        lastImprovedTick: ctx.options.state.tick,
        nonImprovingCount: 0,
    };
}

export function isRepeatedAction(ctx: HelperContext, action: AgentAction): boolean {
    if (action.kind === 'dialogue_continue' || action.kind === 'dialogue_choice') {
        return false;
    }
    if (action.kind === 'move_to' && typeof action.range === 'number' && action.range > 0) {
        return false;
    }
    const key = JSON.stringify(action);
    const cognition = ctx.cognition();
    return (
        cognition.lastBodyActionKey === key && ctx.options.state.tick - (cognition.lastBodyActionTick || 0) < REPEAT_ACTION_BACKOFF_TICKS
    );
}
