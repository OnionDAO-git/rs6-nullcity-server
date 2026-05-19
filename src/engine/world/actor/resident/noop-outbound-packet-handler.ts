import { OutboundPacketHandler } from '@engine/net/outbound-packet-handler';
import type { Player } from '@engine/world/actor/player/player';

export class NoopOutboundPacketHandler extends OutboundPacketHandler {
    public constructor(player: Player) {
        super(player);
    }

    public override flushQueue(): void {
        this.clearQueues();
    }

    public override logout(): void {
        this.clearQueues();
    }
}
