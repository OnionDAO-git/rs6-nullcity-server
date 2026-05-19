import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import { getSlayerRequirement } from './slayer-config';

export function canAttackSlayerTarget(player: Player, npc: Npc): { ok: true } | { ok: false; reason: string } {
    const requirement = getSlayerRequirement(npc.key);
    if (!requirement || player.skills.hasLevel(Skill.SLAYER, requirement.level)) {
        return { ok: true };
    }
    return {
        ok: false,
        reason: requirement.message ?? `You need a Slayer level of ${requirement.level} to fight this creature.`,
    };
}
