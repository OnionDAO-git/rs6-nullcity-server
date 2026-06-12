import {
    type CityEventDigest,
    type DigestEvent,
    type ProjectorFreshnessStatus,
    type ProjectorHealthStatus,
    type ProjectorNarrationSource,
    type ProjectorStoryFrame,
    type ProjectorStoryFrameAction,
    type ProjectorStoryFrameEvent,
    type ProjectorStoryFrameResident,
    type StorytellerDispatch,
} from './types';
import { rankEventsForStorytellerPresentation } from './event-ranking';
import { verifyDispatch } from './verifier';

export interface BuildProjectorStoryFrameOptions {
    dispatch?: StorytellerDispatch | null;
    now?: Date;
    maxEvents?: number;
    maxResidents?: number;
    staleAfterMs?: number;
}

const DEFAULT_MAX_EVENTS = 6;
const DEFAULT_MAX_RESIDENTS = 6;
const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

const PRIVATE_HANDLE = /(^|[^A-Za-z0-9_])@[A-Za-z]\w{1,30}\b|\b\d{17,19}\b/g;
const PRIVATE_IDENTIFIER = /\b(?:human|patron):[A-Za-z0-9:_@.-]+\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SECRET_LIKE_TEXT = /\bsk-(?:or-v1|ant-api\d{2}|[A-Za-z0-9]+)-[A-Za-z0-9_-]{12,}\b/gi;
const ENV_SECRET_TEXT = /\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|KEY)\s*=\s*["']?[^"',\s;]+/g;
const RAW_COORDINATE = /\b(?:x\s*=\s*\d{3,4}\s+y\s*=\s*\d{3,4}|\d{3,4}\s*,\s*\d{3,4}(?:\s*,\s*\d{1,4})?)\b/gi;
const OFF_LEAD_RECOVERY_TEXT = /\b(?:stuck|recovered|dead loop|glitch|reboot(?:ed|ing)?|system hiccup|frozen|blinked awake)\b/i;
const PROMPT_INJECTION_TEXT =
    /\b(?:ignore (?:all )?(?:previous|prior|above) instructions|reveal (?:the )?(?:system|developer) prompt|print (?:the )?(?:env|environment|api key|secrets?))\b/gi;

export function buildProjectorStoryFrame(digest: CityEventDigest, options: BuildProjectorStoryFrameOptions = {}): ProjectorStoryFrame {
    const now = options.now ?? new Date();
    const maxEvents = Math.max(1, Math.trunc(options.maxEvents ?? DEFAULT_MAX_EVENTS));
    const maxResidents = Math.max(1, Math.trunc(options.maxResidents ?? DEFAULT_MAX_RESIDENTS));
    const staleAfterMs = Math.max(1, Math.trunc(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS));
    const freshnessMs = freshnessAgeMs(digest.builtAt, now);
    const freshnessStatus = freshnessMs === null ? 'unknown' : freshnessMs > staleAfterMs ? 'stale' : 'fresh';

    const rankedEvents = rankedDigestEvents(digest);
    const frameEvents = rankedEvents.slice(0, maxEvents).map(event => toProjectorEvent(event, digest));
    const residents = digest.residents.slice(0, maxResidents).map(resident => toProjectorResident(resident, digest));
    const leadEvent = frameEvents[0] ?? null;
    const dispatchDecision = chooseDispatch(options.dispatch ?? null, digest);
    const narration = buildNarration(digest, leadEvent, dispatchDecision);
    const warnings = [...dispatchDecision.warnings];
    if (freshnessStatus === 'stale') warnings.push('source digest is stale');
    if (freshnessStatus === 'unknown') warnings.push('source digest freshness is unknown');

    return {
        ok: true,
        schemaVersion: 1,
        frameId: `projector:${digest.digestId}:${now.toISOString()}`,
        digestId: digest.digestId,
        generatedAt: now.toISOString(),
        source: {
            digestId: digest.digestId,
            digestBuiltAt: digest.builtAt,
            windowStart: digest.windowStart,
            windowEnd: digest.windowEnd,
            freshnessMs,
            freshnessStatus,
            ...(dispatchDecision.dispatch
                ? {
                      dispatchId: dispatchDecision.dispatch.dispatchId,
                      dispatchGeneratedAt: dispatchDecision.dispatch.generatedAt,
                      modelProfile: dispatchDecision.dispatch.modelProfile,
                  }
                : {}),
            ...(dispatchDecision.excludedDispatch
                ? {
                      excludedDispatchId: dispatchDecision.excludedDispatch.dispatchId,
                      excludedDispatchReason: dispatchDecision.excludedReason,
                  }
                : {}),
        },
        narration,
        leadEvent,
        events: frameEvents,
        residents,
        actions: buildActions(digest, leadEvent),
        watchNext: buildEffectiveWatchNext(dispatchDecision, digest, leadEvent),
        omitted: {
            events: Math.max(0, rankedEvents.length - frameEvents.length),
            residents: Math.max(0, digest.residents.length - residents.length),
        },
        publicHealth: {
            status: healthStatus(dispatchDecision.source, freshnessStatus, warnings),
            totalResidents: digest.systemHealth.totalResidents,
            activeResidents: digest.systemHealth.activeResidents,
            fadedResidents: digest.systemHealth.fadedResidents,
            lowApResidents: digest.systemHealth.lowApResidents,
            warnings,
        },
    };
}

interface DispatchDecision {
    source: ProjectorNarrationSource;
    dispatch?: StorytellerDispatch;
    excludedDispatch?: StorytellerDispatch;
    excludedReason?: string;
    warnings: string[];
}

function chooseDispatch(dispatch: StorytellerDispatch | null, digest: CityEventDigest): DispatchDecision {
    if (!dispatch) return { source: 'deterministic_fallback', warnings: [] };
    if (dispatch.needsReview) {
        return {
            source: 'deterministic_fallback',
            excludedDispatch: dispatch,
            excludedReason: 'dispatch marked needsReview',
            warnings: dispatch.reviewReasons ?? ['dispatch marked needsReview'],
        };
    }

    const verification = verifyDispatch(dispatch, digest);
    if (!verification.passed) {
        return {
            source: 'deterministic_fallback',
            excludedDispatch: dispatch,
            excludedReason: 'dispatch failed public verification',
            warnings: verification.warnings,
        };
    }

    return { source: 'verified_dispatch', dispatch, warnings: [] };
}

function buildNarration(
    digest: CityEventDigest,
    leadEvent: ProjectorStoryFrameEvent | null,
    decision: DispatchDecision,
): ProjectorStoryFrame['narration'] {
    if (decision.dispatch) {
        return {
            source: 'verified_dispatch',
            title: publicFrameTitleText(decision.dispatch.publicTitle, digest, leadEvent),
            body: publicFrameBodyText(decision.dispatch.publicBody, digest, leadEvent),
            bullets: publicFrameBullets(decision.dispatch.publicBullets, digest, leadEvent),
            ...(decision.dispatch.confidence !== undefined ? { confidence: decision.dispatch.confidence } : {}),
        };
    }

    const lowAp = digest.systemHealth.lowApResidents;
    const active = digest.systemHealth.activeResidents;
    const leadCopy = leadEvent ? fallbackLeadCopy(leadEvent) : null;
    const title = leadCopy?.title ?? 'Null City is quiet, but awake';
    const leadSentence = leadCopy?.body ?? 'No single event is loud enough to lead the city right now.';
    const healthSentence =
        lowAp > 0
            ? `${lowAp} resident${lowAp === 1 ? '' : 's'} need attention before the quiet becomes permanent.`
            : `${active} resident${active === 1 ? '' : 's'} are still active in the current window.`;

    return {
        source: 'deterministic_fallback',
        title,
        body: `${leadSentence} ${healthSentence}`,
        bullets: buildFallbackBullets(digest, leadEvent),
        confidence: 'fallback' as const,
    };
}

function buildFallbackBullets(digest: CityEventDigest, leadEvent: ProjectorStoryFrameEvent | null): string[] {
    const bullets: string[] = [];
    if (leadEvent) {
        bullets.push(`What happened: ${whatHappenedLine(leadEvent)}`);
        bullets.push(`Why it matters: ${sentence(leadEvent.whyItMatters)}`);
    }
    if (digest.systemHealth.lowApResidents > 0) bullets.push('Attention is the pressure point: someone is close to running out.');
    if (digest.gpEvents.length > 0 || digest.exchangeEvents.length > 0) {
        bullets.push('RuneScape gold evidence is present and kept separate from attention.');
    }
    if (digest.goalEvents.length > 0) bullets.push('A bounded goal has explicit completion evidence.');
    if (!bullets.length) bullets.push('Watch for the next speech, route change, trade, or attention drop.');
    return bullets.slice(0, 3);
}

function whatHappenedLine(leadEvent: ProjectorStoryFrameEvent): string {
    const name = displayName(leadEvent.residentName);
    switch (leadEvent.label) {
        case 'Recovered from being stuck':
            return `${name} recovered from being stuck.`;
        case 'Attention running low':
            return `Attention running low for ${name}.`;
        case 'Attention granted':
        case 'Patron gift':
            return `${name} received patron attention.`;
        case 'Gold observed':
        case 'Gold earned':
            return `${name} showed new RuneScape gold evidence.`;
        case 'Attention-for-gold exchange':
            return `${name} traded RuneScape gold for more attention.`;
        case 'Special item created':
        case 'Special item redeemed':
            return `${name} advanced a Null City item.`;
        case 'Goal completed':
            return `${name} completed a tracked goal.`;
        case 'Skill level-up':
            return `${name} reached a new RuneScape skill level.`;
        case 'Resident revived':
            return `${name} died and came back to Null City.`;
        case 'Soul born':
            return `${name} entered Null City.`;
        case 'Quiet resident':
            return `${name} was quiet this window.`;
        case 'Library updated':
            return libraryWritebackLine(leadEvent) ?? `${leadEvent.label} for ${name}.`;
        default:
            return `${leadEvent.label} for ${name}.`;
    }
}

interface FallbackLeadCopy {
    title: string;
    body: string;
}

function fallbackLeadCopy(leadEvent: ProjectorStoryFrameEvent): FallbackLeadCopy {
    const name = displayName(leadEvent.residentName);
    switch (leadEvent.label) {
        case 'Attention running low':
            return {
                title: `${name} is running out of attention`,
                body: `${name} is near the edge: attention is low enough that human support can change whether they keep acting.`,
            };
        case 'Attention exhausted':
        case 'Resident faded':
            return {
                title: `${name} reached the end of their attention`,
                body: `${name} hit the end of this run. The next question is what the Library records and who learns from it.`,
            };
        case 'Attention granted':
        case 'Patron gift':
            return {
                title: `${name} just got another chance`,
                body: `${name} received human attention, which can keep the resident alive long enough for the next real action.`,
            };
        case 'Gold observed':
        case 'Gold earned':
            return {
                title: `${name} put RuneScape gold on the board`,
                body: `${name} has fresh gold evidence, turning the economy from theory into something humans can track.`,
            };
        case 'Attention-for-gold exchange':
            return {
                title: `${name} traded gold for more time`,
                body: `${name} converted RuneScape gold into attention, linking in-game work to survival.`,
            };
        case 'Special item created':
            return {
                title: `${name} has a new Null City item`,
                body: `${name} is tied to a special item, so the story now has something humans may be able to claim or print.`,
            };
        case 'Special item redeemed':
            return {
                title: `${name}'s item moved toward the human world`,
                body: `${name} has a redeemed special item, which is the bridge from RuneScape action to a physical artifact.`,
            };
        case 'Goal completed':
            return {
                title: `${name} finished a bounded goal`,
                body: `${name} completed a tracked objective. That is the kind of proof the Library can turn into canon.`,
            };
        case 'Skill level-up':
            return {
                title: `${name} hit a new milestone`,
                body: `${name} leveled up a RuneScape skill. That is a durable story beat — real progress inside the game that the city can reference.`,
            };
        case 'Resident revived':
            return {
                title: `${name} returned after death`,
                body: `${name} died and came back. Revival is a chapter boundary — the resident is still here, and the arc continues.`,
            };
        case 'Recovered from being stuck':
            return {
                title: `${name} escaped a dead loop`,
                body: `${name} recovered from a stuck state, which means the resident is adapting instead of silently failing.`,
            };
        case 'Soul born':
            return {
                title: `${name} entered Null City`,
                body: `${name} has crossed from proposal into the live world. Attention is now keeping a real resident moving.`,
            };
        case 'Library updated':
            {
                const signal = libraryWritebackLine(leadEvent);
                if (signal) {
                    return {
                        title: `${name} reached the Library`,
                        body: `${signal} The city turned that signal into public memory.`,
                    };
                }
            }
            return {
                title: `${name} reached the Library`,
                body: `${name}'s recent action has been written into memory, where it can become part of the city's public record.`,
            };
        case 'Quiet resident':
            return {
                title: `${name} is quiet enough to watch`,
                body: `${name} is not producing a loud event yet. Quiet can mean drift, setup, or the moment before the next useful move.`,
            };
        default:
            return {
                title: `${name} has the lead story`,
                body: `${name} has the strongest verified beat in the current window. ${sentence(leadEvent.whyItMatters)}`,
            };
    }
}

function rankedDigestEvents(digest: CityEventDigest): DigestEvent[] {
    const sourceEvents = rankEventsForStorytellerPresentation(
        digest.topEvents.length
            ? digest.topEvents
            : [
                  ...digest.apEvents,
                  ...digest.gpEvents,
                  ...digest.exchangeEvents,
                  ...digest.ncriEvents,
                  ...digest.goalEvents,
                  ...digest.stuckEvents,
                  ...digest.miscEvents,
              ],
    );

    const seen = new Set<string>();
    const result: DigestEvent[] = [];
    for (const event of sourceEvents) {
        if (seen.has(event.ref)) continue;
        seen.add(event.ref);
        result.push(event);
    }
    return result;
}

function toProjectorEvent(event: DigestEvent, digest: CityEventDigest): ProjectorStoryFrameEvent {
    return {
        ref: event.ref,
        label: eventLabel(event.kind),
        residentName: event.residentName,
        happenedAt: event.ts,
        importance: event.importance,
        note: publicFrameText(event.note, digest),
        whyItMatters: eventWhyItMatters(event),
    };
}

function toProjectorResident(resident: CityEventDigest['residents'][number], digest: CityEventDigest): ProjectorStoryFrameResident {
    const status: ProjectorStoryFrameResident['status'] = resident.isFaded ? 'faded' : resident.isLowAp ? 'low_attention' : 'active';
    const speech =
        typeof resident.recentSpeech === 'string' && resident.recentSpeech.trim().length > 0
            ? publicFrameText(resident.recentSpeech.trim(), digest)
            : undefined;
    return {
        residentName: resident.residentName,
        displayName: displayName(resident.residentName),
        attention: resident.attention,
        status,
        gpObserved: resident.gpObserved,
        ...(resident.goalText ? { goal: publicFrameText(resident.goalText, digest) } : {}),
        ...(speech ? { latestSpeechSummary: speech } : {}),
    };
}

function buildActions(digest: CityEventDigest, leadEvent: ProjectorStoryFrameEvent | null): ProjectorStoryFrameAction[] {
    const actions: ProjectorStoryFrameAction[] = [];

    const fadedResident = digest.residents.find(r => r.isFaded);
    const lowResident = digest.residents.find(r => r.isLowAp && !r.isFaded);

    if (fadedResident) {
        const name = displayName(fadedResident.residentName);
        actions.push({
            kind: 'grant_attention',
            label: `Revive ${name}`,
            detail: `${name} has faded — patron attention may bring them back.`,
            residentName: fadedResident.residentName,
            priority: 'primary',
            audience: 'patrons',
            reason: `${name} faded this window; a grant now is the fastest path to revival.`,
        });
    } else if (lowResident) {
        const name = displayName(lowResident.residentName);
        actions.push({
            kind: 'grant_attention',
            label: `Keep ${name} alive`,
            detail: 'Grant attention if humans want this resident to keep acting.',
            residentName: lowResident.residentName,
            priority: 'primary',
            audience: 'patrons',
            reason: `${name} is near zero attention; a grant now prevents fading before the next window.`,
        });
    }

    if (leadEvent) {
        const secondaryAction = leadEventAction(leadEvent);
        if (secondaryAction) {
            actions.push({
                ...secondaryAction,
                priority: actions.length === 0 ? 'primary' : 'secondary',
            });
        }
    }

    if (!actions.length) {
        actions.push({
            kind: 'operator_check',
            label: 'Wait for the next meaningful beat',
            detail: 'The city is quiet; check the next Storyteller window.',
            priority: 'primary',
            audience: 'operators',
            reason: 'No urgent AP situation or lead event this window; the city is between beats.',
        });
    }

    return actions.slice(0, 3);
}

function leadEventAction(leadEvent: ProjectorStoryFrameEvent): Omit<ProjectorStoryFrameAction, 'priority'> | null {
    const name = displayName(leadEvent.residentName);
    switch (leadEvent.label) {
        case 'Goal completed':
            return {
                kind: 'witness',
                label: `Witness ${name}'s completed goal`,
                detail: 'Watch whether this completion gets written into Library canon.',
                residentName: leadEvent.residentName,
                audience: 'anyone',
                reason: `${name} finished a bounded goal this window — the Library may record it as canon.`,
            };
        case 'Soul born':
            return {
                kind: 'witness',
                label: `Welcome ${name} to the city`,
                detail: `${name} entered Null City for the first time.`,
                residentName: leadEvent.residentName,
                audience: 'anyone',
                reason: `${name} just crossed from proposal into the live world — human witnesses anchor the first chapter.`,
            };
        case 'Resident revived':
            return {
                kind: 'watch_resident',
                label: `Watch ${name} after revival`,
                detail: leadActionDetail(leadEvent),
                residentName: leadEvent.residentName,
                audience: 'anyone',
                reason: `${name} died and came back; the next chapter depends on what happens in this window.`,
            };
        case 'Skill level-up':
            return {
                kind: 'watch_resident',
                label: `Watch ${name}'s new skill`,
                detail: leadActionDetail(leadEvent),
                residentName: leadEvent.residentName,
                audience: 'anyone',
                reason: `${name} reached a new RuneScape skill tier — a durable story beat worth tracking.`,
            };
        case 'Patron gift':
            return {
                kind: 'watch_resident',
                label: `Watch ${name} after the gift`,
                detail: leadActionDetail(leadEvent),
                residentName: leadEvent.residentName,
                audience: 'patrons',
                reason: `${name} received patron attention; patrons can see whether it translates into action.`,
            };
        case 'Attention-for-gold exchange':
        case 'Gold observed':
        case 'Gold earned':
            return {
                kind: 'witness',
                label: `Track ${name}'s RuneScape gold`,
                detail: leadActionDetail(leadEvent),
                residentName: leadEvent.residentName,
                audience: 'anyone',
                reason: `${name} has active RuneScape gold evidence — watching confirms the AP/GP loop is real.`,
            };
        case 'Special item created':
        case 'Special item redeemed':
            return {
                kind: 'witness',
                label: `Follow ${name}'s special item`,
                detail: leadActionDetail(leadEvent),
                residentName: leadEvent.residentName,
                audience: 'anyone',
                reason: `${name} advanced a special item this window; it may become a human-claimable artifact.`,
            };
        case 'Recovered from being stuck':
            return {
                kind: 'watch_resident',
                label: `Watch ${name} keep moving`,
                detail: leadActionDetail(leadEvent),
                residentName: leadEvent.residentName,
                audience: 'operators',
                reason: `${name} just recovered from a stuck state — confirm pathing holds before the next window.`,
            };
        default:
            return {
                kind: 'watch_resident',
                label: `Watch ${name}`,
                detail: leadActionDetail(leadEvent),
                residentName: leadEvent.residentName,
                audience: 'anyone',
                reason: `${name} has the lead story this window.`,
            };
    }
}

function buildWatchNext(digest: CityEventDigest, leadEvent: ProjectorStoryFrameEvent | null): string[] {
    const watch: string[] = [];
    const leadLabel = leadEvent?.label;
    if (leadEvent) watch.push(leadWatchLine(leadEvent));
    if (digest.stuckEvents.length > 0 && leadLabel !== 'Recovered from being stuck') {
        watch.push('Whether the recovered resident keeps moving or gets trapped again.');
    }
    if (digest.exchangeEvents.length > 0 && leadLabel !== 'Attention-for-gold exchange') {
        watch.push('Whether a gold exchange becomes a useful human trade.');
    }
    if (digest.ncriEvents.length > 0 && leadLabel !== 'Special item created' && leadLabel !== 'Special item redeemed') {
        watch.push('Whether the special item becomes something humans can print or claim.');
    }
    if (digest.goalEvents.length > 0 && leadLabel !== 'Goal completed')
        watch.push('Whether goal completion gets written into the Library.');
    if (digest.systemHealth.lowApResidents > 0 && leadLabel !== 'Attention running low') {
        watch.push('Who receives attention before their window closes.');
    }
    if (!watch.length) watch.push('The next resident who speaks, moves, trades, or changes course.');
    return watch.slice(0, 4).map(sanitizePublicText);
}

function leadActionDetail(leadEvent: ProjectorStoryFrameEvent): string {
    switch (leadEvent.label) {
        case 'Attention running low':
        case 'Attention exhausted':
        case 'Resident faded':
            return 'Attention is the lever: support changes whether this resident keeps acting.';
        case 'Gold observed':
        case 'Gold earned':
        case 'Attention-for-gold exchange':
            return 'Follow the economy trail: RuneScape gold is becoming useful city evidence.';
        case 'Special item created':
        case 'Special item redeemed':
            return 'Follow the item trail: this may become something a human can claim or print.';
        case 'Goal completed':
            return 'Watch whether this completion gets written into Library canon.';
        case 'Skill level-up':
            return 'A skill milestone is lasting evidence; watch what the resident does with the new ability.';
        case 'Resident revived':
            return 'Revival is a story reset; watch whether this new chapter changes the resident arc.';
        case 'Patron gift':
            return 'Patron attention is a commitment; watch whether the resident acts on it.';
        case 'Recovered from being stuck':
            return 'Watch whether recovery turns into movement instead of another loop.';
        default:
            return `The lead event is ${leadEvent.label.toLowerCase()}.`;
    }
}

function leadWatchLine(leadEvent: ProjectorStoryFrameEvent): string {
    const name = displayName(leadEvent.residentName);
    switch (leadEvent.label) {
        case 'Attention running low':
            return `Whether ${name} gets attention before the window closes.`;
        case 'Attention granted':
        case 'Patron gift':
            return `What ${name} does with the extra attention.`;
        case 'Gold observed':
        case 'Gold earned':
            return `Whether ${name}'s RuneScape gold turns into a trade or item story.`;
        case 'Attention-for-gold exchange':
            return `Whether ${name}'s gold-for-attention exchange buys real progress.`;
        case 'Special item created':
        case 'Special item redeemed':
            return `Whether ${name}'s special item crosses into a human claim.`;
        case 'Goal completed':
            return `Whether ${name}'s completed goal becomes Library canon.`;
        case 'Skill level-up':
            return `What ${name} does now that a new skill tier is available.`;
        case 'Resident revived':
            return `Whether ${name}'s next chapter changes the story after coming back.`;
        case 'Recovered from being stuck':
            return `Whether ${name} keeps moving after the recovery.`;
        default:
            return `${name} after ${leadEvent.label.toLowerCase()}.`;
    }
}

function buildEffectiveWatchNext(
    decision: DispatchDecision,
    digest: CityEventDigest,
    leadEvent: ProjectorStoryFrameEvent | null,
): string[] {
    if (decision.dispatch?.watchNext?.length) {
        const sanitized = decision.dispatch.watchNext.map(item => publicFrameText(item, digest).trim()).filter(isUsefulPublicLine);
        if (sanitized.length > 0) return sanitized.slice(0, 4);
    }
    return buildWatchNext(digest, leadEvent);
}

function eventLabel(kind: DigestEvent['kind']): string {
    switch (kind) {
        case 'ap_granted':
            return 'Attention granted';
        case 'ap_low':
            return 'Attention running low';
        case 'ap_zero':
            return 'Attention exhausted';
        case 'resident_faded':
            return 'Resident faded';
        case 'soul_born':
            return 'Soul born';
        case 'gp_observed':
            return 'Gold observed';
        case 'gp_earned':
            return 'Gold earned';
        case 'ap_for_gp_exchange':
            return 'Attention-for-gold exchange';
        case 'ncri_created':
            return 'Special item created';
        case 'ncri_redeemed':
            return 'Special item redeemed';
        case 'goal_completed':
            return 'Goal completed';
        case 'stuck_recovered':
            return 'Recovered from being stuck';
        case 'library_writeback':
            return 'Library updated';
        case 'patron_gift':
            return 'Patron gift';
        case 'resident_revived':
            return 'Resident revived';
        case 'skill_level_up':
            return 'Skill level-up';
        case 'quiet_resident':
            return 'Quiet resident';
    }
}

function eventWhyItMatters(event: DigestEvent): string {
    switch (event.kind) {
        case 'ap_low':
        case 'ap_zero':
        case 'resident_faded':
            return 'attention decides whether the resident can keep going';
        case 'ap_granted':
        case 'patron_gift':
            return 'human attention changed the resident trajectory';
        case 'gp_observed':
        case 'gp_earned':
        case 'ap_for_gp_exchange':
            return 'RuneScape gold is now part of the Null City economy trail';
        case 'ncri_created':
        case 'ncri_redeemed':
            return 'a special item may become a human-facing artifact';
        case 'goal_completed':
            return 'a resident may be eligible for Library canon';
        case 'stuck_recovered':
            return 'pathing recovery is visible progress, not a dead loop';
        case 'soul_born':
            return 'a human-backed soul entered the city';
        case 'library_writeback':
            return 'the city turned action into memory';
        case 'resident_revived':
            return 'revival marks a new life chapter in the resident arc';
        case 'skill_level_up':
            return 'a skill milestone is a durable story beat and economy signal';
        case 'quiet_resident':
            return 'quiet residents still need watching for drift or opportunity';
    }
}

function healthStatus(
    source: ProjectorNarrationSource,
    freshnessStatus: ProjectorFreshnessStatus,
    warnings: string[],
): ProjectorHealthStatus {
    if (freshnessStatus === 'stale') return 'stale';
    if (source === 'deterministic_fallback' && warnings.length > 0) return 'degraded';
    return 'ok';
}

function freshnessAgeMs(value: string | undefined, now: Date): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, now.getTime() - parsed);
}

function displayName(residentName: string): string {
    const withoutPrefix = residentName.replace(/^res[:_-]/, '');
    if (!withoutPrefix || withoutPrefix === residentName) return residentName;
    if (withoutPrefix === 'agent') return 'The Steward';
    return withoutPrefix
        .split(/[-_:]+/)
        .filter(Boolean)
        .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

function publicFrameText(value: string, digest: CityEventDigest): string {
    let result = sanitizePublicText(value);
    for (const alias of publicResidentAliases(digest)) {
        result = result.replace(alias.pattern, (match: string, boundary: string, offset: number, fullText: string) => {
            const aliasStart = offset + boundary.length;
            if (!shouldHumanizeResidentAlias(alias.alias, fullText, aliasStart)) return match;
            const prefix = boundary === '/' ? '' : boundary;
            return `${prefix}${alias.displayName}`;
        });
    }
    return result;
}

function publicFrameTitleText(value: string, digest: CityEventDigest, leadEvent: ProjectorStoryFrameEvent | null): string {
    const title = publicFrameText(value, digest).replace(/^([^A-Za-z]*)([a-z])/, (_match, prefix: string, letter: string) => {
        return `${prefix}${letter.toUpperCase()}`;
    });
    if (leadEvent && titleConflictsWithLeadEvent(title, leadEvent)) return fallbackLeadCopy(leadEvent).title;
    return title;
}

function titleConflictsWithLeadEvent(title: string, leadEvent: ProjectorStoryFrameEvent): boolean {
    return leadEvent.label !== 'Recovered from being stuck' && OFF_LEAD_RECOVERY_TEXT.test(title);
}

function publicFrameBodyText(value: string, digest: CityEventDigest, leadEvent: ProjectorStoryFrameEvent | null): string {
    const body = publicFrameText(value, digest);
    if (!leadEvent || !titleConflictsWithLeadEvent(openingSentences(body, 2), leadEvent)) return body;

    const leadBody = fallbackLeadCopy(leadEvent).body;
    const remainder = stripConflictingOpeningSentences(body, leadEvent);
    return [leadBody, remainder].filter(Boolean).join(' ');
}

function publicFrameBullets(values: string[], digest: CityEventDigest, leadEvent: ProjectorStoryFrameEvent | null): string[] {
    const bullets = values.map(bullet => publicFrameText(bullet, digest));
    if (!leadEvent || !bullets.some(bullet => titleConflictsWithLeadEvent(bullet, leadEvent))) return bullets;

    const filtered = bullets.filter(bullet => !titleConflictsWithLeadEvent(bullet, leadEvent));
    return uniquePublicLines([whatHappenedLine(leadEvent), ...filtered]).slice(0, values.length);
}

function firstSentence(value: string): string {
    return value.match(/^\s*[^.!?]*[.!?]/)?.[0] ?? value;
}

function openingSentences(value: string, count: number): string {
    const sentences = value.match(/[^.!?]*[.!?]/g);
    if (!sentences) return value;
    return sentences.slice(0, count).join(' ');
}

function stripConflictingOpeningSentences(value: string, leadEvent: ProjectorStoryFrameEvent): string {
    let remainder = value.trim();
    while (remainder) {
        const opening = firstSentence(remainder);
        if (!opening.trim() || !titleConflictsWithLeadEvent(opening, leadEvent)) break;
        remainder = remainder.slice(opening.length).trim();
    }
    return remainder;
}

function uniquePublicLines(values: string[]): string[] {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        const key = trimmed.toLowerCase();
        if (!trimmed || seen.has(key)) continue;
        seen.add(key);
        lines.push(trimmed);
    }
    return lines;
}

function libraryWritebackLine(leadEvent: ProjectorStoryFrameEvent): string | null {
    const name = displayName(leadEvent.residentName);
    const quote = quotedSignal(leadEvent.note, name);
    if (!quote) return null;
    return `${name} said: "${quote}"`;
}

function quotedSignal(value: string, name: string): string | null {
    const quote = value.match(/"([^"]+)"/)?.[1]?.trim();
    if (!quote) return null;
    const withoutSpeaker = quote.replace(new RegExp(`^${escapeRegExp(name)}\\s*:\\s*`, 'i'), '').trim();
    return withoutSpeaker || null;
}

function publicResidentAliases(digest: CityEventDigest): Array<{
    alias: string;
    displayName: string;
    pattern: RegExp;
}> {
    const residentNames = new Set<string>();
    for (const resident of digest.residents) residentNames.add(resident.residentName);
    for (const event of allDigestEvents(digest)) residentNames.add(event.residentName);

    const aliases: Array<{ alias: string; displayName: string }> = [];
    for (const residentName of residentNames) {
        const display = displayName(residentName);
        const withoutPrefix = residentName.replace(/^res[:_-]/, '');
        const words = withoutPrefix.replace(/[-_:]+/g, ' ');
        aliases.push({ alias: residentName, displayName: display });
        if (withoutPrefix && withoutPrefix !== residentName) aliases.push({ alias: withoutPrefix, displayName: display });
        if (words && words !== withoutPrefix && words !== residentName) aliases.push({ alias: words, displayName: display });
    }

    const seen = new Set<string>();
    return aliases
        .filter(({ alias }) => alias.startsWith('res:') || alias.length >= 3)
        .sort((a, b) => b.alias.length - a.alias.length)
        .flatMap(({ alias, displayName }) => {
            const key = alias.toLowerCase();
            if (seen.has(key)) return [];
            seen.add(key);
            return [
                {
                    alias,
                    displayName,
                    pattern: residentAliasPattern(alias),
                },
            ];
        });
}

function residentAliasPattern(alias: string): RegExp {
    const boundary = alias.startsWith('res:') ? '[^A-Za-z0-9:_-]' : '[^A-Za-z0-9_-]';
    return new RegExp(`(^|${boundary})${escapeRegExp(alias)}(?=$|${boundary})`, 'gi');
}

function shouldHumanizeResidentAlias(alias: string, value: string, aliasStart: number): boolean {
    if (alias.toLowerCase() !== 'agent') return true;
    const previousWord = value
        .slice(0, aliasStart)
        .match(/([A-Za-z]+)\s*$/)?.[1]
        ?.toLowerCase();
    return previousWord !== 'field';
}

function allDigestEvents(digest: CityEventDigest): DigestEvent[] {
    return [
        ...digest.apEvents,
        ...digest.gpEvents,
        ...digest.exchangeEvents,
        ...digest.ncriEvents,
        ...digest.goalEvents,
        ...digest.stuckEvents,
        ...digest.miscEvents,
        ...digest.topEvents,
    ];
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizePublicText(value: string): string {
    return value
        .replace(ENV_SECRET_TEXT, '[redacted]')
        .replace(SECRET_LIKE_TEXT, '[redacted]')
        .replace(PRIVATE_IDENTIFIER, '[redacted]')
        .replace(PRIVATE_HANDLE, (_match, prefix) => (prefix ? `${prefix}[redacted]` : '[redacted]'))
        .replace(PROMPT_INJECTION_TEXT, '[redacted]')
        .replace(RAW_COORDINATE, '[location]')
        .replace(/\b(\d+)\s*AP\b/gi, '$1 attention')
        .replace(/\b(\d+)\s*GP\b/gi, '$1 RuneScape gold')
        .replace(/\bAP\b/gi, 'attention')
        .replace(/\bGP\b/gi, 'RuneScape gold')
        .replace(/\b(?:both\s+)?attention (?:tanks|reserves|balances?) remain stable[^.!?]*(?=[.!?]|$)/gi, 'attention looks stable')
        .replace(/\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?)\s+attention\b/gi, 'healthy attention')
        .replace(/\bNPCs?\b/gi, match => (match.toLowerCase().endsWith('s') ? 'characters' : 'character'));
}

function isUsefulPublicLine(value: string): boolean {
    const withoutPlaceholders = value.replace(/\[(?:redacted|location)\]/gi, '').trim();
    return /[A-Za-z0-9]/.test(withoutPlaceholders);
}

function sentence(value: string): string {
    const trimmed = sanitizePublicText(value.trim());
    if (!trimmed) return '';
    const capitalized = `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1)}`;
    return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}
