import type { playerInitActionHandler } from '@engine/action/pipe/player-init.action';
import { findNpc } from '@engine/config/config-handler';
import { Task } from '@engine/task/task';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { isNpc } from '@engine/world/actor/util';
import { CombatTask } from '@engine/world/actor/combat/combat-task';
import { createNpcMeleeStrategy } from '@engine/world/actor/combat/npc-melee-strategy';
import { activeWorld } from '@engine/world';

const DEFAULT_AGGRESSION_RADIUS = 6;

function aggressionRadius(npc: Npc): number {
    try {
        const details = findNpc(npc.id);
        if (details?.metadata?.aggressive !== true) {
            return 0;
        }
        const configured = details.metadata.aggression_radius;
        return typeof configured === 'number' && configured > 0 ? configured : DEFAULT_AGGRESSION_RADIUS;
    } catch {
        return 0;
    }
}

function tryAggress(player: Player): void {
    if (!player.isActive || player.inCombat || player.skills.hitpoints.level <= 0) {
        return;
    }

    for (const actor of activeWorld.npcList) {
        if (!actor || !isNpc(actor) || actor.inCombat || actor.skills.hitpoints.level <= 0) {
            continue;
        }

        const npc = actor as Npc;
        const radius = aggressionRadius(npc);
        if (radius <= 0 || npc.instanceId !== player.instance.instanceId || npc.position.level !== player.position.level) {
            continue;
        }

        if (Math.floor(npc.position.distanceBetween(player.position)) > radius) {
            continue;
        }

        npc.enqueueBaseTask(new CombatTask(npc, player, createNpcMeleeStrategy(npc)));
        return;
    }
}

class NpcAggressionTask extends Task {
    public constructor(private readonly player: Player) {
        super({ interval: 2, repeat: true, immediate: false });
    }

    public execute(): void {
        tryAggress(this.player);
    }
}

const initAction: playerInitActionHandler = ({ player }) => {
    player.enqueueBaseTask(new NpcAggressionTask(player));
};

export default {
    pluginId: 'rs:npc_aggression',
    hooks: [
        {
            type: 'player_init',
            handler: initAction,
        },
    ],
};
