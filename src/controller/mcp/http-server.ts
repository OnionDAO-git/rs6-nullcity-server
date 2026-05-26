import http, { type Server } from 'http';
import type { AddressInfo } from 'net';
import type { ControllerHost } from '../controller-host';
import { ControllerMcpServer } from './server';

export interface ControllerMcpHttpOptions {
    port: number;
    host?: string;
    path?: string;
}

export interface StartedControllerMcpHttpServer {
    server: Server;
    url: string;
}

const DEFAULT_MCP_PATH = '/controller/mcp';

export async function startControllerMcpHttpServer(
    host: ControllerHost,
    options: ControllerMcpHttpOptions,
): Promise<StartedControllerMcpHttpServer> {
    const facade = new ControllerMcpServer(host);
    const routePath = normalizeHttpPath(options.path || DEFAULT_MCP_PATH);
    const bindHost = options.host || '127.0.0.1';
    const server = http.createServer((request, response) => {
        if (!request.url || requestPath(request) !== routePath) {
            response.writeHead(404, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'Not Found' }));
            return;
        }

        facade.handleHttp(request, response).catch(error => {
            if (!response.headersSent) {
                response.writeHead(500, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'MCP request failed' }));
                return;
            }
            if (!response.writableEnded) {
                response.end();
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, bindHost, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address() as AddressInfo;
    return {
        server,
        url: `http://${bindHost}:${address.port}${routePath}`,
    };
}

export async function closeControllerMcpHttpServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
    });
}

function requestPath(request: http.IncomingMessage): string {
    return new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`).pathname;
}

function normalizeHttpPath(value: string): string {
    if (!value.startsWith('/')) {
        return `/${value}`;
    }
    return value;
}
