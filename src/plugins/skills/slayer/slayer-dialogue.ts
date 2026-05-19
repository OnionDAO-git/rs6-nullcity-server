import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import { selectSlayerAssignment } from './slayer-assignment';
import type { SlayerMaster } from './slayer-config';
import { getSlayerAssignment, setSlayerAssignment } from './slayer-state';

export function handleSlayerMasterInteraction(player: Player, npc: Npc, master: SlayerMaster): void {
    npc.face(player, false, false, false);
    player.face(npc, false, false, false);

    const active = getSlayerAssignment(player);
    if (active) {
        player.sendMessage(`Your current Slayer assignment is ${active.displayName}; ${active.remaining} remaining.`);
        return;
    }

    const assignment = selectSlayerAssignment(master, player.skills.slayer.level);
    if (!assignment) {
        player.sendMessage('I do not have a Slayer assignment suitable for you right now.');
        return;
    }

    setSlayerAssignment(player, assignment);
    player.sendMessage(`Your new Slayer assignment is ${assignment.remaining} ${assignment.displayName}.`);
}
