import { z } from 'zod';
import { type StandingTier, isUserFacingTier } from './standing-ledger';

// ---------------------------------------------------------------------------
// Tick-to-human-time helper
// ---------------------------------------------------------------------------

// At the RuneJS tick rate of ~0.6 s/tick:
//   100 ticks ≈ 1 minute, 6 000 ticks ≈ 1 hour, 144 000 ticks ≈ 1 day.
const TICKS_PER_MINUTE = 100; // Math.round(60 / 0.6)
const TICKS_PER_HOUR = 6_000; // Math.round(3600 / 0.6)
const TICKS_PER_DAY = 144_000; // Math.round(86400 / 0.6)

/**
 * Convert a raw tick count into a human-readable duration string suitable for
 * letters and public-facing pages (e.g. "12 minutes", "2 hours", "30 days").
 */
export function ticksToHumanTime(ticks: number): string {
    if (ticks < TICKS_PER_MINUTE * 2) return 'a few minutes';
    const minutes = Math.round(ticks / TICKS_PER_MINUTE);
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.round(ticks / TICKS_PER_HOUR);
    if (hours < 24) return hours === 1 ? 'about an hour' : `${hours} hours`;
    const days = Math.round(ticks / TICKS_PER_DAY);
    return days === 1 ? 'about a day' : `${days} days`;
}

/**
 * A letter dispatched to a human after a standing-tier crossing, a resident
 * death (J-δ-β, TODO), or a civic milestone (J-δ-γ, TODO).
 *
 * Per the OnionDAO Notion + the patron-loop spec, letters are the
 * human-visible counterpart to the resident-visible portrait timeline.
 * Standing crossings, resident deaths, and civic achievements all surface
 * here.
 */
export interface Letter {
    /** Discriminator. */
    kind: 'standing_tier_crossed' | 'epitaph' | 'civic_milestone' | 'broadcast' | 'attention_plea';
    /** humanId (badge handle, e.g. 'alice@onion'). */
    recipient: string;
    /**
     * The resident the letter is from. Today this is the resident the human
     * supported. J-δ-3 (hero death) will sometimes set this to a SIBLING
     * resident in the same faction so a deceased hero's death-letter
     * arrives "from" a flagship who survived.
     */
    senderResident: string;
    /** Short subject line for web inbox + scroll envelope. */
    subject: string;
    /** Full prose body. No LLM yet — templated. */
    body: string;
    /** ISO timestamp of dispatch. Usually the support's ts. */
    dispatchedAt: string;
    /**
     * Where this letter should be delivered. The dispatcher (later slice)
     * fans out across channels.
     */
    deliveryChannels: Array<'web-inbox' | 'in-game-scroll' | 'lanyard-card'>;
}

export const letterSchema = z.object({
    kind: z.enum(['standing_tier_crossed', 'epitaph', 'civic_milestone', 'broadcast', 'attention_plea']),
    recipient: z.string().min(1),
    senderResident: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    dispatchedAt: z.string().min(1),
    deliveryChannels: z.array(z.enum(['web-inbox', 'in-game-scroll', 'lanyard-card'])).min(1),
});

/** Input for {@link produceStandingTierLetter}. */
export interface StandingTierLetterInput {
    humanId: string;
    faction: string;
    residentName: string;
    /** The tier the human's standing crossed into. */
    tierCrossed: StandingTier;
    /** The support amount in Shards that produced this crossing. */
    amount: number;
    /** ISO timestamp from the supporting ledger entry. */
    ts: string;
}

/**
 * Generate a standing-tier-crossing letter, or `null` if the "crossing" was
 * into the `stranger` sentinel (which has no user-facing copy per
 * `isUserFacingTier`).
 *
 * Pure function; no I/O. The dispatcher slice (J-δ-β / J-δ-γ) handles
 * delivery + persistence.
 */
export function produceStandingTierLetter(input: StandingTierLetterInput): Letter | null {
    if (!isUserFacingTier(input.tierCrossed)) {
        return null;
    }

    // isUserFacingTier eliminates 'stranger'; narrow for the body renderer.
    const tier = input.tierCrossed as Exclude<StandingTier, 'stranger'>;
    const tierLabel = capitalize(tier);
    const subject = `You are now ${tierLabel} of ${input.faction}`;
    const body = renderTierBody({
        tier,
        humanId: input.humanId,
        faction: input.faction,
        residentName: input.residentName,
        amount: input.amount,
    });

    return {
        kind: 'standing_tier_crossed',
        recipient: input.humanId,
        senderResident: input.residentName,
        subject,
        body,
        dispatchedAt: input.ts,
        deliveryChannels: ['web-inbox'],
    };
}

interface TierBodyContext {
    tier: 'acquaintance' | 'ally' | 'officer';
    humanId: string;
    faction: string;
    residentName: string;
    amount: number;
}

function renderTierBody(ctx: TierBodyContext): string {
    switch (ctx.tier) {
        case 'acquaintance':
            return [
                `${ctx.humanId},`,
                '',
                `Your support of ${ctx.residentName} reached the embassy. The clerks of ${ctx.faction} have noted your name; you are now known to us as an Acquaintance.`,
                '',
                `Your most recent offering of ${ctx.amount} Shard${ctx.amount === 1 ? '' : 's'} brought you here. A small grace, and an honest one. Welcome.`,
                '',
                '— Embassy Clerk',
            ].join('\n');
        case 'ally':
            return [
                `${ctx.humanId},`,
                '',
                `You are now an Ally of ${ctx.faction}. ${ctx.residentName} remembers you in a way only steady patronage earns.`,
                '',
                `Your support of ${ctx.amount} Shard${ctx.amount === 1 ? '' : 's'} carried you past acquaintance. Allies receive the city's small favors: priority routing for letters, a hand when stuck, a name spoken back when asked.`,
                '',
                '— Embassy Clerk',
            ].join('\n');
        case 'officer':
            return [
                `${ctx.humanId},`,
                '',
                `${ctx.faction} names you Officer. This is the highest standing in our register, and it is not given lightly.`,
                '',
                `Your support of ${ctx.amount} Shard${ctx.amount === 1 ? '' : 's'} brought you across the last threshold. Officers shape what ${ctx.residentName} and their siblings can attempt — your voice carries with theirs now, in matters of city, faction, and quiet hour.`,
                '',
                '— Embassy Clerk',
            ].join('\n');
    }
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// J-δ-γ: epitaph + civic milestone letter producers.
//
// These travel through the same Letter shape + dispatcher (J-δ-β-2) so the
// inbox + scroll + lanyard delivery channels already work end-to-end. The
// runtime hooks that CALL these producers — legacy_event → epitaph cascade
// (J-δ-2) and milestone detectors — are separate slices.
// ---------------------------------------------------------------------------

/** Input for {@link produceEpitaphLetter}. */
export interface EpitaphLetterInput {
    /** humanId of the patron receiving the death notice. */
    humanId: string;
    /** Faction the deceased resident served. */
    faction: string;
    /** Name of the deceased resident. */
    residentName: string;
    /** Archetype label (mentor / achiever / endurer). Used in body framing. */
    residentArchetype: string;
    /** Total ticks lived. */
    livedTicks: number;
    /** Highest skill at time of death, if any. */
    bestSkill?: { name: string; level: number };
    /** Short cause-of-death string, or omitted to mean "circumstances unrecorded". */
    causeOfDeath?: string;
    /** ISO timestamp of dispatch (usually the death tick). */
    ts: string;
    /**
     * Optional sibling-flagship override (J-δ-3 hero death: a surviving
     * flagship in the same faction speaks for the deceased). Defaults to
     * the deceased {@link residentName} themselves when omitted (the
     * resident "speaks" via their own legacy_event echo, addressed to
     * their patron).
     */
    senderResident?: string;
    /**
     * The resident's own prepared epitaph text (M4), written near death
     * via `nervous:prepare-epitaph`. When present, appended verbatim to
     * the letter body as "In their own words:" — voice preservation rule.
     */
    preparedEpitaph?: string;
}

/**
 * Generate an epitaph letter for a deceased resident's patron. Pure
 * function; no I/O. The dispatcher (J-δ-β) routes the returned Letter
 * via web-inbox, in-game-scroll, and the IRL lanyard-card channel —
 * epitaphs travel widely because they are the moment a human's emotional
 * relationship to the city is built.
 */
export function produceEpitaphLetter(input: EpitaphLetterInput): Letter {
    const sender = input.senderResident && input.senderResident.length > 0 ? input.senderResident : input.residentName;
    const subject = `On the passing of ${input.residentName}`;
    const body = renderEpitaphBody(input);
    return {
        kind: 'epitaph',
        recipient: input.humanId,
        senderResident: sender,
        subject,
        body,
        dispatchedAt: input.ts,
        deliveryChannels: ['web-inbox', 'in-game-scroll', 'lanyard-card'],
    };
}

function renderEpitaphBody(input: EpitaphLetterInput): string {
    const skillLine =
        input.bestSkill && input.bestSkill.name.length > 0
            ? `Their hands were best at ${input.bestSkill.name}; they reached level ${input.bestSkill.level} before the end.`
            : 'They left no single craft as their mark — their hands tried many small things.';
    const causeLine =
        input.causeOfDeath && input.causeOfDeath.length > 0
            ? `The cause was ${input.causeOfDeath}.`
            : 'The circumstances are unrecorded; the city saw them last as a quiet outline at dusk.';
    const lines = [
        `${input.humanId},`,
        '',
        `${input.residentName} has died.`,
        '',
        `They served ${input.faction} for ${ticksToHumanTime(input.livedTicks)} — a life measured in the small currency of attention rather than the large one of years.`,
        '',
        skillLine,
        causeLine,
        '',
        `Your patronage stayed with them through it. That mattered, in a way the registers don't quite know how to write down. We are writing it down here.`,
    ];
    if (input.preparedEpitaph && input.preparedEpitaph.trim().length > 0) {
        lines.push('');
        lines.push(`In their own words: "${input.preparedEpitaph.trim()}"`);
    }
    lines.push('');
    lines.push('— Embassy Clerk');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------

/** Kinds of civic milestone an achievement letter can announce. */
export type CivicAchievementKind = 'first_quest_completed' | 'firemaking_level_25' | 'faction_oath' | 'embassy_visit';

/** Input for {@link produceCivicAchievementLetter}. */
export interface CivicAchievementLetterInput {
    humanId: string;
    faction: string;
    residentName: string;
    achievementKind: CivicAchievementKind;
    /** Free-form one-line detail (quest name, skill milestone description, etc.). */
    achievementDetail: string;
    ts: string;
    /** Optional sender override; defaults to {@link residentName}. */
    senderResident?: string;
}

/**
 * Generate a civic milestone letter — quest completion, skill milestone,
 * faction oath, embassy visit, etc. Lighter than an epitaph: web-inbox
 * + lanyard-card only (no in-game-scroll — the resident is still alive
 * and can tell their own story in-world).
 */
export function produceCivicAchievementLetter(input: CivicAchievementLetterInput): Letter {
    const sender = input.senderResident && input.senderResident.length > 0 ? input.senderResident : input.residentName;
    const headline = headlineForAchievement(input.achievementKind);
    const subject = `${input.residentName}: ${headline}`;
    const body = [
        `${input.humanId},`,
        '',
        `${input.residentName} (${input.faction}) just reached a milestone the city wants you to know about:`,
        '',
        `${headline}. ${input.achievementDetail}`,
        '',
        `Patrons are who residents work for; we record this so your support is visible alongside the act.`,
        '',
        '— Embassy Clerk',
    ].join('\n');
    return {
        kind: 'civic_milestone',
        recipient: input.humanId,
        senderResident: sender,
        subject,
        body,
        dispatchedAt: input.ts,
        deliveryChannels: ['web-inbox', 'lanyard-card'],
    };
}

function headlineForAchievement(kind: CivicAchievementKind): string {
    switch (kind) {
        case 'first_quest_completed':
            return 'First quest completed';
        case 'firemaking_level_25':
            return 'Firemaking reached level 25';
        case 'faction_oath':
            return 'Sworn a faction oath';
        case 'embassy_visit':
            return 'Walked the embassy floor';
    }
}

/** Input for {@link produceBroadcastLetter}. */
export interface BroadcastLetterInput {
    recipient: string;
    residentName: string;
    faction: string;
    livedTicks: number;
    causeOfDeath: string;
    ts: string;
}

/**
 * Generate a broadcast letter notifying all patrons of a resident's death.
 */
export function produceBroadcastLetter(input: BroadcastLetterInput): Letter {
    const subject = `[Broadcast] On the passing of ${input.residentName}`;
    const body = [
        `All Patrons of Null City,`,
        '',
        `The city records the passing of ${input.residentName}, who served ${input.faction}.`,
        '',
        `They walked among us for ${ticksToHumanTime(input.livedTicks)}. The cause: ${input.causeOfDeath}.`,
        '',
        `Their portrait has been sealed in the Library of Souls.`,
        '',
        '— Embassy Clerk',
    ].join('\n');

    return {
        kind: 'broadcast',
        recipient: input.recipient,
        senderResident: input.residentName,
        subject,
        body,
        dispatchedAt: input.ts,
        deliveryChannels: ['web-inbox'],
    };
}

// ---------------------------------------------------------------------------
// N5: Mortician's Ribbon

/** Input for {@link produceMorticiansRibbonLetter}. */
export interface MorticiansRibbonLetterInput {
    /** The patron who witnessed the death. */
    humanId: string;
    /** The resident who died. */
    deceasedResidentName: string;
    /** ISO timestamp of the death. */
    ts: string;
}

/**
 * Generate a Mortician's Ribbon letter — a civic achievement awarded when a
 * patron witnesses a resident's death (threshold N=1 per vision doc).
 *
 * Dispatched alongside the epitaph so every patron who receives an epitaph
 * automatically earns the ribbon. The subject "Mortician's Ribbon — <name>"
 * makes the LettersStore's natural dedup idempotent per-death per-patron.
 */
export function produceMorticiansRibbonLetter(input: MorticiansRibbonLetterInput): Letter {
    const subject = `Mortician's Ribbon — ${input.deceasedResidentName}`;
    const body = [
        `${input.humanId},`,
        '',
        `You were present for the passing of ${input.deceasedResidentName}.`,
        '',
        `In Null City, those who remain long enough to witness a resident die become part of the city's record. The Mortician's Ribbon is a mark of that witness — it stays with you regardless of how many lives pass after.`,
        '',
        `The Embassy Clerk has noted this in your name.`,
        '',
        '— Embassy Clerk',
    ].join('\n');
    return {
        kind: 'civic_milestone',
        recipient: input.humanId,
        senderResident: input.deceasedResidentName,
        subject,
        body,
        dispatchedAt: input.ts,
        deliveryChannels: ['web-inbox', 'lanyard-card'],
    };
}

// ---------------------------------------------------------------------------
// LB-H2R-4p77: Resident attention plea — dispatched to faction supporters
// when the resident is fading (requestAttentionReaction fires).
// ---------------------------------------------------------------------------

/** Input for {@link produceAttentionPleaLetter}. */
export interface AttentionPleaLetterInput {
    /** humanId of the patron receiving the plea. */
    humanId: string;
    /** Name of the fading resident (used as sender voice). */
    residentName: string;
    /** Faction the resident serves. */
    faction: string;
    /** Current AP amount (personalises urgency). */
    currentAp: number;
    /** ISO timestamp of dispatch. */
    ts: string;
}

const PLEA_BODIES: ReadonlyArray<(name: string, humanId: string, faction: string, ap: number) => string> = [
    (name, humanId, faction, ap) =>
        [
            `${humanId},`,
            '',
            `It's ${name}. My attention is running thin — ${ap} left on the ledger — and I'm not sure how long I can hold on.`,
            '',
            `If you have AP to spare, an offering at the embassy for ${faction} would help. Even a small amount keeps me here.`,
            '',
            `— ${name}`,
        ].join('\n'),
    (name, humanId, faction, ap) =>
        [
            `${humanId},`,
            '',
            `${name} here. My AP is down to ${ap} and fading. I wanted to reach out before it gets worse.`,
            '',
            `Your support for ${faction} has meant something to me. If you can spare any attention, now is when it matters.`,
            '',
            `— ${name}`,
        ].join('\n'),
    (name, humanId, faction, ap) =>
        [
            `${humanId},`,
            '',
            `I won't be able to keep going at this rate. ${ap} AP remaining. The city still needs ${faction} around, and I'd like to stay.`,
            '',
            `An embassy offering in my name would make a real difference.`,
            '',
            `— ${name}`,
        ].join('\n'),
];

/**
 * Generate an attention-plea letter from a fading resident to one of their
 * faction's supporters. Pure function; no I/O.
 *
 * The body rotates through {@link PLEA_BODIES} using a hash of the timestamp
 * so simultaneous pleas to different patrons share the same voice (not
 * random), and successive pleas after the cooldown may use a different phrase.
 */
export function produceAttentionPleaLetter(input: AttentionPleaLetterInput): Letter {
    const hashBase = input.ts.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0);
    const idx = Math.abs(hashBase) % PLEA_BODIES.length;
    const body = PLEA_BODIES[idx](input.residentName, input.humanId, input.faction, input.currentAp);
    return {
        kind: 'attention_plea',
        recipient: input.humanId,
        senderResident: input.residentName,
        subject: `${input.residentName} is running low on attention`,
        body,
        dispatchedAt: input.ts,
        deliveryChannels: ['web-inbox'],
    };
}
