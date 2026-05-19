import type { NpcInteractionActionHook, npcInteractionActionHandler } from '@engine/action/pipe/npc-interaction.action';
import { CombatTask } from '@engine/world/actor/combat/combat-task';
import { createPlayerMeleeStrategy } from '@engine/world/actor/combat/melee-strategy';
import { createPlayerRangedStrategy } from '@engine/world/actor/combat/ranged-strategy';
import { canAttackSlayerTarget } from '@plugins/skills/slayer/slayer-level-gate';

const attackNpc: npcInteractionActionHandler = ({ player, npc }) => {
    const slayerGate = canAttackSlayerTarget(player, npc);
    if (!slayerGate.ok) {
        player.sendMessage(slayerGate.reason, true);
        return;
    }

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
