import fs from 'fs';
import path from 'path';
import { residentSlug, type RuntimeState } from '../memory/runtime-state';
import { ECONOMY_EVENT_KINDS, type EconomyEvent, type EconomyEventKind } from './economy-event';
import type { SoulProposal, SoulProposalStatus } from './soul-proposals';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const MAX_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_EVENT_LIMIT = 20;
const MAX_EVENT_LIMIT = 200;
const DEFAULT_TOP_RESIDENT_LIMIT = 10;
const MAX_TOP_RESIDENT_LIMIT = 100;

const PENDING_PROPOSAL_STATUSES: SoulProposalStatus[] = ['proposed', 'funding', 'threshold_crossed', 'approved'];
const USER_HANDLE_PATTERN = /\b(?:city-user|user):[A-Za-z0-9._:-]+\b/g;
const AT_HANDLE_PATTERN = /@[A-Za-z]\w{1,30}\b/g;

export interface LiveEconomyQuery {
    since?: string;
    limit?: number;
    residentLimit?: number;
}

export interface LiveEconomyEventSummary {
    id: string;
    ts: string;
    kind: EconomyEventKind;
    residentName?: string;
    cityUserId?: string;
    apDelta?: number;
    gpDelta?: number;
    ncriId?: string;
    refId?: string;
    note?: string;
}

export interface LiveEconomyResidentSummary {
    residentName: string;
    attentionBalance: number;
    gpNetDelta: number;
    eventCount: number;
    windowEventCount: number;
    activeInWindow: boolean;
    online: boolean;
    lastEventTs?: string;
}

export interface LiveEconomyPendingProposalSummary {
    proposalId: string;
    residentName: string;
    goalText: string;
    apFunded: number;
    apThreshold: number;
    status: SoulProposalStatus;
}

export interface LiveEconomyCitySummary {
    residentCount: number;
    activeResidentCount: number;
    attentionTotal: number;
    attentionDelta: number;
    gpNetDelta: number;
}

export interface LiveEconomySnapshot {
    asOf: string;
    window: {
        since: string;
        windowMs: number;
    };
    city: LiveEconomyCitySummary;
    countsByKind: Record<EconomyEventKind, number>;
    topResidentsByAttention: LiveEconomyResidentSummary[];
    residents: LiveEconomyResidentSummary[];
    recentEvents: LiveEconomyEventSummary[];
    pendingProposals: LiveEconomyPendingProposalSummary[];
}

export interface BuildLiveEconomySnapshotOptions {
    memoryRoot: string;
    now: () => Date;
    events: EconomyEvent[];
    proposals: SoulProposal[];
    query?: LiveEconomyQuery;
    isResidentOnline?: (residentName: string) => boolean;
    getOnlineAttention?: (residentName: string) => number | undefined;
}

export function buildLiveEconomySnapshot(options: BuildLiveEconomySnapshotOptions): LiveEconomySnapshot {
    const asOfDate = options.now();
    const asOf = asOfDate.toISOString();
    const { sinceIso, windowMs } = resolveWindow(options.query?.since, asOfDate);
    const eventLimit = clampInt(options.query?.limit, DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT);
    const residentLimit = clampInt(options.query?.residentLimit, DEFAULT_TOP_RESIDENT_LIMIT, MAX_TOP_RESIDENT_LIMIT);
    const windowEvents = options.events.filter(event => event.ts >= sinceIso && event.ts <= asOf);
    const countByKind = emptyCountsByKind();
    for (const event of windowEvents) {
        countByKind[event.kind] += 1;
    }

    const runtimeAttention = readAttentionByResident(options.memoryRoot);
    const residentNames = collectResidentNames(runtimeAttention, options.events, options.proposals);
    const residents = residentNames.map(residentName => {
        const residentEvents = options.events.filter(event => event.residentName === residentName);
        const residentWindowEvents = windowEvents.filter(event => event.residentName === residentName);
        const gpNetDelta = residentEvents.reduce((sum, event) => sum + (typeof event.gpDelta === 'number' ? event.gpDelta : 0), 0);
        const lastEventTs = residentEvents.length ? residentEvents[residentEvents.length - 1].ts : undefined;
        const onlineAttention = options.getOnlineAttention?.(residentName);
        return {
            residentName,
            attentionBalance: typeof onlineAttention === 'number' ? onlineAttention : (runtimeAttention.get(residentName) ?? 0),
            gpNetDelta,
            eventCount: residentEvents.length,
            windowEventCount: residentWindowEvents.length,
            activeInWindow: residentWindowEvents.length > 0,
            online: options.isResidentOnline?.(residentName) ?? false,
            ...(lastEventTs ? { lastEventTs } : {}),
        } satisfies LiveEconomyResidentSummary;
    });
    residents.sort(
        (left, right) =>
            right.attentionBalance - left.attentionBalance ||
            right.windowEventCount - left.windowEventCount ||
            left.residentName.localeCompare(right.residentName),
    );

    const redactionMap = makeRedactionMap(windowEvents.map(event => event.cityUserId).filter((id): id is string => Boolean(id)));
    const recentEvents = windowEvents
        .slice()
        .sort((left, right) => right.ts.localeCompare(left.ts))
        .slice(0, eventLimit)
        .map(event => summarizeEvent(event, redactionMap));

    const pendingProposals = options.proposals
        .filter(proposal => PENDING_PROPOSAL_STATUSES.includes(proposal.status))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(proposal => ({
            proposalId: proposal.id,
            residentName: proposal.residentName,
            goalText: proposal.goalText,
            apFunded: proposal.apFunded,
            apThreshold: proposal.apThreshold,
            status: proposal.status,
        }));

    const city: LiveEconomyCitySummary = {
        residentCount: residents.length,
        activeResidentCount: residents.filter(resident => resident.activeInWindow).length,
        attentionTotal: residents.reduce((sum, resident) => sum + resident.attentionBalance, 0),
        attentionDelta: windowEvents.reduce((sum, event) => sum + (typeof event.apDelta === 'number' ? event.apDelta : 0), 0),
        gpNetDelta: windowEvents.reduce((sum, event) => sum + (typeof event.gpDelta === 'number' ? event.gpDelta : 0), 0),
    };

    return {
        asOf,
        window: {
            since: sinceIso,
            windowMs,
        },
        city,
        countsByKind: countByKind,
        topResidentsByAttention: residents.slice(0, residentLimit),
        residents,
        recentEvents,
        pendingProposals,
    };
}

function summarizeEvent(event: EconomyEvent, redactionMap: Map<string, string>): LiveEconomyEventSummary {
    return {
        id: event.id,
        ts: event.ts,
        kind: event.kind,
        ...(event.residentName ? { residentName: event.residentName } : {}),
        ...(event.cityUserId ? { cityUserId: redactPrivateHandle(event.cityUserId, redactionMap) } : {}),
        ...(typeof event.apDelta === 'number' ? { apDelta: event.apDelta } : {}),
        ...(typeof event.gpDelta === 'number' ? { gpDelta: event.gpDelta } : {}),
        ...(event.ncriId ? { ncriId: event.ncriId } : {}),
        ...(event.refId ? { refId: event.refId } : {}),
        ...(event.note ? { note: redactPrivateText(event.note, redactionMap) } : {}),
    };
}

function collectResidentNames(runtimeAttention: Map<string, number>, events: EconomyEvent[], proposals: SoulProposal[]): string[] {
    const names = new Set<string>(runtimeAttention.keys());
    for (const event of events) {
        if (event.residentName) {
            names.add(event.residentName);
        }
    }
    for (const proposal of proposals) {
        names.add(proposal.residentName);
    }
    return [...names].sort((left, right) => left.localeCompare(right));
}

function readAttentionByResident(memoryRoot: string): Map<string, number> {
    const result = new Map<string, number>();
    if (!fs.existsSync(memoryRoot)) {
        return result;
    }

    const entries = fs.readdirSync(memoryRoot, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const slug = entry.name;
        const runtimeStatePath = path.join(memoryRoot, slug, 'runtime-state.json');
        if (!fs.existsSync(runtimeStatePath)) {
            continue;
        }
        const state = readRuntimeState(runtimeStatePath);
        if (!state || typeof state.attention !== 'number') {
            continue;
        }
        const residentName = typeof state.resident === 'string' && state.resident.length > 0 ? state.resident : inferResidentFromSlug(slug);
        if (!residentName) {
            continue;
        }
        result.set(residentName, state.attention);
    }
    return result;
}

function readRuntimeState(runtimeStatePath: string): Partial<RuntimeState> | undefined {
    try {
        return JSON.parse(fs.readFileSync(runtimeStatePath, 'utf8')) as Partial<RuntimeState>;
    } catch {
        return undefined;
    }
}

function inferResidentFromSlug(slug: string): string | undefined {
    const candidate = slug.startsWith('res-') ? `res:${slug.slice(4)}` : `res:${slug}`;
    return residentSlug(candidate) === slug ? candidate : undefined;
}

function resolveWindow(since: string | undefined, asOf: Date): { sinceIso: string; windowMs: number } {
    const asOfMs = asOf.getTime();
    const fallbackStart = asOfMs - DEFAULT_WINDOW_MS;
    if (!since) {
        return {
            sinceIso: new Date(fallbackStart).toISOString(),
            windowMs: DEFAULT_WINDOW_MS,
        };
    }

    const parsed = Date.parse(since);
    if (Number.isNaN(parsed)) {
        return {
            sinceIso: new Date(fallbackStart).toISOString(),
            windowMs: DEFAULT_WINDOW_MS,
        };
    }

    const clampedStart = Math.max(asOfMs - MAX_WINDOW_MS, Math.min(parsed, asOfMs));
    return {
        sinceIso: new Date(clampedStart).toISOString(),
        windowMs: asOfMs - clampedStart,
    };
}

function emptyCountsByKind(): Record<EconomyEventKind, number> {
    return Object.fromEntries(ECONOMY_EVENT_KINDS.map(kind => [kind, 0])) as Record<EconomyEventKind, number>;
}

function makeRedactionMap(rawHandles: string[]): Map<string, string> {
    const unique = [...new Set(rawHandles.filter(Boolean))].sort();
    const aliases = new Map<string, string>();
    unique.forEach((handle, index) => aliases.set(handle, `<patron #${index + 1}>`));
    return aliases;
}

function redactPrivateHandle(raw: string, redactionMap: Map<string, string>): string {
    const existing = redactionMap.get(raw);
    if (existing) {
        return existing;
    }
    const alias = `<patron #${redactionMap.size + 1}>`;
    redactionMap.set(raw, alias);
    return alias;
}

function redactPrivateText(raw: string, redactionMap: Map<string, string>): string {
    let text = raw.replace(USER_HANDLE_PATTERN, match => redactPrivateHandle(match, redactionMap));
    text = text.replace(AT_HANDLE_PATTERN, match => redactPrivateHandle(match, redactionMap));
    return text;
}

function clampInt(value: number | undefined, fallback: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.min(Math.floor(value), max);
}
