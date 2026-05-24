import type { playerInitActionHandler } from '@engine/action/pipe/player-init.action';
import { Task } from '@engine/task/task';
import type { Player } from '@engine/world/actor/player/player';

export const HITPOINTS_REGEN_INTERVAL_TICKS = 100;

export interface HitpointsRegenerationPlayer {
    isActive: boolean;
    skills: {
        hitpoints: { level: number; exp: number };
        getMaxLevel(skill: 'hitpoints'): number;
        getSkillId(skill: 'hitpoints'): number;
    };
    outgoingPackets: {
        updateSkill(skill: number, level: number, exp: number): void;
    };
}

export function regenerateHitpoints(player: HitpointsRegenerationPlayer): boolean {
    const current = player.skills.hitpoints.level;
    if (current <= 0) {
        return false;
    }

    const max = player.skills.getMaxLevel('hitpoints');
    if (current >= max) {
        return false;
    }

    const next = Math.min(max, current + 1);
    player.skills.hitpoints.level = next;
    player.outgoingPackets.updateSkill(player.skills.getSkillId('hitpoints'), next, player.skills.hitpoints.exp);
    return true;
}

export class HitpointsRegenerationTask extends Task {
    public constructor(private readonly player: HitpointsRegenerationPlayer) {
        super({ interval: HITPOINTS_REGEN_INTERVAL_TICKS, repeat: true });
    }

    public execute(): void {
        if (!this.player.isActive) {
            this.stop();
            return;
        }

        regenerateHitpoints(this.player);
    }
}

const initHitpointsRegeneration: playerInitActionHandler = ({ player }) => {
    player.enqueueBaseTask(new HitpointsRegenerationTask(player));
};

export default {
    pluginId: 'rs:hitpoints_regeneration',
    hooks: [
        {
            type: 'player_init',
            handler: initHitpointsRegeneration,
        },
    ],
};
