import { logger } from '@runejs/common';
import { SocketServer, parseServerConfig } from '@runejs/common/net';
import { Filestore } from '@runejs/filestore';

import { loadCoreConfigurations, loadGameConfigurations, xteaRegions } from '@engine/config/config-handler';
import { loadPackets } from '@engine/net/inbound-packet-handler';
import { watchForChanges, watchSource } from '@engine/util/files';
import { activateGameWorld } from '@engine/world';
import { AgentGateway } from '@server/agent/gateway';
import type { GameServerConfig } from '@server/game/game-server-config';
import { GatewayServer } from '@server/gateway/gateway-server';

/**
 * The singleton instance containing the server's active configuration settings.
 */
export let serverConfig: GameServerConfig;

/**
 * The singleton instance referencing the game's asset file store.
 */
export let filestore: Filestore;

export const openGatewayServer = (host: string, port: number): void => {
    SocketServer.launch<GatewayServer>('Game Gateway Server', host, port, socket => new GatewayServer(socket));
};

export async function setupConfig(): Promise<boolean> {
    serverConfig = parseServerConfig<GameServerConfig>();

    if (!serverConfig) {
        logger.error('Unable to start server due to missing or invalid server configuration.');
        return false;
    }

    await loadCoreConfigurations();
    filestore = new Filestore('cache', { xteas: xteaRegions });

    await loadGameConfigurations();
    return true;
}

/**
 * Configures the game server, parses the asset file store, initializes the game world,
 * and finally spins up the game server itself.
 */
export async function launchGameServer(): Promise<void> {
    const config = await setupConfig();
    if (!config) {
        return;
    }
    await loadPackets();
    const world = await activateGameWorld();

    if (serverConfig.agentGateway?.enabled) {
        await new AgentGateway({
            ...serverConfig.agentGateway,
            host: serverConfig.agentGateway.host || '127.0.0.1',
            port: serverConfig.agentGateway.port || 43595,
        }).start();
    }

    if (process.argv.indexOf('-fakePlayers') !== -1 || process.argv.indexOf('-fakeResidents') !== -1) {
        await world.spawnFakeResidents();
    }

    openGatewayServer(serverConfig.host, serverConfig.port);

    watchSource('src/').subscribe(() => world.saveOnlinePlayers());
    watchForChanges('dist/plugins/', /[/\\]plugins[/\\]/);
}
