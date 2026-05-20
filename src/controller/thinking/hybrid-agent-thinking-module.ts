import { z } from 'zod';
import { objectIds } from '@engine/world/config/object-ids';
import { parseCompletion } from '../llm/completion-parser';
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { ActiveGoalState, RuntimeState } from '../memory/runtime-state';
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
type Actor = { id: string; kind: 'player' | 'npc' | 'resident'; name?: string; key?: string; position: Pos; hpFraction?: number };
type HybridPerception = {
    tick?: number;
    resident?: {
        position?: Pos;
        hp?: { current?: number; max?: number };
        inCombat?: boolean;
        combatTarget?: Actor | null;
        busy?: boolean;
        inventory?: Array<Item | null>;
    };
    nearby?: {
        players?: Actor[];
        npcs?: Actor[];
        worldItems?: Array<Item & { position: Pos; ownerId?: string }>;
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
const REPEAT_ACTION_BACKOFF_TICKS = 30;
const TINDERBOX_ITEM_IDS = new Set([590]);
const FIREMAKING_LOG_ITEM_IDS = new Set([1511, 2862, 1521, 1519, 6333, 1517, 6332, 1515, 1513]);
const FIREMAKING_LOG_KEY_PATTERN = /^rs:(logs|.*_logs)$/i;
const FIRE_OBJECT_IDS = new Set([objectIds.fire]);
const FOOD_KEY_PATTERN = /(food|shrimp|anchovies|sardine|herring|trout|salmon|tuna|lobster|bass|swordfish|monkfish|shark|manta|karambwan|bread|cake|meat|chicken)/i;
const LEVEL_ONE_TREE_IDS = new Set([
    ...objectIds.tree.normal.map(tree => tree.default),
    ...objectIds.tree.dead.map(tree => tree.default),
]);

export class HybridAgentThinkingModule implements ThinkingModule {
    constructor(private readonly options: HybridAgentThinkingModuleOptions) {}

    async think(perception: Perception): Promise<ThoughtResult> {
        this.advanceTick(perception);
        this.ensureCognition();

        const directChat = this.directChatAction(perception as HybridPerception);
        if (directChat) {
            return this.result([directChat.action], directChat.cause, 0, false);
        }

        const combat = this.combatReaction(perception as HybridPerception);
        if (combat) {
            return this.result([combat.action], combat.cause, 0, false);
        }

        if ((perception as HybridPerception).resident?.busy) {
            return { actions: [], cause: 'resident_busy', nooped: true };
        }

        if (this.shouldRunBrain()) {
            const brain = await this.runBrain(perception);
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

        return this.runBody(perception);
    }

    considerInterrupt(_perception: Perception): boolean {
        return false;
    }

    stop(_cause: string): void {
        // Hybrid MVP performs one awaited inference at a time and keeps no abort controller.
    }

    private async runBrain(perception: Perception): Promise<{ action?: AgentAction; cause: string; envelopeTokens: number; nooped: boolean }> {
        const behavior = this.behavior();
        const prompt = buildBrainPrompt({
            soul: this.options.soul,
            perception,
            activeGoal: this.activeGoal(),
            commandPrefix: this.commandPrefix(),
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
            this.cognition().activeGoal = {
                id: parsed.goal.id || goalId(parsed.goal.description),
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

    private async runBody(perception: Perception): Promise<ThoughtResult> {
        const behavior = this.behavior();
        const visibility = this.visibilityStatus(perception);
        const prompt = buildBodyPrompt({
            soul: this.options.soul,
            perception,
            activeGoal: this.activeGoal(),
            commandPrefix: this.commandPrefix(),
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
            actions = [routine.action];
            cause = routine.cause;
        }
        const approach = this.approachDistantInteraction(actions, perception as HybridPerception);
        if (approach) {
            actions = [approach.action];
            cause = approach.cause;
        }

        const modelSuggestedAction = actions.length > 0;
        actions = this.suppressRepeatedActions(actions);
        if (actions.length === 0 && !modelSuggestedAction) {
            const fallback = this.nonRepeatedFallbackAction(perception, visibility);
            if (fallback) {
                actions = [fallback.action];
                cause = fallback.cause;
            }
        }
        if (actions.length === 0 && modelSuggestedAction) {
            const fallback = this.nonRepeatedFallbackAction(perception, { ...visibility, returnDue: false });
            if (fallback) {
                actions = [fallback.action];
                cause = fallback.cause;
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

    private fallbackAction(perception: Perception, visibility: ReturnType<HybridAgentThinkingModule['visibilityStatus']>):
        | { action: AgentAction; cause: string }
        | undefined {
        const view = perception as HybridPerception;
        const goal = this.activeGoal();
        const fireAction = goal && /fire|burn|logs|tinderbox|light/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`)
            ? firemakingAction(view)
            : undefined;
        if (fireAction) {
            return { action: fireAction, cause: 'firemaking_fallback' };
        }

        const exploreAction = goal && isExplorationGoal(goal) ? explorationAction(view, visibility.anchor) : undefined;
        if (exploreAction) {
            return { action: exploreAction, cause: 'exploration_fallback' };
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

        const targetObject = actionObjectTarget(actions[0], perception);
        if (targetObject && LEVEL_ONE_TREE_IDS.has(targetObject.objectId)) {
            return undefined;
        }
        if (!targetObject && actions.length > 0) {
            return undefined;
        }

        const woodcutting = levelOneWoodcuttingAction(perception);
        return woodcutting ? { action: woodcutting, cause: woodcutting.cause || 'woodcutting_level1_routine' } : undefined;
    }

    private approachDistantInteraction(actions: AgentAction[], perception: HybridPerception): { action: AgentAction; cause: string } | undefined {
        const action = actions[0];
        if (action?.kind === 'move_to' && typeof action.range === 'number') {
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

        return { kind: 'move_to', target: target.position, range: this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS, cause: 'follow_player_fallback' };
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
                action: { kind: 'move_to', target: speakerPosition, range: this.behavior().followRadius ?? DEFAULT_FOLLOW_RADIUS, cause: 'direct_chat_follow' },
                cause: 'direct_chat_follow',
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
                    : { kind: 'say', text: pickup.query ? `I do not see ${pickup.query} on the ground.` : 'I do not see an item to pick up.' },
                cause: 'direct_chat_pickup',
            };
        }

        const drop = dropIntent(command);
        if (drop) {
            const slot = drop.query ? findSlot(perception.resident?.inventory || [], item => itemMatchesQuery(item, drop.query!)) : undefined;
            return {
                action: drop.query
                    ? slot === undefined
                        ? { kind: 'say', text: `I am not carrying ${drop.query}.` }
                        : { kind: 'drop', slot, cause: 'direct_chat_drop' }
                    : { kind: 'say', text: 'Tell me what to drop.' },
                cause: 'direct_chat_drop',
            };
        }

        const attack = attackIntent(command);
        if (attack) {
            const target = findActorByName([...(perception.nearby?.npcs || []), ...(perception.nearby?.players || [])], attack);
            return {
                action: target ? { kind: 'attack', target, cause: 'direct_chat_attack' } : { kind: 'say', text: `I do not see ${cleanTarget(attack)} from here.` },
                cause: 'direct_chat_attack',
            };
        }

        if (isRetreatIntent(command, chat.normalizedText)) {
            return {
                action: { kind: 'move_to', target: fleeTarget(perception), cause: 'direct_chat_retreat' },
                cause: 'direct_chat_retreat',
            };
        }

        if (isExploreIntent(command, chat.normalizedText)) {
            this.cognition().activeGoal = explorationGoal(this.options.state.tick);
            return {
                action: explorationAction(perception, this.visibilityAnchor()) || {
                    kind: 'say',
                    text: this.statusSpeech(perception, 'I will scout nearby and stay findable'),
                },
                cause: 'direct_chat_explore',
            };
        }

        if (isFiremakingIntent(command, chat.normalizedText)) {
            this.cognition().activeGoal = firemakingGoal(this.options.state.tick);
            return {
                action:
                    firemakingAction(perception) ||
                    levelOneWoodcuttingAction(perception) || {
                        kind: 'say',
                        text: this.statusSpeech(perception, 'I will gather logs, then use the tinderbox to light them'),
                    },
                cause: 'direct_chat_make_fire',
            };
        }

        if (isWoodcuttingIntent(command, chat.normalizedText)) {
            this.cognition().activeGoal = woodcuttingGoal(this.options.state.tick);
            return {
                action:
                    levelOneWoodcuttingAction(perception) || {
                        kind: 'say',
                        text: this.statusSpeech(perception, 'I will look for an ordinary tree or dead tree to chop'),
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
        } else {
            action = { kind: 'attack', target, cause: 'combat_retaliate' };
        }

        if (this.isRepeatedAction(action)) {
            return undefined;
        }

        this.rememberBodyAction(action);
        return { action, cause: action.cause || 'combat_reaction' };
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
        return { kind: 'say', text: this.statusSpeech(perception, 'I am online') };
    }

    private statusSpeech(perception: HybridPerception, prefix: string): string {
        const here = perception.resident?.position;
        const goal = this.activeGoal()?.description || 'staying findable and looking for useful actions';
        return cleanSpeech(`${prefix}${here ? ` at ${here.x},${here.y}` : ''}. Goal: ${goal}`) || prefix;
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
        return cognition.lastBodyActionKey === key && this.options.state.tick - (cognition.lastBodyActionTick || 0) < REPEAT_ACTION_BACKOFF_TICKS;
    }

    private rememberBodyAction(action: AgentAction): void {
        const key = JSON.stringify(action);
        const cognition = this.cognition();
        cognition.lastBodyActionKey = key;
        cognition.lastBodyActionTick = this.options.state.tick;
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
        return this.options.state.tick - (this.cognition().lastBodyTick || 0) >= (this.behavior().bodyEveryTicks ?? DEFAULT_BODY_EVERY_TICKS);
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

    private ensureCognition(): void {
        this.options.state.cognition ||= {};
    }

    private cognition() {
        this.ensureCognition();
        return this.options.state.cognition!;
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

function actionObjectTarget(action: AgentAction | undefined, perception: HybridPerception): { objectId: number; position: Pos; orientation?: number } | undefined {
    if (!action) {
        return undefined;
    }

    const target = (action as { target?: unknown }).target as { objectId?: number; position?: Pos; x?: number; y?: number; level?: number } | undefined;
    if (target?.objectId && target.position) {
        return { objectId: target.objectId, position: target.position };
    }
    if (action.kind === 'move_to' && target) {
        const position = 'position' in target && target.position ? target.position : { x: target.x, y: target.y, level: target.level };
        return (perception.nearby?.objects || []).find(
            object =>
                object.position.x === position.x &&
                object.position.y === position.y &&
                object.position.level === (position.level ?? object.position.level),
        );
    }

    return undefined;
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

function isExplorationGoal(goal: ActiveGoalState): boolean {
    return /explore|scout|survey|look around|nearby|landmark|area/i.test(`${goal.description} ${(goal.steps || []).join(' ')}`);
}

function explorationAction(perception: HybridPerception, anchor?: Pos): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!here) {
        return undefined;
    }

    const object = (perception.nearby?.objects || [])
        .filter(candidate => !FIRE_OBJECT_IDS.has(candidate.objectId) && !LEVEL_ONE_TREE_IDS.has(candidate.objectId))
        .sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (object) {
        if (distance(here, object.position) > 2) {
            return { kind: 'move_to', target: object.position, range: 2, cause: 'explore_visible_object' };
        }
        return { kind: 'say', text: `I am checking the landmark at ${object.position.x},${object.position.y}.`, cause: 'explore_visible_object' };
    }

    const npc = (perception.nearby?.npcs || []).sort((a, b) => distance(here, a.position) - distance(here, b.position))[0];
    if (npc) {
        if (distance(here, npc.position) > 2) {
            return { kind: 'move_to', target: npc.position, range: 2, cause: 'explore_visible_actor' };
        }
        return { kind: 'say', text: `I see ${actorName(npc)} nearby at ${npc.position.x},${npc.position.y}.`, cause: 'explore_visible_actor' };
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

function explorationPatrolTarget(here: Pos, anchor?: Pos): Pos {
    const center = anchor && distance(here, anchor) <= DEFAULT_RETURN_TO_ANCHOR_RADIUS ? anchor : here;
    const dx = here.x >= center.x ? -4 : 4;
    const dy = here.y >= center.y ? 4 : -4;
    return { x: center.x + dx, y: center.y + dy, level: center.level };
}

function latestAddressedChat(perception: HybridPerception, commandPrefix: string, lastKey: string | undefined):
    | { key: string; normalizedText: string; from?: Actor }
    | undefined {
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
        if (from?.kind === 'resident') {
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

function mentionsCommandPrefix(text: string, commandPrefix: string): boolean {
    return new RegExp(`\\b${escapeRegExp(commandPrefix)}\\b`, 'i').test(text);
}

function addressedCommand(text: string, commandPrefix: string): string {
    return text.replace(new RegExp(`^${escapeRegExp(commandPrefix)}\\b[:,]?\\s*`, 'i'), '').trim();
}

function isFollowIntent(command: string, fullText: string): boolean {
    return /^(follow me|follow|come here|come to me|keep up|guard me|guard)\b/.test(command) || /\b(follow me|come here|come to me)\b/.test(fullText);
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
    return /^(make a fire|light a fire|start a fire|burn logs|firemaking)\b/.test(command) || /\b(make a fire|light a fire|start a fire|firemaking)\b/.test(fullText);
}

function isWoodcuttingIntent(command: string, fullText: string): boolean {
    return /^(chop wood|cut wood|chop a tree|cut a tree|woodcutting|gather logs)\b/.test(command) || /\b(chop wood|cut wood|woodcutting|gather logs)\b/.test(fullText);
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

function isExploreIntent(command: string, fullText: string): boolean {
    return /^(explore|scout|patrol|survey|wander)\b/.test(command) || /\b(explore|scout|patrol|survey)\b/.test(fullText);
}

function isRetreatIntent(command: string, fullText: string): boolean {
    return /^(run away|flee|retreat|escape)\b/.test(command) || /\b(run away|flee|retreat|escape)\b/.test(fullText);
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

function findActorByName(actors: Actor[], query: string): Actor | undefined {
    const wanted = normalizeText(cleanTarget(query));
    return actors.find(actor => {
        const names = [actor.name, actor.key, actor.id].filter((value): value is string => Boolean(value)).map(normalizeText);
        return names.some(name => name.includes(wanted) || wanted.includes(name));
    });
}

function isLowHealth(perception: HybridPerception): boolean {
    const hp = perception.resident?.hp;
    const max = Number(hp?.max || 0);
    return max > 0 && Number(hp?.current || 0) / max <= 0.4;
}

function firstFoodSlot(inventory: Array<Item | null>): number | undefined {
    return findSlot(inventory, item => FOOD_KEY_PATTERN.test(item.key || ''));
}

function findWorldItem(items: Array<Item & { position: Pos; ownerId?: string }>, query: string): (Item & { position: Pos; ownerId?: string }) | undefined {
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
    return (item.key || `item ${item.itemId}`)
        .replace(/^rs:/i, '')
        .replace(/_/g, ' ')
        .trim();
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
    const clean = text?.trim().replace(/\s+/g, ' ').slice(0, 160);
    return clean || undefined;
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
    if (!['interact', 'use_item_on', 'attack', 'trade_request'].includes(action.kind) || !('target' in action) || !isRecord(action.target)) {
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
