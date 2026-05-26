import type { AgentAction, Perception } from '../transport/message-codecs';
import type { Soul, HybridAgentBehaviorDefinition, InferenceProfileDefinition } from '../soul/soul-schema';
import type { RuntimeState } from '../memory/runtime-state';
import type { MemoryStore } from '../memory/memory-store';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import type { PatronRegistry } from '../patron/patron-registry';
import {
    isRecord,
    positionLike,
    actorLike,
    normalizeText,
    escapeRegExp,
    displayName,
    type Pos,
    type Item,
    type WorldItem,
    type Actor,
    type ActiveTrade,
    type HybridPerception,
} from './hybrid-agent-utils';
import {
    findSlot,
    itemLabel,
    distance,
    isLowHealth,
    npcTalkAction,
    combatTrainingAction,
    prayerTrainingAction,
    firemakingAction,
    levelOneWoodcuttingAction,
    starterFishingAction,
    explorationAction,
    buryBonesAction,
} from '../spark/runescape-body-routines';
import {
    isTinderbox,
    isSmallFishingNet,
    isFiremakingLog,
    isBones,
    hasSmallFishingNet,
    hasWoodcuttingAxe,
    isStarterRawFish,
} from '../spark/runescape-workflows';
import { admitInference } from '../llm/budgets';
import { pickPhrase } from '../soul/phrasebook';
import {
    cleanTarget,
    isFollowGoal,
    explorationGoal,
    firemakingGoal,
    starterFishingGoal,
    woodcuttingGoal,
    prayerGoal,
    combatGoal,
    starterCookingGoal,
    followGoal,
    cleanSpeech,
} from '../spark/runescape-brain-planner';
import { fleeTarget } from '../spark/runescape-nervous-rules';
import {
    statusSpeech,
    DEFAULT_FOLLOW_RADIUS,
    rememberPendingDirectTrade,
    starterFishingCookingAction,
    type HelperContext,
} from './hybrid-agent-helpers';

// --- Shared Constants ---
export const WINDOW_TICKS = 10;
export const CHAT_REPLIES_PER_WINDOW = 3;
export const DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS = 20_000;
export const ESSENTIAL_TOOL_KEY_PATTERN = /(tinderbox|axe|pickaxe)/i;
export const FOOD_KEY_PATTERN = /(shrimp|bread|fish|meat)/i;

export type ChatContext = HelperContext;

export type DirectChatDecision = {
    action: AgentAction;
    cause: string;
    prefaceActions?: AgentAction[];
};

export function isChatRateLimited(ctx: ChatContext): boolean {
    const cognition = ctx.cognition();
    if (!cognition.chatReplyTicks) {
        cognition.chatReplyTicks = [];
    }
    const currentTick = ctx.options.state.tick;
    cognition.chatReplyTicks = cognition.chatReplyTicks.filter((tick: number) => tick > currentTick - WINDOW_TICKS);
    return cognition.chatReplyTicks.length >= CHAT_REPLIES_PER_WINDOW;
}

export function recordChatReplyEmit(ctx: ChatContext): void {
    const cognition = ctx.cognition();
    if (!cognition.chatReplyTicks) {
        cognition.chatReplyTicks = [];
    }
    cognition.chatReplyTicks.push(ctx.options.state.tick);
}

export function isManuallyPaused(ctx: ChatContext): boolean {
    return ctx.cognition().manualPauseSinceTick !== undefined;
}

export function pauseDirectChatActivity(ctx: ChatContext): void {
    const cognition = ctx.cognition();
    cognition.manualPauseSinceTick = ctx.options.state.tick;
    const target = cognition.followTarget;
    cognition.followTarget = target
        ? { ...target, paused: true, setAtTick: ctx.options.state.tick }
        : { paused: true, setAtTick: ctx.options.state.tick };
}

export function resumeManualPause(ctx: ChatContext): void {
    ctx.cognition().manualPauseSinceTick = undefined;
}

export function currentFollowTarget(ctx: ChatContext): { name?: string; id?: string; kind?: string } | undefined {
    const target = ctx.cognition().followTarget;
    if (target?.paused) {
        return undefined;
    }
    if (target?.name || target?.id) {
        return target;
    }
    const configured = ctx.behavior().followPlayer;
    return configured ? { name: configured } : undefined;
}

export async function nonCommandChatReaction(
    ctx: ChatContext,
    perception: HybridPerception,
    thinkId: number,
): Promise<{ action: AgentAction; cause: string } | undefined> {
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
        if (mentionsCommandPrefix(normalizedText, ctx.commandPrefix())) {
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

        if (isChatRateLimited(ctx)) {
            ctx.cognition().tickTelemetry = {
                chat_reply_emitted: false,
                chat_reply_suppressed: 'rate_limited',
            };
            return undefined;
        }

        const budgetDecision = admitInference(ctx.options.state);
        if (!budgetDecision.ok) {
            ctx.cognition().tickTelemetry = {
                chat_reply_emitted: false,
                chat_reply_suppressed: 'budget_exhausted',
            };
            return undefined;
        }

        const memories = ctx.promptMemories(perception, 'body');
        const prompt = [
            `You are the RuneScape resident ${ctx.options.soul.frontmatter.display || ctx.options.soul.frontmatter.name}.`,
            `Your character archetype is ${ctx.options.soul.frontmatter.archetype || 'default'}.`,
            `Your voice register is ${ctx.options.soul.frontmatter.voice?.register || 'default'}.`,
            ctx.options.soul.body ? `Character notes:\n${ctx.options.soul.body}` : '',
            ctx.promptMemorySection(memories, 'body'),
            `A player nearby said: "${event.text}".`,
            `Reply to them in character as one normal public chat sentence under 160 characters.`,
            `Do not include JSON, fields, markdown, arrays, or labels. Do not echo this prompt. Output only the chat text.`,
        ]
            .filter(Boolean)
            .join('\n');

        const response = await ctx.complete(thinkId, {
            endpoint: ctx.endpointFor(ctx.behavior().brain),
            prompt,
            temperature: ctx.temperatureFor(ctx.behavior().brain, 0.7),
            thinking: ctx.behavior().brain?.thinking ?? true,
            timeoutMs: ctx.timeoutFor(ctx.behavior().brain, DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS),
            priority: 5,
            ...(ctx.modelFor(ctx.behavior().brain) ? { model: ctx.modelFor(ctx.behavior().brain) } : {}),
        });

        const replyText = cleanSmallTalkReply(response.text, normalizedText, memories);
        if (!replyText) {
            return undefined;
        }

        recordChatReplyEmit(ctx);

        const action: AgentAction = {
            kind: 'say',
            text: replyText,
            voiceSource: 'inference',
        };

        ctx.cognition().tickTelemetry = {
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

export function cleanSmallTalkReply(text: string | undefined, normalizedQuestion: string, memories: string[]): string | undefined {
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

export function clarifyingQuestionReaction(
    ctx: ChatContext,
    perception: HybridPerception,
    commandLower: string,
): { action: AgentAction; cause: string } | undefined {
    if (isChatRateLimited(ctx)) {
        ctx.cognition().tickTelemetry = {
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
        soul: ctx.options.soul,
        situation: `ambiguity.${commandLower}`,
        seed: `${ctx.options.state.tick}`,
        params,
    });

    recordChatReplyEmit(ctx);

    const action: AgentAction = {
        kind: 'say',
        text,
        voiceSource: 'phrasebook',
    };

    ctx.cognition().tickTelemetry = {
        chat_reply_emitted: true,
        chat_reply_kind: 'clarifying_question',
        voiceSource: 'phrasebook',
    };

    return {
        action,
        cause: `direct_chat_clarify_ambiguous_${commandLower}`,
    };
}

export function politeDeclineReaction(
    ctx: ChatContext,
    perception: HybridPerception,
    refusalReason: string,
    missingTool?: string,
    extraParams?: Record<string, string>,
): { action: AgentAction; cause: string } | undefined {
    if (isChatRateLimited(ctx)) {
        ctx.cognition().tickTelemetry = {
            chat_reply_emitted: false,
            chat_reply_suppressed: 'rate_limited',
        };
        return undefined;
    }

    let text = '';
    if (refusalReason === 'missing_tool') {
        text = pickPhrase({
            soul: ctx.options.soul,
            situation: 'polite_decline.missing_tool',
            seed: `${ctx.options.state.tick}`,
            params: { tool: missingTool || 'tool' },
        });
    } else {
        text = pickPhrase({
            soul: ctx.options.soul,
            situation: `polite_decline.${refusalReason}`,
            seed: `${ctx.options.state.tick}`,
            params: { prefix: ctx.commandPrefix(), ...extraParams },
        });
    }

    recordChatReplyEmit(ctx);

    const action: AgentAction = {
        kind: 'say',
        text,
        voiceSource: 'phrasebook',
    };

    ctx.cognition().tickTelemetry = {
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

function isRecognizedCommand(command: string, fullText: string): boolean {
    return (
        isStopFollowingIntent(command, fullText) ||
        Boolean(followIntent(command, fullText)) ||
        isReturnHomeIntent(command, fullText) ||
        isStopIntent(command, fullText) ||
        isStatusIntent(command, fullText) ||
        isHelpIntent(command, fullText) ||
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
        isComeHereIntent(command, fullText) ||
        isWaitIntent(command, fullText) ||
        isSmallTalkIntent(command, fullText)
    );
}

function commandCatalogForVoice(): string {
    return 'follow, stop, wait, come, train, fight, eat, drop, trade, explore, make fire, or cook';
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

export async function directChatAction(
    ctx: ChatContext,
    perception: HybridPerception,
    thinkId: number,
    options: { includeSmallTalk?: boolean } = {},
): Promise<DirectChatDecision | undefined> {
    const chat = latestAddressedChat(perception, ctx.commandPrefix(), ctx.cognition().lastDirectChatKey);
    if (!chat) {
        return options.includeSmallTalk ? await nonCommandChatReaction(ctx, perception, thinkId) : undefined;
    }

    ctx.cognition().lastDirectChatKey = chat.key;
    const command = addressedCommand(chat.normalizedText, ctx.commandPrefix());
    const here = perception.resident?.position;
    const cognition = ctx.cognition();

    // 1. stop (highest precedence)
    if (isStopIntent(command, chat.normalizedText)) {
        ctx.clearGoalMomentum();
        cognition.activeGoal = undefined;
        cognition.followTarget = undefined;
        cognition.waitResumeTick = undefined;
        cognition.pausedGoal = undefined;
        cognition.pausedFollowTarget = undefined;
        pauseDirectChatActivity(ctx);

        const stopSayAction: AgentAction = {
            kind: 'say',
            text: pickPhrase({
                soul: ctx.options.soul,
                situation: 'direct_chat_stop.ack',
                seed: `${ctx.options.state.tick}`,
            }),
            voiceSource: 'phrasebook',
        };

        if (perception.resident?.inCombat) {
            const combat = ctx.combatReaction(perception);
            return {
                action: stopSayAction,
                cause: 'direct_chat_stop',
                prefaceActions: combat?.actions,
            };
        }

        return {
            action: stopSayAction,
            cause: 'direct_chat_stop',
        };
    }

    // Combat Gating (Patrons-don't-override safety)
    if (perception.resident?.inCombat) {
        const hp = perception.resident?.hp?.current || 0;
        const maxHp = perception.resident?.hp?.max || 100;
        const hpPercent = (hp / maxHp) * 100;
        if (hpPercent < 30) {
            cognition.tickTelemetry = {
                chat_reply_emitted: true,
                chat_reply_kind: 'polite_decline',
                refusalReason: 'command_unsafe',
                voiceSource: 'phrasebook',
            };
            const declineSayAction: AgentAction = {
                kind: 'say',
                text: pickPhrase({
                    soul: ctx.options.soul,
                    situation: 'polite_decline.command_unsafe.combat',
                    seed: `${ctx.options.state.tick}`,
                }),
                voiceSource: 'phrasebook',
            };
            const combat = ctx.combatReaction(perception);
            return {
                action: declineSayAction,
                cause: 'direct_chat_decline_command_unsafe',
                prefaceActions: combat?.actions,
            };
        } else {
            cognition.tickTelemetry = {
                chat_reply_emitted: false,
                chat_reply_kind: 'polite_decline',
                refusalReason: 'busy_higher_priority_goal',
            };
            return undefined;
        }
    }

    // Trade Gating (Patrons-don't-override safety)
    const midTrade = isMidTradeWithAcceptedOffer(perception);
    if (midTrade) {
        cognition.tickTelemetry = {
            chat_reply_emitted: true,
            chat_reply_kind: 'polite_decline',
            refusalReason: 'command_unsafe',
            voiceSource: 'phrasebook',
        };
        const declineSayAction: AgentAction = {
            kind: 'say',
            text: pickPhrase({
                soul: ctx.options.soul,
                situation: 'polite_decline.command_unsafe.trade',
                seed: `${ctx.options.state.tick}`,
            }),
            voiceSource: 'phrasebook',
        };
        const trade = ctx.tradeReaction(perception);
        return {
            action: declineSayAction,
            cause: 'direct_chat_decline_command_unsafe',
            prefaceActions: trade?.action ? [trade.action] : undefined,
        };
    }

    const commandLower = command.toLowerCase().trim();

    // 2. wait
    if (isWaitIntent(command, chat.normalizedText)) {
        const tick = ctx.options.state.tick;
        const WAIT_DURATION_TICKS = 60;

        if (cognition.waitResumeTick !== undefined && tick < cognition.waitResumeTick) {
            cognition.waitResumeTick = tick + WAIT_DURATION_TICKS;

            recordChatReplyEmit(ctx);
            cognition.tickTelemetry = {
                chat_reply_emitted: true,
                chat_reply_kind: 'polite_decline',
                voiceSource: 'phrasebook',
            };
            return {
                action: {
                    kind: 'say',
                    text: pickPhrase({
                        soul: ctx.options.soul,
                        situation: 'direct_chat_wait.extend',
                        seed: `${tick}`,
                    }),
                    voiceSource: 'phrasebook',
                },
                cause: 'direct_chat_wait_extend',
            };
        } else {
            cognition.waitResumeTick = tick + WAIT_DURATION_TICKS;
            cognition.pausedGoal = cognition.activeGoal;
            cognition.activeGoal = undefined;
            cognition.pausedFollowTarget = cognition.followTarget;
            cognition.followTarget = undefined;

            ctx.clearGoalMomentum();
            pauseDirectChatActivity(ctx);
            recordChatReplyEmit(ctx);
            cognition.tickTelemetry = {
                chat_reply_emitted: true,
                chat_reply_kind: 'polite_decline',
                voiceSource: 'phrasebook',
            };
            return {
                action: {
                    kind: 'say',
                    text: pickPhrase({
                        soul: ctx.options.soul,
                        situation: 'direct_chat_wait.wait',
                        seed: `${tick}`,
                    }),
                    voiceSource: 'phrasebook',
                },
                cause: 'direct_chat_wait',
            };
        }
    }

    if (commandLower === 'go' || commandLower === 'make' || commandLower === 'give') {
        return clarifyingQuestionReaction(ctx, perception, commandLower);
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
        const extraParams = refusalReason === 'unknown_command' ? { command, catalog: commandCatalogForVoice() } : undefined;
        return politeDeclineReaction(ctx, perception, refusalReason!, missingTool, extraParams);
    }

    if (isStopFollowingIntent(command, chat.normalizedText)) {
        const target = currentFollowTarget(ctx);
        ctx.clearGoalMomentum();
        cognition.followTarget = { paused: true, setAtTick: ctx.options.state.tick };
        if (isFollowGoal(cognition.activeGoal)) {
            cognition.activeGoal = undefined;
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
            cognition.tickTelemetry = {
                chat_reply_emitted: true,
                chat_reply_kind: 'polite_decline',
                refusalReason: 'target_not_visible',
                voiceSource: 'phrasebook',
            };
            return {
                action: {
                    kind: 'say',
                    text: follow.target ? `I do not see ${cleanTarget(follow.target)} nearby.` : 'I need to see who to follow.',
                    voiceSource: 'phrasebook',
                },
                cause: 'direct_chat_follow_failed',
            };
        }

        ctx.clearGoalMomentum();
        resumeManualPause(ctx);
        cognition.followTarget = {
            name: actorName(target),
            id: target.id,
            kind: target.kind,
            paused: false,
            setAtTick: ctx.options.state.tick,
        };
        cognition.activeGoal = followGoal(actorName(target), ctx.options.state.tick);

        if (here && distance(here, target.position) <= (ctx.behavior().followRadius ?? 2)) {
            return {
                action: { kind: 'say', text: statusSpeech(ctx, perception, `I will follow ${actorName(target)}`) },
                cause: 'direct_chat_follow',
            };
        }

        return {
            action: {
                kind: 'move_to',
                target: target.position,
                range: ctx.behavior().followRadius ?? 2,
                cause: 'direct_chat_follow',
            },
            cause: 'direct_chat_follow',
        };
    }

    // 4. come here
    if (isComeHereIntent(command, chat.normalizedText)) {
        const target = chat.from && chat.from.name ? findActorByName(perception.nearby?.players || [], chat.from.name) : undefined;
        if (!target) {
            return {
                action: {
                    kind: 'say',
                    text: 'I need to see who to come to.',
                    voiceSource: 'phrasebook',
                },
                cause: 'direct_chat_come_here_no_target',
            };
        }

        ctx.clearGoalMomentum();
        resumeManualPause(ctx);
        cognition.waitResumeTick = undefined;
        cognition.pausedGoal = undefined;
        cognition.pausedFollowTarget = undefined;

        recordChatReplyEmit(ctx);
        cognition.tickTelemetry = {
            chat_reply_emitted: true,
            chat_reply_kind: 'polite_decline',
            voiceSource: 'phrasebook',
        };

        const dist = here ? distance(here, target.position) : 999;
        const moveActions =
            dist > 1
                ? [
                      {
                          kind: 'move_to' as const,
                          target: target.position,
                          range: 1,
                          cause: 'direct_chat_come_here',
                      },
                  ]
                : [];

        return {
            action: {
                kind: 'say',
                text: pickPhrase({
                    soul: ctx.options.soul,
                    situation: 'direct_chat_come_here.ack',
                    seed: `${ctx.options.state.tick}`,
                }),
                voiceSource: 'phrasebook',
            },
            prefaceActions: moveActions,
            cause: 'direct_chat_come_here',
        };
    }

    if (isReturnHomeIntent(command, chat.normalizedText)) {
        const anchor = ctx.visibilityAnchor();
        if (!anchor) {
            return {
                action: { kind: 'say', text: 'I do not have a home anchor set yet.' },
                cause: 'direct_chat_return_home',
            };
        }

        resumeManualPause(ctx);
        if (here && distance(here, anchor) <= (ctx.behavior().followRadius ?? 2)) {
            return {
                action: { kind: 'say', text: statusSpeech(ctx, perception, 'I am already near home') },
                cause: 'direct_chat_return_home',
            };
        }

        return {
            action: {
                kind: 'move_to',
                target: anchor,
                range: ctx.behavior().followRadius ?? 2,
                cause: 'direct_chat_return_home',
            },
            cause: 'direct_chat_return_home',
        };
    }

    if (isStopIntent(command, chat.normalizedText)) {
        ctx.clearGoalMomentum();
        cognition.activeGoal = undefined;
        pauseDirectChatActivity(ctx);
        return {
            action: { kind: 'say', text: 'I will pause here and wait for a new goal.', cause: 'direct_chat_stop' },
            cause: 'direct_chat_stop',
        };
    }

    if (isStatusIntent(command, chat.normalizedText)) {
        return {
            action: { kind: 'say', text: statusSpeech(ctx, perception, 'I am online') },
            cause: 'direct_chat_status',
        };
    }

    if (isHelpIntent(command, chat.normalizedText)) {
        return {
            action: { kind: 'say', text: helpSpeech(), cause: 'direct_chat_help' },
            cause: 'direct_chat_help',
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
        resumeManualPause(ctx);
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
        resumeManualPause(ctx);
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

    if (isPrayerTrainingIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        cognition.activeGoal = prayerGoal(ctx.options.state.tick);
        return {
            action: prayerTrainingAction(perception) || {
                kind: 'say',
                text: statusSpeech(ctx, perception, 'I will look for a safe creature, collect bones, then bury them'),
            },
            cause: 'direct_chat_train_prayer',
        };
    }

    if (isBuryBonesIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        cognition.activeGoal = prayerGoal(ctx.options.state.tick);
        return {
            action: buryBonesAction(perception) || {
                kind: 'say',
                text: statusSpeech(ctx, perception, 'I will look for bones to bury'),
            },
            cause: 'direct_chat_bury_bones',
        };
    }

    if (isCombatTrainingIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        cognition.activeGoal = combatGoal(ctx.options.state.tick);
        return {
            action: combatTrainingAction(perception) || {
                kind: 'say',
                text: statusSpeech(ctx, perception, 'I will look for a safe low-level creature to fight'),
            },
            cause: 'direct_chat_train_combat',
        };
    }

    const talk = talkIntent(command);
    if (talk) {
        resumeManualPause(ctx);
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
        resumeManualPause(ctx);
        const target = findActorByName([...(perception.nearby?.npcs || []), ...(perception.nearby?.players || [])], attack);
        return {
            action: target
                ? { kind: 'attack', target, cause: 'direct_chat_attack' }
                : { kind: 'say', text: `I do not see ${cleanTarget(attack)} from here.` },
            cause: 'direct_chat_attack',
        };
    }

    if (isRetreatIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        return {
            action: { kind: 'move_to', target: fleeTarget(perception), cause: 'direct_chat_retreat' },
            cause: 'direct_chat_retreat',
        };
    }

    if (isTradeIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        const action = tradeRequestOrApproach(perception, chat.from, 'direct_chat_trade');
        if (action?.kind === 'move_to') {
            rememberPendingDirectTrade(ctx, chat.from);
        } else if (action?.kind === 'trade_request') {
            cognition.pendingDirectTrade = undefined;
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
        resumeManualPause(ctx);
        const slot = safeTradeOfferSlot(perception.resident?.inventory || [], tradeOffer);
        return {
            action:
                slot === undefined
                    ? {
                          kind: 'say',
                          text: tradeOffer ? `I do not have a spare ${tradeOffer} to offer.` : 'I do not have a safe spare item to offer.',
                      }
                    : { kind: 'trade_offer_item', inventorySlot: slot, amount: 1, cause: 'direct_chat_trade_offer' },
            cause: 'direct_chat_trade_offer',
        };
    }

    if (isTradeAcceptIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        return {
            action: tradeAcceptAction(perception.resident?.activeTrade) || {
                kind: 'say',
                text: 'I do not have a trade ready to accept yet.',
            },
            cause: 'direct_chat_trade_accept',
        };
    }

    if (isExploreIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        cognition.activeGoal = explorationGoal(ctx.options.state.tick);
        return {
            action: explorationAction(
                perception,
                ctx.visibilityAnchor(),
                ctx.options.state.resident,
                ctx.pickupCooldowns(),
                ctx.options.state.tick,
                ctx.explorationCooldowns(),
                { interactWithOpenables: false },
            ) || {
                kind: 'say',
                text: statusSpeech(ctx, perception, 'I will scout nearby and stay findable'),
            },
            cause: 'direct_chat_explore',
        };
    }

    if (isFiremakingIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        cognition.activeGoal = firemakingGoal(ctx.options.state.tick);
        const action = firemakingAction(perception) || levelOneWoodcuttingAction(perception);
        return {
            action: action || missingFiremakingToolAction(perception),
            cause: 'direct_chat_make_fire',
        };
    }

    if (isCookingIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        cognition.activeGoal = starterCookingGoal(ctx.options.state.tick);
        return {
            action: starterFishingCookingAction(ctx, perception) || {
                kind: 'say',
                text: 'I need raw shrimp or anchovies before I can cook starter fish.',
            },
            cause: 'direct_chat_cook',
        };
    }

    if (isStarterFishingIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        cognition.activeGoal = starterFishingGoal(ctx.options.state.tick);
        return {
            action:
                starterFishingAction(perception) ||
                missingStarterFishingAction(perception, statusSpeech(ctx, perception, 'I will look for a Fishing spot')),
            cause: 'direct_chat_fish',
        };
    }

    if (isWoodcuttingIntent(command, chat.normalizedText)) {
        resumeManualPause(ctx);
        cognition.activeGoal = woodcuttingGoal(ctx.options.state.tick);
        return {
            action: levelOneWoodcuttingAction(perception) || {
                kind: 'say',
                text: hasWoodcuttingAxe(perception)
                    ? statusSpeech(ctx, perception, 'I will look for an ordinary tree or dead tree to chop')
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

// --- Intent Parsing Helper Functions (Moved Verbatim) ---

export function mentionsCommandPrefix(text: string, commandPrefix: string): boolean {
    return new RegExp(`\\b${escapeRegExp(commandPrefix)}\\b`, 'i').test(text);
}

export function addressedCommand(text: string, commandPrefix: string): string {
    const prefixPattern = new RegExp(`\\b${escapeRegExp(commandPrefix)}\\b[:,]?\\s*`, 'i');
    const match = prefixPattern.exec(text);
    if (!match) {
        return text.trim();
    }

    return text.slice(match.index + match[0].length).trim();
}

export function followIntent(command: string, fullText: string): { target?: string } | undefined {
    if (/^(follow me|keep up|guard me)\b/.test(command) || /^(follow|guard)$/.test(command) || /\b(follow me)\b/.test(fullText)) {
        return {};
    }

    const named = command.match(/^(follow|guard)\s+(.+)/);
    if (!named) {
        return undefined;
    }

    const target = cleanTarget(named[2]);
    return /^me\b/.test(target) ? {} : { target };
}

export function isComeHereIntent(command: string, fullText: string): boolean {
    return /^(come here|come to me|come)\b/.test(command) || /\b(come here|come to me)\b/.test(fullText);
}

export function isWaitIntent(command: string, fullText: string): boolean {
    return /^(wait|pause)\b/.test(command) || /\b(wait|pause)\b/.test(fullText);
}

export function isStopFollowingIntent(command: string, fullText: string): boolean {
    return (
        /^(stop following|stop follow|do not follow|dont follow|don't follow|quit following|stop guarding)\b/.test(command) ||
        /\b(stop following|do not follow me|dont follow me|don't follow me|stop guarding)\b/.test(fullText)
    );
}

export function isReturnHomeIntent(command: string, fullText: string): boolean {
    return (
        /^(return home|go home|home|return to start|go to start|back to anchor)\b/.test(command) ||
        /\b(return home|go home|return to start|go to start|back to anchor)\b/.test(fullText)
    );
}

export function isStopIntent(command: string, fullText: string): boolean {
    if (isStopFollowingIntent(command, fullText)) {
        return false;
    }
    return /^(stop|hold position|cancel goal|clear goal)\b/.test(command) || /\b(cancel goal|clear goal|hold position)\b/.test(fullText);
}

export function isStatusIntent(command: string, fullText: string): boolean {
    return (
        /^(status|where are you|what are you doing|what are you up to|are you working|say something|hello|hi|hey)\b/.test(command) ||
        /\b(what are you doing|what are you up to|are you working|status|say something)\b/.test(fullText)
    );
}

export function isHelpIntent(command: string, fullText: string): boolean {
    return (
        /^(help|commands|what can you do|what should i say|what can i ask|what do you know how to do)\b/.test(command) ||
        /\b(what can you do|what should i say|what can i ask|what do you know how to do)\b/.test(fullText)
    );
}

export function isLookIntent(command: string, fullText: string): boolean {
    return (
        /^(what do you see|look|look around|suggest|actions|what can we do|what is nearby)\b/.test(command) ||
        /\b(what do you see|what can we do|what is nearby|look around)\b/.test(fullText)
    );
}

export function isInventoryIntent(command: string, fullText: string): boolean {
    return (
        /^(inventory|what are you carrying|what do you have|supplies)\b/.test(command) ||
        /\b(inventory|what are you carrying|what do you have|supplies)\b/.test(fullText)
    );
}

export function isFiremakingIntent(command: string, fullText: string): boolean {
    return (
        /^(make a fire|make fire|light a fire|light fire|start a fire|burn logs|firemaking)\b/.test(command) ||
        /\b(make a fire|make fire|light a fire|light fire|start a fire|firemaking)\b/.test(fullText)
    );
}

export function isWoodcuttingIntent(command: string, fullText: string): boolean {
    return (
        /^(chop wood|cut wood|chop a tree|cut a tree|woodcutting|gather logs)\b/.test(command) ||
        /\b(chop wood|cut wood|woodcutting|gather logs)\b/.test(fullText)
    );
}

export function isStarterFishingIntent(command: string, fullText: string): boolean {
    return (
        /^(fish|go fish|go fishing|catch fish|catch shrimp|fishing|net fish)\b/.test(command) ||
        /\b(catch shrimp|go fishing|small net fishing)\b/.test(fullText)
    );
}

export function isCookingIntent(command: string, fullText: string): boolean {
    return /^(cook|cook fish|cook shrimp|cook food|cooking)\b/.test(command) || /\b(cook shrimp|cook fish|cook food)\b/.test(fullText);
}

export function isBuryBonesIntent(command: string, fullText: string): boolean {
    return /^(bury bones|bury)\b/.test(command) || /\bbury bones\b/.test(fullText);
}

export function isPrayerTrainingIntent(command: string, fullText: string): boolean {
    return (
        /^(train prayer|prayer training|combat prayer|get bones|collect bones|prayer)\b/.test(command) ||
        /\b(train prayer|prayer training|combat prayer|get bones|collect bones)\b/.test(fullText)
    );
}

export function isCombatTrainingIntent(command: string, fullText: string): boolean {
    return (
        /^(train combat|combat training|practice combat|train melee|melee training|fight something|fight safely)\b/.test(command) ||
        /\b(train combat|combat training|practice combat|train melee|melee training|fight something|fight safely)\b/.test(fullText)
    );
}

export function attackIntent(command: string): string | undefined {
    const match = command.match(/^attack\s+(.+)/);
    return match ? cleanTarget(match[1]) : undefined;
}

export function pickupIntent(command: string): { query?: string } | undefined {
    const match = command.match(/^(pick up|take|loot)(?:\s+(.+))?/);
    if (!match) {
        return undefined;
    }
    const query = match[2] ? cleanTarget(match[2]) : undefined;
    return query ? { query } : {};
}

export function dropIntent(command: string): { query?: string } | undefined {
    const match = command.match(/^drop(?:\s+(.+))?/);
    if (!match) {
        return undefined;
    }
    const query = match[1] ? cleanTarget(match[1]) : undefined;
    return query ? { query } : {};
}

export function talkIntent(command: string): string | undefined {
    const match = command.match(/^(talk to|talk|speak to|speak with)\s+(.+)/);
    return match ? cleanTarget(match[2]) : undefined;
}

export function isExploreIntent(command: string, fullText: string): boolean {
    return /^(explore|scout|patrol|survey|wander)\b/.test(command) || /\b(explore|scout|patrol|survey)\b/.test(fullText);
}

export function isRetreatIntent(command: string, fullText: string): boolean {
    return /^(run away|flee|retreat|escape)\b/.test(command) || /\b(run away|flee|retreat|escape)\b/.test(fullText);
}

export function isTradeIntent(command: string, fullText: string): boolean {
    return /^(trade|trade me|start trade|request trade)\b/.test(command) || /\b(trade me|start trade|request trade)\b/.test(fullText);
}

export function tradeOfferIntent(command: string): string | undefined {
    const match = command.match(/^offer(?:\s+(.+))?/);
    if (!match) {
        return undefined;
    }
    return match[1] ? cleanTarget(match[1]) : '';
}

export function isTradeAcceptIntent(command: string, fullText: string): boolean {
    return /^(accept trade|accept)\b/.test(command) || /\baccept trade\b/.test(fullText);
}

export function isSmallTalkIntent(command: string, fullText: string): boolean {
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

export function latestDialogueEvent(perception: HybridPerception): { options?: unknown[] } | undefined {
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

export function latestTradeRequest(perception: HybridPerception): Actor | undefined {
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

export function latestAddressedChat(
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

export function isSelfActor(actor: Actor, perception: HybridPerception): boolean {
    return actor.kind === 'resident' && Boolean(perception.resident?.id) && actor.id === perception.resident?.id;
}

export function findActorByName(actors: Actor[], query: string): Actor | undefined {
    const wanted = normalizeText(cleanTarget(query));
    return actors.find(actor => actorMatchesName(actor, wanted));
}

export function actorMatchesName(actor: Actor, query: string): boolean {
    const wanted = normalizeText(cleanTarget(query));
    const names = [actor.name, actor.key, actor.id].filter((value): value is string => Boolean(value)).map(normalizeText);
    return names.some(name => name.includes(wanted) || wanted.includes(name));
}

export function safeTradeOfferSlot(inventory: Array<Item | null>, query?: string): number | undefined {
    if (query) {
        return findSlot(inventory, item => !isEssentialTool(item) && itemMatchesQuery(item, query));
    }

    return (
        findSlot(inventory, item => !isEssentialTool(item) && (isFiremakingLog(item) || isBones(item))) ??
        findSlot(inventory, item => !isEssentialTool(item) && FOOD_KEY_PATTERN.test(item.key || '')) ??
        findSlot(inventory, item => !isEssentialTool(item))
    );
}

export function isEssentialTool(item: Item): boolean {
    return isTinderbox(item) || isSmallFishingNet(item) || ESSENTIAL_TOOL_KEY_PATTERN.test(item.key || '');
}

export function findWorldItem(items: WorldItem[], query: string): WorldItem | undefined {
    return items.find(item => itemMatchesQuery(item, query));
}

export function itemMatchesQuery(item: Item | null, query: string): boolean {
    if (!item) {
        return false;
    }
    const wanted = normalizeText(query);
    const labels = [itemLabel(item), item.key || '', String(item.itemId)].map(normalizeText);
    return labels.some(label => label.includes(wanted) || wanted.includes(label));
}

export function describeSurroundings(perception: HybridPerception): string {
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

export function describeInventory(perception: HybridPerception): string {
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

export function actorName(actor: Actor): string {
    return actor.name || actor.key || displayName(actor.id);
}

export function isFishingSpot(actor: Actor): boolean {
    return actor.kind === 'npc' && (actor.key === 'fishing_spot' || actor.name === 'Fishing spot');
}

export function extractStructuredChatReply(text: string | undefined): string | undefined {
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

export function structuredReplyValue(value: unknown): string | undefined {
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

export function looksLikeStructuredEcho(text: string): boolean {
    const sample = text.trim().slice(0, 180);
    return sample.startsWith('{') || sample.startsWith('[') || /"memories"\s*:/.test(sample) || /"archetype"\s*:/.test(sample);
}

export function memoryRecallFallback(memories: string[]): string | undefined {
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
    return `I remember ${parts.join(', and ')}.`;
}

export function helpSpeech(): string {
    return 'Try: follow me, status, look around, inventory, make fire, fish, cook, fight safely, bury bones, trade me, offer logs, wait, stop.';
}

export function isMidTradeWithAcceptedOffer(perception: HybridPerception): boolean {
    const trade = perception.resident?.activeTrade;
    if (!trade) {
        return false;
    }
    return trade.ourStage === 'accepted_1' || trade.ourStage === 'accepted_2';
}

export function tradeRequestOrApproach(perception: HybridPerception, target: Actor | undefined, cause: string): AgentAction | undefined {
    const here = perception.resident?.position;
    if (!target || target.kind === 'npc') {
        return undefined;
    }
    if (here && distance(here, target.position) > 1) {
        return { kind: 'move_to', target: target.position, range: 1, cause };
    }
    return { kind: 'trade_request', target, cause };
}

export function tradeAcceptAction(trade: ActiveTrade | undefined): AgentAction | undefined {
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
