import { LibraryUpdater } from '../evidence';
import { type RuntimeState, RuntimeStateStore } from '../memory/runtime-state';
import { SoulLoader } from '../soul/soul-loader';
import type { RespawnPolicy, Soul } from '../soul/soul-schema';
import { initialAttention } from '../spark/attention';
import { endurerTargetTicks } from '../spark/legacy';

export interface ReviveResidentOptions {
    residentName: string;
    soulsDir: string;
    memoryDir: string;
    attention?: number;
    force?: boolean;
    now?: () => Date;
}

export interface ReviveResidentResult {
    residentName: string;
    revived: boolean;
    reason: 'revived' | 'already_living' | 'repaired_legacy' | 'blocked_non_attention_death' | 'blocked_respawn_policy';
    previousDeceasedCause?: string;
    respawnPolicy?: RespawnPolicy;
    attentionBefore: number;
    attentionAfter: number;
    tick: number;
}

export function reviveResident(options: ReviveResidentOptions): ReviveResidentResult {
    const residentName = normalizeResidentName(options.residentName);
    const loader = new SoulLoader(options.soulsDir);
    const soul = loader.load(residentName);
    const stateStore = new RuntimeStateStore(options.memoryDir);
    const startingAttention = initialAttention(soul.frontmatter.attentionProfile);
    const state = stateStore.load(residentName, startingAttention, soul.frontmatter.archetype ?? 'default');
    const attentionBefore = state.attention;
    const previousDeceasedCause = state.deceased?.cause;
    const respawnPolicy = soul.frontmatter.respawnPolicy ?? 'manual';

    if (!state.deceased) {
        if (options.force && reopenExtendedEndurerLegacy(soul, state)) {
            stateStore.save(state);
            return {
                residentName,
                revived: false,
                reason: 'repaired_legacy',
                respawnPolicy,
                attentionBefore,
                attentionAfter: state.attention,
                tick: state.tick,
            };
        }
        return {
            residentName,
            revived: false,
            reason: 'already_living',
            respawnPolicy,
            attentionBefore,
            attentionAfter: state.attention,
            tick: state.tick,
        };
    }

    if (respawnPolicy !== 'manual' && !options.force) {
        return {
            residentName,
            revived: false,
            reason: 'blocked_respawn_policy',
            previousDeceasedCause,
            respawnPolicy,
            attentionBefore,
            attentionAfter: state.attention,
            tick: state.tick,
        };
    }

    if (state.deceased.cause !== 'attention_exhausted' && !options.force) {
        return {
            residentName,
            revived: false,
            reason: 'blocked_non_attention_death',
            previousDeceasedCause,
            respawnPolicy,
            attentionBefore,
            attentionAfter: state.attention,
            tick: state.tick,
        };
    }

    const targetAttention = options.attention ?? startingAttention;
    if (!Number.isFinite(targetAttention) || targetAttention <= 0) {
        throw new Error('attention must be a positive number when provided');
    }

    delete state.deceased;
    state.stuckSince = undefined;
    if (state.cognition?.activeMove) {
        state.cognition.activeMove = undefined;
    }
    state.attention = Math.max(state.attention, targetAttention);
    reopenExtendedEndurerLegacy(soul, state);
    stateStore.save(state);

    new LibraryUpdater(residentName, options.memoryDir, { now: options.now }).observeRevival({
        ts: (options.now ?? (() => new Date()))().toISOString(),
        tick: state.tick,
        cause: options.force ? 'operator_force_revive' : 'operator_revive_attention_exhausted',
    });

    return {
        residentName,
        revived: true,
        reason: 'revived',
        previousDeceasedCause,
        respawnPolicy,
        attentionBefore,
        attentionAfter: state.attention,
        tick: state.tick,
    };
}

function reopenExtendedEndurerLegacy(soul: Soul, state: RuntimeState): boolean {
    if (state.legacy.kind !== 'endurer' || !state.legacy.complete) {
        return false;
    }

    const target = endurerTargetTicks(soul);
    const ticksLived = Number(state.legacy.progress.ticksLived || 0);
    if (!Number.isFinite(ticksLived) || ticksLived >= target) {
        return false;
    }

    state.legacy.complete = false;
    state.legacy.progress.targetTicksLived = target;
    state.legacy.progress.ratio = target <= 0 ? 1 : Math.min(1, Math.max(0, ticksLived / target));
    return true;
}

export function normalizeResidentName(residentName: string): string {
    return residentName.startsWith('res:') ? residentName : `res:${residentName}`;
}
