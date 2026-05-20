import type { buttonActionHandler } from '@engine/action/pipe/button.action';
import { widgets } from '@engine/config/config-handler';
import { activeWorld } from '@engine/world';
import type { Player } from '@engine/world/actor/player/player';

export const handler: buttonActionHandler = details => {
    const { player } = details;
    const playerName = player.username.toLowerCase();
    player.logout();

    // Update online players friends lists that have this player as a friend
    const otherPlayers = activeWorld.playerList.filter((p): p is Player => p !== null && p.friendsList.indexOf(playerName) !== -1);
    if (otherPlayers && otherPlayers.length !== 0) {
        otherPlayers.forEach(otherPlayer => otherPlayer.outgoingPackets.updateFriendStatus(playerName, 0));
    }
};

export default {
    pluginId: 'rs:logout_button',
    hooks: [
        {
            type: 'button',
            widgetId: widgets.logoutTab,
            buttonIds: 6,
            handler,
        },
    ],
};
