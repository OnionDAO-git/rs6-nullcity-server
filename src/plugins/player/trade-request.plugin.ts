import type { playerInteractionActionHandler } from '@engine/action/pipe/player-interaction.action';
import { TradeEngine } from '@engine/world/actor/trade/trade-engine';

export const handler: playerInteractionActionHandler = ({ player, otherPlayer }) => {
    TradeEngine.beginRequest(player, otherPlayer);
};

export default {
    pluginId: 'rs:trade_request',
    hooks: [
        {
            type: 'player_interaction',
            options: 'trade',
            walkTo: true,
            handler,
        },
    ],
};
