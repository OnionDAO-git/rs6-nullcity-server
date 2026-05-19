import type { commandActionHandler } from '@engine/action/pipe/player-command.action';
import { activeWorld } from '@engine/world';
import { Position } from '@engine/world/position';
import { World } from '@engine/world/world';

const handler: commandActionHandler = ({ player, args }) => {
    const playerCount = args.playerCount as number;

    if (playerCount > World.MAX_PLAYERS - 1) {
        player.sendMessage(`Error: Max player count is ${World.MAX_PLAYERS - 1}.`);
        return;
    }

    const x: number = player.position.x;
    const y: number = player.position.y;

    const worldSlotsRemaining = activeWorld.playerSlotsRemaining() - 1;
    if (worldSlotsRemaining <= 0) {
        player.sendMessage(`Error: The game world is full.`);
        return;
    }

    const playerSpawnCount = playerCount > worldSlotsRemaining ? worldSlotsRemaining : playerCount;

    if (playerSpawnCount < playerCount) {
        player.sendMessage(`Warning: There was only room for ${playerSpawnCount}/${playerCount} player spawns.`);
    }

    activeWorld.spawnFakeResidents(playerSpawnCount, new Position(x, y, 0)).catch(error => player.sendMessage(error?.message || String(error)));
};

export default {
    pluginId: 'rs:spawn_test_players_command',
    hooks: [
        {
            type: 'player_command',
            commands: ['spawn_players', 'spawnplayers'],
            args: [
                {
                    name: 'playerCount',
                    type: 'number',
                },
            ],
            handler,
        },
    ],
};
