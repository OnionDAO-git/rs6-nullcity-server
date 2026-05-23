import type { GameSkillContext } from '../knowledge/game-skill-context';
import { parseCompletion } from '../llm/completion-parser';
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { ActiveGoalState, ActiveMoveState, RuntimeState } from '../memory/runtime-state';
import { retireNervousRulesMd, upsertNervousRulesMd } from '../nervous-system/rules-md';
import type { HybridAgentBehaviorDefinition, InferenceProfileDefinition, Soul } from '../soul/soul-schema';
import {
    COIN_ITEM_IDS,
    COMBAT_LOOT_MAX_DISTANCE,
    COOKING_HEAT_OBJECT_IDS,
    EXPLORATION_TARGET_COOLDOWN_TICKS,
    FIRE_OBJECT_IDS,
    FOOD_KEY_PATTERN,
    INTERACTION_APPROACH_RADIUS,
    LEVEL_ONE_TREE_IDS,
    MAX_INVENTORY_SLOTS,
    PICKUP_TARGET_COOLDOWN_TICKS,
    PRAYER_TRAINING_WAYPOINTS,
    PRAYER_TRAINING_WAYPOINT_RANGE,
    actionWithCause,
    buryBonesAction,
    combatLootOrPrayerAction,
    combatTrainingAction,
    distance,
    explorationAction,
    explorationActorCooldownKey,
    explorationItemCooldownKey,
    explorationObjectCooldownKey,
    explorationPatrolTarget,
    findSlot,
    firemakingAction,
    firstFoodSlot,
    hasNearbyFire,
    inventoryHasFreeSlot,
    isExplorationOnCooldown,
    isLowHealth,
    isOwnedByAnotherActor,
    isPickupOnCooldown,
    isStaleSelfOwnedLog,
    isUsefulGroundItem,
    itemLabel,
    levelOneWoodcuttingAction,
    nearestPrayerTrainingWaypoint,
    normalizeActorId,
    npcTalkAction,
    opportunisticPickupAction,
    pickupItemKey,
    prayerTrainingAction,
    safeBoneSourceTarget,
    safeCombatTarget,
    starterFishingAction,
    starterFishingCookingAction,
    stuckRecoveryPatrolTarget,
    usefulGroundItemPriority,
} from '../spark/runescape-body-routines';
import {
    HUMAN_BONE_SOURCE_PATTERN,
    LOW_RISK_BONE_SOURCE_PATTERN,
    MEDIUM_RISK_BONE_SOURCE_PATTERN,
    hasSmallFishingNet,
    hasWoodcuttingAxe,
    isBones,
    isFiremakingLog,
    isFishingSpot,
    isSafeBoneSource,
    isSafeCombatTarget,
    isSmallFishingNet,
    isStarterRawFish,
    isTinderbox,
    isWoodcuttingAxe,
} from '../spark/runescape-workflows';
import {
    OPENABLE_OBSTACLE_IDS,
    STUCK_OBSTACLE_RANGE,
    fleeTarget,
    latestCombatAttacker,
    shouldEmitPresenceBeacon,
    stuckBlockerReportAction,
    stuckHelpRequestAction,
    stuckOpenObstacleAction,
} from '../spark/runescape-nervous-rules';
import {
    benchmarkGoalForTask,
    cleanSpeech,
    cleanTarget,
    combatGoal,
    explorationGoal,
    firemakingGoal,
    followGoal,
    goalId,
    isCombatTrainingGoal,
    isDedicatedExplorationGoal,
    isExplorationGoal,
    isFiremakingGoal,
    isFollowGoal,
    isPrayerTrainingGoal,
    isStarterFishingGoal,
    isWoodcuttingTrainingGoal,
    parseBrainCompletion,
    prayerGoal,
    starterCookingGoal,
    starterFishingCookingGoal,
    starterFishingGoal,
    summarizeGoalForSpeech,
    woodcuttingGoal,
} from '../spark/runescape-brain-planner';
import type { AgentAction, Perception } from '../transport/message-codecs';
import { estimateTokens } from '../util/token-count';
import { buildBodyPrompt, buildBrainPrompt } from './hybrid-agent-prompts';
import type { ThinkingModule, ThoughtResult } from './thinking-module';
import { pickPhrase } from '../soul/phrasebook';
import { admitInference } from '../llm/budgets';

export interface HybridAgentThinkingModuleOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
}

type Pos = { x: number; y: number; level: number };
type Item = { itemId: number; key?: string; amount: number };
type WorldItem = Item & { position: Pos; ownerId?: string };
type Actor = {
    id: string;
    kind: 'player' | 'npc' | 'resident';
    name?: string;
    key?: string;
    position: Pos;
    hpFraction?: number;
    combatLevel?: number;
};
type ActiveTrade = {
    partner?: Actor;
    ours?: Item[];
    theirs?: Item[];
    ourStage?: string;
    theirStage?: string;
};
type HybridPerception = {
    tick?: number;
    resident?: {
        id?: string;
        position?: Pos;
        hp?: { current?: number; max?: number };
        combatLevel?: number;
        inCombat?: boolean;
        combatTarget?: Actor | null;
        busy?: boolean;
        inventory?: Array<Item | null>;
        activeTrade?: ActiveTrade;
    };
    nearby?: {
        players?: Actor[];
        npcs?: Actor[];
        worldItems?: WorldItem[];
        objects?: Array<{ objectId: number; position: Pos; orientation?: number }>;
    };
    events?: Array<Record<string, unknown>>;
};

const DEFAULT_BRAIN_EVERY_TICKS = 180;
const DEFAULT_BODY_EVERY_TICKS = 8;
const DEFAULT_GOAL_SHARE_EVERY_TICKS = 120;
const DEFAULT_RETURN_TO_ANCHOR_EVERY_TICKS = 600;
const DEFAULT_RETURN_TO_ANCHOR_RADIUS = 12;
const DEFAULT_FOLLOW_RADIUS = 2;
const REPEAT_ACTION_BACKOFF_TICKS = 30;
const MOVE_COMMIT_TICKS = 24;
const MOVE_STUCK_STATIONARY_OBSERVATIONS = 2;
const ROUTINE_LOOP_BREAK_ACTIONS = 3;
const ROUTINE_LOOP_BREAK_COOLDOWN_TICKS = 90;
const EXPLORATION_REPORT_COOLDOWN_TICKS = 80;
const EXPLORATION_MODEL_TARGET_MAX_DISTANCE = 6;
const ROUTINE_OPPORTUNISTIC_PICKUP_MAX_DISTANCE = 6;
const ESSENTIAL_TOOL_KEY_PATTERN = /(tinderbox|axe|pickaxe)/i;
// Item / actor classification predicates and their constant tables now live in
// `../spark/runescape-workflows` (Plan R-α). Body-routine action helpers and
// their shared primitives (`distance`, `findSlot`, `hasNearbyFire`,
// `FIRE_OBJECT_IDS`) live in `../spark/runescape-body-routines` (Plan R-β).
// The monolith imports both above.
// `OPENABLE_OBSTACLE_IDS`, `FENCE_OBSTACLE_IDS`, `STUCK_OBSTACLE_RANGE`, and
const EARSHOT_TILES = 8;
const CHAT_REPLIES_PER_WINDOW = 3;
const WINDOW_TICKS = 10;
const MAX_PROMPT_MEMORIES = 6;
const MAX_PROMPT_MEMORY_CHARS = 360;

export class HybridAgentThinkingModule implements ThinkingModule {
    constructor(private readonly options: HybridAgentThinkingModuleOptions) {}

    async think(perception: Perception, gameSkill?: GameSkillContext): Promise<ThoughtResult> {
        this.advanceTick(perception);
        this.ensureCognition();
        this.cognition().tickTelemetry = undefined;
        this.ensureBenchmarkGoal();

        const directChat = await this.directChatAction(perception as HybridPerception);
        if (directChat) {
            return this.result([directChat.action], directChat.cause, 0, false);
        }

        const combat = this.combatReaction(perception as HybridPerception);
        if (combat) {
            return this.result(combat.actions, combat.cause, 0, false);
        }

        const dialogue = this.dialogueReaction(perception as HybridPerception);
        if (dialogue) {
            return this.result([dialogue.action], dialogue.cause, 0, false);
        }

        const trade = this.tradeReaction(perception as HybridPerception);
        if (trade) {
            return this.result([trade.action], trade.cause, 0, false);
        }

        const pendingDirectTrade = this.pendingDirectTradeAction(perception as HybridPerception);
        if (pendingDirectTrade) {
            return this.result([pendingDirectTrade.action], pendingDirectTrade.cause, 0, false);
        }

        if ((perception as HybridPerception).resident?.busy) {
            return { actions: [], cause: 'resident_busy', nooped: true };
        }

        const combatNarration = this.combatNarrationAction();
        if (combatNarration) {
            return this.result([combatNarration.action], combatNarration.cause, 0, false);
        }

        const activeFollow = this.activeFollowAction(perception as HybridPerception);
        if (activeFollow) {
            return this.result([activeFollow.action], activeFollow.cause, 0, false);
        }

        const followHold = this.followListenHoldAction(perception as HybridPerception);
        if (followHold) {
            return this.result(followHold.actions, followHold.cause, 0, followHold.nooped);
        }

        if (this.shouldRunBrain()) {
            const brain = await this.runBrain(perception, gameSkill);
            if (brain.action) {
                return this.result([brain.action], brain.cause, brain.envelopeTokens, brain.nooped);
            }
        }

        if (!this.shouldRunBody()) {
            return this.result([], 'body_wait', 0, true);
        }

        const presenceBeacon = this.presenceBeaconAction(perception as HybridPerception);
        if (presenceBeacon) {
            return this.result([presenceBeacon], 'presence_beacon', 0, false);
        }

        const bodyResult = await this.runBody(perception, gameSkill);
        return this.result(bodyResult.actions, bodyResult.cause || 'body_step', bodyResult.envelopeTokens || 0, bodyResult.nooped);
    }

    considerInterrupt(_perception: Perception): boolean {
        return false;
    }

    stop(_cause: string): void {
        // Hybrid MVP performs one awaited inference at a time and keeps no abort controller.
    }

    private async runBrain(
        perception: Perception,
        gameSkill?: GameSkillContext,
    ): Promise<{ action?: AgentAction; cause: string; envelopeTokens: number; nooped: boolean }> {
        const behavior = this.behavior();
        const prompt = buildBrainPrompt({
            soul: this.options.soul,
            perception,
            activeGoal: this.activeGoal(),
            commandPrefix: this.commandPrefix(),
            gameSkill,
            progress: this.progressPromptInput(),
            memories: this.promptMemories(perception as HybridPerception, 'brain'),
        });
        const response = await this.options.llm.complete({
            endpoint: this.endpointFor(behavior.brain),
            prompt,
            temperature: this.temperatureFor(behavior.brain, 0.7),
            thinking: behavior.brain?.thinking ?? true,
            priority: 5,
            ...(this.modelFor(behavior.brain) ? { model: this.modelFor(behavior.brain) } : {}),
        });

        const parsed = parseBrainCompletion(response.text);
        this.applyBrainSideEffects(response.text);
        this.cognition().lastBrainTick = this.options.state.tick;

        if (parsed.goal) {
            const cognition = this.cognition();
            const nextGoalId = parsed.goal.id || goalId(parsed.goal.description);
            if (cognition.activeGoal?.id && cognition.activeGoal.id !== nextGoalId) {
                this.clearGoalMomentum();
            }
            this.cognition().activeGoal = {
                id: nextGoalId,
                description: parsed.goal.description,
                steps: parsed.goal.steps,
                success: parsed.goal.success,
                ttlTicks: parsed.goal.ttlTicks,
                createdAtTick: this.options.state.tick,
            };
        }

        const say = cleanSpeech(parsed.say);
        if (say && this.shouldShareGoal()) {
            this.cognition().lastGoalShareTick = this.options.state.tick;
            return {
                action: { kind: 'say', text: say },
                cause: parsed.cause || 'brain_goal',
                envelopeTokens: estimateTokens(prompt),
                nooped: response.nooped,
            };
        }

        return { cause: parsed.cause || 'brain_goal', envelopeTokens: estimateTokens(prompt), nooped: response.nooped && !parsed.goal };
    }

    private async runBody(perception: Perception, gameSkill?: GameSkillContext): Promise<ThoughtResult> {
        const behavior = this.behavior();
        const visibility = this.visibilityStatus(perception);
        const prompt = buildBodyPrompt({
            soul: this.options.soul,
            perception,
            activeGoal: this.activeGoal(),
            commandPrefix: this.commandPrefix(),
            gameSkill,
            progress: this.progressPromptInput(),
            memories: this.promptMemories(perception as HybridPerception, 'body'),
            visibility,
        });
        const response = await this.options.llm.complete({
            endpoint: this.endpointFor(behavior.body),
            prompt,
            temperature: this.temperatureFor(behavior.body, 0.15),
            thinking: behavior.body?.thinking ?? false,
            priority: 2,
            ...(this.modelFor(behavior.body) ? { model: this.modelFor(behavior.body) } : {}),
        });
        this.cognition().lastBodyTick = this.options.state.tick;

        const parsed = parseCompletion(response.text);
        let actions = parsed.ok ? parsed.actions.filter(action => action.kind !== 'noop').slice(0, 1) : [];
        let cause = parsed.ok ? parsed.cause || 'body_step' : parsed.cause || 'body_parse_failed';
        const routine = this.goalRoutineOverride(actions, perception as HybridPerception);
        if (routine) {
            const loopBreak = this.routineLoopBreakAction(routine.action, routine.cause, perception as HybridPerception, visibility.anchor);
            actions = [loopBreak?.action || routine.action];
            cause = loopBreak?.cause || routine.cause;
        }
        const approach = this.approachDistantInteraction(actions, perception as HybridPerception);
        if (approach) {
            actions = [approach.action];
            cause = approach.cause;
        }
        const stabilizeMove = () => {
            const stableMove = this.stabilizedMoveAction(actions[0], perception as HybridPerception, visibility.anchor);
            if (stableMove) {
                actions = [stableMove.action];
                cause = stableMove.cause;
            }
        };
        stabilizeMove();

        const modelSuggestedAction = actions.length > 0;
        actions = this.suppressRepeatedActions(actions);
        if (actions.length === 0 && !modelSuggestedAction) {
            const fallback = this.nonRepeatedFallbackAction(perception, visibility);
            if (fallback) {
                actions = [fallback.action];
                cause = fallback.cause;
                stabilizeMove();
            }
        }
        if (actions.length === 0 && modelSuggestedAction) {
            const fallback = this.nonRepeatedFallbackAction(perception, { ...visibility, returnDue: false });
            if (fallback) {
                actions = [fallback.action];
                cause = fallback.cause;
                stabilizeMove();
            }
        }
        if (actions.some(action => action.cause === 'return_to_visibility_anchor' || isMoveTo(action, visibility.anchor))) {
            this.cognition().lastAnchorReturnTick = this.options.state.tick;
        }

        return {
            actions,
            cause,
            envelopeTokens: estimateTokens(prompt),
            nooped: response.nooped || actions.length === 0,
        };
    }

    private applyBrainSideEffects(text: string): void {
        const parsed = parseCompletion(text);
        if (!parsed.ok) {
            return;
        }

        const memoryDir = this.options.memory.ensureResident(this.options.soul.frontmatter.name);
        for (const memo of parsed.memo || []) {
            this.options.memory.write(this.options.soul.frontmatter.name, memo.path, memo.text, memo.mode || 'append');
        }
        if (parsed.indexPatch?.append?.length) {
            this.options.memory.upsertIndexPatch(this.options.soul.frontmatter.name, parsed.indexPatch.append.join('\n'));
        }
        if (parsed.retireNervousRule?.length) {
            retireNervousRulesMd(memoryDir, parsed.retireNervousRule);
        }
        if (parsed.proposeNervousRule?.length) {
            upsertNervousRulesMd(memoryDir, { rules: parsed.proposeNervousRule });
        }
    }

    private fallbackAction(
        perception: Perception,
        visibility: ReturnType<HybridAgentThinkingModule['visibilityStatus']>,
    ): { action: AgentAction; cause: string } | undefined {
        const view = perception as HybridPerception;
        const goal = this.activeGoal();
        const prayerAction =
            goal && /prayer|bone|bones|bury/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`)
                ? prayerTrainingAction(view)
                : undefined;
        if (prayerAction) {
            return { action: prayerAction, cause: prayerAction.cause || 'prayer_bury_bones' };
        }

        const combatAction =
            goal && isCombatTrainingGoal(goal) ? combatTrainingAction(view, this.pickupCooldowns(), this.options.state.tick) : undefined;
        if (combatAction) {
            return { action: combatAction, cause: combatAction.cause || 'combat_training' };
        }

        const cookingAction = goal && isStarterFishingGoal(goal) ? starterFishingCookingAction(view) : undefined;
        if (cookingAction) {
            return { action: cookingAction, cause: cookingAction.cause || 'starter_fishing_cooking' };
        }

        const fishingAction = goal && isStarterFishingGoal(goal) ? starterFishingAction(view) : undefined;
        if (fishingAction) {
            return { action: fishingAction, cause: fishingAction.cause || 'starter_fishing' };
        }

        const fireAction =
            goal && /fire|burn|logs|tinderbox|light/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`)
                ? firemakingAction(view)
                : undefined;
        if (fireAction) {
            return { action: fireAction, cause: 'firemaking_fallback' };
        }

        const exploreAction =
            goal && isExplorationGoal(goal)
                ? explorationAction(
                      view,
                      visibility.anchor,
                      this.options.state.resident,
                      this.pickupCooldowns(),
                      this.options.state.tick,
                      this.explorationCooldowns(),
                  )
                : undefined;
        if (exploreAction) {
            return {
                action: exploreAction,
                cause: exploreAction.cause === 'opportunistic_pickup' ? 'opportunistic_pickup' : 'exploration_fallback',
            };
        }

        const follow = this.followAction(view);
        if (follow) {
            return { action: follow, cause: 'follow_player_fallback' };
        }

        if (visibility.returnDue && visibility.anchor) {
            return {
                action: { kind: 'move_to', target: visibility.anchor, cause: 'return_to_visibility_anchor' },
                cause: 'return_to_visibility_anchor',
            };
        }

        return undefined;
    }

    private goalRoutineOverride(actions: AgentAction[], perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
        const goal = this.activeGoal();
        if (!goal) {
            return undefined;
        }

        const goalText = `${goal.description} ${(goal.steps || []).join(' ')}`;
        if (isPrayerTrainingGoal(goal)) {
            const prayerAction = prayerTrainingAction(perception);
            if (prayerAction) {
                return { action: prayerAction, cause: prayerAction.cause || 'prayer_training' };
            }
        }

        if (isCombatTrainingGoal(goal)) {
            const combatAction = combatTrainingAction(perception, this.pickupCooldowns(), this.options.state.tick);
            if (combatAction) {
                return { action: combatAction, cause: combatAction.cause || 'combat_training' };
            }
        }

        if (isWoodcuttingTrainingGoal(goal) && !isFiremakingGoal(goal)) {
            const fireAction = firemakingAction(perception);
            if (fireAction) {
                this.clearGoalMomentum();
                this.cognition().activeGoal = firemakingGoal(this.options.state.tick);
                return { action: actionWithCause(fireAction, 'woodcutting_chain_firemaking'), cause: 'woodcutting_chain_firemaking' };
            }
        }

        if (isStarterFishingGoal(goal)) {
            const cookingAction = starterFishingCookingAction(perception);
            if (cookingAction) {
                return { action: cookingAction, cause: cookingAction.cause || 'starter_fishing_cooking' };
            }
            const fishingAction = starterFishingAction(perception);
            if (fishingAction) {
                return { action: fishingAction, cause: fishingAction.cause || 'starter_fishing' };
            }
        }

        const fireGoalLike = /fire|burn|logs|tinderbox|light/i.test(goalText);
        if (fireGoalLike) {
            const fireAction = firemakingAction(perception);
            if (fireAction) {
                return { action: fireAction, cause: 'firemaking_fallback' };
            }
        }

        const opportunity = opportunisticPickupAction(
            perception,
            this.options.state.resident,
            ROUTINE_OPPORTUNISTIC_PICKUP_MAX_DISTANCE,
            this.pickupCooldowns(),
            this.options.state.tick,
        );
        if (opportunity) {
            return { action: opportunity, cause: 'opportunistic_pickup' };
        }

        if (isDedicatedExplorationGoal(goal)) {
            const explorationOverride = this.explorationRoutineOverride(actions, perception);
            if (explorationOverride) {
                return { action: explorationOverride, cause: 'exploration_fallback' };
            }
        }

        if (fireGoalLike) {
            const explicitWoodcuttingGoalId = /woodcut|chop/i.test(goal.id);
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

    private repeatedExplorationReportOverride(actions: AgentAction[], perception: HybridPerception): AgentAction | undefined {
        const action = actions[0];
        if (action?.kind !== 'say') {
            return undefined;
        }

        const cognition = this.cognition();
        const lastReport = cognition.lastExplorationReportTick;
        if (lastReport === undefined || this.options.state.tick - lastReport >= EXPLORATION_REPORT_COOLDOWN_TICKS) {
            cognition.lastExplorationReportTick = this.options.state.tick;
            return undefined;
        }

        return explorationAction(
            perception,
            this.visibilityAnchor(),
            this.options.state.resident,
            this.pickupCooldowns(),
            this.options.state.tick,
            this.explorationCooldowns(),
        );
    }

    private explorationRoutineOverride(actions: AgentAction[], perception: HybridPerception): AgentAction | undefined {
        const reportOverride = this.repeatedExplorationReportOverride(actions, perception);
        if (reportOverride) {
            return reportOverride;
        }

        if (this.cognition().activeMove) {
            return undefined;
        }

        const localAction = explorationAction(
            perception,
            this.visibilityAnchor(),
            this.options.state.resident,
            this.pickupCooldowns(),
            this.options.state.tick,
            this.explorationCooldowns(),
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
        const evidenceSaysStuck = typeof this.options.state.stuckSince === 'number';
        if (
            here &&
            target &&
            distance(here, target) > EXPLORATION_MODEL_TARGET_MAX_DISTANCE &&
            (evidenceSaysStuck || isConcreteExplorationOverride(localAction)) &&
            !this.isRepeatedAction(localAction)
        ) {
            return localAction;
        }

        return undefined;
    }

    private stabilizedMoveAction(
        action: AgentAction | undefined,
        perception: HybridPerception,
        anchor?: Pos,
    ): { action: AgentAction; cause: string } | undefined {
        const here = perception.resident?.position;
        if (!here) {
            return undefined;
        }

        const cognition = this.cognition();
        const active = cognition.activeMove;
        if (active) {
            if (action && shouldInterruptActiveMove(action)) {
                cognition.activeMove = undefined;
                return undefined;
            }
            if (distance(here, active.target) <= (active.range ?? 0)) {
                cognition.activeMove = undefined;
            } else {
                const currentPositionKey = positionKey(here);
                const stationaryCount = active.lastPositionKey === currentPositionKey ? (active.stationaryCount || 0) + 1 : 0;
                const updated = {
                    ...active,
                    lastTick: this.options.state.tick,
                    lastPositionKey: currentPositionKey,
                    stationaryCount,
                };
                cognition.activeMove = updated;

                if (typeof this.options.state.stuckSince === 'number') {
                    if (active.cause === 'stuck_move_recovery') {
                        const helpRequest = stuckHelpRequestAction(here, updated, perception, this.options.soul);
                        if (helpRequest && !this.isRepeatedAction(helpRequest)) {
                            cognition.activeMove = undefined;
                            return { action: helpRequest, cause: 'stuck_help_request' };
                        }
                    } else {
                        const recovery = this.stuckMoveRecoveryAction(perception, here, updated, anchor);
                        if (recovery) {
                            return recovery;
                        }
                    }
                }

                if (stationaryCount >= MOVE_STUCK_STATIONARY_OBSERVATIONS) {
                    return this.stuckMoveRecoveryAction(perception, here, updated, anchor);
                }

                if (
                    action?.kind === 'move_to' &&
                    !sameMoveIntent(action, updated) &&
                    this.options.state.tick - updated.startedAtTick < MOVE_COMMIT_TICKS
                ) {
                    return { action: moveIntentAction(updated, 'continue_move'), cause: 'continue_move' };
                }

                if (action?.kind === 'move_to' && sameMoveIntent(action, updated)) {
                    return undefined;
                }
            }
        }

        if (action?.kind === 'move_to') {
            this.rememberActiveMove(action, here);
        } else if (action) {
            cognition.activeMove = undefined;
        }

        return undefined;
    }

    private stuckMoveRecoveryAction(
        perception: HybridPerception,
        here: Pos,
        active: ActiveMoveState,
        anchor?: Pos,
    ): { action: AgentAction; cause: string } | undefined {
        const obstacle = stuckOpenObstacleAction(perception, here, active, this.explorationCooldowns(), this.options.state.tick);
        if (obstacle) {
            this.cognition().activeMove = undefined;
            return { action: obstacle, cause: 'stuck_open_obstacle' };
        }

        const blocker = stuckBlockerReportAction(perception, here, active);
        if (blocker && !this.isRepeatedAction(blocker)) {
            return { action: blocker, cause: 'stuck_blocker_report' };
        }

        const helpRequest = stuckHelpRequestAction(here, active, perception, this.options.soul);
        if (helpRequest && !this.isRepeatedAction(helpRequest)) {
            this.cognition().activeMove = undefined;
            return { action: helpRequest, cause: 'stuck_help_request' };
        }

        const localAction = explorationAction(
            perception,
            anchor,
            this.options.state.resident,
            this.pickupCooldowns(),
            this.options.state.tick,
            this.explorationCooldowns(),
        );
        const recovery =
            localAction && isConcreteExplorationOverride(localAction)
                ? localAction
                : {
                      kind: 'move_to',
                      target: stuckRecoveryPatrolTarget(here, active.target, this.options.state.tick, anchor),
                      range: 1,
                      cause: 'stuck_move_recovery',
                  };
        const action = actionWithCause(recovery, 'stuck_move_recovery');
        this.rememberActiveMove(action, here);
        return { action, cause: 'stuck_move_recovery' };
    }

    private approachDistantInteraction(
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

    private nonRepeatedFallbackAction(
        perception: Perception,
        visibility: ReturnType<HybridAgentThinkingModule['visibilityStatus']>,
    ): { action: AgentAction; cause: string } | undefined {
        const fallback = this.fallbackAction(perception, visibility);
        if (!fallback || this.isRepeatedAction(fallback.action)) {
            return undefined;
        }

        this.rememberBodyAction(fallback.action);
        return fallback;
    }

    private routineLoopBreakAction(
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

        const cognition = this.cognition();
        const key = `${routineLoopFamily(cause, action)}|${positionKey(here)}`;
        cognition.routineLoopCount = cognition.routineLoopKey === key ? (cognition.routineLoopCount || 0) + 1 : 1;
        cognition.routineLoopKey = key;

        const lastBreakTick = cognition.lastRoutineLoopBreakTick || 0;
        const evidenceSaysStuck = typeof this.options.state.stuckSince === 'number';
        if (
            (!evidenceSaysStuck && cognition.routineLoopCount < ROUTINE_LOOP_BREAK_ACTIONS) ||
            (lastBreakTick > 0 && this.options.state.tick - lastBreakTick < ROUTINE_LOOP_BREAK_COOLDOWN_TICKS)
        ) {
            return undefined;
        }

        cognition.routineLoopCount = 0;
        cognition.routineLoopKey = undefined;
        cognition.lastRoutineLoopBreakTick = this.options.state.tick;

        const explore = explorationAction(
            perception,
            anchor,
            this.options.state.resident,
            this.pickupCooldowns(),
            this.options.state.tick,
            this.explorationCooldowns(),
        );
        return {
            action: explore
                ? actionWithCause(explore, 'routine_loop_break')
                : { kind: 'say', text: 'I have worked this spot for a while. I am going to scout nearby.', cause: 'routine_loop_break' },
            cause: 'routine_loop_break',
        };
    }

    private activeFollowAction(perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
        const target = this.currentFollowTarget();
        const goal = this.activeGoal();
        if (!target?.name || (!this.cognition().followTarget?.name && !isFollowGoal(goal))) {
            return undefined;
        }

        const action = this.followAction(perception, 'follow_player_active');
        return action ? { action, cause: 'follow_player_active' } : undefined;
    }

    private followListenHoldAction(perception: HybridPerception): { actions: AgentAction[]; cause: string; nooped: boolean } | undefined {
        const goal = this.activeGoal();
        const targetState = this.currentFollowTarget();
        if (!goal || !isFollowGoal(goal) || !targetState?.name) {
            return undefined;
        }

        const beacon = this.presenceBeaconAction(perception);
        if (beacon) {
            return { actions: [beacon], cause: 'presence_beacon', nooped: false };
        }

        return { actions: [], cause: 'follow_listen_hold', nooped: true };
    }

    private followAction(perception: HybridPerception, cause = 'follow_player_fallback'): AgentAction | undefined {
        const targetState = this.currentFollowTarget();
        const targetName = targetState?.name;
        const here = perception.resident?.position;
        if (!targetName || !here) {
            return undefined;
        }

        const target = (perception.nearby?.players || []).find(player => {
            return (targetState?.id && player.id === targetState.id) || actorMatchesName(player, targetName);
        });
        if (!target || distance(here, target.position) <= (this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS)) {
            return undefined;
        }

        return {
            kind: 'move_to',
            target: target.position,
            range: this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS,
            cause,
        };
    }

    private pendingDirectTradeAction(perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
        const pending = this.cognition().pendingDirectTrade;
        if (!pending) {
            return undefined;
        }
        if (this.options.state.tick - pending.setAtTick > 80) {
            this.cognition().pendingDirectTrade = undefined;
            return undefined;
        }
        if (perception.resident?.activeTrade) {
            this.cognition().pendingDirectTrade = undefined;
            return undefined;
        }

        const here = perception.resident?.position;
        const target = this.resolvePendingDirectTradeTarget(perception, pending.target);
        if (!here || !target) {
            return undefined;
        }
        if (distance(here, target.position) > 1) {
            return {
                action: { kind: 'move_to', target: target.position, range: 1, cause: 'direct_chat_trade' },
                cause: 'direct_chat_trade',
            };
        }

        this.cognition().pendingDirectTrade = undefined;
        return { action: { kind: 'trade_request', target, cause: 'direct_chat_trade' }, cause: 'direct_chat_trade' };
    }

    private rememberPendingDirectTrade(target: Actor | undefined): void {
        if (!target || target.kind === 'npc') {
            return;
        }
        this.cognition().pendingDirectTrade = {
            target: {
                id: target.id,
                kind: target.kind,
                name: target.name,
                key: target.key,
                position: target.position,
                hpFraction: target.hpFraction,
                combatLevel: target.combatLevel,
            },
            setAtTick: this.options.state.tick,
        };
    }

    private resolvePendingDirectTradeTarget(
        perception: HybridPerception,
        pending: NonNullable<ReturnType<HybridAgentThinkingModule['cognition']>['pendingDirectTrade']>['target'],
    ): Actor | undefined {
        const visible = (perception.nearby?.players || []).find(
            actor => actor.id === pending.id || actorMatchesName(actor, pending.name || pending.id),
        );
        if (visible) {
            return visible;
        }
        return actorLike(pending);
    }

    private isChatRateLimited(): boolean {
        const cognition = this.cognition() as any;
        if (!cognition.chatReplyTicks) {
            cognition.chatReplyTicks = [];
        }
        const currentTick = this.options.state.tick;
        cognition.chatReplyTicks = cognition.chatReplyTicks.filter((tick: number) => tick > currentTick - WINDOW_TICKS);
        return cognition.chatReplyTicks.length >= CHAT_REPLIES_PER_WINDOW;
    }

    private recordChatReplyEmit(): void {
        const cognition = this.cognition() as any;
        if (!cognition.chatReplyTicks) {
            cognition.chatReplyTicks = [];
        }
        cognition.chatReplyTicks.push(this.options.state.tick);
    }

    private isManuallyPaused(): boolean {
        return this.cognition().manualPauseSinceTick !== undefined;
    }

    private pauseDirectChatActivity(): void {
        const cognition = this.cognition();
        cognition.manualPauseSinceTick = this.options.state.tick;
        const target = cognition.followTarget;
        cognition.followTarget = target
            ? { ...target, paused: true, setAtTick: this.options.state.tick }
            : { paused: true, setAtTick: this.options.state.tick };
    }

    private resumeManualPause(): void {
        this.cognition().manualPauseSinceTick = undefined;
    }

    private async nonCommandChatReaction(perception: HybridPerception): Promise<{ action: AgentAction; cause: string } | undefined> {
        const events = perception.events || [];
        const resident = perception.resident;
        if (!resident || !resident.position) {
            return undefined;
        }

        for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index];
            if (event.kind !== 'chat' || typeof event.text !== 'string') {
                continue;
            }

            const from = actorLike(event.from);
            if (!from || isSelfActor(from, perception)) {
                continue;
            }

            const normalizedText = normalizeText(event.text);
            if (mentionsCommandPrefix(normalizedText, this.commandPrefix())) {
                continue;
            }

            if (!from.position || from.position.level !== resident.position.level) {
                continue;
            }

            const dx = from.position.x - resident.position.x;
            const dy = from.position.y - resident.position.y;
            if (dx * dx + dy * dy > 64) {
                continue;
            }

            if (this.isChatRateLimited()) {
                this.cognition().tickTelemetry = {
                    chat_reply_emitted: false,
                    chat_reply_suppressed: 'rate_limited',
                };
                return undefined;
            }

            const budgetDecision = admitInference(this.options.state);
            if (!budgetDecision.ok) {
                this.cognition().tickTelemetry = {
                    chat_reply_emitted: false,
                    chat_reply_suppressed: 'budget_exhausted',
                };
                return undefined;
            }

            const memories = this.promptMemories(perception, 'body');
            const prompt = [
                `You are the RuneScape resident ${this.options.soul.frontmatter.display || this.options.soul.frontmatter.name}.`,
                `Your character archetype is ${this.options.soul.frontmatter.archetype || 'default'}.`,
                `Your voice register is ${this.options.soul.frontmatter.voice?.register || 'default'}.`,
                this.options.soul.body ? `Character notes:\n${this.options.soul.body}` : '',
                this.promptMemorySection(memories, 'body'),
                `A player nearby said: "${event.text}".`,
                `Reply to them in character as one normal public chat sentence under 160 characters.`,
                `Do not include JSON, fields, markdown, arrays, or labels. Do not echo this prompt. Output only the chat text.`,
            ]
                .filter(Boolean)
                .join('\n');

            const response = await this.options.llm.complete({
                endpoint: this.endpointFor(this.behavior().brain),
                prompt,
                temperature: this.temperatureFor(this.behavior().brain, 0.7),
                thinking: this.behavior().brain?.thinking ?? true,
                priority: 5,
                ...(this.modelFor(this.behavior().brain) ? { model: this.modelFor(this.behavior().brain) } : {}),
            });

            const replyText = this.cleanSmallTalkReply(response.text, normalizedText, memories);
            if (!replyText) {
                return undefined;
            }

            this.recordChatReplyEmit();

            const action: AgentAction = {
                kind: 'say',
                text: replyText,
                voiceSource: 'inference',
            };

            this.cognition().tickTelemetry = {
                chat_reply_emitted: true,
                chat_reply_kind: 'small_talk',
                voiceSource: 'inference',
            };

            return {
                action,
                cause: 'non_command_small_talk',
            };
        }

        return undefined;
    }

    private clarifyingQuestionReaction(
        perception: HybridPerception,
        commandLower: string,
    ): { action: AgentAction; cause: string } | undefined {
        if (this.isChatRateLimited()) {
            this.cognition().tickTelemetry = {
                chat_reply_emitted: false,
                chat_reply_suppressed: 'rate_limited',
            };
            return undefined;
        }

        let params: Record<string, string> | undefined;
        if (commandLower === 'give') {
            const items = (perception.resident?.inventory || [])
                .filter((item): item is Item => item !== null)
                .map(item => itemLabel(item))
                .join(', ');
            params = { inventory: items || 'nothing' };
        }

        const text = pickPhrase({
            soul: this.options.soul,
            situation: `ambiguity.${commandLower}`,
            seed: `${this.options.state.tick}`,
            params,
        });

        this.recordChatReplyEmit();

        const action: AgentAction = {
            kind: 'say',
            text,
            voiceSource: 'phrasebook',
        };

        this.cognition().tickTelemetry = {
            chat_reply_emitted: true,
            chat_reply_kind: 'clarifying_question',
            voiceSource: 'phrasebook',
        };

        return {
            action,
            cause: `direct_chat_clarify_ambiguous_${commandLower}`,
        };
    }

    private politeDeclineReaction(
        perception: HybridPerception,
        refusalReason: string,
        missingTool?: string,
    ): { action: AgentAction; cause: string } | undefined {
        if (this.isChatRateLimited()) {
            this.cognition().tickTelemetry = {
                chat_reply_emitted: false,
                chat_reply_suppressed: 'rate_limited',
            };
            return undefined;
        }

        let text = '';
        if (refusalReason === 'missing_tool') {
            text = pickPhrase({
                soul: this.options.soul,
                situation: 'polite_decline.missing_tool',
                seed: `${this.options.state.tick}`,
                params: { tool: missingTool || 'tool' },
            });
        } else {
            text = pickPhrase({
                soul: this.options.soul,
                situation: `polite_decline.${refusalReason}`,
                seed: `${this.options.state.tick}`,
                params: { prefix: this.commandPrefix() },
            });
        }

        this.recordChatReplyEmit();

        const action: AgentAction = {
            kind: 'say',
            text,
            voiceSource: 'phrasebook',
        };

        this.cognition().tickTelemetry = {
            chat_reply_emitted: true,
            chat_reply_kind: 'polite_decline',
            refusalReason,
            voiceSource: 'phrasebook',
        };

        return {
            action,
            cause: `direct_chat_decline_${refusalReason}`,
        };
    }

    private async directChatAction(perception: HybridPerception): Promise<{ action: AgentAction; cause: string } | undefined> {
        const chat = latestAddressedChat(perception, this.commandPrefix(), this.cognition().lastDirectChatKey);
        if (!chat) {
            return await this.nonCommandChatReaction(perception);
        }

        this.cognition().lastDirectChatKey = chat.key;
        const command = addressedCommand(chat.normalizedText, this.commandPrefix());
        const here = perception.resident?.position;

        if (perception.resident?.inCombat) {
            this.cognition().tickTelemetry = {
                chat_reply_emitted: false,
                chat_reply_kind: 'polite_decline',
                refusalReason: 'busy_higher_priority_goal',
            };
            return undefined;
        }

        const commandLower = command.toLowerCase().trim();

        if (commandLower === 'go' || commandLower === 'make' || commandLower === 'give') {
            return this.clarifyingQuestionReaction(perception, commandLower);
        }

        let refusalReason: string | undefined;
        let missingTool: string | undefined;

        if (isFiremakingIntent(command, chat.normalizedText)) {
            const hasTinderbox = findSlot(perception.resident?.inventory || [], isTinderbox) !== undefined;
            if (!hasTinderbox) {
                refusalReason = 'missing_tool';
                missingTool = 'tinderbox';
            }
        } else if (isWoodcuttingIntent(command, chat.normalizedText)) {
            if (!hasWoodcuttingAxe(perception)) {
                refusalReason = 'missing_tool';
                missingTool = 'axe';
            }
        } else if (isStarterFishingIntent(command, chat.normalizedText)) {
            if (!hasSmallFishingNet(perception)) {
                refusalReason = 'missing_tool';
                missingTool = 'small fishing net';
            }
        } else if (attackIntent(command)) {
            if (isLowHealth(perception)) {
                refusalReason = 'low_hp';
            }
        } else if (!isRecognizedCommand(command, chat.normalizedText)) {
            refusalReason = 'unknown_command';
        }

        if (refusalReason) {
            return this.politeDeclineReaction(perception, refusalReason, missingTool);
        }

        if (isStopFollowingIntent(command, chat.normalizedText)) {
            const target = this.currentFollowTarget();
            this.clearGoalMomentum();
            this.cognition().followTarget = { paused: true, setAtTick: this.options.state.tick };
            if (isFollowGoal(this.cognition().activeGoal)) {
                this.cognition().activeGoal = undefined;
            }

            return {
                action: {
                    kind: 'say',
                    text: target?.name ? `I will stop following ${target.name}.` : 'I will stop following for now.',
                },
                cause: 'direct_chat_stop_following',
            };
        }

        const follow = followIntent(command, chat.normalizedText);
        if (follow) {
            const target = follow.target ? findActorByName(perception.nearby?.players || [], follow.target) : chat.from;
            if (!target) {
                return {
                    action: {
                        kind: 'say',
                        text: follow.target ? `I do not see ${cleanTarget(follow.target)} nearby.` : 'I need to see who to follow.',
                    },
                    cause: 'direct_chat_follow',
                };
            }

            this.clearGoalMomentum();
            this.resumeManualPause();
            this.cognition().followTarget = {
                name: actorName(target),
                id: target.id,
                kind: target.kind,
                paused: false,
                setAtTick: this.options.state.tick,
            };
            this.cognition().activeGoal = followGoal(actorName(target), this.options.state.tick);

            if (here && distance(here, target.position) <= (this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS)) {
                return {
                    action: { kind: 'say', text: this.statusSpeech(perception, `I will follow ${actorName(target)}`) },
                    cause: 'direct_chat_follow',
                };
            }

            return {
                action: {
                    kind: 'move_to',
                    target: target.position,
                    range: this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS,
                    cause: 'direct_chat_follow',
                },
                cause: 'direct_chat_follow',
            };
        }

        if (isReturnHomeIntent(command, chat.normalizedText)) {
            const anchor = this.visibilityAnchor();
            if (!anchor) {
                return {
                    action: { kind: 'say', text: 'I do not have a home anchor set yet.' },
                    cause: 'direct_chat_return_home',
                };
            }

            this.resumeManualPause();
            if (here && distance(here, anchor) <= (this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS)) {
                return {
                    action: { kind: 'say', text: this.statusSpeech(perception, 'I am already near home') },
                    cause: 'direct_chat_return_home',
                };
            }

            return {
                action: {
                    kind: 'move_to',
                    target: anchor,
                    range: this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS,
                    cause: 'direct_chat_return_home',
                },
                cause: 'direct_chat_return_home',
            };
        }

        if (isStopIntent(command, chat.normalizedText)) {
            this.clearGoalMomentum();
            this.cognition().activeGoal = undefined;
            this.pauseDirectChatActivity();
            return {
                action: { kind: 'say', text: 'I will pause here and wait for a new goal.' },
                cause: 'direct_chat_stop',
            };
        }

        if (isStatusIntent(command, chat.normalizedText)) {
            return {
                action: { kind: 'say', text: this.statusSpeech(perception, 'I am online') },
                cause: 'direct_chat_status',
            };
        }

        if (isLookIntent(command, chat.normalizedText)) {
            return {
                action: { kind: 'say', text: describeSurroundings(perception) },
                cause: 'direct_chat_look',
            };
        }

        if (isInventoryIntent(command, chat.normalizedText)) {
            return {
                action: { kind: 'say', text: describeInventory(perception) },
                cause: 'direct_chat_inventory',
            };
        }

        const pickup = pickupIntent(command);
        if (pickup) {
            this.resumeManualPause();
            const item = pickup.query
                ? findWorldItem(perception.nearby?.worldItems || [], pickup.query)
                : (perception.nearby?.worldItems || [])[0];
            return {
                action: item
                    ? { kind: 'interact', target: item, option: 'pick-up', cause: 'direct_chat_pickup' }
                    : {
                          kind: 'say',
                          text: pickup.query ? `I do not see ${pickup.query} on the ground.` : 'I do not see an item to pick up.',
                      },
                cause: 'direct_chat_pickup',
            };
        }

        const drop = dropIntent(command);
        if (drop) {
            this.resumeManualPause();
            const slot = drop.query
                ? findSlot(perception.resident?.inventory || [], item => itemMatchesQuery(item, drop.query!))
                : undefined;
            return {
                action: drop.query
                    ? slot === undefined
                        ? { kind: 'say', text: `I am not carrying ${drop.query}.` }
                        : { kind: 'drop', slot, cause: 'direct_chat_drop' }
                    : { kind: 'say', text: 'Tell me what to drop.' },
                cause: 'direct_chat_drop',
            };
        }

        if (isPrayerTrainingIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            this.cognition().activeGoal = prayerGoal(this.options.state.tick);
            return {
                action: prayerTrainingAction(perception) || {
                    kind: 'say',
                    text: this.statusSpeech(perception, 'I will look for a safe creature, collect bones, then bury them'),
                },
                cause: 'direct_chat_train_prayer',
            };
        }

        if (isBuryBonesIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            this.cognition().activeGoal = prayerGoal(this.options.state.tick);
            return {
                action: buryBonesAction(perception) || {
                    kind: 'say',
                    text: this.statusSpeech(perception, 'I will look for bones to bury'),
                },
                cause: 'direct_chat_bury_bones',
            };
        }

        if (isCombatTrainingIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            this.cognition().activeGoal = combatGoal(this.options.state.tick);
            return {
                action: combatTrainingAction(perception) || {
                    kind: 'say',
                    text: this.statusSpeech(perception, 'I will look for a safe low-level creature to fight'),
                },
                cause: 'direct_chat_train_combat',
            };
        }

        const talk = talkIntent(command);
        if (talk) {
            this.resumeManualPause();
            const target = findActorByName(perception.nearby?.npcs || [], talk);
            return {
                action: target
                    ? npcTalkAction(perception, target, 'direct_chat_talk')
                    : { kind: 'say', text: `I do not see ${cleanTarget(talk)} from here.` },
                cause: 'direct_chat_talk',
            };
        }

        const attack = attackIntent(command);
        if (attack) {
            this.resumeManualPause();
            const target = findActorByName([...(perception.nearby?.npcs || []), ...(perception.nearby?.players || [])], attack);
            return {
                action: target
                    ? { kind: 'attack', target, cause: 'direct_chat_attack' }
                    : { kind: 'say', text: `I do not see ${cleanTarget(attack)} from here.` },
                cause: 'direct_chat_attack',
            };
        }

        if (isRetreatIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            return {
                action: { kind: 'move_to', target: fleeTarget(perception), cause: 'direct_chat_retreat' },
                cause: 'direct_chat_retreat',
            };
        }

        if (isTradeIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            const action = tradeRequestOrApproach(perception, chat.from, 'direct_chat_trade');
            if (action?.kind === 'move_to') {
                this.rememberPendingDirectTrade(chat.from);
            } else if (action?.kind === 'trade_request') {
                this.cognition().pendingDirectTrade = undefined;
            }
            return {
                action: action || {
                    kind: 'say',
                    text: 'I need to see you nearby before I can trade.',
                },
                cause: 'direct_chat_trade',
            };
        }

        const tradeOffer = tradeOfferIntent(command);
        if (tradeOffer) {
            this.resumeManualPause();
            const slot = safeTradeOfferSlot(perception.resident?.inventory || [], tradeOffer);
            return {
                action:
                    slot === undefined
                        ? {
                              kind: 'say',
                              text: tradeOffer
                                  ? `I do not have a spare ${tradeOffer} to offer.`
                                  : 'I do not have a safe spare item to offer.',
                          }
                        : { kind: 'trade_offer_item', inventorySlot: slot, amount: 1, cause: 'direct_chat_trade_offer' },
                cause: 'direct_chat_trade_offer',
            };
        }

        if (isTradeAcceptIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            return {
                action: tradeAcceptAction(perception.resident?.activeTrade) || {
                    kind: 'say',
                    text: 'I do not have a trade ready to accept yet.',
                },
                cause: 'direct_chat_trade_accept',
            };
        }

        if (isExploreIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            this.cognition().activeGoal = explorationGoal(this.options.state.tick);
            return {
                action: explorationAction(
                    perception,
                    this.visibilityAnchor(),
                    this.options.state.resident,
                    this.pickupCooldowns(),
                    this.options.state.tick,
                    this.explorationCooldowns(),
                ) || {
                    kind: 'say',
                    text: this.statusSpeech(perception, 'I will scout nearby and stay findable'),
                },
                cause: 'direct_chat_explore',
            };
        }

        if (isFiremakingIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            this.cognition().activeGoal = firemakingGoal(this.options.state.tick);
            const action = firemakingAction(perception) || levelOneWoodcuttingAction(perception);
            return {
                action: action || missingFiremakingToolAction(perception),
                cause: 'direct_chat_make_fire',
            };
        }

        if (isCookingIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            this.cognition().activeGoal = starterCookingGoal(this.options.state.tick);
            return {
                action: starterFishingCookingAction(perception) || {
                    kind: 'say',
                    text: 'I need raw shrimp or anchovies before I can cook starter fish.',
                },
                cause: 'direct_chat_cook',
            };
        }

        if (isStarterFishingIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            this.cognition().activeGoal = starterFishingGoal(this.options.state.tick);
            return {
                action:
                    starterFishingAction(perception) ||
                    missingStarterFishingAction(perception, this.statusSpeech(perception, 'I will look for a Fishing spot')),
                cause: 'direct_chat_fish',
            };
        }

        if (isWoodcuttingIntent(command, chat.normalizedText)) {
            this.resumeManualPause();
            this.cognition().activeGoal = woodcuttingGoal(this.options.state.tick);
            return {
                action: levelOneWoodcuttingAction(perception) || {
                    kind: 'say',
                    text: hasWoodcuttingAxe(perception)
                        ? this.statusSpeech(perception, 'I will look for an ordinary tree or dead tree to chop')
                        : 'I need an axe before I can chop trees.',
                },
                cause: 'direct_chat_chop_wood',
            };
        }

        if (isSmallTalkIntent(command, chat.normalizedText)) {
            return {
                action: {
                    kind: 'say',
                    text: 'I am here and watching. I can follow, scout, make fires, fish, cook, trade, or train safely.',
                },
                cause: 'direct_chat_small_talk',
            };
        }

        return undefined;
    }

    private combatReaction(perception: HybridPerception): { actions: AgentAction[]; cause: string } | undefined {
        const cognition = this.cognition();
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
                            soul: this.options.soul,
                            situation: 'combat_decision.kill_celebration',
                            seed: `${this.options.state.tick}`,
                        });
                        return { actions: [{ kind: 'say', text }], cause: 'combat_kill_celebration' };
                    }
                }
            }
        }

        const visibleAggressors = getVisibleAggressors(perception);
        let target: Actor | undefined;
        if (visibleAggressors.length > 0) {
            const here = perception.resident?.position;
            target = here ? selectPreferredAggressor(visibleAggressors, here) : visibleAggressors[0];
        } else {
            target = latestCombatAttacker(perception) || perception.resident?.combatTarget || undefined;
        }

        if (!target) {
            return undefined;
        }

        const foodSlot = firstFoodSlot(perception.resident?.inventory || []);
        let action: AgentAction;
        if (target.kind === 'player') {
            action = {
                kind: 'say',
                text: `${actorName(target)} is attacking me. Tell me "${this.commandPrefix()} attack ${actorName(target)}" if I should fight back.`,
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
        } else {
            action = { kind: 'attack', target, cause: 'combat_retaliate' };
        }

        if (this.isRepeatedAction(action)) {
            return undefined;
        }

        this.rememberBodyAction(action);

        const resultActions = [action];
        if (target.kind !== 'player' && !cognition.combatEpisodeNarrated) {
            cognition.combatEpisodeNarrated = true;
            const decision = classifyCombatDecision(perception, target, foodSlot);
            const text = pickPhrase({
                soul: this.options.soul,
                situation: `combat_decision.${decision}`,
                seed: `${this.options.state.tick}`,
                params: { targetName: actorName(target) },
            });
            resultActions.push({ kind: 'say', text });
        }

        return { actions: resultActions, cause: action.cause || 'combat_reaction' };
    }

    private combatNarrationAction(): { action: AgentAction; cause: string } | undefined {
        const pending = this.cognition().pendingCombatNarration;
        if (!pending) {
            return undefined;
        }

        this.cognition().pendingCombatNarration = undefined;
        if (this.options.state.tick - pending.setAtTick > 80) {
            return undefined;
        }

        return {
            action: { kind: 'say', text: pending.text },
            cause: pending.cause,
        };
    }

    private queueCombatNarration(action: AgentAction, target: Actor): void {
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

        this.cognition().pendingCombatNarration = {
            text,
            cause: 'combat_survival_narration',
            setAtTick: this.options.state.tick,
        };
    }

    private dialogueReaction(perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
        const event = latestDialogueEvent(perception);
        if (!event) {
            return undefined;
        }

        const options = Array.isArray(event.options) ? event.options : [];
        const action: AgentAction =
            options.length > 0
                ? { kind: 'dialogue_choice', optionIndex: 0, cause: 'dialogue_choice_first' }
                : { kind: 'dialogue_continue', cause: 'dialogue_continue' };
        if (this.isRepeatedAction(action)) {
            return undefined;
        }

        this.rememberBodyAction(action);
        return { action, cause: action.cause || 'dialogue_reaction' };
    }

    private tradeReaction(perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
        const request = latestTradeRequest(perception);
        if (request && this.isTrustedTradePartner(request)) {
            const action = tradeRequestOrApproach(perception, request, 'trade_reciprocate_trusted_request');
            if (action && !this.isRepeatedAction(action)) {
                this.rememberBodyAction(action);
                return { action, cause: action.cause || 'trade_reciprocate_trusted_request' };
            }
        }

        const trade = perception.resident?.activeTrade;
        if (!trade) {
            return undefined;
        }

        if (trade.partner && !this.isTrustedTradePartner(trade.partner)) {
            const action: AgentAction = { kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' };
            if (this.isRepeatedAction(action)) {
                return undefined;
            }
            this.rememberBodyAction(action);
            return { action, cause: 'trade_decline_untrusted_partner' };
        }

        const offerSlot = (trade.ours?.length || 0) === 0 ? safeTradeOfferSlot(perception.resident?.inventory || []) : undefined;
        const action =
            offerSlot !== undefined
                ? { kind: 'trade_offer_item', inventorySlot: offerSlot, amount: 1, cause: 'trade_offer_safe_item' }
                : tradeAcceptAction(trade);
        if (!action || this.isRepeatedAction(action)) {
            return undefined;
        }

        this.rememberBodyAction(action);
        return { action, cause: action.cause || 'trade_reaction' };
    }

    private presenceBeaconAction(perception: HybridPerception): AgentAction | undefined {
        const cognition = this.cognition();
        if (
            !shouldEmitPresenceBeacon({
                tick: this.options.state.tick,
                hasActiveGoal: this.activeGoal() !== undefined,
                lastBeaconTick: cognition.lastPresenceBeaconTick,
                lastGoalShareTick: cognition.lastGoalShareTick,
                interval: this.behavior().shareGoalsEveryTicks ?? DEFAULT_GOAL_SHARE_EVERY_TICKS,
            })
        ) {
            return undefined;
        }

        cognition.lastPresenceBeaconTick = this.options.state.tick;
        cognition.lastGoalShareTick = this.options.state.tick;
        return { kind: 'say', text: this.statusSpeech(perception, 'I am online', true) };
    }

    private statusSpeech(perception: HybridPerception, prefix: string, includeNextStep = false): string {
        const here = perception.resident?.position;
        const next = includeNextStep ? nextStepSuggestion(perception, this.options.state.resident, this.activeGoal()) : undefined;
        const goal = summarizeGoalForSpeech(
            this.activeGoal()?.description || 'staying findable and looking for useful actions',
            Boolean(next),
        );
        return cleanSpeech(`${prefix}${here ? ` at ${here.x},${here.y}` : ''}. Goal: ${goal}.${next ? ` Next: ${next}` : ''}`) || prefix;
    }

    private visibilityStatus(perception: Perception): { anchor?: Pos; returnDue: boolean } {
        const behavior = this.behavior();
        const anchor = this.visibilityAnchor();
        if (!anchor) {
            return { returnDue: false };
        }

        const here = (perception as HybridPerception).resident?.position;
        const interval = behavior.returnToAnchorEveryTicks ?? DEFAULT_RETURN_TO_ANCHOR_EVERY_TICKS;
        if (!here || interval <= 0) {
            return { anchor, returnDue: false };
        }

        const last = this.cognition().lastAnchorReturnTick || 0;
        const radius = behavior.returnToAnchorRadius ?? DEFAULT_RETURN_TO_ANCHOR_RADIUS;
        return {
            anchor,
            returnDue: this.options.state.tick - last >= interval && distance(here, anchor) > radius,
        };
    }

    private suppressRepeatedActions(actions: AgentAction[]): AgentAction[] {
        const action = actions[0];
        if (!action) {
            return actions;
        }

        if (this.isRepeatedAction(action)) {
            return [];
        }

        this.rememberBodyAction(action);
        return actions;
    }

    private isRepeatedAction(action: AgentAction): boolean {
        if (action.kind === 'move_to' && typeof action.range === 'number' && action.range > 0) {
            return false;
        }
        const key = JSON.stringify(action);
        const cognition = this.cognition();
        return (
            cognition.lastBodyActionKey === key &&
            this.options.state.tick - (cognition.lastBodyActionTick || 0) < REPEAT_ACTION_BACKOFF_TICKS
        );
    }

    private rememberBodyAction(action: AgentAction): void {
        const key = JSON.stringify(action);
        const cognition = this.cognition();
        cognition.lastBodyActionKey = key;
        cognition.lastBodyActionTick = this.options.state.tick;
        this.rememberPickupAttempt(action);
        this.rememberExplorationAttempt(action);
    }

    private rememberActiveMove(action: AgentAction, here: Pos): void {
        if (action.kind !== 'move_to') {
            return;
        }

        const target = positionLike(action.target);
        if (!target) {
            return;
        }

        this.cognition().activeMove = {
            target,
            range: typeof action.range === 'number' ? action.range : 0,
            cause: typeof action.cause === 'string' ? action.cause : undefined,
            startedAtTick: this.options.state.tick,
            lastTick: this.options.state.tick,
            lastPositionKey: positionKey(here),
            stationaryCount: 0,
        };
    }

    private shouldRunBrain(): boolean {
        const goal = this.activeGoal();
        const cognition = this.cognition();
        if (!goal || this.goalExpired(goal)) {
            return true;
        }

        return this.options.state.tick - (cognition.lastBrainTick || 0) >= (this.behavior().brainEveryTicks ?? DEFAULT_BRAIN_EVERY_TICKS);
    }

    private shouldRunBody(): boolean {
        return (
            this.options.state.tick - (this.cognition().lastBodyTick || 0) >= (this.behavior().bodyEveryTicks ?? DEFAULT_BODY_EVERY_TICKS)
        );
    }

    private progressPromptInput(): { tick: number; lastMeaningfulProgressAt?: number; stuckSince?: number } {
        return {
            tick: this.options.state.tick,
            lastMeaningfulProgressAt: this.options.state.lastMeaningfulProgressAt,
            stuckSince: this.options.state.stuckSince,
        };
    }

    private promptMemories(perception: HybridPerception, role: 'brain' | 'body'): string[] {
        const goal = this.activeGoal();
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
            return this.options.memory
                .retrieve(this.options.soul.frontmatter.name, query, MAX_PROMPT_MEMORIES)
                .map(memory => memory.trim())
                .filter(Boolean)
                .slice(0, MAX_PROMPT_MEMORIES);
        } catch {
            return [];
        }
    }

    private promptMemorySection(memories: string[], role: 'brain' | 'body'): string {
        const lines = memories
            .map(memory => `- ${memory.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_MEMORY_CHARS)}`)
            .filter(line => line.length > 2);
        if (lines.length === 0) {
            return '';
        }
        return [
            'Recent Library memories and resident notes:',
            role === 'brain'
                ? 'Use these as continuity: keep promises, remember patrons/players, and bias goal choice toward unfinished story threads.'
                : 'Use these as continuity: if you speak or act, respect recent promises, patrons, and unfinished player requests.',
            ...lines,
        ].join('\n');
    }

    private cleanSmallTalkReply(text: string | undefined, normalizedQuestion: string, memories: string[]): string | undefined {
        const structuredText = extractStructuredChatReply(text);
        const clean = cleanSpeech(structuredText || text);
        if (clean && !looksLikeStructuredEcho(clean)) {
            return clean;
        }
        if (/\b(remember|memory|memories|recall)\b/.test(normalizedQuestion)) {
            return memoryRecallFallback(memories);
        }
        return undefined;
    }

    private shouldShareGoal(): boolean {
        const interval = this.behavior().shareGoalsEveryTicks ?? DEFAULT_GOAL_SHARE_EVERY_TICKS;
        if (interval <= 0) {
            return true;
        }
        const lastShared = this.cognition().lastGoalShareTick;
        return lastShared === undefined || this.options.state.tick - lastShared >= interval;
    }

    private goalExpired(goal: ActiveGoalState): boolean {
        return goal.ttlTicks !== undefined && this.options.state.tick - goal.createdAtTick > goal.ttlTicks;
    }

    private activeGoal(): ActiveGoalState | undefined {
        const goal = this.cognition().activeGoal;
        if (!goal || this.goalExpired(goal)) {
            return undefined;
        }
        return goal;
    }

    private endpointFor(profile?: InferenceProfileDefinition): string {
        return profile?.endpoint || this.options.soul.frontmatter.model?.endpoint || 'default';
    }

    private modelFor(profile?: InferenceProfileDefinition): string | undefined {
        return profile?.model || this.options.soul.frontmatter.model?.model;
    }

    private temperatureFor(profile: InferenceProfileDefinition | undefined, fallback: number): number {
        return profile?.temperature ?? this.options.soul.frontmatter.model?.temperature ?? fallback;
    }

    private visibilityAnchor(): Pos | undefined {
        const configured = this.behavior().visibilityAnchor || positionLike(this.options.soul.frontmatter.spawnPosition);
        if (!configured) {
            return undefined;
        }
        return { x: configured.x, y: configured.y, level: configured.level ?? 0 };
    }

    private behavior(): HybridAgentBehaviorDefinition {
        const behavior = this.options.soul.frontmatter.behavior;
        return behavior?.kind === 'hybrid-agent' ? behavior : { kind: 'hybrid-agent' };
    }

    private commandPrefix(): string {
        return normalizeText(this.behavior().commandPrefix || displayName(this.options.soul.frontmatter.name));
    }

    private currentFollowTarget(): { name?: string; id?: string; kind?: string } | undefined {
        const target = this.cognition().followTarget;
        if (target?.paused) {
            return undefined;
        }
        if (target?.name || target?.id) {
            return target;
        }

        const configured = this.behavior().followPlayer;
        return configured ? { name: configured } : undefined;
    }

    private isTrustedTradePartner(actor: Actor): boolean {
        const trusted = this.behavior().followPlayer;
        const followTarget = this.currentFollowTarget();
        return Boolean(
            (trusted && actorMatchesName(actor, trusted)) ||
                (followTarget?.id && actor.id === followTarget.id) ||
                (followTarget?.name && actorMatchesName(actor, followTarget.name)),
        );
    }

    private rememberPickupAttempt(action: AgentAction): void {
        const item = pickupActionWorldItem(action);
        if (!item) {
            return;
        }

        const cooldowns = this.pickupCooldowns();
        cooldowns[pickupItemKey(item)] = this.options.state.tick;
        for (const [key, tick] of Object.entries(cooldowns)) {
            if (this.options.state.tick - tick > PICKUP_TARGET_COOLDOWN_TICKS) {
                delete cooldowns[key];
            }
        }
    }

    private rememberExplorationAttempt(action: AgentAction): void {
        const key = explorationCooldownKeyFromAction(action);
        if (!key) {
            return;
        }

        const cooldowns = this.explorationCooldowns();
        cooldowns[key] = this.options.state.tick;
        for (const [cooldownKey, tick] of Object.entries(cooldowns)) {
            if (this.options.state.tick - tick > EXPLORATION_TARGET_COOLDOWN_TICKS) {
                delete cooldowns[cooldownKey];
            }
        }
    }

    private pickupCooldowns(): Record<string, number> {
        const cognition = this.cognition();
        cognition.pickupCooldowns ||= {};
        return cognition.pickupCooldowns;
    }

    private explorationCooldowns(): Record<string, number> {
        const cognition = this.cognition();
        cognition.explorationCooldowns ||= {};
        return cognition.explorationCooldowns;
    }

    private ensureCognition(): void {
        this.options.state.cognition ||= {};
    }

    private ensureBenchmarkGoal(): void {
        const goal = benchmarkGoalForTask(this.options.soul.frontmatter.legacy?.parameters?.benchmarkTask, this.options.state.tick);
        if (!goal) {
            return;
        }

        const cognition = this.cognition();
        if (!cognition.activeGoal || cognition.activeGoal.id !== goal.id || this.goalExpired(cognition.activeGoal)) {
            this.clearGoalMomentum();
            cognition.activeGoal = goal;
            cognition.lastPresenceBeaconTick ??= this.options.state.tick;
            cognition.lastGoalShareTick ??= this.options.state.tick;
        }
        cognition.lastBrainTick = this.options.state.tick;
    }

    private cognition() {
        this.ensureCognition();
        return this.options.state.cognition!;
    }

    private clearGoalMomentum(): void {
        const cognition = this.cognition();
        cognition.activeMove = undefined;
        cognition.lastBodyActionKey = undefined;
        cognition.lastBodyActionTick = undefined;
        cognition.routineLoopKey = undefined;
        cognition.routineLoopCount = 0;
    }

    private advanceTick(perception: Perception): void {
        const perceptionTick = typeof perception.tick === 'number' ? perception.tick : 0;
        this.options.state.tick = Math.max(this.options.state.tick + 1, perceptionTick);
    }

    private result(actions: AgentAction[], cause: string, envelopeTokens: number, nooped: boolean): ThoughtResult {
        const telemetry = this.cognition().tickTelemetry;
        return {
            actions,
            cause,
            envelopeTokens,
            nooped: nooped || actions.length === 0,
            ...telemetry,
        };
    }
}

function missingFiremakingToolAction(perception: HybridPerception): AgentAction {
    const inventory = perception.resident?.inventory || [];
    const hasLogs = findSlot(inventory, isFiremakingLog) !== undefined;
    const hasTinderbox = findSlot(inventory, isTinderbox) !== undefined;
    if (!hasLogs && !hasWoodcuttingAxe(perception)) {
        return { kind: 'say', text: 'I need an axe or logs before I can make a fire from that tree.' };
    }
    if (!hasTinderbox) {
        return { kind: 'say', text: 'I need a tinderbox before I can light logs.' };
    }
    return { kind: 'say', text: 'I will gather logs, then use the tinderbox to light them.' };
}

function missingStarterFishingAction(perception: HybridPerception, missingSpotText: string): AgentAction {
    if (!hasSmallFishingNet(perception)) {
        return { kind: 'say', text: 'I need a small fishing net before I can catch shrimp.' };
    }
    return { kind: 'say', text: missingSpotText };
}

function explorationCooldownKeyFromAction(action: AgentAction): string | undefined {
    if (!/explore|routine_loop_break|stuck_move_recovery|stuck_open_obstacle/i.test(String(action.cause || ''))) {
        return undefined;
    }
    if (!('target' in action) || !isRecord(action.target)) {
        return undefined;
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

function pickupActionWorldItem(action: AgentAction): WorldItem | undefined {
    const candidate = action as { option?: unknown; target?: unknown };
    if (action.kind !== 'interact' || !/pick[- ]?up/i.test(String(candidate.option || ''))) {
        return undefined;
    }

    return worldItemLike(candidate.target);
}

function shouldLetInteractionPipelineApproach(action: AgentAction): boolean {
    if (action.kind === 'attack') {
        return true;
    }
    return Boolean(pickupActionWorldItem(action));
}

function worldItemLike(value: unknown): WorldItem | undefined {
    if (!isRecord(value) || typeof value.itemId !== 'number' || typeof value.amount !== 'number') {
        return undefined;
    }

    const position = positionLike(value.position);
    if (!position) {
        return undefined;
    }

    return {
        itemId: value.itemId,
        key: typeof value.key === 'string' ? value.key : undefined,
        amount: value.amount,
        position,
        ownerId: typeof value.ownerId === 'string' ? value.ownerId : undefined,
    };
}

function nextStepSuggestion(perception: HybridPerception, residentId?: string, goal?: ActiveGoalState): string | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const routine = routineNextStepSuggestion(perception, here, goal);
    if (routine) {
        return routine;
    }

    const suppressFiremakingLogPickup = hasNearbyFire(perception);
    const item = (perception.nearby?.worldItems || [])
        .filter(
            candidate =>
                !(suppressFiremakingLogPickup && isFiremakingLog(candidate)) &&
                !isStaleSelfOwnedLog(candidate, residentId, perception.resident?.id) &&
                isUsefulGroundItem(candidate) &&
                !isOwnedByAnotherActor(candidate, residentId, perception.resident?.id),
        )
        .sort((a, b) => {
            const priority = usefulGroundItemPriority(a) - usefulGroundItemPriority(b);
            return priority !== 0 ? priority : distance(here, a.position) - distance(here, b.position);
        })[0];
    if (item) {
        return `pick up ${itemLabel(item)} at ${item.position.x},${item.position.y}.`;
    }

    const safeTarget = safeCombatTarget(perception);
    if (safeTarget) {
        return `fight the safe ${actorName(safeTarget)} at ${safeTarget.position.x},${safeTarget.position.y}.`;
    }

    const fishingSpot = (perception.nearby?.npcs || [])
        .filter(isFishingSpot)
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (fishingSpot && hasSmallFishingNet(perception)) {
        return `fish at ${fishingSpot.position.x},${fishingSpot.position.y} with my small net.`;
    }

    const npc = (perception.nearby?.npcs || []).sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (npc) {
        return `talk to ${actorName(npc)} at ${npc.position.x},${npc.position.y}.`;
    }

    const tree = (perception.nearby?.objects || [])
        .filter(object => LEVEL_ONE_TREE_IDS.has(object.objectId))
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (tree) {
        return `chop the tree at ${tree.position.x},${tree.position.y}.`;
    }

    const obstacle = (perception.nearby?.objects || [])
        .filter(object => OPENABLE_OBSTACLE_IDS.has(object.objectId))
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (obstacle) {
        return `open the door or gate at ${obstacle.position.x},${obstacle.position.y}.`;
    }

    const player = (perception.nearby?.players || []).sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (player) {
        return `stay near ${actorName(player)} and answer commands.`;
    }

    return undefined;
}

function routineNextStepSuggestion(perception: HybridPerception, here: Pos, goal?: ActiveGoalState): string | undefined {
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

function isLocalRoutineCause(cause: string, action: AgentAction): boolean {
    if (action.kind === 'use_item_on_item') {
        return false;
    }
    return /woodcutting_level1_routine|firemaking_fallback|firemaking_gather_logs/i.test(`${cause} ${action.cause || ''}`);
}

function routineLoopFamily(cause: string, action: AgentAction): string {
    if (/woodcutting|firemaking/i.test(`${cause} ${action.cause || ''}`)) {
        return 'woodcutting-firemaking';
    }
    return cause;
}

function isConcreteExplorationOverride(action: AgentAction): boolean {
    return /explore_talk_to_npc|opportunistic_pickup|explore_visible_item/i.test(String(action.cause || ''));
}

function modelActionTarget(action: AgentAction): Pos | undefined {
    if (action.kind === 'move_to' && 'target' in action) {
        return positionLike(action.target);
    }

    return actionTargetPosition(action);
}

function sameMoveIntent(action: AgentAction, active: ActiveMoveState): boolean {
    if (action.kind !== 'move_to') {
        return false;
    }

    const target = positionLike(action.target);
    const range = typeof action.range === 'number' ? action.range : 0;
    return Boolean(target && positionsEqual(target, active.target) && range === (active.range ?? 0));
}

function shouldInterruptActiveMove(action: AgentAction): boolean {
    return /^(say|use_item_on_item|item_action|trade_request|trade_offer_item|trade_accept|trade_decline)$/.test(action.kind);
}

function moveIntentAction(active: ActiveMoveState, cause: string): AgentAction {
    return {
        kind: 'move_to',
        target: active.target,
        range: active.range ?? 0,
        cause,
    };
}

function positionKey(position: Pos): string {
    return `${position.x},${position.y},${position.level}`;
}

function latestAddressedChat(
    perception: HybridPerception,
    commandPrefix: string,
    lastKey: string | undefined,
): { key: string; normalizedText: string; from?: Actor } | undefined {
    const events = perception.events || [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.kind !== 'chat' || typeof event.text !== 'string') {
            continue;
        }

        const normalizedText = normalizeText(event.text);
        if (!mentionsCommandPrefix(normalizedText, commandPrefix)) {
            continue;
        }

        const from = actorLike(event.from);
        if (from && isSelfActor(from, perception)) {
            continue;
        }

        const key = `${perception.tick ?? 0}:${from?.id || 'unknown'}:${normalizedText}`;
        if (key === lastKey) {
            return undefined;
        }

        return { key, normalizedText, from };
    }

    return undefined;
}

function isSelfActor(actor: Actor, perception: HybridPerception): boolean {
    return actor.kind === 'resident' && Boolean(perception.resident?.id) && actor.id === perception.resident?.id;
}

function mentionsCommandPrefix(text: string, commandPrefix: string): boolean {
    return new RegExp(`\\b${escapeRegExp(commandPrefix)}\\b`, 'i').test(text);
}

function addressedCommand(text: string, commandPrefix: string): string {
    const prefixPattern = new RegExp(`\\b${escapeRegExp(commandPrefix)}\\b[:,]?\\s*`, 'i');
    const match = prefixPattern.exec(text);
    if (!match) {
        return text.trim();
    }

    return text.slice(match.index + match[0].length).trim();
}

function followIntent(command: string, fullText: string): { target?: string } | undefined {
    if (
        /^(follow me|come here|come to me|keep up|guard me)\b/.test(command) ||
        /^(follow|guard)$/.test(command) ||
        /\b(follow me|come here|come to me)\b/.test(fullText)
    ) {
        return {};
    }

    const named = command.match(/^(follow|guard)\s+(.+)/);
    if (!named) {
        return undefined;
    }

    const target = cleanTarget(named[2]);
    return /^me\b/.test(target) ? {} : { target };
}

function isStopFollowingIntent(command: string, fullText: string): boolean {
    return (
        /^(stop following|stop follow|do not follow|dont follow|don't follow|quit following|stop guarding)\b/.test(command) ||
        /\b(stop following|do not follow me|dont follow me|don't follow me|stop guarding)\b/.test(fullText)
    );
}

function isReturnHomeIntent(command: string, fullText: string): boolean {
    return (
        /^(return home|go home|home|return to start|go to start|back to anchor)\b/.test(command) ||
        /\b(return home|go home|return to start|go to start|back to anchor)\b/.test(fullText)
    );
}

function isStopIntent(command: string, fullText: string): boolean {
    return (
        /^(stop|pause|wait|hold position|cancel goal|clear goal)\b/.test(command) ||
        /\b(cancel goal|clear goal|hold position)\b/.test(fullText)
    );
}

function isStatusIntent(command: string, fullText: string): boolean {
    return (
        /^(status|where are you|what are you doing|what are you up to|are you working|say something|hello|hi|hey)\b/.test(command) ||
        /\b(what are you doing|what are you up to|are you working|status|say something)\b/.test(fullText)
    );
}

function isLookIntent(command: string, fullText: string): boolean {
    return (
        /^(what do you see|look|look around|suggest|actions|what can we do|what is nearby)\b/.test(command) ||
        /\b(what do you see|what can we do|what is nearby|look around)\b/.test(fullText)
    );
}

function isInventoryIntent(command: string, fullText: string): boolean {
    return (
        /^(inventory|what are you carrying|what do you have|supplies)\b/.test(command) ||
        /\b(inventory|what are you carrying|what do you have|supplies)\b/.test(fullText)
    );
}

function isFiremakingIntent(command: string, fullText: string): boolean {
    return (
        /^(make a fire|make fire|light a fire|light fire|start a fire|burn logs|firemaking)\b/.test(command) ||
        /\b(make a fire|make fire|light a fire|light fire|start a fire|firemaking)\b/.test(fullText)
    );
}

function isWoodcuttingIntent(command: string, fullText: string): boolean {
    return (
        /^(chop wood|cut wood|chop a tree|cut a tree|woodcutting|gather logs)\b/.test(command) ||
        /\b(chop wood|cut wood|woodcutting|gather logs)\b/.test(fullText)
    );
}

function isStarterFishingIntent(command: string, fullText: string): boolean {
    return (
        /^(fish|go fish|go fishing|catch fish|catch shrimp|fishing|net fish)\b/.test(command) ||
        /\b(catch shrimp|go fishing|small net fishing)\b/.test(fullText)
    );
}

function isCookingIntent(command: string, fullText: string): boolean {
    return /^(cook|cook fish|cook shrimp|cook food|cooking)\b/.test(command) || /\b(cook shrimp|cook fish|cook food)\b/.test(fullText);
}

function isBuryBonesIntent(command: string, fullText: string): boolean {
    return /^(bury bones|bury)\b/.test(command) || /\bbury bones\b/.test(fullText);
}

function isPrayerTrainingIntent(command: string, fullText: string): boolean {
    return (
        /^(train prayer|prayer training|combat prayer|get bones|collect bones|prayer)\b/.test(command) ||
        /\b(train prayer|prayer training|combat prayer|get bones|collect bones)\b/.test(fullText)
    );
}

function isCombatTrainingIntent(command: string, fullText: string): boolean {
    return (
        /^(train combat|combat training|practice combat|train melee|melee training|fight something|fight safely)\b/.test(command) ||
        /\b(train combat|combat training|practice combat|train melee|melee training|fight something|fight safely)\b/.test(fullText)
    );
}

function attackIntent(command: string): string | undefined {
    const match = command.match(/^attack\s+(.+)/);
    return match ? cleanTarget(match[1]) : undefined;
}

function pickupIntent(command: string): { query?: string } | undefined {
    const match = command.match(/^(pick up|take|loot)(?:\s+(.+))?/);
    if (!match) {
        return undefined;
    }
    const query = match[2] ? cleanTarget(match[2]) : undefined;
    return query ? { query } : {};
}

function dropIntent(command: string): { query?: string } | undefined {
    const match = command.match(/^drop(?:\s+(.+))?/);
    if (!match) {
        return undefined;
    }
    const query = match[1] ? cleanTarget(match[1]) : undefined;
    return query ? { query } : {};
}

function talkIntent(command: string): string | undefined {
    const match = command.match(/^(talk to|talk|speak to|speak with)\s+(.+)/);
    return match ? cleanTarget(match[2]) : undefined;
}

function isExploreIntent(command: string, fullText: string): boolean {
    return /^(explore|scout|patrol|survey|wander)\b/.test(command) || /\b(explore|scout|patrol|survey)\b/.test(fullText);
}

function isRetreatIntent(command: string, fullText: string): boolean {
    return /^(run away|flee|retreat|escape)\b/.test(command) || /\b(run away|flee|retreat|escape)\b/.test(fullText);
}

function isTradeIntent(command: string, fullText: string): boolean {
    return /^(trade|trade me|start trade|request trade)\b/.test(command) || /\b(trade me|start trade|request trade)\b/.test(fullText);
}

function tradeOfferIntent(command: string): string | undefined {
    const match = command.match(/^offer(?:\s+(.+))?/);
    if (!match) {
        return undefined;
    }
    return match[1] ? cleanTarget(match[1]) : '';
}

function isTradeAcceptIntent(command: string, fullText: string): boolean {
    return /^(accept trade|accept)\b/.test(command) || /\baccept trade\b/.test(fullText);
}

function isSmallTalkIntent(command: string, fullText: string): boolean {
    if (/^(please\s+)?(can you|could you|would you|do|try|use|find|bring|get|give|equip|open|close|walk|move|run)\b/.test(command)) {
        return false;
    }

    return (
        command.length === 0 ||
        /^(how are you|hello|hi|hey|thanks|thank you|good job|nice|cool)\b/.test(command) ||
        /^(hello|hi|hey)\s+agent\b/.test(fullText) ||
        /\b(how are you|thank you|thanks|good job|nice work)\b/.test(fullText)
    );
}

function latestTradeRequest(perception: HybridPerception): Actor | undefined {
    for (const event of [...(perception.events || [])].reverse()) {
        if (event.kind !== 'trade_requested') {
            continue;
        }
        const from = actorLike(event.from);
        if (from?.kind === 'player' || from?.kind === 'resident') {
            return from;
        }
    }

    return undefined;
}

function latestDialogueEvent(perception: HybridPerception): { options?: unknown[] } | undefined {
    for (const event of [...(perception.events || [])].reverse()) {
        if (event.kind === 'dialogue_opened' || event.kind === 'dialogue_updated') {
            return event as { options?: unknown[] };
        }
        if (event.kind === 'dialogue_closed') {
            return undefined;
        }
    }

    return undefined;
}

function findActorByName(actors: Actor[], query: string): Actor | undefined {
    const wanted = normalizeText(cleanTarget(query));
    return actors.find(actor => actorMatchesName(actor, wanted));
}

function actorMatchesName(actor: Actor, query: string): boolean {
    const wanted = normalizeText(cleanTarget(query));
    const names = [actor.name, actor.key, actor.id].filter((value): value is string => Boolean(value)).map(normalizeText);
    return names.some(name => name.includes(wanted) || wanted.includes(name));
}

function safeTradeOfferSlot(inventory: Array<Item | null>, query?: string): number | undefined {
    if (query) {
        return findSlot(inventory, item => !isEssentialTool(item) && itemMatchesQuery(item, query));
    }

    return (
        findSlot(inventory, item => !isEssentialTool(item) && (isFiremakingLog(item) || isBones(item))) ??
        findSlot(inventory, item => !isEssentialTool(item) && FOOD_KEY_PATTERN.test(item.key || '')) ??
        findSlot(inventory, item => !isEssentialTool(item))
    );
}

function isEssentialTool(item: Item): boolean {
    return isTinderbox(item) || isSmallFishingNet(item) || ESSENTIAL_TOOL_KEY_PATTERN.test(item.key || '');
}

function tradeRequestOrApproach(perception: HybridPerception, target: Actor | undefined, cause: string): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!target || target.kind === 'npc') {
        return undefined;
    }
    if (here && distance(here, target.position) > 1) {
        return { kind: 'move_to', target: target.position, range: 1, cause };
    }
    return { kind: 'trade_request', target, cause };
}

function tradeAcceptAction(trade: ActiveTrade | undefined): AgentAction | undefined {
    if (!trade || !trade.ours?.length) {
        return undefined;
    }
    if (trade.ourStage === 'accepted_1' && (trade.theirStage === 'accepted_1' || trade.theirStage === 'accepted_2')) {
        return { kind: 'trade_accept_stage_2', cause: 'trade_accept_stage_2' };
    }
    if (!trade.ourStage || trade.ourStage === 'editing') {
        return { kind: 'trade_accept_stage_1', cause: 'trade_accept_stage_1' };
    }
    return undefined;
}

function findWorldItem(items: WorldItem[], query: string): WorldItem | undefined {
    return items.find(item => itemMatchesQuery(item, query));
}

function itemMatchesQuery(item: Item | null, query: string): boolean {
    if (!item) {
        return false;
    }
    const wanted = normalizeText(query);
    const labels = [itemLabel(item), item.key || '', String(item.itemId)].map(normalizeText);
    return labels.some(label => label.includes(wanted) || wanted.includes(label));
}

function describeSurroundings(perception: HybridPerception): string {
    const fishingSpot = (perception.nearby?.npcs || []).find(isFishingSpot);
    if (fishingSpot) {
        return hasSmallFishingNet(perception)
            ? `I see a Fishing spot at ${fishingSpot.position.x},${fishingSpot.position.y}. I can use my small fishing net there.`
            : `I see a Fishing spot at ${fishingSpot.position.x},${fishingSpot.position.y}. I need a small fishing net before I can use it.`;
    }

    const npc = perception.nearby?.npcs?.[0];
    if (npc) {
        return `I see ${actorName(npc)} nearby at ${npc.position.x},${npc.position.y}. I can talk, fight if needed, pick up items, or explore.`;
    }

    const item = perception.nearby?.worldItems?.[0];
    if (item) {
        return `I see ${itemLabel(item)} on the ground at ${item.position.x},${item.position.y}. I can pick it up or keep scouting.`;
    }

    const object = perception.nearby?.objects?.[0];
    if (object) {
        return `I see scenery at ${object.position.x},${object.position.y}. I can move closer and inspect the area.`;
    }

    const player = perception.nearby?.players?.[0];
    if (player) {
        return `I see ${actorName(player)} nearby at ${player.position.x},${player.position.y}.`;
    }

    return 'I do not see anything actionable nearby yet.';
}

function describeInventory(perception: HybridPerception): string {
    const counts = new Map<string, number>();
    for (const item of perception.resident?.inventory || []) {
        if (!item) {
            continue;
        }
        const label = itemLabel(item);
        counts.set(label, (counts.get(label) || 0) + item.amount);
    }

    if (counts.size === 0) {
        return 'I am not carrying anything.';
    }

    const labels = [...counts.entries()].map(([label, amount]) => (amount > 1 ? `${label} x${amount}` : label));
    return `I am carrying ${labels.join(', ')}.`;
}

function actorName(actor: Actor): string {
    return actor.name || actor.key || displayName(actor.id);
}

function actorLike(value: unknown): Actor | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') {
        return undefined;
    }

    const position = positionLike(value.position);
    if (!position || !['player', 'npc', 'resident'].includes(value.kind)) {
        return undefined;
    }

    return {
        id: value.id,
        kind: value.kind as Actor['kind'],
        name: typeof value.name === 'string' ? value.name : undefined,
        key: typeof value.key === 'string' ? value.key : undefined,
        position,
        hpFraction: typeof value.hpFraction === 'number' ? value.hpFraction : undefined,
        combatLevel: typeof value.combatLevel === 'number' ? value.combatLevel : undefined,
    };
}

function displayName(name: string): string {
    return name.replace(/^res:/i, '');
}

function extractStructuredChatReply(text: string | undefined): string | undefined {
    const raw = text?.trim();
    if (!raw) {
        return undefined;
    }
    const candidate = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(candidate) as unknown;
        return structuredReplyValue(parsed);
    } catch {
        return undefined;
    }
}

function structuredReplyValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(structuredReplyValue).find((candidate): candidate is string => !!candidate);
    }
    if (!isRecord(value)) {
        return undefined;
    }
    for (const key of ['reply', 'say', 'text', 'message']) {
        if (typeof value[key] === 'string') {
            return value[key];
        }
    }
    return undefined;
}

function looksLikeStructuredEcho(text: string): boolean {
    const sample = text.trim().slice(0, 180);
    return sample.startsWith('{') || sample.startsWith('[') || /"memories"\s*:/.test(sample) || /"archetype"\s*:/.test(sample);
}

function memoryRecallFallback(memories: string[]): string | undefined {
    const lines = memories.map(memory => memory.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const gift = lines.find(line => /patron gift from/i.test(line));
    const promise = lines.find(line => /\b(promise|promised|shrimp|codex)\b/i.test(line));
    const parts: string[] = [];

    const giftMatch = gift?.match(/patron gift from\s+([^:]+):\s*([^()]+)/i);
    if (giftMatch) {
        parts.push(`${giftMatch[1].trim()} gave me ${giftMatch[2].trim().replace(/^rs:/i, '')}`);
    } else if (gift) {
        parts.push(gift.replace(/\s*\([^)]*\)\s*$/g, ''));
    }

    if (promise) {
        const promiseText = promise
            .replace(/^story_note:\s*/i, '')
            .replace(/\s+at\s+\d{4}-\d{2}-\d{2}.*$/i, '')
            .replace(/\s*\([^)]*\)\s*$/g, '')
            .trim();
        if (promiseText) {
            parts.push(promiseText.replace(/^i\s+/i, 'I ').replace(/[.!?]+$/g, ''));
        }
    }

    if (parts.length === 0) {
        return undefined;
    }
    return cleanSpeech(`I remember ${parts.join(', and ')}.`);
}

function normalizeText(text: string): string {
    return text
        .replace(/^res:/i, '')
        .replace(/^player:/i, '')
        .trim()
        .toLowerCase();
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMoveTo(action: AgentAction, target: Pos | undefined): boolean {
    if (!target || action.kind !== 'move_to' || !isRecord(action.target)) {
        return false;
    }
    return action.target.x === target.x && action.target.y === target.y && (action.target.level ?? 0) === target.level;
}

function actionTargetPosition(action: AgentAction): Pos | undefined {
    if (
        !['interact', 'use_item_on', 'attack', 'trade_request'].includes(action.kind) ||
        !('target' in action) ||
        !isRecord(action.target)
    ) {
        return undefined;
    }

    return positionLike(action.target.position);
}

function objectTileMoveTarget(action: AgentAction, perception: HybridPerception): Pos | undefined {
    if (action.kind !== 'move_to' || !('target' in action)) {
        return undefined;
    }

    const target = positionLike(action.target);
    if (!target || !(perception.nearby?.objects || []).some(object => positionsEqual(object.position, target))) {
        return undefined;
    }

    return target;
}

function positionsEqual(a: Pos, b: Pos): boolean {
    return a.x === b.x && a.y === b.y && a.level === b.level;
}

function positionLike(value: unknown): Pos | undefined {
    if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
        return undefined;
    }
    return { x: value.x, y: value.y, level: typeof value.level === 'number' ? value.level : 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isRecognizedCommand(command: string, fullText: string): boolean {
    return (
        isStopFollowingIntent(command, fullText) ||
        Boolean(followIntent(command, fullText)) ||
        isReturnHomeIntent(command, fullText) ||
        isStopIntent(command, fullText) ||
        isStatusIntent(command, fullText) ||
        isLookIntent(command, fullText) ||
        isInventoryIntent(command, fullText) ||
        Boolean(pickupIntent(command)) ||
        Boolean(dropIntent(command)) ||
        isPrayerTrainingIntent(command, fullText) ||
        isBuryBonesIntent(command, fullText) ||
        isCombatTrainingIntent(command, fullText) ||
        Boolean(talkIntent(command)) ||
        Boolean(attackIntent(command)) ||
        isRetreatIntent(command, fullText) ||
        isTradeIntent(command, fullText) ||
        tradeOfferIntent(command) !== undefined ||
        isTradeAcceptIntent(command, fullText) ||
        isExploreIntent(command, fullText) ||
        isCookingIntent(command, fullText) ||
        isStarterFishingIntent(command, fullText) ||
        isWoodcuttingIntent(command, fullText) ||
        isFiremakingIntent(command, fullText) ||
        isSmallTalkIntent(command, fullText)
    );
}
