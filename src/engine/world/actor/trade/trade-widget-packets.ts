import type { Player } from '@engine/world/actor/player/player';
import type { TradeEvent } from './trade-events';

export const TradeWidgetPackets = {
    send(_player: Player, _event: TradeEvent): void {
        // Real-player trade widget packets are intentionally left as a UI layer.
        // The server-side trade lifecycle is actor agnostic and emits chatbox
        // fallbacks for real players in trade-events.ts.
    },
};
