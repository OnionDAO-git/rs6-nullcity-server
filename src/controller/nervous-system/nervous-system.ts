import type { MemoryStore } from '../memory/memory-store';
import type { ActiveGoalState, RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { readNervousRulesMd } from './rules-md';
import { type NervousReaction, type NervousRule, clampNervousRulePriority, evaluateNervousRules } from './rules';
import { PatronRegistry } from '../patron/patron-registry';
import { STARTER_GP_HARVEST_GOAL_ID, starterGpHarvestGoal } from '../spark/runescape-brain-planner';
import { RUNESCAPE_STANDARD_SPARK_MODULE_ID } from '../spark/standard-module-metadata';
import {
    SELF_INITIATED_EXCHANGE_MIN_GP,
    gpInInventory,
    heroSurplusGpExchangeAction,
    selfInitiatedApGpExchangeAction,
} from '../spark/self-initiated-ap-gp-exchange';

export interface NervousSystemOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    patronRegistry?: PatronRegistry;
}

type Item = { itemId?: number; key?: string; amount?: number };

const LOW_HEALTH_FOOD_THRESHOLD = 0.4;
const FOOD_KEY_PATTERN =
    /(food|shrimp|anchovies|sardine|herring|trout|salmon|tuna|lobster|bass|swordfish|monkfish|shark|manta|karambwan|bread|cake|meat|chicken)/i;
const RAW_FOOD_KEY_PATTERN = /(^|[:_-])raw([:_-]|$)/i;
const BURNT_FOOD_KEY_PATTERN = /burnt.*(shrimp|fish|anchov|meat|food)|(shrimp|fish|anchov|meat|food).*burnt/i;
const STARTER_RAW_FISH_ITEM_IDS: ReadonlySet<number> = new Set([317, 321]);
const STARTER_BURNT_FISH_ITEM_IDS: ReadonlySet<number> = new Set([7954, 323]);

/** Ticks between attention-appeal says (~10 minutes at 1 tick/s). */
const REQUEST_ATTENTION_COOLDOWN_TICKS = 600;
/** Buffer above the declared attention floor at which the appeal fires. */
const LOW_ATTENTION_REQUEST_BUFFER = 5000;
/** Residents without an attention floor still need one last AP appeal before fading. */
const CRITICAL_ATTENTION_REQUEST_THRESHOLD = 10;
/** Rotating phrases for the low-attention appeal (index = tick % length). */
const APPEAL_PHRASES = [
    'My AP grows thin. If you have Attention Points to spare, even a small offering helps.',
    'I can feel my AP fading. An offering at the embassy would keep me here a while longer.',
    "I won't last at this pace. If anyone has earned AP today, I'd welcome the support.",
] as const;

/** Attention buffer above floor within which the "final testament" fires (once per life). */
const PREPARE_EPITAPH_ATTENTION_BUFFER = 200;
/** Cooldown that effectively makes prepare_epitaph a once-per-life event. */
const PREPARE_EPITAPH_COOLDOWN_TICKS = 99999;
/** Rotating final-testament phrases — verbatim voice for the Library. */
const FINAL_TESTAMENT_PHRASES = [
    'My time here grows short. Whatever comes next, I gave this world what I had.',
    'If these are my last hours, I want it known — I was here, and I cared.',
    'I may not last much longer. Let the record show: I stood my ground.',
] as const;
const ATTENTION_TOPUP_ACK_COOLDOWN_TICKS = 20;
const RESTART_COOLDOWN_COMPAT_WINDOW_TICKS = 1_000;
const SELF_INITIATED_AP_GP_EXCHANGE_COOLDOWN_TICKS = 120;
const STARTER_GP_HARVEST_COOLDOWN_TICKS = 120;

const LOW_HEALTH_RULE: NervousRule = {
    id: 'eat-when-low-health',
    priority: 100,
    condition: { kind: 'always' },
    action: { kind: 'noop' },
    cooldownTicks: 2,
    source: 'system',
};

export class NervousSystem {
    constructor(private readonly options: NervousSystemOptions) {}

    react(perception: Perception): NervousReaction | undefined {
        this.clearInexecutableStarterGpHarvestGoal();

        const lowHealthFood = lowHealthFoodSlot(perception);
        if (lowHealthFood !== undefined) {
            return {
                rule: LOW_HEALTH_RULE,
                action: { kind: 'eat', slot: lowHealthFood, cause: `nervous:${LOW_HEALTH_RULE.id}` },
                suppressThinking: true,
                interruptThinking: true,
            };
        }

        const patronAsk = this.patronAskReaction(perception);
        if (patronAsk) {
            return patronAsk;
        }

        const attentionTopUp = this.attentionTopUpReaction(perception);
        if (attentionTopUp) {
            return attentionTopUp;
        }

        if (this.options.patronRegistry && Array.isArray(perception.events)) {
            for (const event of perception.events) {
                if (event.kind === 'chat' && typeof event.text === 'string' && event.from && typeof event.from === 'object') {
                    const fromName = 'name' in event.from && typeof event.from.name === 'string' ? event.from.name : undefined;
                    if (fromName) {
                        const patronKind = this.options.patronRegistry.getKind(fromName);
                        if (patronKind) {
                            const cooldownKey = `patron-thank:${fromName.toLowerCase()}`;
                            const tick = cooldownTick(this.options.state, perception);
                            const coolingUntil = this.options.state.hookCooldowns?.[cooldownKey] || 0;
                            if (!isCooldownActive(coolingUntil, tick, this.options.state.tick)) {
                                this.options.state.hookCooldowns = this.options.state.hookCooldowns || {};
                                this.options.state.hookCooldowns[cooldownKey] = tick + 30;

                                let message = `Thank you for the support, ${fromName}!`;
                                if (patronKind === 'patron_sponsor') {
                                    message = `Thank you for sponsoring us, ${fromName}!`;
                                } else if (patronKind === 'patron_gift') {
                                    message = `Thank you for the gift, ${fromName}!`;
                                } else if (patronKind === 'patron_witness') {
                                    message = `Thank you for witnessing this, ${fromName}!`;
                                }

                                const rule: NervousRule = {
                                    id: `patron-acknowledge-${fromName.toLowerCase()}`,
                                    priority: 95,
                                    condition: { kind: 'always' },
                                    action: { kind: 'say', text: message },
                                    source: 'system',
                                };

                                return {
                                    rule,
                                    action: { kind: 'say', text: message, cause: `nervous:patron-acknowledge` },
                                    suppressThinking: true,
                                    interruptThinking: true,
                                };
                            }
                        }
                    }
                }
            }
        }

        const patronMemoryReaction = this.patronMemoryReaction(perception);
        if (patronMemoryReaction) {
            return patronMemoryReaction;
        }

        const memoryDir = this.options.memory.ensureResident(this.options.soul.frontmatter.name);
        const soulReaction = evaluateNervousRules(
            this.rules(memoryDir),
            this.options.state,
            perception,
            this.options.state.variables || {},
        );
        if (soulReaction) {
            return soulReaction;
        }

        const selfInitiatedApGpExchange = this.selfInitiatedApGpExchangeReaction(perception);
        if (selfInitiatedApGpExchange) {
            return selfInitiatedApGpExchange;
        }

        const epitaphReaction = this.prepareEpitaphReaction(perception);
        if (epitaphReaction) {
            return epitaphReaction;
        }

        const starterGpHarvest = this.starterGpHarvestReaction(perception);
        if (starterGpHarvest) {
            return starterGpHarvest;
        }

        return this.requestAttentionReaction(perception);
    }

    private attentionTopUpReaction(perception: Perception): NervousReaction | undefined {
        if (!Array.isArray(perception.events)) {
            return undefined;
        }
        const topUpEvent = perception.events.find(event => event.kind === 'attention_topup');
        if (!topUpEvent || this.options.state.attention <= 0) {
            return undefined;
        }

        const tick = cooldownTick(this.options.state, perception);
        const cooldownKey = 'attention-topup:resume-ack';
        const coolingUntil = this.options.state.hookCooldowns?.[cooldownKey] || 0;
        if (isCooldownActive(coolingUntil, tick, this.options.state.tick)) {
            return undefined;
        }

        this.options.state.hookCooldowns = this.options.state.hookCooldowns || {};
        this.options.state.hookCooldowns[cooldownKey] = tick + ATTENTION_TOPUP_ACK_COOLDOWN_TICKS;

        const amount = typeof topUpEvent.amount === 'number' ? Math.max(0, Math.trunc(topUpEvent.amount)) : undefined;
        const amountText = amount ? ` ${amount} AP` : ' AP';
        const message = `AP received:${amountText}. I am back on my feet and resuming my work.`;
        const rule: NervousRule = {
            id: 'attention-topup-resume',
            priority: 93,
            condition: { kind: 'always' },
            action: { kind: 'say', text: message },
            source: 'system',
        };

        return {
            rule,
            action: { kind: 'say', text: message, cause: 'nervous:attention-topup-resume' },
            suppressThinking: false,
            interruptThinking: false,
        };
    }

    private patronAskReaction(perception: Perception): NervousReaction | undefined {
        if (!Array.isArray(perception.events)) {
            return undefined;
        }

        const tick = cooldownTick(this.options.state, perception);
        for (const event of perception.events) {
            if (event.kind !== 'chat' || event.source !== 'patron:ask' || !event.from || typeof event.from !== 'object') {
                continue;
            }
            const fromName = 'name' in event.from && typeof event.from.name === 'string' ? event.from.name : undefined;
            if (!fromName) {
                continue;
            }

            const cooldownKey = `patron-ask-acknowledge:${fromName.toLowerCase()}`;
            const coolingUntil = this.options.state.hookCooldowns?.[cooldownKey] || 0;
            if (isCooldownActive(coolingUntil, tick, this.options.state.tick)) {
                continue;
            }

            this.options.state.hookCooldowns = this.options.state.hookCooldowns || {};
            this.options.state.hookCooldowns[cooldownKey] = tick + 10;
            const message = `I heard you, ${fromName}. I will answer what I can while I keep moving.`;
            const rule: NervousRule = {
                id: `patron-ask-acknowledge-${stableKey(fromName)}`,
                priority: 94,
                condition: { kind: 'always' },
                action: { kind: 'say', text: message },
                source: 'system',
            };

            return {
                rule,
                action: { kind: 'say', text: message, cause: 'nervous:patron-ask-acknowledge' },
                suppressThinking: true,
                interruptThinking: true,
            };
        }

        return undefined;
    }

    private patronMemoryReaction(perception: Perception): NervousReaction | undefined {
        const tick = cooldownTick(this.options.state, perception);
        const coolingUntil = this.options.state.hookCooldowns?.['patron-memory-acknowledge:any'] || 0;
        if (isCooldownActive(coolingUntil, tick, this.options.state.tick)) {
            return undefined;
        }
        const scanCoolingUntil = this.options.state.hookCooldowns?.['patron-memory-acknowledge:scan'] || 0;
        if (isCooldownActive(scanCoolingUntil, tick, this.options.state.tick)) {
            return undefined;
        }

        let memories: string[];
        try {
            memories = this.options.memory.retrieve(this.options.soul.frontmatter.name, 'patron gift AP support witness sponsor', 6);
        } catch {
            this.options.state.hookCooldowns = this.options.state.hookCooldowns || {};
            this.options.state.hookCooldowns['patron-memory-acknowledge:scan'] = tick + 10;
            return undefined;
        }

        const candidates: Array<{ patron: PatronMemory; ackKey: string }> = [];
        for (const memory of memories) {
            const patron = parsePatronMemory(memory);
            if (!patron) {
                continue;
            }

            const ackKey = `patron-memory-acknowledge:${stableKey(memory)}`;
            const ackCoolingUntil = this.options.state.hookCooldowns?.[ackKey] || 0;
            if (isCooldownActive(ackCoolingUntil, tick, this.options.state.tick)) {
                continue;
            }

            candidates.push({ patron, ackKey });
        }

        const latest = candidates[candidates.length - 1];
        if (latest) {
            this.options.state.hookCooldowns = this.options.state.hookCooldowns || {};
            for (const candidate of candidates) {
                this.options.state.hookCooldowns[candidate.ackKey] = Number.MAX_SAFE_INTEGER;
            }
            this.options.state.hookCooldowns['patron-memory-acknowledge:any'] = tick + 30;

            const message = patronThanksMessage(latest.patron, candidates.length > 1);
            const rule: NervousRule = {
                id: `patron-memory-acknowledge-${stableKey(latest.patron.handle)}`,
                priority: 90,
                condition: { kind: 'always' },
                action: { kind: 'say', text: message },
                source: 'system',
            };

            return {
                rule,
                action: { kind: 'say', text: message, cause: 'nervous:patron-memory-acknowledge' },
                suppressThinking: true,
                interruptThinking: true,
            };
        }

        this.options.state.hookCooldowns = this.options.state.hookCooldowns || {};
        this.options.state.hookCooldowns['patron-memory-acknowledge:scan'] = tick + 10;
        return undefined;
    }

    private rules(memoryDir: string): NervousRule[] {
        return [...this.soulRules(), ...readNervousRulesMd(memoryDir).rules];
    }

    private selfInitiatedApGpExchangeReaction(perception: Perception): NervousReaction | undefined {
        const tick = cooldownTick(this.options.state, perception);
        const cooldownKey = 'self-initiated-ap-gp-exchange';
        const coolingUntil = this.options.state.hookCooldowns?.[cooldownKey] ?? 0;
        if (isCooldownActive(coolingUntil, tick, this.options.state.tick)) {
            return undefined;
        }

        const exchangeInput = {
            attention: this.options.state.attention,
            attentionFloor: this.options.soul.frontmatter.attentionProfile?.floor ?? 0,
            perception,
            idempotencyKey: `self-ap-gp:${this.options.soul.frontmatter.name}:${tick}`,
        };
        const action = selfInitiatedApGpExchangeAction(exchangeInput) ?? heroSurplusGpExchangeAction(exchangeInput);
        if (!action) {
            return undefined;
        }

        this.options.state.hookCooldowns = this.options.state.hookCooldowns ?? {};
        this.options.state.hookCooldowns[cooldownKey] = tick + SELF_INITIATED_AP_GP_EXCHANGE_COOLDOWN_TICKS;

        const rule: NervousRule = {
            id: 'self-initiated-ap-gp-exchange',
            priority: 86,
            condition: { kind: 'always' },
            action: { kind: 'noop' },
            cooldownTicks: SELF_INITIATED_AP_GP_EXCHANGE_COOLDOWN_TICKS,
            source: 'system',
        };

        return {
            rule,
            action,
            suppressThinking: true,
            interruptThinking: true,
        };
    }

    private prepareEpitaphReaction(perception: Perception): NervousReaction | undefined {
        const floor = this.options.soul.frontmatter.attentionProfile?.floor ?? 0;
        if (floor <= 0) {
            return undefined;
        }
        const attention = this.options.state.attention;
        const threshold = floor + PREPARE_EPITAPH_ATTENTION_BUFFER;
        // Only fires in the narrow band [floor, floor+buffer). The floor clamp
        // prevents attention from going below floor in production, so attention<floor
        // is a test-only scenario that belongs to requestAttentionReaction instead.
        if (attention <= 0 || attention < floor || attention >= threshold) {
            return undefined;
        }
        const tick = cooldownTick(this.options.state, perception);
        const cooldownKey = 'prepare-epitaph:written';
        const coolingUntil = this.options.state.hookCooldowns?.[cooldownKey] ?? 0;
        if (isCooldownActive(coolingUntil, tick, this.options.state.tick, PREPARE_EPITAPH_COOLDOWN_TICKS)) {
            return undefined;
        }

        this.options.state.hookCooldowns = this.options.state.hookCooldowns ?? {};
        this.options.state.hookCooldowns[cooldownKey] = tick + PREPARE_EPITAPH_COOLDOWN_TICKS;

        const basePhrase = FINAL_TESTAMENT_PHRASES[tick % FINAL_TESTAMENT_PHRASES.length];
        const publicName = this.options.soul.frontmatter.heroProfile?.publicName;
        const message = publicName ? `${publicName}: ${basePhrase}` : basePhrase;

        const residentName = this.options.soul.frontmatter.name;
        try {
            this.options.memory.write(residentName, 'prepared-epitaph.txt', `${message}\n`, 'replace');
        } catch {
            // Non-fatal: say still fires even if the memory write fails.
        }

        const rule: NervousRule = {
            id: 'prepare-epitaph-testament',
            priority: 88,
            condition: { kind: 'always' },
            action: { kind: 'say', text: message },
            source: 'system',
        };

        return {
            rule,
            action: { kind: 'say', text: message, cause: 'nervous:prepare-epitaph' },
            suppressThinking: false,
            interruptThinking: false,
        };
    }

    private starterGpHarvestReaction(perception: Perception): NervousReaction | undefined {
        if (!this.shouldSeekStarterGpHarvest(perception)) {
            return undefined;
        }

        const tick = cooldownTick(this.options.state, perception);
        const existingGoal = this.options.state.cognition?.activeGoal;
        if (existingGoal?.id === STARTER_GP_HARVEST_GOAL_ID && !goalExpired(existingGoal, tick)) {
            return undefined;
        }

        const cooldownKey = 'starter-gp-harvest';
        const coolingUntil = this.options.state.hookCooldowns?.[cooldownKey] ?? 0;
        if (isCooldownActive(coolingUntil, tick, this.options.state.tick)) {
            return undefined;
        }

        this.options.state.hookCooldowns = this.options.state.hookCooldowns ?? {};
        this.options.state.hookCooldowns[cooldownKey] = tick + STARTER_GP_HARVEST_COOLDOWN_TICKS;

        this.options.state.cognition = this.options.state.cognition ?? {};
        this.options.state.cognition.activeGoal = starterGpHarvestGoal(tick);
        this.options.state.cognition.lastGoalShareTick = undefined;

        const rule: NervousRule = {
            id: 'starter-gp-harvest',
            priority: 84,
            condition: { kind: 'always' },
            action: { kind: 'noop' },
            cooldownTicks: STARTER_GP_HARVEST_COOLDOWN_TICKS,
            source: 'system',
        };

        return {
            rule,
            action: { kind: 'noop', cause: 'nervous:starter-gp-harvest' },
            suppressThinking: false,
            interruptThinking: false,
        };
    }

    private shouldSeekStarterGpHarvest(perception: Perception): boolean {
        if (!this.canExecuteStarterGpHarvestGoal()) {
            return false;
        }

        const floor = this.options.soul.frontmatter.attentionProfile?.floor ?? 0;
        const attention = this.options.state.attention;
        if (!Number.isFinite(attention) || attention <= 0) {
            return false;
        }

        const withinLowAttentionBand =
            floor > 0
                ? attention >= floor && attention < floor + LOW_ATTENTION_REQUEST_BUFFER
                : attention <= CRITICAL_ATTENTION_REQUEST_THRESHOLD;
        if (!withinLowAttentionBand) {
            return false;
        }

        if (gpInInventory(perception) >= SELF_INITIATED_EXCHANGE_MIN_GP) {
            return false;
        }

        return !isLowHealth(perception);
    }

    private canExecuteStarterGpHarvestGoal(): boolean {
        if (this.options.soul.frontmatter.behavior?.kind === 'hybrid-agent') {
            return true;
        }

        return (
            this.options.soul.frontmatter.modules?.some(
                module => module.id === RUNESCAPE_STANDARD_SPARK_MODULE_ID && module.enabled !== false,
            ) ?? false
        );
    }

    private clearInexecutableStarterGpHarvestGoal(): void {
        const goal = this.options.state.cognition?.activeGoal;
        if (goal?.id !== STARTER_GP_HARVEST_GOAL_ID || this.canExecuteStarterGpHarvestGoal()) {
            return;
        }

        this.options.state.cognition = { ...this.options.state.cognition, activeGoal: undefined };
        this.options.state.cognition.lastGoalShareTick = undefined;
    }

    private requestAttentionReaction(perception: Perception): NervousReaction | undefined {
        if (this.canExecuteStarterGpHarvestGoal() && this.hasActiveStarterGpHarvestGoal(perception) && !isLowHealth(perception)) {
            return undefined;
        }

        const floor = this.options.soul.frontmatter.attentionProfile?.floor ?? 0;
        const threshold = floor > 0 ? floor + LOW_ATTENTION_REQUEST_BUFFER : CRITICAL_ATTENTION_REQUEST_THRESHOLD;
        const attention = this.options.state.attention;
        const shouldAppeal = floor > 0 ? attention < threshold : attention <= threshold;
        if (attention <= 0 || !shouldAppeal) {
            return undefined;
        }
        const tick = cooldownTick(this.options.state, perception);
        const cooldownKey = 'request-attention:appeal';
        const coolingUntil = this.options.state.hookCooldowns?.[cooldownKey] ?? 0;
        if (isCooldownActive(coolingUntil, tick, this.options.state.tick)) {
            return undefined;
        }

        this.options.state.hookCooldowns = this.options.state.hookCooldowns ?? {};
        this.options.state.hookCooldowns[cooldownKey] = tick + REQUEST_ATTENTION_COOLDOWN_TICKS;

        const basePhrase = APPEAL_PHRASES[tick % APPEAL_PHRASES.length];
        const publicName = this.options.soul.frontmatter.heroProfile?.publicName;
        const message = publicName ? `${publicName}: ${basePhrase}` : basePhrase;

        const rule: NervousRule = {
            id: 'request-attention-appeal',
            priority: 85,
            condition: { kind: 'always' },
            action: { kind: 'say', text: message },
            source: 'system',
        };

        return {
            rule,
            action: { kind: 'say', text: message, cause: 'nervous:request-attention' },
            suppressThinking: true,
            interruptThinking: false,
        };
    }

    private hasActiveStarterGpHarvestGoal(perception: Perception): boolean {
        const goal = this.options.state.cognition?.activeGoal;
        if (goal?.id !== STARTER_GP_HARVEST_GOAL_ID) {
            return false;
        }

        return !goalExpired(goal, cooldownTick(this.options.state, perception));
    }

    private soulRules(): NervousRule[] {
        const rules = this.options.soul.frontmatter.nervousSystem;
        if (!Array.isArray(rules)) {
            return [];
        }

        return rules.flatMap(rule => {
            if (!isRecord(rule) || typeof rule.id !== 'string' || typeof rule.priority !== 'number' || !isRecord(rule.condition)) {
                return [];
            }
            return [clampNervousRulePriority({ ...(rule as NervousRule), source: 'soul' }, 80)];
        });
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lowHealthFoodSlot(perception: Perception): number | undefined {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const hp = isRecord(resident.hp) ? resident.hp : {};
    const current = Number(hp.current);
    const max = Number(hp.max);
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0 || current / max > LOW_HEALTH_FOOD_THRESHOLD) {
        return undefined;
    }

    const inventory = Array.isArray(resident.inventory) ? resident.inventory : [];
    const slot = inventory.findIndex(item => isFoodItem(item));
    return slot >= 0 ? slot : undefined;
}

function isLowHealth(perception: Perception): boolean {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const hp = isRecord(resident.hp) ? resident.hp : {};
    const current = Number(hp.current);
    const max = Number(hp.max);
    return Number.isFinite(current) && Number.isFinite(max) && max > 0 && current / max <= LOW_HEALTH_FOOD_THRESHOLD;
}

function goalExpired(goal: ActiveGoalState, tick: number): boolean {
    return goal.ttlTicks !== undefined && tick - goal.createdAtTick > goal.ttlTicks;
}

function isFoodItem(value: unknown): value is Item {
    if (!isRecord(value)) {
        return false;
    }

    const key = typeof value.key === 'string' ? value.key : '';
    const itemId = typeof value.itemId === 'number' ? value.itemId : undefined;
    return (
        FOOD_KEY_PATTERN.test(key) &&
        !RAW_FOOD_KEY_PATTERN.test(key) &&
        !BURNT_FOOD_KEY_PATTERN.test(key) &&
        !isStarterRawFish(itemId, key) &&
        !isStarterBurntFish(itemId)
    );
}

function isStarterRawFish(itemId: number | undefined, key: string): boolean {
    return (itemId !== undefined && STARTER_RAW_FISH_ITEM_IDS.has(itemId)) || /^rs:raw_(shrimp|anchovies)$/i.test(key);
}

function isStarterBurntFish(itemId: number | undefined): boolean {
    return itemId !== undefined && STARTER_BURNT_FISH_ITEM_IDS.has(itemId);
}

type PatronMemory = { kind: 'gift' | 'witness' | 'sponsor'; handle: string; detail?: string };

function parsePatronMemory(memory: string): PatronMemory | undefined {
    const gift = memory.match(/patron gift from\s+([^:]+):\s*([^()]+)/i);
    if (gift) {
        return { kind: 'gift', handle: gift[1].trim(), detail: gift[2].trim() };
    }

    const witness = memory.match(/patron witnessed\s+\(([^)]+)\)/i);
    if (witness) {
        return { kind: 'witness', handle: witness[1].trim() };
    }

    const sponsor = memory.match(/patron sponsor:\s*([^()]+)/i);
    if (sponsor) {
        return { kind: 'sponsor', handle: sponsor[1].trim() };
    }

    return undefined;
}

function patronThanksMessage(patron: PatronMemory, backlog = false): string {
    const suffix = backlog ? ', and everyone backing me!' : '!';
    if (patron.kind === 'sponsor') {
        return `Thank you for sponsoring us, ${patron.handle}${suffix}`;
    }
    if (patron.kind === 'witness') {
        return `Thank you for witnessing this, ${patron.handle}${suffix}`;
    }
    if (patron.detail && /\b(?:shards?|AP)\b/i.test(patron.detail)) {
        return `Thank you for the AP, ${patron.handle}${suffix}`;
    }
    return `Thank you for the support, ${patron.handle}${suffix}`;
}

function stableKey(value: string): string {
    return (
        value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || 'unknown'
    );
}

function cooldownTick(state: RuntimeState, perception: Perception): number {
    return typeof perception.tick === 'number' ? perception.tick : state.tick;
}

function isCooldownActive(
    coolingUntil: number,
    tick: number,
    stateTick: number,
    maxActiveCooldownTicks = RESTART_COOLDOWN_COMPAT_WINDOW_TICKS,
): boolean {
    if (coolingUntil <= tick) {
        return false;
    }

    // After a controller restart, world/perception ticks can start from a
    // smaller session-local value while persisted hook cooldowns still carry
    // the prior runtime tick domain. A cooldown close to the new perception
    // tick is active-domain and should still hold; a cooldown far ahead of
    // the new tick but close to the restored state tick is old-domain drift
    // and should expire. Number.MAX_SAFE_INTEGER one-shot acknowledgements
    // remain active because they are far beyond the restored state tick.
    if (tick < stateTick && coolingUntil <= stateTick + RESTART_COOLDOWN_COMPAT_WINDOW_TICKS) {
        return coolingUntil <= tick + maxActiveCooldownTicks;
    }

    return true;
}
