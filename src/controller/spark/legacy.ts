import { type RuntimeState, markDeceased } from '../memory/runtime-state';
import type { Soul, SoulArchetype } from '../soul/soul-schema';
import type { AgentAction } from '../transport/message-codecs';

export const DEFAULT_ENDURER_TARGET_TICKS = 50_000;
export const HERO_ENDURER_TARGET_TICKS = 4_320_000;

export interface LegacyProgress {
    kind: SoulArchetype;
    complete: boolean;
    progress: Record<string, unknown>;
    ratio: number;
    summary: string;
}

export interface LegacyUpdate {
    complete: boolean;
    cause?: string;
}

interface MentorActionWindow {
    tick: number;
    skill: string;
    nearby: string[];
}

interface MentorSayWindow {
    tick: number;
}

export class LegacyTracker {
    constructor(
        private readonly soul: Soul,
        private readonly state: RuntimeState,
    ) {}

    update(perception: unknown): LegacyUpdate {
        if (this.state.legacy.complete) {
            if (!this.reopenExtendedEndurerIfNeeded()) {
                return { complete: true, cause: this.completionCause() };
            }
        }

        switch (this.kind()) {
            case 'mentor':
                return this.updateMentor(perception, []);
            case 'achiever':
                return this.updateAchiever(perception);
            case 'endurer':
                return this.updateEndurer();
            default:
                return { complete: false };
        }
    }

    observeActions(actions: AgentAction[], perception: unknown): LegacyUpdate {
        if (this.state.legacy.complete) {
            return { complete: true, cause: this.completionCause() };
        }
        if (this.kind() !== 'mentor') {
            return { complete: false };
        }

        return this.updateMentor(perception, actions);
    }

    read(): LegacyProgress {
        const kind = this.kind();
        const ratio = this.progressRatio(kind);
        return {
            kind,
            complete: this.state.legacy.complete,
            progress: this.state.legacy.progress,
            ratio,
            summary: this.summary(kind, ratio),
        };
    }

    private updateMentor(perception: unknown, actions: AgentAction[]): LegacyUpdate {
        const progress = this.state.legacy.progress;
        const taught = stringArray(progress.menteeIds);
        const target = numberParam(this.soul, ['targetMenteeCount'], 1);
        const skillsToTeach = stringArray(this.soul.frontmatter.legacy?.parameters?.skillsToTeach).map(normalizeSkill);
        const actionWindow = objectArray<MentorActionWindow>(progress.mentorActionWindow);
        const sayWindow = objectArray<MentorSayWindow>(progress.mentorSayWindow);

        const nearby = nearbyActorIds(perception);
        for (const action of actions) {
            const skill = actionSkill(action);
            if (skill && (skillsToTeach.length === 0 || skillsToTeach.includes(skill))) {
                actionWindow.push({ tick: this.state.tick, skill, nearby });
            }
            if (action.kind === 'say' && teachingText(String((action as Record<string, unknown>).text || ''))) {
                sayWindow.push({ tick: this.state.tick });
            }
        }

        const events = extractEvents(perception);
        for (const event of events) {
            const skill = eventSkill(event);
            const mentee = actorId(event);
            if (!skill || !mentee || taught.includes(mentee)) {
                continue;
            }
            if (skillsToTeach.length > 0 && !skillsToTeach.includes(skill)) {
                continue;
            }

            const recentSkillAction = actionWindow.some(
                entry => entry.skill === skill && this.state.tick - entry.tick <= 5 && entry.nearby.includes(mentee),
            );
            const recentTeachingSay = sayWindow.some(entry => this.state.tick - entry.tick <= 10);
            if (isXpEvent(event) && recentSkillAction && recentTeachingSay) {
                taught.push(mentee);
            }
        }

        progress.menteeIds = taught;
        progress.mentorActionWindow = actionWindow.filter(entry => this.state.tick - entry.tick <= 10);
        progress.mentorSayWindow = sayWindow.filter(entry => this.state.tick - entry.tick <= 10);
        progress.count = taught.length;
        progress.target = target;
        progress.ratio = target <= 0 ? 1 : Math.min(1, taught.length / target);

        if (taught.length >= target) {
            return this.complete('legacy_complete');
        }
        return { complete: false };
    }

    private updateAchiever(perception: unknown): LegacyUpdate {
        const spec = achievementSpec(this.soul);
        if (!spec) {
            return { complete: false };
        }

        const achieved = achievementFired(spec, perception);
        this.state.legacy.progress.spec = spec;
        this.state.legacy.progress.ratio = achieved ? 1 : 0;
        this.state.legacy.progress.complete = achieved;
        if (achieved) {
            return this.complete('legacy_complete');
        }
        return { complete: false };
    }

    private updateEndurer(): LegacyUpdate {
        const target = endurerTargetTicks(this.soul);
        const ticksLived = Number(this.state.legacy.progress.ticksLived || 0) + 1;
        const ratio = target <= 0 ? 1 : Math.min(1, ticksLived / target);
        this.state.legacy.progress.ticksLived = ticksLived;
        this.state.legacy.progress.targetTicksLived = target;
        this.state.legacy.progress.ratio = ratio;
        if (ticksLived >= target) {
            return this.complete('endured');
        }
        return { complete: false };
    }

    private reopenExtendedEndurerIfNeeded(): boolean {
        if (this.kind() !== 'endurer') {
            return false;
        }

        const target = endurerTargetTicks(this.soul);
        const ticksLived = Number(this.state.legacy.progress.ticksLived || 0);
        if (!Number.isFinite(ticksLived) || ticksLived >= target) {
            return false;
        }

        this.state.legacy.complete = false;
        this.state.legacy.progress.targetTicksLived = target;
        this.state.legacy.progress.ratio = target <= 0 ? 1 : Math.min(1, Math.max(0, ticksLived / target));
        return true;
    }

    private complete(cause: string): LegacyUpdate {
        this.state.legacy.complete = true;
        this.state.attention = 0;
        markDeceased(this.state, cause);
        return { complete: true, cause };
    }

    private progressRatio(kind: SoulArchetype): number {
        if (typeof this.state.legacy.progress.ratio === 'number') {
            return Math.max(0, Math.min(1, this.state.legacy.progress.ratio));
        }
        if (kind === 'mentor') {
            const target = Number(this.state.legacy.progress.target || 1);
            const count = Number(this.state.legacy.progress.count || 0);
            return target <= 0 ? 1 : Math.min(1, count / target);
        }
        return this.state.legacy.complete ? 1 : 0;
    }

    private summary(kind: SoulArchetype, ratio: number): string {
        if (kind === 'mentor') {
            return `Mentor legacy: ${Number(this.state.legacy.progress.count || 0)}/${Number(this.state.legacy.progress.target || 1)} mentees taught.`;
        }
        if (kind === 'achiever') {
            return `Achiever legacy: ${this.state.legacy.complete ? 'complete' : 'in progress'} (${Math.round(ratio * 100)}%).`;
        }
        return `Endurer legacy: ${Number(this.state.legacy.progress.ticksLived || 0)}/${Number(this.state.legacy.progress.targetTicksLived || DEFAULT_ENDURER_TARGET_TICKS)} ticks lived.`;
    }

    private completionCause(): string {
        return this.kind() === 'endurer' ? 'endured' : 'legacy_complete';
    }

    private kind(): SoulArchetype {
        return (this.state.legacy.kind || this.soul.frontmatter.legacy?.kind || this.soul.frontmatter.archetype) as SoulArchetype;
    }
}

export function readLegacyProgress(state: RuntimeState): LegacyProgress {
    const kind = state.legacy.kind as SoulArchetype;
    const ratio =
        typeof state.legacy.progress.ratio === 'number'
            ? Math.max(0, Math.min(1, state.legacy.progress.ratio))
            : state.legacy.complete
              ? 1
              : 0;
    return {
        kind,
        complete: state.legacy.complete,
        progress: state.legacy.progress,
        ratio,
        summary: `${kind} legacy ${state.legacy.complete ? 'complete' : 'in progress'} (${Math.round(ratio * 100)}%).`,
    };
}

function extractEvents(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
        return value.flatMap(extractEvents);
    }
    if (!isRecord(value)) {
        return [];
    }

    const own = typeof value.kind === 'string' || typeof value.type === 'string' || typeof value.event === 'string' ? [value] : [];
    const nested = ['events', 'perceptionEvents', 'recentEvents'].flatMap(key =>
        Array.isArray(value[key]) ? (value[key] as unknown[]).flatMap(extractEvents) : [],
    );
    return [...own, ...nested];
}

function achievementSpec(soul: Soul): Record<string, unknown> | undefined {
    const params = soul.frontmatter.legacy?.parameters || {};
    if (isRecord(params.spec)) {
        return params.spec;
    }
    if (typeof params.kind === 'string') {
        return params;
    }
    if (typeof params.targetSkill === 'string') {
        return { kind: 'reach_skill_level', skill: params.targetSkill, level: Number(params.level || params.targetLevel || 2) };
    }
    return undefined;
}

function achievementFired(spec: Record<string, unknown>, perception: unknown): boolean {
    const events = extractEvents(perception);
    switch (spec.kind) {
        case 'reach_skill_level':
            return events.some(
                event =>
                    isLevelEvent(event) && eventSkill(event) === normalizeSkill(spec.skill) && eventLevel(event) >= Number(spec.level || 1),
            );
        case 'craft_item':
            return events.some(
                event =>
                    eventKind(event, ['craft_item', 'item_crafted']) &&
                    Number(event.itemId || readPath(event, 'item.itemId')) === Number(spec.itemId),
            );
        case 'defeat_npc':
            return events.some(
                event =>
                    eventKind(event, ['defeat_npc', 'npc_defeated', 'npc_killed', 'kill']) && npcKey(event) === String(spec.npcKey || ''),
            );
        case 'reach_place':
            return reachedPlace(perception, String(spec.placeSlug || ''));
        default:
            return false;
    }
}

function reachedPlace(perception: unknown, placeSlug: string): boolean {
    if (!placeSlug) {
        return false;
    }
    if (
        readPath(perception, 'location.slug') === placeSlug ||
        readPath(perception, 'place.slug') === placeSlug ||
        readPath(perception, 'chunk.slug') === placeSlug
    ) {
        return true;
    }
    return extractEvents(perception).some(
        event => eventKind(event, ['reach_place', 'place_reached', 'arrived']) && String(event.placeSlug || event.slug || '') === placeSlug,
    );
}

function nearbyActorIds(perception: unknown): string[] {
    const nearby = readPath(perception, 'nearby') || readPath(perception, 'actors') || [];
    if (!Array.isArray(nearby)) {
        return [];
    }
    return nearby.map(actorId).filter((id): id is string => Boolean(id));
}

function actionSkill(action: AgentAction): string | undefined {
    const record = action as Record<string, unknown>;
    const explicit = normalizeSkill(record.skill || readPath(record, 'target.skill') || readPath(record, 'target.key'));
    if (explicit) {
        return explicit;
    }

    const text = `${record.kind || ''} ${record.option || ''}`.toLowerCase();
    for (const skill of [
        'cooking',
        'fishing',
        'woodcutting',
        'mining',
        'smithing',
        'crafting',
        'firemaking',
        'fletching',
        'herblore',
        'runecrafting',
    ]) {
        if (text.includes(skill)) {
            return skill;
        }
    }
    return undefined;
}

function isXpEvent(event: Record<string, unknown>): boolean {
    return eventKind(event, ['xp_gained', 'skill_xp_gained', 'skill_xp']);
}

function isLevelEvent(event: Record<string, unknown>): boolean {
    return eventKind(event, ['level_up', 'skill_level', 'skill_level_up']);
}

function eventKind(event: Record<string, unknown>, kinds: string[]): boolean {
    const kind = String(event.kind || event.type || event.event || '');
    return kinds.includes(kind);
}

function eventSkill(event: Record<string, unknown>): string | undefined {
    return normalizeSkill(event.skill || readPath(event, 'skill.name') || readPath(event, 'skill.key'));
}

function eventLevel(event: Record<string, unknown>): number {
    return Number(event.level || event.newLevel || readPath(event, 'skill.level') || 0);
}

function actorId(value: unknown): string | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    return stringValue(
        value.id ||
            value.actorId ||
            value.playerId ||
            value.residentId ||
            value.name ||
            readPath(value, 'actor.id') ||
            readPath(value, 'actor.name'),
    );
}

function npcKey(event: Record<string, unknown>): string {
    return String(event.npcKey || readPath(event, 'npc.key') || readPath(event, 'target.key') || '');
}

function teachingText(text: string): boolean {
    return /teach|show|here.{0,20}how|like this/i.test(text);
}

function numberParam(soul: Soul, keys: string[], fallback: number): number {
    const params = soul.frontmatter.legacy?.parameters || {};
    for (const key of keys) {
        const value = Number(params[key]);
        if (Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
}

export function endurerTargetTicks(soul: Soul): number {
    return numberParam(
        soul,
        ['targetTicksLived', 'targetTicks'],
        soul.frontmatter.heroProfile?.tier === 'hero' ? HERO_ENDURER_TARGET_TICKS : DEFAULT_ENDURER_TARGET_TICKS,
    );
}

function objectArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value.filter(isRecord) as T[]) : [];
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(stringValue).filter((item): item is string => Boolean(item)) : [];
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeSkill(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim().toLowerCase().replace(/\s+/g, '_') : undefined;
}

function readPath(value: unknown, dottedPath: string): unknown {
    let current = value;
    for (const part of dottedPath.split('.').filter(Boolean)) {
        if (!isRecord(current)) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
