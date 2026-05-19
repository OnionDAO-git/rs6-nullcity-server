import type { MagicOnNPCAction, MagicOnNPCActionHook } from '@engine/action/pipe/magic-on-npc.action';
import { CombatTask } from '@engine/world/actor/combat/combat-task';
import { createPlayerMagicStrategy } from '@engine/world/actor/combat/magic-strategy';
import { findSpellByButton } from '@engine/world/actor/magic';

/**
 * Standard-spellbook attack widget id. All currently-defined attack spells
 * live under this widget; we filter spell lookups against the widget id too
 * so this plugin can coexist with future ancient/lunar entries on different
 * widgets without renumbering.
 */
const STANDARD_SPELLBOOK_WIDGET_ID = 192;

const hook: MagicOnNPCActionHook = {
    type: 'magic_on_npc',
    widgetIds: [STANDARD_SPELLBOOK_WIDGET_ID],
    // Don't restrict buttonIds here — `findSpellByButton` decides whether the
    // button corresponds to a known attack spell, and falls through with a
    // chatbox message otherwise.
    handler: ({ npc, player, widgetId, buttonId }: MagicOnNPCAction) => {
        const spell = findSpellByButton(widgetId, buttonId);
        if (!spell) {
            player.outgoingPackets.chatboxMessage(
                `Unknown spell (widget ${widgetId} button ${buttonId}).`,
            );
            return;
        }

        const strategy = createPlayerMagicStrategy(player, spell);
        player.enqueueBaseTask(new CombatTask(player, npc, strategy));
    },
};

export default {
    pluginId: 'rs:magic_attack',
    hooks: [hook],
};
