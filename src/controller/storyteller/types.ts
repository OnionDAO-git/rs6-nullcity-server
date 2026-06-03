import { z } from 'zod';

// ---------------------------------------------------------------------------
// Economy vocabulary (S0a alignment)
// AP = Attention Points — the Null City ledger balance that sustains residents.
// GP = real RuneScape gold, coin item 995 — NOT a second Null City ledger.
// ---------------------------------------------------------------------------

/** Importance tier for sorting digest events, highest first. */
export type ImportanceTier =
    | 'critical' // resident faded/died, lost all AP
    | 'high' // AP-for-GP exchange, GP earned, soul born, NCRI minted/redeemed
    | 'medium' // low AP alert, goal completed, stuck-then-recovered
    | 'low' // patron gift, Library writeback, routine activity
    | 'minimal'; // quiet resident, no notable events

/** A single notable event inside a digest window, referencing source evidence. */
export interface DigestEvent {
    /** Unique ref within the digest — used by verifier to check eventRefsUsed. */
    ref: string;
    kind:
        | 'ap_granted'
        | 'ap_low'
        | 'ap_zero'
        | 'resident_faded'
        | 'soul_born'
        | 'gp_observed'
        | 'gp_earned'
        | 'ap_for_gp_exchange'
        | 'ncri_created'
        | 'ncri_redeemed'
        | 'goal_completed'
        | 'stuck_recovered'
        | 'library_writeback'
        | 'patron_gift'
        | 'quiet_resident';
    residentName: string;
    ts: string;
    /** Human-readable note for the operator summary. */
    note: string;
    importance: ImportanceTier;
    /** Raw evidence payload from the source event (AP ledger entry, GP observation, etc.). */
    evidence?: Record<string, unknown>;
}

/** Snapshot of a single resident's state at the time the digest was built. */
export interface ResidentSnapshot {
    residentName: string;
    attention: number;
    /** true when attention is below the configured low-AP threshold */
    isLowAp: boolean;
    /** true when the resident has been marked deceased / faded */
    isFaded: boolean;
    /** GP balance observed from RuneScape game state (coin item 995). null = not yet observed. */
    gpObserved: number | null;
    /** Resident's current Soul goal text, if available. */
    goalText?: string;
    /** Most recent say event text from the Library timeline within the recent-speech window (max 140 chars). */
    recentSpeech?: string;
}

/**
 * CityEventDigest — the bounded evidence packet the Storyteller (and verifier)
 * consume. Built deterministically from Library timelines + runtime snapshots.
 * No model calls happen at digest-build time.
 */
export interface CityEventDigest {
    schemaVersion: 1;
    digestId: string;
    windowStart: string;
    windowEnd: string;
    builtAt: string;
    /** AP ledger events (Attention Points — Null City currency). Kept separate from GP evidence. */
    apEvents: DigestEvent[];
    /** RuneScape GP evidence events (real coin item 995). Never mixed with AP balance entries. */
    gpEvents: DigestEvent[];
    /** AP-for-GP exchange events — must reference both an AP event and a GP event. */
    exchangeEvents: DigestEvent[];
    /** NCRI (Null City RuneScape Item) lifecycle events. */
    ncriEvents: DigestEvent[];
    /** Bounded binary goal/quest completion events. */
    goalEvents: DigestEvent[];
    /** Stuck-and-recovered pathing/behavior events. */
    stuckEvents: DigestEvent[];
    /** Catch-all for patron gifts, Library writebacks, and quiet residents. */
    miscEvents: DigestEvent[];
    /** All events merged and sorted by importance (highest first), capped at maxResidentMentions. */
    topEvents: DigestEvent[];
    /** Resident snapshots at digest time, capped at maxResidentMentions. */
    residents: ResidentSnapshot[];
    /** System health summary. */
    systemHealth: {
        totalResidents: number;
        activeResidents: number;
        fadedResidents: number;
        lowApResidents: number;
    };
}

export const cityEventDigestSchema = z.object({
    schemaVersion: z.literal(1),
    digestId: z.string().min(1),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    builtAt: z.string().datetime(),
    apEvents: z.array(
        z
            .object({
                ref: z.string(),
                kind: z.string(),
                residentName: z.string(),
                ts: z.string(),
                note: z.string(),
                importance: z.string(),
            })
            .passthrough(),
    ),
    gpEvents: z.array(
        z
            .object({
                ref: z.string(),
                kind: z.string(),
                residentName: z.string(),
                ts: z.string(),
                note: z.string(),
                importance: z.string(),
            })
            .passthrough(),
    ),
    exchangeEvents: z.array(
        z
            .object({
                ref: z.string(),
                kind: z.string(),
                residentName: z.string(),
                ts: z.string(),
                note: z.string(),
                importance: z.string(),
            })
            .passthrough(),
    ),
    ncriEvents: z.array(
        z
            .object({
                ref: z.string(),
                kind: z.string(),
                residentName: z.string(),
                ts: z.string(),
                note: z.string(),
                importance: z.string(),
            })
            .passthrough(),
    ),
    goalEvents: z.array(
        z
            .object({
                ref: z.string(),
                kind: z.string(),
                residentName: z.string(),
                ts: z.string(),
                note: z.string(),
                importance: z.string(),
            })
            .passthrough(),
    ),
    stuckEvents: z.array(
        z
            .object({
                ref: z.string(),
                kind: z.string(),
                residentName: z.string(),
                ts: z.string(),
                note: z.string(),
                importance: z.string(),
            })
            .passthrough(),
    ),
    miscEvents: z.array(
        z
            .object({
                ref: z.string(),
                kind: z.string(),
                residentName: z.string(),
                ts: z.string(),
                note: z.string(),
                importance: z.string(),
            })
            .passthrough(),
    ),
    topEvents: z.array(
        z
            .object({
                ref: z.string(),
                kind: z.string(),
                residentName: z.string(),
                ts: z.string(),
                note: z.string(),
                importance: z.string(),
            })
            .passthrough(),
    ),
    residents: z.array(
        z
            .object({
                residentName: z.string(),
                attention: z.number(),
                isLowAp: z.boolean(),
                isFaded: z.boolean(),
                gpObserved: z.number().nullable(),
            })
            .passthrough(),
    ),
    systemHealth: z.object({
        totalResidents: z.number().int().nonnegative(),
        activeResidents: z.number().int().nonnegative(),
        fadedResidents: z.number().int().nonnegative(),
        lowApResidents: z.number().int().nonnegative(),
    }),
});

/**
 * StorytellerDispatch — the model-generated public-canon output.
 * eventRefsUsed must only reference refs that exist in the source CityEventDigest.
 */
export interface StorytellerDispatch {
    schemaVersion: 1;
    dispatchId: string;
    digestId: string;
    generatedAt: string;
    modelProfile: string;
    latencyMs: number;
    /** Estimated cost in USD; null when unavailable (local/free models). */
    estimatedCostUsd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    publicTitle: string;
    publicBody: string;
    publicBullets: string[];
    operatorSummary: string;
    operatorWarnings: string[];
    /** References into CityEventDigest.{apEvents,gpEvents,...}[].ref used to generate this dispatch. */
    eventRefsUsed: string[];
    /** Set by the verifier when a claim could not be confirmed from the digest. */
    needsReview: boolean;
    reviewReasons?: string[];
}

export const storytellerDispatchSchema = z.object({
    schemaVersion: z.literal(1),
    dispatchId: z.string().min(1),
    digestId: z.string().min(1),
    generatedAt: z.string().datetime(),
    modelProfile: z.string().min(1),
    latencyMs: z.number().nonnegative(),
    estimatedCostUsd: z.number().nullable(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    publicTitle: z.string().min(1),
    publicBody: z.string().min(1),
    publicBullets: z.array(z.string()),
    operatorSummary: z.string().min(1),
    operatorWarnings: z.array(z.string()),
    eventRefsUsed: z.array(z.string()),
    needsReview: z.boolean(),
    reviewReasons: z.array(z.string()).optional(),
});

export type ProjectorNarrationSource = 'verified_dispatch' | 'deterministic_fallback';

export type ProjectorFreshnessStatus = 'fresh' | 'stale' | 'unknown';

export type ProjectorHealthStatus = 'ok' | 'degraded' | 'stale';

export interface ProjectorStoryFrameEvent {
    ref: string;
    label: string;
    residentName: string;
    happenedAt: string;
    importance: ImportanceTier;
    note: string;
    whyItMatters: string;
}

export interface ProjectorStoryFrameResident {
    residentName: string;
    displayName: string;
    attention: number;
    status: 'active' | 'low_attention' | 'faded';
    gpObserved: number | null;
    goal?: string;
    /** Most recent public speech from the Library timeline (sanitized, max 140 chars). */
    latestSpeechSummary?: string;
}

export interface ProjectorStoryFrameAction {
    kind: 'grant_attention' | 'watch_resident' | 'operator_check' | 'witness';
    label: string;
    detail: string;
    residentName?: string;
}

export interface ProjectorStoryFrame {
    ok: true;
    schemaVersion: 1;
    frameId: string;
    digestId: string;
    generatedAt: string;
    source: {
        digestId: string;
        digestBuiltAt?: string;
        windowStart?: string;
        windowEnd?: string;
        freshnessMs: number | null;
        freshnessStatus: ProjectorFreshnessStatus;
        dispatchId?: string;
        dispatchGeneratedAt?: string;
        modelProfile?: string;
        excludedDispatchId?: string;
        excludedDispatchReason?: string;
    };
    narration: {
        source: ProjectorNarrationSource;
        title: string;
        body: string;
        bullets: string[];
    };
    leadEvent: ProjectorStoryFrameEvent | null;
    events: ProjectorStoryFrameEvent[];
    residents: ProjectorStoryFrameResident[];
    actions: ProjectorStoryFrameAction[];
    watchNext: string[];
    omitted: {
        events: number;
        residents: number;
    };
    publicHealth: {
        status: ProjectorHealthStatus;
        totalResidents: number;
        activeResidents: number;
        fadedResidents: number;
        lowApResidents: number;
        warnings: string[];
    };
}

export const projectorStoryFrameSchema = z
    .object({
        ok: z.literal(true),
        schemaVersion: z.literal(1),
        frameId: z.string().min(1),
        digestId: z.string().min(1),
        generatedAt: z.string().datetime(),
        source: z
            .object({
                digestId: z.string().min(1),
                digestBuiltAt: z.string().optional(),
                windowStart: z.string().optional(),
                windowEnd: z.string().optional(),
                freshnessMs: z.number().nullable(),
                freshnessStatus: z.enum(['fresh', 'stale', 'unknown']),
                dispatchId: z.string().optional(),
                dispatchGeneratedAt: z.string().optional(),
                modelProfile: z.string().optional(),
                excludedDispatchId: z.string().optional(),
                excludedDispatchReason: z.string().optional(),
            })
            .strict(),
        narration: z
            .object({
                source: z.enum(['verified_dispatch', 'deterministic_fallback']),
                title: z.string().min(1),
                body: z.string().min(1),
                bullets: z.array(z.string()),
            })
            .strict(),
        leadEvent: z
            .object({
                ref: z.string(),
                label: z.string(),
                residentName: z.string(),
                happenedAt: z.string(),
                importance: z.string(),
                note: z.string(),
                whyItMatters: z.string(),
            })
            .passthrough()
            .nullable(),
        events: z.array(z.unknown()),
        residents: z.array(z.unknown()),
        actions: z.array(z.unknown()),
        watchNext: z.array(z.string()),
        omitted: z.object({ events: z.number().int().nonnegative(), residents: z.number().int().nonnegative() }).strict(),
        publicHealth: z
            .object({
                status: z.enum(['ok', 'degraded', 'stale']),
                totalResidents: z.number().int().nonnegative(),
                activeResidents: z.number().int().nonnegative(),
                fadedResidents: z.number().int().nonnegative(),
                lowApResidents: z.number().int().nonnegative(),
                warnings: z.array(z.string()),
            })
            .strict(),
    })
    .passthrough();

/** Configuration for the Storyteller subsystem. */
export interface StorytellerConfig {
    /** Master switch — false by default until cost caps exist. */
    enabled: boolean;
    /** How often to run the Storyteller in milliseconds (default 10 min). */
    cadenceMs: number;
    /** Maximum event window to read, in milliseconds (default 10 min). */
    maxDigestWindowMs: number;
    /** Maximum number of resident snapshots and top events in one digest. */
    maxResidentMentions: number;
    /** Maximum word count for publicBody in generated dispatches. */
    maxPublicBodyWords: number;
    /** Model profile id to use for Storyteller runs. */
    modelProfile: string;
}

export const DEFAULT_STORYTELLER_CONFIG: StorytellerConfig = {
    enabled: false,
    cadenceMs: 10 * 60 * 1000,
    maxDigestWindowMs: 10 * 60 * 1000,
    maxResidentMentions: 8,
    maxPublicBodyWords: 180,
    modelProfile: 'default',
};

/** Numeric weight for each importance tier (higher = shown first). */
export const IMPORTANCE_WEIGHT: Record<ImportanceTier, number> = {
    critical: 100,
    high: 75,
    medium: 50,
    low: 25,
    minimal: 0,
};
