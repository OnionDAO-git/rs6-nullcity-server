import { z } from 'zod';
import { objectIds } from '@engine/world/config/object-ids';
import type { GameSkillContext } from '../knowledge/game-skill-context';
import { parseCompletion } from '../llm/completion-parser';
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { ActiveGoalState, ActiveMoveState, RuntimeState } from '../memory/runtime-state';
import { retireNervousRulesMd, upsertNervousRulesMd } from '../nervous-system/rules-md';
import type { HybridAgentBehaviorDefinition, InferenceProfileDefinition, Soul } from '../soul/soul-schema';
import type { AgentAction, Perception } from '../transport/message-codecs';
import { estimateTokens } from '../util/token-count';
import { buildBodyPrompt, buildBrainPrompt } from './hybrid-agent-prompts';
import type { ThinkingModule, ThoughtResult } from './thinking-module';

export interface HybridAgentThinkingModuleOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
}

type Pos = { x: number; y: number; level: number };
type Item = { itemId: number; key?: string; amount: number };
type WorldItem = Item & { position: Pos; ownerId?: string };
type Actor = { id: string; kind: 'player' | 'npc' | 'resident'; name?: string; key?: string; position: Pos; hpFraction?: number };
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
const INTERACTION_APPROACH_RADIUS = 1;
const PRAYER_TRAINING_WAYPOINT_RANGE = 6;
const PRAYER_TRAINING_WAYPOINTS: Pos[] = [
    { x: 3222, y: 3218, level: 0 },
    { x: 3249, y: 3238, level: 0 },
];
const REPEAT_ACTION_BACKOFF_TICKS = 30;
const MOVE_COMMIT_TICKS = 24;
const MOVE_STUCK_STATIONARY_OBSERVATIONS = 2;
const ROUTINE_LOOP_BREAK_ACTIONS = 3;
const ROUTINE_LOOP_BREAK_COOLDOWN_TICKS = 90;
const EXPLORATION_REPORT_COOLDOWN_TICKS = 80;
const MAX_INVENTORY_SLOTS = 28;
const ROUTINE_OPPORTUNISTIC_PICKUP_MAX_DISTANCE = 6;
const COMBAT_LOOT_MAX_DISTANCE = 6;
const PICKUP_TARGET_COOLDOWN_TICKS = 120;
const TINDERBOX_ITEM_IDS = new Set([590]);
const COIN_ITEM_IDS = new Set([995]);
const FIREMAKING_LOG_ITEM_IDS = new Set([1511, 2862, 1521, 1519, 6333, 1517, 6332, 1515, 1513]);
const FIREMAKING_LOG_KEY_PATTERN = /^rs:(logs|.*_logs)$/i;
const WOODCUTTING_AXE_ITEM_IDS = new Set([1351, 1349, 1353, 1361, 1355, 1357, 1359]);
const SMALL_FISHING_NET_ITEM_IDS = new Set([303]);
const STARTER_RAW_FISH_ITEM_IDS = new Set([317, 321]);
const STARTER_RAW_FISH_KEY_PATTERN = /^rs:raw_(shrimp|anchovies)$/i;
const COOKING_HEAT_OBJECT_IDS = new Set([objectIds.fire, 114, 2728, 2729, 2730, 2731, 2859, 4172, 9682]);
const ESSENTIAL_TOOL_KEY_PATTERN = /(tinderbox|axe|pickaxe)/i;
const FISHING_SPOT_PATTERN = /\bfishing\s+spot\b/i;
const BONE_ITEM_IDS = new Set([
    526, 528, 530, 532, 534, 536, 2859, 3123, 3125, 3179, 3180, 3181, 3182, 3183, 3185, 3186, 4812, 4813, 4814, 6729, 6812,
]);
const BONE_KEY_PATTERN = /^rs:(bones|bones_.+|.+_bones)$/i;
const SAFE_BONE_SOURCE_PATTERN = /\b(chicken|cow|goblin|rat|giant rat|spider|man|woman)\b/i;
const LOW_RISK_BONE_SOURCE_PATTERN = /\b(chicken|cow|rat|giant rat)\b/i;
const MEDIUM_RISK_BONE_SOURCE_PATTERN = /\b(goblin|spider)\b/i;
const HUMAN_BONE_SOURCE_PATTERN = /\b(man|woman)\b/i;
const SAFE_COMBAT_TARGET_PATTERN = /\b(chicken|cow|rat|giant rat|goblin)\b/i;
const FIRE_OBJECT_IDS = new Set([objectIds.fire]);
const FOOD_KEY_PATTERN =
    /(food|shrimp|anchovies|sardine|herring|trout|salmon|tuna|lobster|bass|swordfish|monkfish|shark|manta|karambwan|bread|cake|meat|chicken)/i;
const LEVEL_ONE_TREE_IDS = new Set([...objectIds.tree.normal.map(tree => tree.default), ...objectIds.tree.dead.map(tree => tree.default)]);
const OPENABLE_OBSTACLE_IDS = new Set([1530, 11707, 1533, 1516, 1519, 1536, 11993, 13001, 1551, 1553, 12986, 12987]);
const FENCE_OBSTACLE_IDS = new Set([objectIds.shortCuts.fenceNearKharidCows]);
const STUCK_OBSTACLE_RANGE = 2;

export class HybridAgentThinkingModule implements ThinkingModule {
    constructor(private readonly options: HybridAgentThinkingModuleOptions) {}

    async think(perception: Perception, gameSkill?: GameSkillContext): Promise<ThoughtResult> {
        this.advanceTick(perception);
        this.ensureCognition();
        this.ensureBenchmarkGoal();

        const directChat = this.directChatAction(perception as HybridPerception);
        if (directChat) {
            return this.result([directChat.action], directChat.cause, 0, false);
        }

        const combat = this.combatReaction(perception as HybridPerception);
        if (combat) {
            return this.result([combat.action], combat.cause, 0, false);
        }

        const dialogue = this.dialogueReaction(perception as HybridPerception);
        if (dialogue) {
            return this.result([dialogue.action], dialogue.cause, 0, false);
        }

        const trade = this.tradeReaction(perception as HybridPerception);
        if (trade) {
            return this.result([trade.action], trade.cause, 0, false);
        }

        if ((perception as HybridPerception).resident?.busy) {
            return { actions: [], cause: 'resident_busy', nooped: true };
        }

        if (this.shouldRunBrain()) {
            const brain = await this.runBrain(perception, gameSkill);
            if (brain.action) {
                return this.result([brain.action], brain.cause, brain.envelopeTokens, brain.nooped);
            }
        }

        if (!this.shouldRunBody()) {
            return { actions: [], cause: 'body_wait', nooped: true };
        }

        const presenceBeacon = this.presenceBeaconAction(perception as HybridPerception);
        if (presenceBeacon) {
            return this.result([presenceBeacon], 'presence_beacon', 0, false);
        }

        return this.runBody(perception, gameSkill);
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
        });
        const response = await this.options.llm.complete({
            endpoint: this.endpointFor(behavior.brain),
            prompt,
            temperature: this.temperatureFor(behavior.brain, 0.7),
            thinking: behavior.brain?.thinking ?? true,
            priority: 5,
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
            visibility,
        });
        const response = await this.options.llm.complete({
            endpoint: this.endpointFor(behavior.body),
            prompt,
            temperature: this.temperatureFor(behavior.body, 0.15),
            thinking: behavior.body?.thinking ?? false,
            priority: 2,
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
                ? explorationAction(view, visibility.anchor, this.options.state.resident, this.pickupCooldowns(), this.options.state.tick)
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

        if (isExplorationGoal(goal)) {
            const explorationAction = this.repeatedExplorationReportOverride(actions, perception);
            if (explorationAction) {
                return { action: explorationAction, cause: 'exploration_fallback' };
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

        if (isWoodcuttingTrainingGoal(goal) && !isFiremakingGoal(goal)) {
            const fireAction = firemakingAction(perception);
            if (fireAction) {
                this.clearGoalMomentum();
                this.cognition().activeGoal = firemakingGoal(this.options.state.tick);
                return { action: actionWithCause(fireAction, 'woodcutting_chain_firemaking'), cause: 'woodcutting_chain_firemaking' };
            }
        }

        if (/fire|burn|logs|tinderbox|light/i.test(goalText)) {
            const fireAction = firemakingAction(perception);
            if (fireAction) {
                return { action: fireAction, cause: 'firemaking_fallback' };
            }
            const woodcutting = actions.length === 0 ? levelOneWoodcuttingAction(perception) : undefined;
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
        );
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

                if (stationaryCount >= MOVE_STUCK_STATIONARY_OBSERVATIONS) {
                    const obstacle = stuckOpenObstacleAction(perception, here, updated);
                    if (obstacle) {
                        cognition.activeMove = undefined;
                        return { action: obstacle, cause: 'stuck_open_obstacle' };
                    }

                    const blocker = stuckBlockerReportAction(perception, here, updated);
                    if (blocker && !this.isRepeatedAction(blocker)) {
                        return { action: blocker, cause: 'stuck_blocker_report' };
                    }

                    const recovery = {
                        kind: 'move_to',
                        target: explorationPatrolTarget(here, anchor),
                        range: 1,
                        cause: 'stuck_move_recovery',
                    };
                    this.rememberActiveMove(recovery, here);
                    return { action: recovery, cause: 'stuck_move_recovery' };
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

    private approachDistantInteraction(
        actions: AgentAction[],
        perception: HybridPerception,
    ): { action: AgentAction; cause: string } | undefined {
        const action = actions[0];
        if (action?.kind === 'move_to' && typeof action.range === 'number') {
            return undefined;
        }
        if (action?.kind === 'interact' && action.cause === 'starter_fishing_net') {
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
        if (
            cognition.routineLoopCount < ROUTINE_LOOP_BREAK_ACTIONS ||
            (lastBreakTick > 0 && this.options.state.tick - lastBreakTick < ROUTINE_LOOP_BREAK_COOLDOWN_TICKS)
        ) {
            return undefined;
        }

        cognition.routineLoopCount = 0;
        cognition.routineLoopKey = undefined;
        cognition.lastRoutineLoopBreakTick = this.options.state.tick;
        cognition.activeGoal = explorationGoal(this.options.state.tick);

        const explore = explorationAction(perception, anchor, this.options.state.resident, this.pickupCooldowns(), this.options.state.tick);
        return {
            action: explore
                ? actionWithCause(explore, 'routine_loop_break')
                : { kind: 'say', text: 'I have worked this spot for a while. I am going to scout nearby.', cause: 'routine_loop_break' },
            cause: 'routine_loop_break',
        };
    }

    private followAction(perception: HybridPerception): AgentAction | undefined {
        const targetName = this.behavior().followPlayer;
        const here = perception.resident?.position;
        if (!targetName || !here) {
            return undefined;
        }

        const target = (perception.nearby?.players || []).find(player => {
            const names = [player.name, player.key, player.id].filter((value): value is string => Boolean(value)).map(normalizeText);
            return names.some(name => name.includes(normalizeText(targetName)) || normalizeText(targetName).includes(name));
        });
        if (!target || distance(here, target.position) <= (this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS)) {
            return undefined;
        }

        return {
            kind: 'move_to',
            target: target.position,
            range: this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS,
            cause: 'follow_player_fallback',
        };
    }

    private directChatAction(perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
        const chat = latestAddressedChat(perception, this.commandPrefix(), this.cognition().lastDirectChatKey);
        if (!chat) {
            return undefined;
        }

        this.cognition().lastDirectChatKey = chat.key;
        const command = addressedCommand(chat.normalizedText, this.commandPrefix());
        const here = perception.resident?.position;
        const speakerPosition = chat.from?.position;
        if (isFollowIntent(command, chat.normalizedText) && speakerPosition) {
            if (here && distance(here, speakerPosition) <= (this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS)) {
                return {
                    action: { kind: 'say', text: this.statusSpeech(perception, 'I am with you') },
                    cause: 'direct_chat_follow',
                };
            }

            return {
                action: {
                    kind: 'move_to',
                    target: speakerPosition,
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
            this.cognition().activeGoal = undefined;
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
            if (isLowHealth(perception)) {
                const foodSlot = firstFoodSlot(perception.resident?.inventory || []);
                return {
                    action:
                        foodSlot === undefined
                            ? { kind: 'say', text: 'I am too hurt to attack without food. I need to heal or retreat first.' }
                            : { kind: 'eat', slot: foodSlot, cause: 'direct_chat_eat_before_attack' },
                    cause: 'direct_chat_attack',
                };
            }
            const target = findActorByName([...(perception.nearby?.npcs || []), ...(perception.nearby?.players || [])], attack);
            return {
                action: target
                    ? { kind: 'attack', target, cause: 'direct_chat_attack' }
                    : { kind: 'say', text: `I do not see ${cleanTarget(attack)} from here.` },
                cause: 'direct_chat_attack',
            };
        }

        if (isRetreatIntent(command, chat.normalizedText)) {
            return {
                action: { kind: 'move_to', target: fleeTarget(perception), cause: 'direct_chat_retreat' },
                cause: 'direct_chat_retreat',
            };
        }

        if (isTradeIntent(command, chat.normalizedText)) {
            return {
                action: tradeRequestOrApproach(perception, chat.from, 'direct_chat_trade') || {
                    kind: 'say',
                    text: 'I need to see you nearby before I can trade.',
                },
                cause: 'direct_chat_trade',
            };
        }

        const tradeOffer = tradeOfferIntent(command);
        if (tradeOffer) {
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
            return {
                action: tradeAcceptAction(perception.resident?.activeTrade) || {
                    kind: 'say',
                    text: 'I do not have a trade ready to accept yet.',
                },
                cause: 'direct_chat_trade_accept',
            };
        }

        if (isExploreIntent(command, chat.normalizedText)) {
            this.cognition().activeGoal = explorationGoal(this.options.state.tick);
            return {
                action: explorationAction(
                    perception,
                    this.visibilityAnchor(),
                    this.options.state.resident,
                    this.pickupCooldowns(),
                    this.options.state.tick,
                ) || {
                    kind: 'say',
                    text: this.statusSpeech(perception, 'I will scout nearby and stay findable'),
                },
                cause: 'direct_chat_explore',
            };
        }

        if (isFiremakingIntent(command, chat.normalizedText)) {
            this.cognition().activeGoal = firemakingGoal(this.options.state.tick);
            const action = firemakingAction(perception) || levelOneWoodcuttingAction(perception);
            return {
                action: action || missingFiremakingToolAction(perception),
                cause: 'direct_chat_make_fire',
            };
        }

        if (isCookingIntent(command, chat.normalizedText)) {
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
            this.cognition().activeGoal = starterFishingGoal(this.options.state.tick);
            return {
                action:
                    starterFishingAction(perception) ||
                    missingStarterFishingAction(perception, this.statusSpeech(perception, 'I will look for a Fishing spot')),
                cause: 'direct_chat_fish',
            };
        }

        if (isWoodcuttingIntent(command, chat.normalizedText)) {
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

        return {
            action: { kind: 'say', text: this.statusSpeech(perception, 'I hear you') },
            cause: 'direct_chat_ack',
        };
    }

    private combatReaction(perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
        const target = latestCombatAttacker(perception) || perception.resident?.combatTarget || undefined;
        if (!target) {
            return undefined;
        }

        let action: AgentAction;
        if (target.kind === 'player') {
            action = {
                kind: 'say',
                text: `${actorName(target)} is attacking me. Tell me "${this.commandPrefix()} attack ${actorName(target)}" if I should fight back.`,
            };
        } else if (isLowHealth(perception) && firstFoodSlot(perception.resident?.inventory || []) === undefined) {
            action = { kind: 'move_to', target: fleeTarget(perception), cause: 'combat_retreat' };
        } else if (isLowHealth(perception)) {
            const foodSlot = firstFoodSlot(perception.resident?.inventory || []);
            action =
                foodSlot === undefined
                    ? { kind: 'move_to', target: fleeTarget(perception), cause: 'combat_retreat' }
                    : { kind: 'eat', slot: foodSlot, cause: 'combat_eat_before_retaliating' };
        } else {
            action = { kind: 'attack', target, cause: 'combat_retaliate' };
        }

        if (this.isRepeatedAction(action)) {
            return undefined;
        }

        this.rememberBodyAction(action);
        return { action, cause: action.cause || 'combat_reaction' };
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
        if (!this.activeGoal()) {
            return undefined;
        }

        const interval = this.behavior().shareGoalsEveryTicks ?? DEFAULT_GOAL_SHARE_EVERY_TICKS;
        const last = this.cognition().lastPresenceBeaconTick ?? this.cognition().lastGoalShareTick;
        if (last === undefined || (interval > 0 && this.options.state.tick - last < interval)) {
            return undefined;
        }

        this.cognition().lastPresenceBeaconTick = this.options.state.tick;
        this.cognition().lastGoalShareTick = this.options.state.tick;
        return { kind: 'say', text: this.statusSpeech(perception, 'I am online', true) };
    }

    private statusSpeech(perception: HybridPerception, prefix: string, includeNextStep = false): string {
        const here = perception.resident?.position;
        const next = includeNextStep ? nextStepSuggestion(perception, this.options.state.resident) : undefined;
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

    private isTrustedTradePartner(actor: Actor): boolean {
        const trusted = this.behavior().followPlayer;
        return Boolean(trusted && actorMatchesName(actor, trusted));
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

    private pickupCooldowns(): Record<string, number> {
        const cognition = this.cognition();
        cognition.pickupCooldowns ||= {};
        return cognition.pickupCooldowns;
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
        return { actions, cause, envelopeTokens, nooped: nooped || actions.length === 0 };
    }
}

const brainGoalSchema = z.object({
    id: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(500),
    steps: z.array(z.string().min(1).max(200)).max(8).optional(),
    success: z.string().min(1).max(300).optional(),
    ttlTicks: z.number().int().positive().max(5000).optional(),
});

const brainCompletionSchema = z.object({
    cause: z.string().max(120).optional(),
    goal: brainGoalSchema.optional(),
    say: z.string().max(200).optional(),
});

function parseBrainCompletion(text: string): { goal?: z.infer<typeof brainGoalSchema>; say?: string; cause?: string } {
    if (!text.trim()) {
        return {};
    }

    const parsed = brainCompletionSchema.safeParse(extractJson(text));
    if (!parsed.success) {
        return {};
    }
    return parsed.data;
}

function firemakingAction(perception: HybridPerception): AgentAction | undefined {
    if (hasNearbyFire(perception)) {
        return undefined;
    }

    const inventory = perception.resident?.inventory || [];
    const tinderboxSlot = findSlot(inventory, isTinderbox);
    const logSlot = findSlot(inventory, isFiremakingLog);
    if (tinderboxSlot !== undefined && logSlot !== undefined) {
        return { kind: 'use_item_on_item', itemSlot: tinderboxSlot, targetSlot: logSlot, cause: 'firemaking_fallback' };
    }

    return undefined;
}

function hasNearbyFire(perception: HybridPerception): boolean {
    const here = perception.resident?.position;
    if (!here) {
        return false;
    }

    return (perception.nearby?.objects || []).some(object => FIRE_OBJECT_IDS.has(object.objectId) && distance(here, object.position) <= 1);
}

function firemakingGoal(tick: number): ActiveGoalState {
    return {
        id: 'make-fire',
        description: 'Gather ordinary logs and light a fire with the tinderbox.',
        steps: ['Find a level-1 ordinary Tree or Dead tree', 'Chop it for logs', 'Use tinderbox on logs', 'Say what happened'],
        success: 'A fire appears nearby and I can still report my location.',
        ttlTicks: 600,
        createdAtTick: tick,
    };
}

function woodcuttingGoal(tick: number): ActiveGoalState {
    return {
        id: 'chop-level-one-tree',
        description: 'Practice woodcutting on ordinary level-1 trees and gather logs.',
        steps: ['Find a visible ordinary Tree or Dead tree', 'Move beside it', 'Use chop down', 'Repeat while staying findable'],
        success: 'Logs are collected or a tree-chopping attempt is underway.',
        ttlTicks: 600,
        createdAtTick: tick,
    };
}

function starterFishingGoal(tick: number): ActiveGoalState {
    return {
        id: 'catch-starter-fish',
        description: 'Catch shrimp with a small fishing net at a visible Fishing spot.',
        steps: ['Carry a small fishing net', 'Find a Fishing spot', 'Move beside it', 'Use the net option'],
        success: 'A net fishing attempt is underway or raw shrimp are collected.',
        ttlTicks: 600,
        createdAtTick: tick,
    };
}

function starterCookingGoal(tick: number): ActiveGoalState {
    return {
        id: 'cook-starter-fish',
        description: 'Cook raw shrimp or anchovies on a visible fire or range.',
        steps: ['Carry raw shrimp or anchovies', 'Find a fire or range', 'Use raw fish on the heat source'],
        success: 'Raw fish turn into cooked food or a clear blocker is explained.',
        ttlTicks: 450,
        createdAtTick: tick,
    };
}

function prayerGoal(tick: number): ActiveGoalState {
    return {
        id: 'train-prayer-with-bones',
        description: 'Pick up bones and bury them to train Prayer after safe combat.',
        steps: ['Find bones on the ground or in inventory', 'Pick up visible bones', 'Use the bury option on carried bones'],
        success: 'Bones are buried and Prayer gains progress.',
        ttlTicks: 450,
        createdAtTick: tick,
    };
}

function combatGoal(tick: number): ActiveGoalState {
    return {
        id: 'train-combat-safely',
        description: 'Train combat on safe low-level NPCs and stop when hurt.',
        steps: ['Find a safe Chicken, Rat, Cow, or Goblin', 'Move beside it', 'Attack when healthy', 'Eat or stop when hurt'],
        success: 'A safe creature is attacked while Agent remains healthy enough to continue.',
        ttlTicks: 450,
        createdAtTick: tick,
    };
}

function benchmarkGoalForTask(taskId: unknown, tick: number): ActiveGoalState | undefined {
    if (taskId === 'starter-fishing-5m') {
        return starterFishingGoal(tick);
    }
    if (taskId === 'combat-prayer-10m') {
        return combatGoal(tick);
    }
    return undefined;
}

function explorationGoal(tick: number): ActiveGoalState {
    return {
        id: 'scout-nearby-area',
        description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
        steps: ['Walk toward a nearby landmark or person', 'Report what is visible', 'Return near the anchor if I drift too far'],
        success: 'A nearby landmark, actor, or item has been checked and I can report my location.',
        ttlTicks: 450,
        createdAtTick: tick,
    };
}

function levelOneWoodcuttingAction(perception: HybridPerception): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }
    if (!hasWoodcuttingAxe(perception)) {
        return undefined;
    }

    const target = (perception.nearby?.objects || [])
        .filter(object => LEVEL_ONE_TREE_IDS.has(object.objectId))
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (!target) {
        return undefined;
    }

    if (distance(here, target.position) > INTERACTION_APPROACH_RADIUS) {
        return { kind: 'move_to', target: target.position, range: INTERACTION_APPROACH_RADIUS, cause: 'woodcutting_level1_routine' };
    }

    return { kind: 'interact', target, option: 'chop down', cause: 'woodcutting_level1_routine' };
}

function starterFishingAction(perception: HybridPerception): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here || !hasSmallFishingNet(perception)) {
        return undefined;
    }

    const target = (perception.nearby?.npcs || [])
        .filter(isFishingSpot)
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (!target) {
        return undefined;
    }

    return { kind: 'interact', target, option: 'net', cause: 'starter_fishing_net' };
}

function findSlot(items: Array<Item | null>, predicate: (item: Item) => boolean): number | undefined {
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item && predicate(item)) {
            return i;
        }
    }
    return undefined;
}

function isTinderbox(item: Item): boolean {
    return TINDERBOX_ITEM_IDS.has(item.itemId) || /tinderbox/i.test(item.key || '');
}

function isFiremakingLog(item: Item): boolean {
    return FIREMAKING_LOG_ITEM_IDS.has(item.itemId) || FIREMAKING_LOG_KEY_PATTERN.test(item.key || '');
}

function isWoodcuttingAxe(item: Item): boolean {
    return WOODCUTTING_AXE_ITEM_IDS.has(item.itemId) || /\b(axe|hatchet)\b/i.test(item.key || '');
}

function hasWoodcuttingAxe(perception: HybridPerception): boolean {
    return [...(perception.resident?.inventory || [])].some(item => Boolean(item && isWoodcuttingAxe(item)));
}

function isSmallFishingNet(item: Item): boolean {
    return SMALL_FISHING_NET_ITEM_IDS.has(item.itemId) || /\bsmall(_|\s)?fishing(_|\s)?net\b|\bsmall(_|\s)?net\b/i.test(item.key || '');
}

function hasSmallFishingNet(perception: HybridPerception): boolean {
    return [...(perception.resident?.inventory || [])].some(item => Boolean(item && isSmallFishingNet(item)));
}

function isStarterRawFish(item: Item): boolean {
    return STARTER_RAW_FISH_ITEM_IDS.has(item.itemId) || STARTER_RAW_FISH_KEY_PATTERN.test(item.key || '');
}

function starterFishingCookingAction(perception: HybridPerception): AgentAction | undefined {
    const rawFishSlot = findSlot(perception.resident?.inventory || [], isStarterRawFish);
    if (rawFishSlot === undefined) {
        return undefined;
    }

    const here = perception.resident?.position;
    const heatSource = (perception.nearby?.objects || [])
        .filter(object => COOKING_HEAT_OBJECT_IDS.has(object.objectId))
        .sort((a, b) => distance(here || a.position, a.position) - distance(here || b.position, b.position))[0];
    if (heatSource) {
        return { kind: 'use_item_on', itemSlot: rawFishSlot, target: heatSource, cause: 'starter_fishing_cook_catch' };
    }

    const fireAction = firemakingAction(perception);
    if (fireAction) {
        return actionWithCause(fireAction, 'starter_fishing_make_cooking_fire');
    }

    return { kind: 'say', text: 'I have raw fish now. I need a fire or range to cook it.', cause: 'starter_fishing_missing_heat' };
}

function isFishingSpot(actor: Actor): boolean {
    return [actor.name, actor.key, actor.id]
        .filter((value): value is string => Boolean(value))
        .some(value => FISHING_SPOT_PATTERN.test(value));
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

function isBones(item: Item): boolean {
    return BONE_ITEM_IDS.has(item.itemId) || BONE_KEY_PATTERN.test(item.key || '');
}

function buryBonesAction(perception: HybridPerception): AgentAction | undefined {
    const inventory = perception.resident?.inventory || [];
    const bonesSlot = findSlot(inventory, isBones);
    if (bonesSlot !== undefined) {
        return { kind: 'item_action', slot: bonesSlot, option: 'bury', cause: 'prayer_bury_bones' };
    }

    const bones = (perception.nearby?.worldItems || [])
        .filter(isBones)
        .sort(
            (a, b) =>
                distance(perception.resident?.position || a.position, a.position) -
                distance(perception.resident?.position || b.position, b.position),
        )[0];
    if (bones) {
        return { kind: 'interact', target: bones, option: 'pick-up', cause: 'prayer_pickup_bones' };
    }

    return undefined;
}

function prayerTrainingAction(perception: HybridPerception): AgentAction | undefined {
    const bonesAction = buryBonesAction(perception);
    if (bonesAction) {
        return bonesAction;
    }
    if (isLowHealth(perception)) {
        return undefined;
    }

    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const target = safeBoneSourceTarget(perception);
    if (!target) {
        const waypoint = nearestPrayerTrainingWaypoint(here);
        return distance(here, waypoint) > PRAYER_TRAINING_WAYPOINT_RANGE
            ? { kind: 'move_to', target: waypoint, range: PRAYER_TRAINING_WAYPOINT_RANGE, cause: 'prayer_seek_safe_bone_source' }
            : undefined;
    }

    if (distance(here, target.position) > INTERACTION_APPROACH_RADIUS) {
        return { kind: 'move_to', target: target.position, range: INTERACTION_APPROACH_RADIUS, cause: 'prayer_approach_safe_bone_source' };
    }

    return { kind: 'attack', target, cause: 'prayer_attack_safe_bone_source' };
}

function combatTrainingAction(
    perception: HybridPerception,
    pickupCooldowns?: Record<string, number>,
    currentTick?: number,
): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    if (isLowHealth(perception)) {
        const foodSlot = firstFoodSlot(perception.resident?.inventory || []);
        return foodSlot === undefined
            ? { kind: 'say', text: 'I am too hurt to start combat without food. I need to heal or get food first.' }
            : { kind: 'eat', slot: foodSlot, cause: 'combat_eat_before_training' };
    }

    if (!perception.resident?.inCombat) {
        const loot = combatLootOrPrayerAction(perception, pickupCooldowns, currentTick);
        if (loot) {
            return loot;
        }
    }

    const target = safeCombatTarget(perception);
    if (!target) {
        const waypoint = nearestPrayerTrainingWaypoint(here);
        return distance(here, waypoint) > PRAYER_TRAINING_WAYPOINT_RANGE
            ? { kind: 'move_to', target: waypoint, range: PRAYER_TRAINING_WAYPOINT_RANGE, cause: 'combat_seek_safe_target' }
            : undefined;
    }

    if (distance(here, target.position) > INTERACTION_APPROACH_RADIUS) {
        return { kind: 'move_to', target: target.position, range: INTERACTION_APPROACH_RADIUS, cause: 'combat_approach_safe_target' };
    }

    return { kind: 'attack', target, cause: 'combat_attack_safe_target' };
}

function combatLootOrPrayerAction(
    perception: HybridPerception,
    pickupCooldowns?: Record<string, number>,
    currentTick?: number,
): AgentAction | undefined {
    const bonesSlot = findSlot(perception.resident?.inventory || [], isBones);
    if (bonesSlot !== undefined) {
        return { kind: 'item_action', slot: bonesSlot, option: 'bury', cause: 'combat_bury_looted_bones' };
    }

    const pickup = opportunisticPickupAction(perception, undefined, COMBAT_LOOT_MAX_DISTANCE, pickupCooldowns, currentTick);
    return pickup ? actionWithCause(pickup, 'combat_loot_pickup') : undefined;
}

function nearestPrayerTrainingWaypoint(here: Pos): Pos {
    return [...PRAYER_TRAINING_WAYPOINTS].sort((a, b) => distance(here, a) - distance(here, b))[0];
}

function safeBoneSourceTarget(perception: HybridPerception): Actor | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    return (perception.nearby?.npcs || []).filter(isSafeBoneSource).sort((a, b) => {
        const priority = boneSourcePriority(a) - boneSourcePriority(b);
        return priority !== 0 ? priority : distance(here, a.position) - distance(here, b.position);
    })[0];
}

function isSafeBoneSource(actor: Actor): boolean {
    if (actor.kind !== 'npc' || actor.hpFraction === 0) {
        return false;
    }
    return SAFE_BONE_SOURCE_PATTERN.test([actor.name, actor.key, actor.id].filter(Boolean).join(' '));
}

function boneSourcePriority(actor: Actor): number {
    const label = [actor.name, actor.key, actor.id].filter(Boolean).join(' ');
    if (LOW_RISK_BONE_SOURCE_PATTERN.test(label)) {
        return 0;
    }
    if (MEDIUM_RISK_BONE_SOURCE_PATTERN.test(label)) {
        return 1;
    }
    if (HUMAN_BONE_SOURCE_PATTERN.test(label)) {
        return 2;
    }
    return 3;
}

function safeCombatTarget(perception: HybridPerception): Actor | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    return (perception.nearby?.npcs || []).filter(isSafeCombatTarget).sort((a, b) => {
        const priority = combatTargetPriority(a) - combatTargetPriority(b);
        return priority !== 0 ? priority : distance(here, a.position) - distance(here, b.position);
    })[0];
}

function isSafeCombatTarget(actor: Actor): boolean {
    if (actor.kind !== 'npc' || actor.hpFraction === 0) {
        return false;
    }
    return SAFE_COMBAT_TARGET_PATTERN.test([actor.name, actor.key, actor.id].filter(Boolean).join(' '));
}

function combatTargetPriority(actor: Actor): number {
    const label = [actor.name, actor.key, actor.id].filter(Boolean).join(' ');
    if (LOW_RISK_BONE_SOURCE_PATTERN.test(label)) {
        return 0;
    }
    if (MEDIUM_RISK_BONE_SOURCE_PATTERN.test(label)) {
        return 1;
    }
    return 2;
}

function isPrayerTrainingGoal(goal: ActiveGoalState): boolean {
    if (/^train-combat|^combat/i.test(goal.id)) {
        return false;
    }
    return /prayer|bone|bones|bury/i.test(`${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`);
}

function isExplorationGoal(goal: ActiveGoalState): boolean {
    return /explore|scout|survey|look around|nearby|landmark|area/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`);
}

function isCombatTrainingGoal(goal: ActiveGoalState): boolean {
    return /combat|fight|fighting|attack|melee/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`);
}

function isWoodcuttingTrainingGoal(goal: ActiveGoalState): boolean {
    return /woodcut|chop|tree|gather logs/i.test(`${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`);
}

function isStarterFishingGoal(goal: ActiveGoalState): boolean {
    return /fish|fishing|shrimp|anchov|small net|small_fishing_net|fishing spot/i.test(
        `${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`,
    );
}

function isFiremakingGoal(goal: ActiveGoalState): boolean {
    return /fire|burn|tinderbox|light/i.test(`${goal.id} ${goal.description} ${(goal.steps || []).join(' ')}`);
}

function explorationAction(
    perception: HybridPerception,
    anchor?: Pos,
    residentId?: string,
    pickupCooldowns?: Record<string, number>,
    currentTick?: number,
): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const pickup = opportunisticPickupAction(perception, residentId, undefined, pickupCooldowns, currentTick);
    if (pickup) {
        return pickup;
    }

    const npc = (perception.nearby?.npcs || []).sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (npc) {
        return npcTalkAction(perception, npc, 'explore_talk_to_npc');
    }

    const object = (perception.nearby?.objects || [])
        .filter(candidate => !FIRE_OBJECT_IDS.has(candidate.objectId) && !LEVEL_ONE_TREE_IDS.has(candidate.objectId))
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (object) {
        if (distance(here, object.position) > 2) {
            return { kind: 'move_to', target: object.position, range: 2, cause: 'explore_visible_object' };
        }
        return {
            kind: 'say',
            text: `I am checking the landmark at ${object.position.x},${object.position.y}.`,
            cause: 'explore_visible_object',
        };
    }

    const item = (perception.nearby?.worldItems || []).sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (item) {
        if (distance(here, item.position) > 1) {
            return { kind: 'move_to', target: item.position, range: 1, cause: 'explore_visible_item' };
        }
        return { kind: 'say', text: `I see ${itemLabel(item)} on the ground.`, cause: 'explore_visible_item' };
    }

    const patrol = explorationPatrolTarget(here, anchor);
    if (distance(here, patrol) > 1) {
        return { kind: 'move_to', target: patrol, range: 1, cause: 'explore_patrol' };
    }

    return { kind: 'say', text: `I am scouting near ${here.x},${here.y} and staying findable.`, cause: 'explore_patrol' };
}

function opportunisticPickupAction(
    perception: HybridPerception,
    residentId?: string,
    maxDistance?: number,
    pickupCooldowns?: Record<string, number>,
    currentTick = perception.tick ?? 0,
): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here || !inventoryHasFreeSlot(perception.resident?.inventory || [])) {
        return undefined;
    }

    const suppressFiremakingLogPickup = hasNearbyFire(perception);
    const item = (perception.nearby?.worldItems || [])
        .filter(candidate => {
            if (
                (suppressFiremakingLogPickup && isFiremakingLog(candidate)) ||
                !isUsefulGroundItem(candidate) ||
                isOwnedByAnotherActor(candidate, residentId, perception.resident?.id) ||
                isPickupOnCooldown(candidate, pickupCooldowns, currentTick)
            ) {
                return false;
            }
            return maxDistance === undefined || distance(here, candidate.position) <= maxDistance;
        })
        .sort((a, b) => {
            const priority = usefulGroundItemPriority(a) - usefulGroundItemPriority(b);
            return priority !== 0 ? priority : distance(here, a.position) - distance(here, b.position);
        })[0];
    if (!item) {
        return undefined;
    }

    if (distance(here, item.position) > INTERACTION_APPROACH_RADIUS) {
        return { kind: 'move_to', target: item.position, range: INTERACTION_APPROACH_RADIUS, cause: 'opportunistic_pickup' };
    }

    return { kind: 'interact', target: item, option: 'pick-up', cause: 'opportunistic_pickup' };
}

function inventoryHasFreeSlot(inventory: Array<Item | null>): boolean {
    return inventory.length < MAX_INVENTORY_SLOTS || inventory.some(item => item === null);
}

function isUsefulGroundItem(item: Item): boolean {
    return (
        COIN_ITEM_IDS.has(item.itemId) ||
        /coins?/i.test(item.key || '') ||
        isFiremakingLog(item) ||
        isBones(item) ||
        FOOD_KEY_PATTERN.test(item.key || '')
    );
}

function usefulGroundItemPriority(item: Item): number {
    if (COIN_ITEM_IDS.has(item.itemId) || /coins?/i.test(item.key || '')) {
        return 0;
    }
    if (FOOD_KEY_PATTERN.test(item.key || '')) {
        return 1;
    }
    if (isFiremakingLog(item)) {
        return 2;
    }
    if (isBones(item)) {
        return 3;
    }
    return 4;
}

function isOwnedByAnotherActor(item: WorldItem, residentId?: string, perceptionResidentId?: string): boolean {
    if (!item.ownerId) {
        return false;
    }

    const owner = normalizeActorId(item.ownerId);
    const residentIds = [residentId, perceptionResidentId].filter((id): id is string => Boolean(id)).map(normalizeActorId);
    return !residentIds.includes(owner);
}

function isPickupOnCooldown(item: WorldItem, cooldowns: Record<string, number> | undefined, currentTick: number): boolean {
    const last = cooldowns?.[pickupItemKey(item)];
    return last !== undefined && currentTick - last < PICKUP_TARGET_COOLDOWN_TICKS;
}

function pickupItemKey(item: WorldItem): string {
    return `${item.itemId}:${item.key || ''}:${positionKey(item.position)}`;
}

function pickupActionWorldItem(action: AgentAction): WorldItem | undefined {
    const candidate = action as { option?: unknown; target?: unknown };
    if (action.kind !== 'interact' || !/pick[- ]?up/i.test(String(candidate.option || ''))) {
        return undefined;
    }

    return worldItemLike(candidate.target);
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

function normalizeActorId(id: string): string {
    return id
        .toLowerCase()
        .replace(/^player:/, '')
        .replace(/^resident:/, '');
}

function explorationPatrolTarget(here: Pos, anchor?: Pos): Pos {
    const center = anchor && distance(here, anchor) <= DEFAULT_RETURN_TO_ANCHOR_RADIUS ? anchor : here;
    const dx = here.x >= center.x ? -4 : 4;
    const dy = here.y >= center.y ? 4 : -4;
    return { x: center.x + dx, y: center.y + dy, level: center.level };
}

function stuckOpenObstacleAction(perception: HybridPerception, here: Pos, active: ActiveMoveState): AgentAction | undefined {
    const obstacle = (perception.nearby?.objects || [])
        .filter(object => OPENABLE_OBSTACLE_IDS.has(object.objectId) && distance(here, object.position) <= STUCK_OBSTACLE_RANGE)
        .sort((a, b) => {
            const nearest = distance(here, a.position) - distance(here, b.position);
            return nearest !== 0 ? nearest : distance(active.target, a.position) - distance(active.target, b.position);
        })[0];

    return obstacle ? { kind: 'interact', target: obstacle, option: 'open', cause: 'stuck_open_obstacle' } : undefined;
}

function stuckBlockerReportAction(perception: HybridPerception, here: Pos, active: ActiveMoveState): AgentAction | undefined {
    const blocker = (perception.nearby?.objects || [])
        .filter(object => FENCE_OBSTACLE_IDS.has(object.objectId) && distance(here, object.position) <= STUCK_OBSTACLE_RANGE)
        .sort((a, b) => {
            const nearest = distance(here, a.position) - distance(here, b.position);
            return nearest !== 0 ? nearest : distance(active.target, a.position) - distance(active.target, b.position);
        })[0];

    if (!blocker) {
        return undefined;
    }

    return { kind: 'say', text: 'I am stuck near a fence. I will step away and try another route.', cause: 'stuck_blocker_report' };
}

function nextStepSuggestion(perception: HybridPerception, residentId?: string): string | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const suppressFiremakingLogPickup = hasNearbyFire(perception);
    const item = (perception.nearby?.worldItems || [])
        .filter(
            candidate =>
                !(suppressFiremakingLogPickup && isFiremakingLog(candidate)) &&
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

function npcTalkAction(perception: HybridPerception, target: Actor, cause: string): AgentAction {
    const here = perception.resident?.position;
    if (here && distance(here, target.position) > 2) {
        return { kind: 'move_to', target: target.position, range: 1, cause };
    }

    return { kind: 'interact', target, option: 'talk-to', cause };
}

function isLocalRoutineCause(cause: string, action: AgentAction): boolean {
    return /woodcutting_level1_routine|firemaking_fallback|firemaking_gather_logs/i.test(`${cause} ${action.cause || ''}`);
}

function routineLoopFamily(cause: string, action: AgentAction): string {
    if (/woodcutting|firemaking/i.test(`${cause} ${action.cause || ''}`)) {
        return 'woodcutting-firemaking';
    }
    return cause;
}

function actionWithCause(action: AgentAction, cause: string): AgentAction {
    return { ...action, cause };
}

function sameMoveIntent(action: AgentAction, active: ActiveMoveState): boolean {
    if (action.kind !== 'move_to') {
        return false;
    }

    const target = positionLike(action.target);
    const range = typeof action.range === 'number' ? action.range : 0;
    return Boolean(target && positionsEqual(target, active.target) && range === (active.range ?? 0));
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
    return text.replace(new RegExp(`^${escapeRegExp(commandPrefix)}\\b[:,]?\\s*`, 'i'), '').trim();
}

function isFollowIntent(command: string, fullText: string): boolean {
    return (
        /^(follow me|follow|come here|come to me|keep up|guard me|guard)\b/.test(command) ||
        /\b(follow me|come here|come to me)\b/.test(fullText)
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
        /\b(what are you doing|what are you up to|are you working|status|say something|hello|hi|hey)\b/.test(fullText)
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
        /^(make a fire|light a fire|start a fire|burn logs|firemaking)\b/.test(command) ||
        /\b(make a fire|light a fire|start a fire|firemaking)\b/.test(fullText)
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

function latestCombatAttacker(perception: HybridPerception): Actor | undefined {
    for (const event of [...(perception.events || [])].reverse()) {
        if (!['hit_taken', 'hit', 'attacked'].includes(String(event.kind || ''))) {
            continue;
        }
        const attacker = actorLike(event.from);
        if (attacker) {
            return attacker;
        }
    }

    return undefined;
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

function isLowHealth(perception: HybridPerception): boolean {
    const hp = perception.resident?.hp;
    const max = Number(hp?.max || 0);
    return max > 0 && Number(hp?.current || 0) / max <= 0.4;
}

function firstFoodSlot(inventory: Array<Item | null>): number | undefined {
    return findSlot(inventory, item => FOOD_KEY_PATTERN.test(item.key || ''));
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

function itemLabel(item: Item): string {
    return (item.key || `item ${item.itemId}`).replace(/^rs:/i, '').replace(/_/g, ' ').trim();
}

function fleeTarget(perception: HybridPerception): Pos {
    const here = perception.resident?.position || { x: 0, y: 0, level: 0 };
    const threat = latestCombatAttacker(perception) || perception.resident?.combatTarget;
    if (!threat) {
        return { x: here.x + 4, y: here.y, level: here.level };
    }

    return {
        x: here.x + Math.sign(here.x - threat.position.x || 1) * 4,
        y: here.y + Math.sign(here.y - threat.position.y || 1) * 4,
        level: here.level,
    };
}

function actorName(actor: Actor): string {
    return actor.name || actor.key || displayName(actor.id);
}

function cleanTarget(text: string): string {
    return text.trim().replace(/[.!?]+$/g, '');
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
    };
}

function cleanSpeech(text: string | undefined): string | undefined {
    const clean = text?.trim().replace(/\s+/g, ' ').slice(0, 220);
    return clean || undefined;
}

function summarizeGoalForSpeech(text: string, reserveSpaceForNextStep: boolean): string {
    const clean = text
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[.!?]+$/g, '');
    const max = reserveSpaceForNextStep ? 96 : 160;
    if (clean.length <= max) {
        return clean;
    }
    return `${clean
        .slice(0, max - 3)
        .trimEnd()
        .replace(/[,:;.!?]+$/g, '')}...`;
}

function goalId(description: string): string {
    return description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

function displayName(name: string): string {
    return name.replace(/^res:/i, '');
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

function distance(a: Pos, b: Pos): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
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

function extractJson(text: string): unknown {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
        return JSON.parse(trimmed);
    }

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
        return JSON.parse(trimmed.slice(first, last + 1));
    }

    return JSON.parse(trimmed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
