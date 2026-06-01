import type { AgentAction } from '../transport/message-codecs';

/**
 * Self-initiated AP-for-GP exchange reflex (packet S-EXCHANGE-INIT-1, issue
 * QA-20260529-011).
 *
 * Closes the social-emergence gap where residents only ever exchanged AP for GP
 * when a *patron* prompted them. This pure helper lets a resident recognise the
 * economically-rational moment on its own: when AP is running low **and** it is
 * already holding real RuneScape GP (coin item 995), it can ask the city to
 * burn some GP for AP without waiting for anyone.
 *
 * This module is intentionally a self-contained pure predicate→action helper
 * (no engine/runtime imports) so it can be unit-tested in isolation and wired
 * into the nervous/reflex evaluation pipeline (`NervousSystem.react`, just
 * before `requestAttentionReaction`) by a small additive change. The wiring
 * seam is documented in the packet HANDOFF; this file ships the decision logic.
 *
 * Rate note: the city service (`CityIntegrationService.exchangeApForGp`) does
 * NOT compute a GP→AP rate — it credits whatever `apAmount` the caller supplies
 * and burns whatever `gpAmount` the caller supplies. The canonical benchmark
 * convention (`autonomous-runtime.ts`: 25 GP → 50 AP) is **2 AP per GP**, which
 * we mirror here via {@link SELF_INITIATED_EXCHANGE_AP_PER_GP}.
 */

/** Coin item id for real RuneScape GP. */
export const COIN_ITEM_ID = 995;

/** Cause tag stamped on the emitted exchange action. */
export const SELF_INITIATED_AP_GP_EXCHANGE_CAUSE = 'nervous:self-initiated-ap-gp-exchange';

/**
 * AP credited per GP burned. The city service does not enforce a rate; this is
 * the convention shared with the AP-for-GP benchmark (25 GP → 50 AP).
 */
export const SELF_INITIATED_EXCHANGE_AP_PER_GP = 2;

/** AP buffer above the declared floor within which the reflex fires. */
export const SELF_INITIATED_EXCHANGE_GP_FLOOR_BUFFER = 20;

/** AP threshold for residents with no declared attention floor. */
export const SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD = 3000;

/** Minimum GP the resident must hold before self-initiating an exchange. */
export const SELF_INITIATED_EXCHANGE_MIN_GP = 10;

/** Target AP runway above the declared floor after a self-initiated exchange. */
export const SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP = 3500;

/** Maximum GP burned in a single self-initiated exchange (keeps rich residents from overspending). */
export const SELF_INITIATED_EXCHANGE_MAX_GP = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericField(record: Record<string, unknown>, key: string, fallback = 0): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Total real GP (coin item 995) the resident currently holds, summed across all
 * matching inventory stacks. A coin entry without an explicit amount counts as a
 * single coin.
 */
export function gpInInventory(perception: unknown): number {
    if (!isRecord(perception)) {
        return 0;
    }
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const inventory = Array.isArray(resident.inventory) ? resident.inventory : [];
    return inventory.reduce<number>((total, entry) => {
        if (!isRecord(entry)) {
            return total;
        }
        if (numericField(entry, 'itemId', -1) !== COIN_ITEM_ID) {
            return total;
        }
        return total + numericField(entry, 'amount', 1);
    }, 0);
}

export interface SelfInitiatedApGpExchangeInput {
    /** Current AP (attention) balance. */
    attention: number;
    /** Declared attention floor from the resident's soul profile (0 if none). */
    attentionFloor: number;
    /** The latest perception, used to read GP from the resident inventory. */
    perception: unknown;
    /** Optional pre-supplied GP total (skips perception inventory read). */
    gpOverride?: number;
    /** Optional idempotency key to make the emitted exchange request replay-safe. */
    idempotencyKey?: string;
}

/**
 * Pure predicate→action helper. Returns a `city_exchange_ap_gp` AgentAction when
 * the resident should self-initiate an AP-for-GP exchange, or `undefined` when
 * the economic conditions are not met.
 *
 * Fires when:
 *  - AP is positive (a faded resident at AP <= 0 cannot act), AND
 *  - AP is below `attentionFloor + SELF_INITIATED_EXCHANGE_GP_FLOOR_BUFFER`
 *    when a floor is declared, or below
 *    `SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD` when no floor exists, AND
 *  - the resident holds at least `SELF_INITIATED_EXCHANGE_MIN_GP` real GP.
 *
 * The emitted action spends enough GP to buy roughly
 * `SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP` above the resident's floor,
 * capped by both inventory and `SELF_INITIATED_EXCHANGE_MAX_GP`, then requests
 * `gpAmount * SELF_INITIATED_EXCHANGE_AP_PER_GP` AP in return.
 */
export function selfInitiatedApGpExchangeAction(input: SelfInitiatedApGpExchangeInput): AgentAction | undefined {
    const { attention, attentionFloor } = input;
    if (!Number.isFinite(attention) || attention <= 0) {
        return undefined;
    }

    const floor = Number.isFinite(attentionFloor) && attentionFloor > 0 ? attentionFloor : 0;
    const threshold = floor > 0 ? floor + SELF_INITIATED_EXCHANGE_GP_FLOOR_BUFFER : SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD;
    if (attention >= threshold) {
        return undefined;
    }

    const gp = input.gpOverride !== undefined ? input.gpOverride : gpInInventory(input.perception);
    if (gp < SELF_INITIATED_EXCHANGE_MIN_GP) {
        return undefined;
    }

    const currentRunway = Math.max(0, attention - floor);
    const neededAp = Math.max(0, SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP - currentRunway);
    const gpNeededForRunway = Math.ceil(neededAp / SELF_INITIATED_EXCHANGE_AP_PER_GP);
    const gpAmount = Math.min(gp, SELF_INITIATED_EXCHANGE_MAX_GP, Math.max(SELF_INITIATED_EXCHANGE_MIN_GP, gpNeededForRunway));
    const apAmount = gpAmount * SELF_INITIATED_EXCHANGE_AP_PER_GP;

    return {
        kind: 'city_exchange_ap_gp',
        cause: SELF_INITIATED_AP_GP_EXCHANGE_CAUSE,
        gpAmount,
        apAmount,
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
    };
}

// ---------------------------------------------------------------------------
// Hero surplus GP → AP exchange (S-AP-CYCLE-2).
//
// Floor-clamped heroes earn real GP via combat but their AP sits comfortably
// above the ordinary exchange threshold (floor + 20). This reflex converts that
// surplus proactively — keeping the AP/GP loop visible in the event log even
// when heroes are financially healthy.
// ---------------------------------------------------------------------------

/** GP reserve a hero keeps after a surplus exchange. */
export const HERO_SURPLUS_GP_RESERVE = 5;

/** Cause tag stamped on hero-surplus exchange actions. */
export const HERO_SURPLUS_EXCHANGE_CAUSE = 'nervous:hero-surplus-gp-exchange';

/**
 * Returns a `city_exchange_ap_gp` AgentAction for floor-clamped residents that
 * have accumulated surplus GP, regardless of current AP level. Fires when:
 *  - AP is positive (faded residents cannot act), AND
 *  - attentionFloor > 0 (floor-clamped hero), AND
 *  - GP held exceeds HERO_SURPLUS_GP_RESERVE + SELF_INITIATED_EXCHANGE_MIN_GP.
 *
 * Spends (gp - HERO_SURPLUS_GP_RESERVE) capped by SELF_INITIATED_EXCHANGE_MAX_GP.
 */
export function heroSurplusGpExchangeAction(input: SelfInitiatedApGpExchangeInput): AgentAction | undefined {
    const { attention, attentionFloor } = input;
    if (!Number.isFinite(attention) || attention <= 0) return undefined;
    const floor = Number.isFinite(attentionFloor) && attentionFloor > 0 ? attentionFloor : 0;
    if (floor <= 0) return undefined;
    const gp = input.gpOverride !== undefined ? input.gpOverride : gpInInventory(input.perception);
    const surplus = gp - HERO_SURPLUS_GP_RESERVE;
    if (surplus < SELF_INITIATED_EXCHANGE_MIN_GP) return undefined;
    const gpAmount = Math.min(surplus, SELF_INITIATED_EXCHANGE_MAX_GP);
    const apAmount = gpAmount * SELF_INITIATED_EXCHANGE_AP_PER_GP;
    return {
        kind: 'city_exchange_ap_gp',
        cause: HERO_SURPLUS_EXCHANGE_CAUSE,
        gpAmount,
        apAmount,
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
    };
}
