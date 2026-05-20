import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { AgentAction, Perception, PerceptionEvent } from '../transport/message-codecs';
import type { ThinkingModule, ThoughtResult } from './thinking-module';

export interface BasicAgentThinkingModuleOptions {
    soul: Soul;
    state: RuntimeState;
}

type Pos = { x: number; y: number; level: number };
type Actor = { id: string; kind: 'player' | 'npc' | 'resident'; name?: string; key?: string; position: Pos; hpFraction?: number };
type Item = { itemId: number; key?: string; amount: number };
type WorldItem = Item & { position: Pos; ownerId?: string };
type ObjectRef = { objectId: number; position: Pos; orientation?: number };
type BasicPerception = {
    tick?: number;
    resident?: {
        position?: Pos;
        hp?: { current?: number; max?: number };
        inCombat?: boolean;
        combatTarget?: Actor | null;
        busy?: boolean;
        inventory?: Array<Item | null>;
    };
    nearby?: {
        players?: Actor[];
        npcs?: Actor[];
        worldItems?: WorldItem[];
        objects?: ObjectRef[];
    };
    events?: PerceptionEvent[];
};
type ChatCommand = { speaker: Actor; text: string; command: string };

const DEFAULT_FOLLOW_RADIUS = 2;
const DEFAULT_COMMENT_EVERY_TICKS = 60;
const AMBIENT_REPEAT_SUPPRESSION_TICKS = 600;
const FOLLOW_MOVE_RETRY_TICKS = 60;
const FIREMAKING_AUTONOMY_PAUSE_TICKS = 120;
const FOOD_KEY_PATTERN = /(food|shrimp|anchovies|sardine|herring|trout|salmon|tuna|lobster|bass|swordfish|monkfish|shark|manta|karambwan|bread|cake|meat|chicken)/i;
const TINDERBOX_ITEM_IDS = new Set([590]);
const FIREMAKING_LOG_ITEM_IDS = new Set([1511, 2862, 1521, 1519, 6333, 1517, 6332, 1515, 1513]);
const FIREMAKING_LOG_KEY_PATTERN = /^rs:(logs|.*_logs)$/i;

export class BasicAgentThinkingModule implements ThinkingModule {
    private readonly commandPrefix: string;
    private readonly followRadius: number;
    private readonly commentEveryTicks: number;
    private followEnabled: boolean;
    private followTarget?: string;
    private guardTarget?: string;
    private lastFollowMoveTarget?: Pos;
    private lastFollowMoveTick = -Infinity;
    private lastCommentTick = 0;
    private recentAmbientObservationTicks = new Map<string, number>();
    private lastPlayerAttackWarningTick = new Map<string, number>();
    private suppressAutonomyUntilTick = -Infinity;

    constructor(private readonly options: BasicAgentThinkingModuleOptions) {
        const behavior =
            options.soul.frontmatter.behavior?.kind === 'basic-agent' ? options.soul.frontmatter.behavior : undefined;
        this.commandPrefix = normalizeText(behavior?.commandPrefix || displayName(options.soul.frontmatter.name));
        this.followTarget = behavior?.followPlayer ? normalizeText(behavior.followPlayer) : undefined;
        this.followEnabled = Boolean(this.followTarget);
        this.followRadius = behavior?.followRadius ?? DEFAULT_FOLLOW_RADIUS;
        this.commentEveryTicks = behavior?.commentEveryTicks ?? DEFAULT_COMMENT_EVERY_TICKS;
    }

    async think(perception: Perception): Promise<ThoughtResult> {
        this.advanceTick(perception);
        const view = perception as BasicPerception;

        const lowHealthFood = this.lowHealthFoodSlot(view);
        if (lowHealthFood !== undefined) {
            return this.result([{ kind: 'eat', slot: lowHealthFood }], 'low_health_eat');
        }

        const command = this.addressedCommand(view);
        if (command) {
            return this.result(this.handleCommand(command, view), 'chat_command');
        }

        const combatAction = this.combatReaction(view);
        if (combatAction) {
            return this.result([combatAction], 'combat_reaction');
        }

        if (view.resident?.busy || this.options.state.tick < this.suppressAutonomyUntilTick) {
            return { actions: [], cause: 'idle', nooped: true };
        }

        const followAction = this.followAction(view);
        if (followAction) {
            return this.result([followAction], 'follow_target');
        }

        const comment = this.ambientComment(view);
        if (comment) {
            return this.result([{ kind: 'say', text: comment }], 'ambient_comment');
        }

        return { actions: [], cause: 'idle', nooped: true };
    }

    considerInterrupt(perception: Perception): boolean {
        const view = perception as BasicPerception;
        return Boolean(this.addressedCommand(view) || this.lowHealthFoodSlot(view) !== undefined || this.latestHitTaken(view));
    }

    stop(_cause: string): void {
        // Basic agent decisions are synchronous and do not keep inflight work.
    }

    private handleCommand(command: ChatCommand, perception: BasicPerception): AgentAction[] {
        const text = command.command;

        if (!text || /^(hi|hello|hey)\b/.test(text)) {
            return [{ kind: 'say', text: 'I can hear you. Tell me: follow me, stay, what do you see, or talk to an NPC.' }];
        }

        if (/^(follow me|follow|keep up|guard me|guard)\b/.test(text)) {
            this.followTarget = normalizeText(command.speaker.name || command.speaker.id);
            this.guardTarget = /^guard/.test(text) ? this.followTarget : this.guardTarget;
            this.followEnabled = true;
            this.lastFollowMoveTarget = undefined;
            return [{ kind: 'say', text: /^guard/.test(text) ? `Guarding you, ${actorName(command.speaker)}.` : `Following you, ${actorName(command.speaker)}.` }];
        }

        if (/^(stay|wait|stop|stop following|hold position)\b/.test(text)) {
            this.followEnabled = false;
            this.lastFollowMoveTarget = undefined;
            return [{ kind: 'say', text: 'Staying here.' }];
        }

        if (/^(come here|come to me)\b/.test(text)) {
            this.followTarget = normalizeText(command.speaker.name || command.speaker.id);
            this.followEnabled = true;
            this.lastFollowMoveTarget = undefined;
            return [{ kind: 'move_to', target: command.speaker.position }];
        }

        if (/^(what do you see|look|suggest|actions|what can we do)\b/.test(text)) {
            return [{ kind: 'say', text: this.describe(perception) }];
        }

        if (/^(inventory|what are you carrying|what do you have|supplies)\b/.test(text)) {
            return [{ kind: 'say', text: this.describeInventory(perception) }];
        }

        if (/^(make a fire|light a fire|light fire|start a fire|light logs|burn logs|firemaking)\b/.test(text)) {
            return this.makeFire(perception);
        }

        const say = text.match(/^say\s+(.+)/);
        if (say) {
            return [{ kind: 'say', text: cleanSpeech(say[1]) || 'I am here.' }];
        }

        const talk = text.match(/^talk to\s+(.+)/);
        if (talk) {
            const npc = this.findActor(perception.nearby?.npcs || [], talk[1]);
            return npc ? [{ kind: 'interact', target: npc, option: 'talk-to' }] : [{ kind: 'say', text: `I do not see ${cleanTarget(talk[1])} from here.` }];
        }

        const attack = text.match(/^attack\s+(.+)/);
        if (attack) {
            const target = this.findActor([...(perception.nearby?.npcs || []), ...(perception.nearby?.players || [])], attack[1]);
            return target ? [{ kind: 'attack', target }] : [{ kind: 'say', text: `I do not see ${cleanTarget(attack[1])} from here.` }];
        }

        const pickup = text.match(/^(pick up|take|loot)(?:\s+(.+))?/);
        if (pickup) {
            const query = pickup[2] ? cleanTarget(pickup[2]) : undefined;
            const item = query ? this.findWorldItem(perception.nearby?.worldItems || [], query) : (perception.nearby?.worldItems || [])[0];
            if (item) {
                return [{ kind: 'interact', target: item, option: 'pick-up' }];
            }
            return [{ kind: 'say', text: query ? `I do not see ${query} on the ground.` : 'I do not see an item to pick up.' }];
        }

        const drop = text.match(/^drop(?:\s+(.+))?/);
        if (drop) {
            const query = drop[1] ? cleanTarget(drop[1]) : '';
            if (!query) {
                return [{ kind: 'say', text: 'Tell me what to drop.' }];
            }
            const slot = findSlot(perception.resident?.inventory || [], item => itemMatchesQuery(item, query));
            return slot === undefined ? [{ kind: 'say', text: `I am not carrying ${query}.` }] : [{ kind: 'drop', slot }];
        }

        if (/^eat\b/.test(text)) {
            const slot = firstFoodSlot(perception.resident?.inventory || []);
            return slot === undefined ? [{ kind: 'say', text: 'I do not have food I recognize.' }] : [{ kind: 'eat', slot }];
        }

        if (/^(run away|flee|retreat)\b/.test(text)) {
            return [{ kind: 'move_to', target: this.fleeTarget(perception) }];
        }

        return [{ kind: 'say', text: 'I understood my name, but not that command yet.' }];
    }

    private makeFire(perception: BasicPerception): AgentAction[] {
        if (perception.resident?.busy) {
            return [{ kind: 'say', text: 'I am already busy trying something.' }];
        }

        const inventory = perception.resident?.inventory || [];
        const tinderboxSlot = findSlot(inventory, isTinderbox);
        const logSlot = findSlot(inventory, isFiremakingLog);
        if (logSlot !== undefined) {
            if (tinderboxSlot === undefined) {
                return [{ kind: 'say', text: 'I have logs, but I need a tinderbox before I can make a fire.' }];
            }
            this.pauseAutonomyForFiremaking();
            return [{ kind: 'use_item_on_item', itemSlot: tinderboxSlot, targetSlot: logSlot }];
        }

        const groundLog = (perception.nearby?.worldItems || []).find(isFiremakingLog);
        if (tinderboxSlot === undefined) {
            return [
                {
                    kind: 'say',
                    text: groundLog
                        ? 'I see logs nearby, but I need a tinderbox before I can make a fire.'
                        : 'I need a tinderbox and logs before I can make a fire.',
                },
            ];
        }
        if (groundLog) {
            this.pauseAutonomyForFiremaking();
            return [{ kind: 'use_item_on', itemSlot: tinderboxSlot, target: groundLog }];
        }

        return [{ kind: 'say', text: 'I have a tinderbox, but I need logs before I can make a fire.' }];
    }

    private combatReaction(perception: BasicPerception): AgentAction | undefined {
        const hit = this.latestHitTaken(perception);
        const attacker = hit?.from || perception.resident?.combatTarget || undefined;
        if (!attacker) {
            return undefined;
        }

        if (attacker.kind === 'player') {
            const previousWarning = this.lastPlayerAttackWarningTick.get(attacker.id) || -1000;
            if (this.options.state.tick - previousWarning < 20) {
                return undefined;
            }
            this.lastPlayerAttackWarningTick.set(attacker.id, this.options.state.tick);
            return {
                kind: 'say',
                text: `${actorName(attacker)} is attacking me. Tell me "${this.commandPrefix} attack ${actorName(attacker)}" if I should fight back.`,
            };
        }

        return { kind: 'attack', target: attacker };
    }

    private followAction(perception: BasicPerception): AgentAction | undefined {
        if (!this.followEnabled || !this.followTarget) {
            return undefined;
        }

        const target = this.findActor(perception.nearby?.players || [], this.followTarget);
        const resident = perception.resident?.position;
        if (!target || !resident || distance(resident, target.position) <= this.followRadius) {
            return undefined;
        }

        if (samePosition(target.position, this.lastFollowMoveTarget) && this.options.state.tick - this.lastFollowMoveTick < FOLLOW_MOVE_RETRY_TICKS) {
            return undefined;
        }

        this.lastFollowMoveTarget = { ...target.position };
        this.lastFollowMoveTick = this.options.state.tick;
        return { kind: 'move_to', target: target.position };
    }

    private ambientComment(perception: BasicPerception): string | undefined {
        if (this.commentEveryTicks <= 0 || this.options.state.tick - this.lastCommentTick < this.commentEveryTicks) {
            return undefined;
        }
        const text = this.shortObservation(perception);
        if (!text) {
            return undefined;
        }
        const lastMentionedTick = this.recentAmbientObservationTicks.get(text);
        if (lastMentionedTick !== undefined && this.options.state.tick - lastMentionedTick < AMBIENT_REPEAT_SUPPRESSION_TICKS) {
            return undefined;
        }
        this.lastCommentTick = this.options.state.tick;
        this.rememberAmbientObservation(text);
        return text;
    }

    private lowHealthFoodSlot(perception: BasicPerception): number | undefined {
        const hp = perception.resident?.hp;
        const max = Number(hp?.max || 0);
        if (max <= 0 || Number(hp?.current || 0) / max > 0.4) {
            return undefined;
        }
        return firstFoodSlot(perception.resident?.inventory || []);
    }

    private latestHitTaken(perception: BasicPerception): { from?: Actor } | undefined {
        return [...(perception.events || [])].reverse().find(event => {
            const kind = (event as { kind?: unknown }).kind;
            return kind === 'hit_taken' || kind === 'hit' || kind === 'attacked';
        }) as { from?: Actor } | undefined;
    }

    private addressedCommand(perception: BasicPerception): ChatCommand | undefined {
        for (const event of [...(perception.events || [])].reverse()) {
            if ((event as { kind?: unknown }).kind !== 'chat') {
                continue;
            }
            const chat = event as { from?: Actor; text?: unknown };
            if (!chat.from || typeof chat.text !== 'string') {
                continue;
            }
            const parsed = parseAddressedCommand(chat.text, this.commandPrefix);
            if (parsed !== undefined) {
                return { speaker: chat.from, text: chat.text, command: parsed };
            }
        }
        return undefined;
    }

    private findActor(actors: Actor[], query: string): Actor | undefined {
        const wanted = normalizeText(cleanTarget(query));
        return actors.find(actor => {
            const names = [actor.name, actor.key, actor.id].filter((value): value is string => Boolean(value));
            return names.some(name => normalizeText(name).includes(wanted) || wanted.includes(normalizeText(name)));
        });
    }

    private findWorldItem(items: WorldItem[], query: string): WorldItem | undefined {
        return items.find(item => itemMatchesQuery(item, query));
    }

    private describe(perception: BasicPerception): string {
        const npc = perception.nearby?.npcs?.[0];
        if (npc) {
            return `I see ${actorName(npc)} nearby. You can tell me "${this.commandPrefix} talk to ${actorName(npc)}" or lead me somewhere else.`;
        }
        const item = perception.nearby?.worldItems?.[0];
        if (item) {
            return `I see ${item.key || `item ${item.itemId}`} on the ground. You can tell me "${this.commandPrefix} pick up item".`;
        }
        const object = perception.nearby?.objects?.[0];
        if (object) {
            return 'I see nearby scenery we may be able to inspect. Lead me closer if you want to try it.';
        }
        const player = perception.nearby?.players?.[0];
        if (player) {
            return `I see ${actorName(player)} nearby.`;
        }
        return 'I do not see anything actionable nearby.';
    }

    private shortObservation(perception: BasicPerception): string | undefined {
        const npc = perception.nearby?.npcs?.[0];
        if (npc) {
            return `I can see ${actorName(npc)} nearby. Maybe walk us closer and we can talk.`;
        }
        const object = perception.nearby?.objects?.[0];
        if (object) {
            return 'I see nearby scenery we may be able to inspect.';
        }
        return undefined;
    }

    private describeInventory(perception: BasicPerception): string {
        const counts = new Map<string, number>();
        for (const item of perception.resident?.inventory || []) {
            if (!item) {
                continue;
            }
            const label = itemLabel(item);
            counts.set(label, (counts.get(label) || 0) + item.amount);
        }
        if (counts.size === 0) {
            return 'I am not carrying anything.';
        }
        const labels = [...counts.entries()].map(([label, amount]) => (amount > 1 ? `${label} x${amount}` : label));
        return `I am carrying ${labels.join(', ')}.`;
    }

    private fleeTarget(perception: BasicPerception): Pos {
        const here = perception.resident?.position || { x: 0, y: 0, level: 0 };
        const threat = this.latestHitTaken(perception)?.from || perception.resident?.combatTarget;
        if (!threat) {
            return { x: here.x + 4, y: here.y, level: here.level };
        }
        return {
            x: here.x + Math.sign(here.x - threat.position.x || 1) * 4,
            y: here.y + Math.sign(here.y - threat.position.y || 1) * 4,
            level: here.level,
        };
    }

    private advanceTick(perception: Perception): void {
        const perceptionTick = typeof perception.tick === 'number' ? perception.tick : 0;
        this.options.state.tick = Math.max(this.options.state.tick + 1, perceptionTick);
    }

    private result(actions: AgentAction[], cause: string): ThoughtResult {
        return { actions, cause, nooped: actions.length === 0 };
    }

    private rememberAmbientObservation(text: string): void {
        this.recentAmbientObservationTicks.set(text, this.options.state.tick);
        for (const [observation, mentionedTick] of this.recentAmbientObservationTicks) {
            if (this.options.state.tick - mentionedTick > AMBIENT_REPEAT_SUPPRESSION_TICKS * 2) {
                this.recentAmbientObservationTicks.delete(observation);
            }
        }
    }

    private pauseAutonomyForFiremaking(): void {
        this.suppressAutonomyUntilTick = this.options.state.tick + FIREMAKING_AUTONOMY_PAUSE_TICKS;
    }
}

function parseAddressedCommand(text: string, prefix: string): string | undefined {
    const clean = text.trim();
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = clean.match(new RegExp(`^${escaped}\\b[\\s,:;-]*(.*)$`, 'i'));
    return match ? normalizeCommand(match[1]) : undefined;
}

function normalizeCommand(text: string): string {
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeText(text: string): string {
    return text
        .replace(/^res:/i, '')
        .replace(/^player:/i, '')
        .replace(/^npc:/i, '')
        .trim()
        .toLowerCase();
}

function displayName(name: string): string {
    return name.replace(/^res:/i, '');
}

function actorName(actor: Actor): string {
    return actor.name || actor.key || displayName(actor.id);
}

function cleanTarget(text: string): string {
    return text.trim().replace(/[.!?]+$/g, '');
}

function cleanSpeech(text: string): string {
    return text.trim().replace(/\s+/g, ' ').slice(0, 140);
}

function distance(a: Pos, b: Pos): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function samePosition(a: Pos, b: Pos | undefined): boolean {
    return Boolean(b && a.x === b.x && a.y === b.y && a.level === b.level);
}

function firstFoodSlot(inventory: Array<Item | null>): number | undefined {
    const slot = inventory.findIndex(item => Boolean(item?.key && FOOD_KEY_PATTERN.test(item.key)));
    return slot >= 0 ? slot : undefined;
}

function findSlot(inventory: Array<Item | null>, predicate: (item: Item) => boolean): number | undefined {
    const slot = inventory.findIndex(item => Boolean(item && predicate(item)));
    return slot >= 0 ? slot : undefined;
}

function itemMatchesQuery(item: Item, query: string): boolean {
    const wanted = normalizeText(cleanTarget(query)).replace(/\s+/g, '_');
    const labels = [item.key, itemLabel(item), String(item.itemId)].filter((value): value is string => Boolean(value));
    return labels.some(label => {
        const normalized = normalizeText(label).replace(/\s+/g, '_');
        return normalized === wanted || normalized.endsWith(`:${wanted}`) || normalized.includes(wanted) || wanted.includes(normalized);
    });
}

function itemLabel(item: Item): string {
    return (item.key || `item ${item.itemId}`)
        .replace(/^rs:/i, '')
        .replace(/_/g, ' ')
        .trim()
        .toLowerCase();
}

function isTinderbox(item: Item): boolean {
    return TINDERBOX_ITEM_IDS.has(item.itemId) || item.key?.toLowerCase() === 'rs:tinderbox';
}

function isFiremakingLog(item: Item): boolean {
    return FIREMAKING_LOG_ITEM_IDS.has(item.itemId) || Boolean(item.key && FIREMAKING_LOG_KEY_PATTERN.test(item.key));
}
