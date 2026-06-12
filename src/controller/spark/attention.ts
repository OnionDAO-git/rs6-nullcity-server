import type { DecayCurve } from '../soul/soul-schema';

export interface AttentionProfile {
    startingAttention: number;
    decayCurve: DecayCurve;
    /**
     * Optional lower bound for hero/anchor residents that must stay
     * "alive" through the IRL event without manual top-up. When provided,
     * `spendAttention` / `spendForAction` / `spendForLlm` clamp the
     * result to `Math.max(floor, computed)` so the resident's attention
     * never decays below this value from normal play.
     *
     * Filed in E30 / HD-008. Heroes were observed decaying from 5000 → 0
     * in <2 hours under live load (E29/F29a — Hans, Duke, Pip, Thrand
     * all died between 19:11-19:52 UTC). A floor of e.g. 5000 means
     * patron offers + idle decay still feel meaningful (attention rises
     * above the floor on engagement) but the resident never "dies from
     * being busy" — Chicago heroes can stay on-post for the full event.
     *
     * Excessive attention damage (death-from-damage etc.) is unaffected
     * because that path uses `markDeceased` in runtime-state directly,
     * not these accrual spend functions.
     */
    floor?: number;
    /**
     * Survivable-weekend capacity: optional upper bound on the attention
     * bar. Support credits (patron top-ups, AP grants) clamp to this
     * value instead of stacking without bound. Absent = uncapped
     * (historical behavior). The per-soul value wins over the
     * `economy.maxAttention` config default — see
     * {@link resolveAttentionCapacity}.
     */
    maxAttention?: number;
}

/**
 * Survivable-weekend decay schedule (config block
 * `economy.attentionDecaySchedule` in controller.yml). Scales the
 * per-tick idle decay by local time of day in `timezone`:
 *
 * - night (nightStartHour..nightEndHour, wraps midnight): ×nightMultiplier
 * - evening (eveningStartHour..nightStartHour): ×eveningMultiplier
 * - weekend (Sat/Sun, all day): min(weekendMultiplier, time-of-day multiplier)
 * - weekday daytime: ×1.0 (full rate)
 *
 * All fields are optional; missing fields use the documented defaults
 * below. An absent block means multiplier 1.0 everywhere — exactly
 * today's behavior. The goal: a resident with a full bar at Friday
 * doors survives, idle, to Monday morning (see controller.yml runway
 * math).
 */
export interface AttentionDecayScheduleConfig {
    timezone?: string;
    weekendMultiplier?: number;
    eveningMultiplier?: number;
    nightMultiplier?: number;
    eveningStartHour?: number;
    nightStartHour?: number;
    nightEndHour?: number;
}

/**
 * Attention-economy defaults threaded from `controller.yml` `economy:`
 * into the runtimes (mirrors the relevant slice of
 * `ControllerConfig['economy']`).
 */
export interface AttentionEconomyConfig {
    attentionDecaySchedule?: AttentionDecayScheduleConfig;
    /** Config-level default attention capacity (per-soul maxAttention wins). */
    maxAttention?: number;
    /** Config-level default starting attention (per-soul startingAttention wins). */
    startingAttention?: number;
    /**
     * Fraction of a no-floor resident's attention capacity below which the
     * attention-plea reflex fires (real-mortality lead time). Defaults to
     * {@link DEFAULT_ATTENTION_PLEA_THRESHOLD_FRACTION}. Values outside
     * (0, 1] are ignored. When no capacity resolves at all, the plea falls
     * back to {@link FALLBACK_ATTENTION_PLEA_THRESHOLD} absolute AP.
     */
    attentionPleaThresholdFraction?: number;
}

const DEFAULT_SCHEDULE_TIMEZONE = 'America/Chicago';
const DEFAULT_WEEKEND_MULTIPLIER = 0.5;
const DEFAULT_EVENING_MULTIPLIER = 0.5;
const DEFAULT_NIGHT_MULTIPLIER = 0.25;
const DEFAULT_EVENING_START_HOUR = 18;
const DEFAULT_NIGHT_START_HOUR = 22;
const DEFAULT_NIGHT_END_HOUR = 8;

// Intl.DateTimeFormat construction is expensive and this runs on every
// tick for every resident — cache one formatter per timezone.
const scheduleFormatterCache = new Map<string, Intl.DateTimeFormat | null>();

function scheduleFormatter(timezone: string): Intl.DateTimeFormat | null {
    const cached = scheduleFormatterCache.get(timezone);
    if (cached !== undefined) {
        return cached;
    }
    let formatter: Intl.DateTimeFormat | null = null;
    try {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'short',
            hour: 'numeric',
            hourCycle: 'h23',
        });
    } catch {
        // Invalid timezone — fail open (multiplier 1.0) rather than
        // killing the tick loop over a config typo.
        formatter = null;
    }
    scheduleFormatterCache.set(timezone, formatter);
    return formatter;
}

function readMultiplier(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readScheduleHour(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback;
}

/**
 * Pure: resolves the decay-schedule multiplier for the wall-clock
 * instant `atMs` (epoch milliseconds). Callers must pass time in from
 * an injected clock — do NOT call Date.now() here — so tests control
 * "now". Absent schedule, or any failure to resolve local time, yields
 * 1.0 (today's behavior).
 */
export function decayScheduleMultiplier(schedule: AttentionDecayScheduleConfig | undefined, atMs: number): number {
    if (!schedule || !Number.isFinite(atMs)) {
        return 1;
    }
    const formatter = scheduleFormatter(schedule.timezone || DEFAULT_SCHEDULE_TIMEZONE);
    if (!formatter) {
        return 1;
    }
    let weekday = '';
    let hour = Number.NaN;
    for (const part of formatter.formatToParts(new Date(atMs))) {
        if (part.type === 'weekday') {
            weekday = part.value;
        } else if (part.type === 'hour') {
            hour = Number(part.value);
        }
    }
    if (!weekday || !Number.isFinite(hour)) {
        return 1;
    }

    const eveningStart = readScheduleHour(schedule.eveningStartHour, DEFAULT_EVENING_START_HOUR);
    const nightStart = readScheduleHour(schedule.nightStartHour, DEFAULT_NIGHT_START_HOUR);
    const nightEnd = readScheduleHour(schedule.nightEndHour, DEFAULT_NIGHT_END_HOUR);

    const isNight =
        nightStart > nightEnd
            ? hour >= nightStart || hour < nightEnd // window wraps midnight (e.g. 22:00-08:00)
            : hour >= nightStart && hour < nightEnd;
    const timeOfDay = isNight
        ? readMultiplier(schedule.nightMultiplier, DEFAULT_NIGHT_MULTIPLIER)
        : hour >= eveningStart
          ? readMultiplier(schedule.eveningMultiplier, DEFAULT_EVENING_MULTIPLIER)
          : 1;

    const isWeekend = weekday === 'Sat' || weekday === 'Sun';
    return isWeekend ? Math.min(readMultiplier(schedule.weekendMultiplier, DEFAULT_WEEKEND_MULTIPLIER), timeOfDay) : timeOfDay;
}

/**
 * Resolves the attention-bar capacity: per-soul
 * `attentionProfile.maxAttention` wins, then the config default
 * (`economy.maxAttention`), then undefined = uncapped (historical
 * behavior). Non-finite / non-positive values are ignored.
 */
export function resolveAttentionCapacity(profile?: Partial<AttentionProfile>, configDefault?: number): number | undefined {
    const soulMax = profile?.maxAttention;
    if (typeof soulMax === 'number' && Number.isFinite(soulMax) && soulMax > 0) {
        return soulMax;
    }
    if (typeof configDefault === 'number' && Number.isFinite(configDefault) && configDefault > 0) {
        return configDefault;
    }
    return undefined;
}

/** Default fraction of capacity below which the attention plea fires (15%). */
export const DEFAULT_ATTENTION_PLEA_THRESHOLD_FRACTION = 0.15;
/**
 * Absolute plea threshold for residents with no resolvable capacity
 * (legacy configs without `economy.maxAttention` or a per-soul
 * `attentionProfile.maxAttention`). With real mortality and floors gone,
 * the historical last-second threshold of 10 AP (~seconds of decay) gave
 * patrons no time to respond — 2000 AP is roughly half a starter bar.
 */
export const FALLBACK_ATTENTION_PLEA_THRESHOLD = 2000;

/**
 * Capacity-aware attention-plea threshold for residents WITHOUT a declared
 * attention floor: a fraction (`economy.attentionPleaThresholdFraction`,
 * default 15%) of the resolved capacity (per-soul `maxAttention` wins over
 * the `economy.maxAttention` config default). Falls back to
 * {@link FALLBACK_ATTENTION_PLEA_THRESHOLD} when no capacity resolves.
 * Floor-protected residents keep their own floor+buffer band and never
 * consult this helper.
 */
export function attentionPleaThreshold(profile?: Partial<AttentionProfile>, economy?: AttentionEconomyConfig): number {
    const capacity = resolveAttentionCapacity(profile, economy?.maxAttention);
    if (capacity === undefined) {
        return FALLBACK_ATTENTION_PLEA_THRESHOLD;
    }
    const fraction = economy?.attentionPleaThresholdFraction;
    const safeFraction =
        typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0 && fraction <= 1
            ? fraction
            : DEFAULT_ATTENTION_PLEA_THRESHOLD_FRACTION;
    return capacity * safeFraction;
}

export type AttentionLedgerEventKind = 'grant' | 'spend' | 'decay' | 'top_up' | 'fade';

export interface AttentionLedgerEvent {
    kind: AttentionLedgerEventKind;
    amount?: number;
}

export interface AttentionLedgerReplayStep {
    kind: AttentionLedgerEventKind;
    amount: number;
    before: number;
    after: number;
}

export interface AttentionLedgerReplay {
    currentAttention: number;
    faded: boolean;
    steps: AttentionLedgerReplayStep[];
}

const decayByCurve: Record<DecayCurve, number> = {
    gentle: 0.5,
    standard: 1,
    steep: 2,
};

export function initialAttention(profile?: Partial<AttentionProfile>, economy?: AttentionEconomyConfig): number {
    const starting = profile?.startingAttention || economy?.startingAttention || 5000;
    const capacity = resolveAttentionCapacity(profile, economy?.maxAttention);
    return capacity !== undefined ? Math.min(starting, capacity) : starting;
}

function clampToFloor(value: number, floor: number | undefined): number {
    const floorValue = typeof floor === 'number' && Number.isFinite(floor) && floor >= 0 ? floor : 0;
    return Math.max(floorValue, value);
}

export function spendAttention(current: number, curve: DecayCurve = 'standard', multiplier = 1, floor?: number): number {
    return clampToFloor(current - decayByCurve[curve] * multiplier, floor);
}

const actionSpend: Record<string, number> = {
    noop: 0,
    say: 0.5,
    whisper: 0.5,
    move_to: 1,
    face: 0.25,
    interact: 1,
    attack: 2,
    cast_spell: 3,
    equip: 0.5,
    unequip: 0.5,
    drop: 0.5,
    eat: 0.75,
    dialogue_continue: 0.5,
    dialogue_choice: 0.75,
    trade_request: 1,
    trade_offer_item: 1,
    trade_remove_item: 0.75,
    trade_accept_stage_1: 1,
    trade_accept_stage_2: 1,
    trade_decline: 0.5,
    logout: 0,
};

const llmSpend = {
    complete: 5,
    nooped: 1,
    aborted: 2,
    failed: 2,
};

export function spendForAction(current: number, actionKind: string, floor?: number): number {
    return clampToFloor(current - (actionSpend[actionKind] ?? 1), floor);
}

export function spendForLlm(current: number, outcome: keyof typeof llmSpend, floor?: number): number {
    return clampToFloor(current - llmSpend[outcome], floor);
}

function normalizeAmount(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

/**
 * Replays AP lifecycle events into a deterministic attention balance.
 * This is a pure helper used by tests and replay/reporting layers.
 */
export function replayAttentionLedger(startingAttention: number, events: AttentionLedgerEvent[]): AttentionLedgerReplay {
    let currentAttention = clampToFloor(startingAttention, 0);
    let faded = currentAttention <= 0;
    const steps: AttentionLedgerReplayStep[] = [];

    for (const event of events) {
        const amount = normalizeAmount(event.amount);
        const before = currentAttention;
        switch (event.kind) {
            case 'grant':
            case 'top_up':
                currentAttention = before + amount;
                faded = currentAttention <= 0;
                break;
            case 'spend':
            case 'decay':
                currentAttention = clampToFloor(before - amount, 0);
                faded = currentAttention <= 0;
                break;
            case 'fade':
                currentAttention = 0;
                faded = true;
                break;
            default:
                break;
        }
        steps.push({
            kind: event.kind,
            amount,
            before,
            after: currentAttention,
        });
    }

    return { currentAttention, faded, steps };
}
