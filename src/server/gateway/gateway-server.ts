import type { Socket } from 'net';
import { createConnection } from 'net';

import { logger } from '@runejs/common';
import { ByteBuffer } from '@runejs/common';
import { SocketServer, parseServerConfig } from '@runejs/common/net';
import { LoginResponseCode } from '@runejs/login-server';

import { Isaac } from '@engine/net/isaac';
import { activeWorld } from '@engine/world';
import { Player } from '@engine/world/actor/player/player';
import type { GameServerConfig } from '@server/game/game-server-config';
import { GameServerConnection } from '@server/game/game-server-connection';

const serverConfig = parseServerConfig<GameServerConfig>();

export type ServerType = 'game_server' | 'login_server' | 'update_server';

export class GatewayServer extends SocketServer {
    private serverType: ServerType;
    private gameServerConnection: GameServerConnection;
    private loginServerSocket: Socket;
    private updateServerSocket: Socket;
    private serverKey: bigint;

    public constructor(private readonly clientSocket: Socket) {
        super(clientSocket);
    }

    public initialHandshake(buffer: ByteBuffer): boolean {
        if (this.serverType) {
            this.decodeMessage(buffer);
            return true;
        }

        // First communication from the game client to the server gateway
        // Here we find out what kind of connection the client is making - game, or update server?
        // If game - they'll need to pass through the login server to authenticate first!

        const packetId = buffer.get('byte', 'u');

        if (packetId === 15) {
            this.serverType = 'update_server';
            const updateTarget = upstreamTarget('update', serverConfig.updateServerHost, serverConfig.updateServerPort);
            this.updateServerSocket = createConnection(updateTarget);
            this.updateServerSocket.on('data', data => this.clientSocket.write(data));
            this.updateServerSocket.on('end', () => {
                logger.info(`Update server connection closed.`);
                this.clientSocket.destroy();
            });
            this.updateServerSocket.on('error', error => {
                logger.error(`Update server error (${updateTarget.host}:${updateTarget.port}): ${error.message}`);
                this.clientSocket.destroy();
            });
            this.updateServerSocket.on('timeout', () => {
                logger.error(`Update server timed out (${updateTarget.host}:${updateTarget.port}).`);
                this.updateServerSocket.destroy();
                this.clientSocket.destroy();
            });
            this.updateServerSocket.setNoDelay(true);
            this.updateServerSocket.setKeepAlive(true);
            this.updateServerSocket.setTimeout(30000);
        } else if (packetId === 14) {
            this.serverType = 'login_server';
            const loginTarget = upstreamTarget('login', serverConfig.loginServerHost, serverConfig.loginServerPort);
            this.loginServerSocket = createConnection(loginTarget);
            this.loginServerSocket.on('data', data => {
                this.parseLoginServerResponse(new ByteBuffer(data));
            });
            this.loginServerSocket.on('end', () => {
                logger.error(`Login server connection closed.`);
                this.clientSocket.destroy();
            });
            this.loginServerSocket.on('error', error => {
                logger.error(`Login server error (${loginTarget.host}:${loginTarget.port}): ${error.message}`);
                this.clientSocket.destroy();
            });
            this.loginServerSocket.on('timeout', () => {
                logger.error(`Login server timed out (${loginTarget.host}:${loginTarget.port}).`);
                this.loginServerSocket.destroy();
                this.clientSocket.destroy();
            });
            this.loginServerSocket.setNoDelay(true);
            this.loginServerSocket.setKeepAlive(true);
            this.loginServerSocket.setTimeout(30000);
        } else {
            logger.error(`Invalid initial client handshake packet id.`);
            return false;
        }

        const data = buffer.getSlice(1, buffer.length);
        const socket = this.serverType === 'login_server' ? this.loginServerSocket : this.updateServerSocket;
        socket.write(data);

        return true;
    }

    public decodeMessage(buffer: ByteBuffer): void | Promise<void> {
        if (this.serverType === 'login_server') {
            this.loginServerSocket.write(buffer);
        } else if (this.serverType === 'update_server') {
            this.updateServerSocket.write(buffer);
        } else {
            this.gameServerConnection?.decodeMessage(buffer);
        }
    }

    public connectionDestroyed(): void {
        this.loginServerSocket?.destroy();
        this.updateServerSocket?.destroy();
        this.gameServerConnection?.connectionDestroyed();
    }

    private async parseLoginServerResponse(buffer: ByteBuffer): Promise<void> {
        if (!this.serverKey) {
            // Login handshake response
            const handshakeResponseCode = buffer.get('byte');

            if (handshakeResponseCode === 0) {
                this.serverKey = BigInt(buffer.get('long'));
            }
        } else {
            // Login response
            const loginResponseCode = buffer.get('byte');

            if (loginResponseCode === LoginResponseCode.SUCCESS) {
                try {
                    const clientKey1 = buffer.get('int');
                    const clientKey2 = buffer.get('int');
                    const gameClientId = buffer.get('int');
                    const username = buffer.getString();
                    const passwordHash = buffer.getString();
                    const lowDetail = buffer.get('byte') === 1;

                    if (activeWorld.playerOnline(username)) {
                        // Player is already logged in!
                        // @TODO move to login server
                        buffer = new ByteBuffer(1);
                        buffer.put(LoginResponseCode.ALREADY_LOGGED_IN);
                    } else {
                        this.serverType = 'game_server';
                        await this.createPlayer([clientKey1, clientKey2], gameClientId, username, passwordHash, lowDetail ? 'low' : 'high');
                        return;
                    }
                } catch (e) {
                    this.gameServerConnection?.closeSocket();
                    logger.error(e);
                }
            }
        }

        // Write the login server response back to the game client
        this.clientSocket.write(buffer);
    }

    private async createPlayer(
        clientKeys: [number, number],
        gameClientId: number,
        username: string,
        passwordHash: string,
        detail: 'high' | 'low',
    ): Promise<void> {
        const sessionKey: number[] = [
            Number(clientKeys[0]),
            Number(clientKeys[1]),
            Number(this.serverKey >> BigInt(32)),
            Number(this.serverKey),
        ];

        const inCipher = new Isaac(sessionKey);

        for (let i = 0; i < 4; i++) {
            sessionKey[i] += 50;
        }

        const outCipher = new Isaac(sessionKey);

        const player = new Player(this.clientSocket, inCipher, outCipher, gameClientId, username, passwordHash, detail === 'low');

        this.gameServerConnection = new GameServerConnection(this.clientSocket, player);

        activeWorld.registerPlayer(player);

        const outputBuffer = new ByteBuffer(6);

        outputBuffer.put(LoginResponseCode.SUCCESS, 'byte');
        outputBuffer.put(player.rights.valueOf(), 'byte');
        outputBuffer.put(0, 'byte'); // account flagged
        outputBuffer.put(player.worldIndex + 1, 'short');
        outputBuffer.put(0, 'byte'); // membership status (for friends list count)
        this.clientSocket.write(outputBuffer);

        await player.init();
    }
}

type UpstreamKind = 'login' | 'update';

export function upstreamTarget(kind: UpstreamKind, host: string, port: number): { host: string; port: number } {
    if (host === '0.0.0.0' || host === '::' || host === '[::]') {
        logger.warn(`${kind} server host ${host} is a bind-all address; using 127.0.0.1 for gateway upstream connection.`);
        return { host: '127.0.0.1', port };
    }
    return { host, port };
}
