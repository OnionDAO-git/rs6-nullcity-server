import { findItem } from '@engine/config/config-handler';
import { Isaac } from '@engine/net/isaac';
import type { OutboundPacketHandler } from '@engine/net/outbound-packet-handler';
import type { Actor } from '@engine/world/actor/actor';
import type { Npc } from '@engine/world/actor/npc';
import { Player } from '@engine/world/actor/player/player';
import {
    type PlayerSaveOptions,
    type ResidentAgentMetadata,
    type ResidentSave,
    loadPlayerSave,
} from '@engine/world/actor/player/player-data';
import { ActionAdapter } from '@engine/world/actor/resident/action/action-adapter';
import type { ActionResult, ActorRef, AgentAction, ItemRef, PerceptionEvent } from '@engine/world/actor/resident/action/agent-action';
import type { Brain } from '@engine/world/actor/resident/brain/brain';
import { ScriptedBrain } from '@engine/world/actor/resident/brain/scripted-brain';
import { NoopOutboundPacketHandler } from '@engine/world/actor/resident/noop-outbound-packet-handler';
import { createNullSocket } from '@engine/world/actor/resident/null-socket';
import { PerceptionBuilder } from '@engine/world/actor/resident/perception/perception-builder';
import type { Perception } from '@engine/world/actor/resident/perception/perception-types';
import { isResident } from '@engine/world/actor/util';
import type { Item } from '@engine/world/items/item';
import type { Chunk } from '@engine/world/map/chunk';

export const RESIDENT_BRAND = Symbol.for('nullcity.resident');
export const RESIDENT_SAVE_DIR = 'data/residents';

export interface ResidentOptions {
    clientUuid?: number;
    password?: string;
    isLowDetail?: boolean;
    brain?: Brain;
}

export class Resident extends Player {
    public readonly [RESIDENT_BRAND] = true;
    public readonly residentId: string;
    public readonly actionResults: ActionResult[] = [];
    public agentMetadata: ResidentAgentMetadata = {};

    private readonly perceptionBuilder = new PerceptionBuilder();
    private readonly actionAdapter = new ActionAdapter();
    private readonly eventBuffer: PerceptionEvent[] = [];
    private acceptedActions: AgentAction[] = [];
    private pendingDecision: Promise<void> | null = null;
    private latestPerception: Perception | null = null;
    private lastMoving = false;

    public constructor(
        username: string,
        private readonly brain: Brain = new ScriptedBrain(),
        options: ResidentOptions = {},
    ) {
        super(
            createNullSocket(),
            new Isaac([0, 0, 0, 0]),
            new Isaac([0, 0, 0, 0]),
            options.clientUuid ?? 0,
            username,
            options.password ?? '',
            options.isLowDetail ?? true,
        );

        this.residentId = `resident:${this.username.toLowerCase()}`;
        this.loadAgentMetadata();
    }

    public override async init(): Promise<void> {
        const playerChunk = this.initWorldState();
        await this.initContentState(playerChunk);
        await this.brain.onAttach?.(this);
    }

    public override logout(): void {
        this.brain.onDetach?.(this);
        super.logout();
    }

    public override handleDeath(attacker: Actor): void {
        this.emitPerceptionEvent({ kind: 'died', attacker: attacker ? this.actorRef(attacker) : null });
        this.save();
        super.handleDeath(attacker);
    }

    public override removeFirstItem(item: number | Item): number {
        const slot = this.inventory.findIndex(item);
        const removed = slot === -1 ? null : this.inventory.items[slot];
        const result = super.removeFirstItem(item);
        if (result !== -1 && removed) {
            this.emitPerceptionEvent({ kind: 'item_lost', item: this.itemRef(removed) });
        }
        return result;
    }

    public override removeItem(slot: number): void {
        const removed = this.inventory.items[slot];
        super.removeItem(slot);
        if (removed) {
            this.emitPerceptionEvent({ kind: 'item_lost', item: this.itemRef(removed) });
        }
    }

    public override async tick(): Promise<void> {
        this.applyAcceptedActions();
        await super.tick();

        if (this.lastMoving && !this.walkingQueue.moving()) {
            this.emitPerceptionEvent({ kind: 'arrived' });
        }
        this.lastMoving = this.walkingQueue.moving();
    }

    public publishPerception(): Perception {
        const perception = this.perceptionBuilder.build(this);
        this.latestPerception = perception;
        this.scheduleDecision(perception);
        return perception;
    }

    public enqueueActions(actions: AgentAction[]): void {
        this.acceptedActions.push(...actions);
    }

    public drainActionResults(): ActionResult[] {
        return this.actionResults.splice(0, this.actionResults.length);
    }

    public emitPerceptionEvent(event: PerceptionEvent): void {
        this.eventBuffer.push(event);
    }

    public drainPerceptionEvents(): PerceptionEvent[] {
        return this.eventBuffer.splice(0, this.eventBuffer.length);
    }

    public markControllerAttached(controllerId: string): void {
        this.agentMetadata.lastControllerId = controllerId;
        this.agentMetadata.lastAttachedAt = new Date().toISOString();
    }

    public markControllerDetached(): void {
        this.agentMetadata.lastDetachedAt = new Date().toISOString();
    }

    public toActorRef(): ActorRef {
        return {
            id: this.residentId,
            kind: 'resident',
            name: this.username,
            position: { x: this.position.x, y: this.position.y, level: this.position.level },
            hpFraction: this.skills.hitpoints.level / Math.max(1, this.skills.getMaxLevel('hitpoints')),
        };
    }

    public get perception(): Perception | null {
        return this.latestPerception;
    }

    protected override createOutboundPacketHandler(): OutboundPacketHandler {
        return new NoopOutboundPacketHandler(this);
    }

    protected override saveOptions(): PlayerSaveOptions {
        return { saveDir: RESIDENT_SAVE_DIR };
    }

    protected override async initClientPresentation(): Promise<void> {
        return;
    }

    protected override async initContentState(playerChunk: Chunk): Promise<void> {
        await super.initContentState(playerChunk);
        this.playerEvents.on('level_up', (event: { skill?: string; level?: number }) => {
            if (event.skill && typeof event.level === 'number') {
                this.emitPerceptionEvent({ kind: 'level_up', skill: event.skill, level: event.level });
            }
        });
        this.inventory.containerUpdated.subscribe(event => {
            if ((event.type === 'ADD' || event.type === 'UPDATE_AMOUNT') && event.item) {
                this.emitPerceptionEvent({ kind: 'item_received', item: this.itemRef(event.item) });
            }
        });
        this.outgoingPackets.flushQueue();
    }

    private applyAcceptedActions(): void {
        const actions = this.acceptedActions.splice(0, this.acceptedActions.length);
        for (const action of actions) {
            const result = this.actionAdapter.apply(this, action);
            this.actionResults.push(result);
        }
    }

    private loadAgentMetadata(): void {
        const playerSave = loadPlayerSave(this.username, this.saveOptions()) as ResidentSave | null;
        this.agentMetadata = playerSave?.agentMetadata || { createdAt: new Date().toISOString() };
    }

    private itemRef(item: Item): ItemRef {
        return {
            itemId: item.itemId,
            key: findItem(item.itemId)?.key,
            amount: item.amount,
        };
    }

    private actorRef(actor: Actor): ActorRef {
        if (actor.type === 'player') {
            const player = actor as Player;
            return {
                id: isResident(player) ? player.residentId : `player:${player.username.toLowerCase()}`,
                kind: isResident(player) ? 'resident' : 'player',
                name: player.username,
                position: { x: player.position.x, y: player.position.y, level: player.position.level },
                hpFraction: player.skills.hitpoints.level / Math.max(1, player.skills.getMaxLevel('hitpoints')),
            };
        }

        const npc = actor as Npc;
        return {
            id: `npc:${npc.worldIndex}`,
            kind: 'npc',
            key: npc.key,
            name: npc.name,
            position: { x: npc.position.x, y: npc.position.y, level: npc.position.level },
            hpFraction: npc.skills.hitpoints.level / Math.max(1, npc.skills.getMaxLevel('hitpoints')),
        };
    }

    private scheduleDecision(perception: Perception): void {
        if (this.pendingDecision) {
            return;
        }

        this.pendingDecision = Promise.resolve(this.brain.decide(perception))
            .then(actions => {
                this.acceptedActions.push(...(actions || []));
            })
            .catch(error => {
                this.actionResults.push({ ok: false, reason: error?.message || 'brain_error' });
            })
            .finally(() => {
                this.pendingDecision = null;
            });
    }
}
