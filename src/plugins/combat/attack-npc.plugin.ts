import type { NpcInteractionActionHook, npcInteractionActionHandler } from '@engine/action/pipe/npc-interaction.action';
import { CombatTask } from '@engine/world/actor/combat/combat-task';
import { createPlayerMeleeStrategy } from '@engine/world/actor/combat/melee-strategy';
import { createPlayerRangedStrategy } from '@engine/world/actor/combat/ranged-strategy';

const attackNpc: npcInteractionActionHandler = ({ player, npc }) => {
    const strategy = createPlayerRangedStrategy(player) ?? createPlayerMeleeStrategy(player);
    player.enqueueBaseTask(new CombatTask(player, npc, strategy));
};

const hook: NpcInteractionActionHook = {
    type: 'npc_interaction',
    options: 'attack',
    walkTo: false,
    handler: attackNpc,
};

export default {
    pluginId: 'rs:attack_npc',
    hooks: [hook],
};
