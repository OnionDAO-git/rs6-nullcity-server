import type { Actor } from '@engine/world/actor/actor';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { Skill } from '@engine/world/actor/skills';
import { isPlayer } from '@engine/world/actor/util';
import { npcMatchesAssignment, slayerXpForKill } from './slayer-assignment';
import { getGroupForNpc } from './slayer-config';
import { decrementSlayerAssignment, getSlayerAssignment } from './slayer-state';

export function handleSlayerKill(player: Player, npc: Npc): void {
    const assignment = getSlayerAssignment(player);
    if (!npcMatchesAssignment(npc.key, assignment)) {
        return;
    }

    const group = getGroupForNpc(npc.key);
    if (!group) {
        return;
    }

    player.skills.addExp(Skill.SLAYER, slayerXpForKill(group, npc.skills.hitpoints.level));
    const updated = decrementSlayerAssignment(player);
    if (!updated) {
        player.sendMessage('You have completed your Slayer assignment.');
        return;
    }
    player.sendMessage(`You have ${updated.remaining} ${updated.displayName} left to slay.`);
}

export function registerSlayerKillListener(npc: Npc): void {
    const metadata = npc.metadata as Npc['metadata'] & { slayerKillListenerRegistered?: boolean };
    if (metadata.slayerKillListenerRegistered) {
        return;
    }
    metadata.slayerKillListenerRegistered = true;
    npc.npcEvents.on('death', (assailant: Actor, defender: Actor) => {
        if (!isPlayer(assailant)) {
            return;
        }
        handleSlayerKill(assailant as Player, defender as Npc);
    });
}
