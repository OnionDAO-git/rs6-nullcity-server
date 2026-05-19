import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { readNervousRulesMd } from './rules-md';
import { type NervousReaction, type NervousRule, clampNervousRulePriority, evaluateNervousRules } from './rules';

export interface NervousSystemOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
}

export class NervousSystem {
    constructor(private readonly options: NervousSystemOptions) {}

    react(perception: Perception): NervousReaction | undefined {
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
