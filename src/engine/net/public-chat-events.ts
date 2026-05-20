import { activeWorld } from '@engine/world';
import type { Player } from '@engine/world/actor/player/player';
import type { Resident } from '@engine/world/actor/resident/resident';
import { isResident } from '@engine/world/actor/util';

export function publishPublicChatToNearbyResidents(player: Player, text: string, visionRange = 15): void {
    const clean = text.trim();
    if (!clean) {
        return;
    }

    const maxHp = player.skills.getMaxLevel('hitpoints');
    const from = {
        id: `player:${player.username.toLowerCase()}`,
        kind: 'player' as const,
        name: player.username,
        position: { x: player.position.x, y: player.position.y, level: player.position.level },
        hpFraction: maxHp <= 0 ? 0 : player.skills.hitpoints.level / maxHp,
    };

    for (const nearbyPlayer of activeWorld.playerList || []) {
        if (
            !nearbyPlayer ||
            nearbyPlayer.equals(player) ||
            !nearbyPlayer.isActive ||
            !isResident(nearbyPlayer) ||
            !isNearby(player.position, nearbyPlayer.position, visionRange)
        ) {
            continue;
        }
        (nearbyPlayer as Resident).emitPerceptionEvent({ kind: 'chat', from, text: clean, to: 'public' });
    }
}

function isNearby(
    a: { x: number; y: number; level?: number },
    b: { x: number; y: number; level?: number },
    maxDistance: number,
): boolean {
    return (a.level ?? 0) === (b.level ?? 0) && Math.abs(a.x - b.x) <= maxDistance && Math.abs(a.y - b.y) <= maxDistance;
}
