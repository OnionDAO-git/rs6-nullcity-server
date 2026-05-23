import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { readNervousRulesMd } from './rules-md';
import { type NervousReaction, type NervousRule, clampNervousRulePriority, evaluateNervousRules } from './rules';
import { PatronRegistry } from '../patron/patron-registry';

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
        const lowHealthFood = lowHealthFoodSlot(perception);
        if (lowHealthFood !== undefined) {
            return {
                rule: LOW_HEALTH_RULE,
                action: { kind: 'eat', slot: lowHealthFood, cause: `nervous:${LOW_HEALTH_RULE.id}` },
                suppressThinking: true,
                interruptThinking: true,
            };
        }

        if (this.options.patronRegistry && Array.isArray(perception.events)) {
            for (const event of perception.events) {
                if (event.kind === 'chat' && typeof event.text === 'string' && event.from && typeof event.from === 'object') {
                    const fromName = 'name' in event.from && typeof event.from.name === 'string' ? event.from.name : undefined;
                    if (fromName) {
                        const patronKind = this.options.patronRegistry.getKind(fromName);
                        if (patronKind) {
                            const cooldownKey = `patron-thank:${fromName.toLowerCase()}`;
                            const tick = typeof perception.tick === 'number' ? perception.tick : this.options.state.tick;
                            const coolingUntil = this.options.state.hookCooldowns?.[cooldownKey] || 0;
                            if (coolingUntil <= tick) {
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

        const memoryDir = this.options.memory.ensureResident(this.options.soul.frontmatter.name);
        return evaluateNervousRules(this.rules(memoryDir), this.options.state, perception, this.options.state.variables || {});
    }

    private rules(memoryDir: string): NervousRule[] {
        return [...this.soulRules(), ...readNervousRulesMd(memoryDir).rules];
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

function isFoodItem(value: unknown): value is Item {
    if (!isRecord(value)) {
        return false;
    }

    return typeof value.key === 'string' && FOOD_KEY_PATTERN.test(value.key);
}
