import { assertProductionControllerConfig, loadControllerConfig, parseControllerArgs, sanitizedControllerConfigSummary } from './config';
import { acquireControllerLock } from './controller-lock';
import { ControllerHost } from './controller-host';
import { closeLettersHttpServer, startLettersHttpServer } from './letters/letters-http-server';
import { closeControllerMcpHttpServer, startControllerMcpHttpServer } from './mcp/http-server';
import { LettersStore } from './patron/letters-store';

async function main(): Promise<void> {
    const args = parseControllerArgs(process.argv.slice(2));
    const config = loadControllerConfig(args.configPath);
    assertProductionControllerConfig(config);
    process.stderr.write(`[controller] ${sanitizedControllerConfigSummary(config)}\n`);
    const lock = acquireControllerLock({ lockDir: config.memory.dir, controllerId: config.gateway.controllerId });
    const host = new ControllerHost(config, { once: args.once, logEnvelope: args.logEnvelope });
    let mcpHttpServer: Awaited<ReturnType<typeof startControllerMcpHttpServer>> | undefined;
    let lettersHttpServer: Awaited<ReturnType<typeof startLettersHttpServer>> | undefined;

    const shutdown = async () => {
        if (lettersHttpServer) {
            await closeLettersHttpServer(lettersHttpServer.server);
            lettersHttpServer = undefined;
        }
        if (mcpHttpServer) {
            await closeControllerMcpHttpServer(mcpHttpServer.server);
            mcpHttpServer = undefined;
        }
        await host.stop();
        lock.release();
        process.exit(0);
    };

    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());

    try {
        await host.start();
        if (args.mcpHttpPort !== undefined) {
            mcpHttpServer = await startControllerMcpHttpServer(host, {
                port: args.mcpHttpPort,
                host: args.mcpHttpHost,
                path: args.mcpHttpPath,
            });
            process.stderr.write(`[controller] MCP HTTP listening at ${mcpHttpServer.url}\n`);
        }
        if (args.lettersHttpPort !== undefined) {
            // EVENT-D2c: spin up the letters inbox HTTP server when configured.
            // LettersStore is filesystem-rooted at memory.dir — a fresh
            // instance here shares the same files PatronGateway writes to via
            // the EVENT-D1a wiring in controller-host.ts.
            // EVENT-D6: passing lettersRoot enables the /v1/wall/snapshot
            // route on the same server for the venue wall ticker.
            lettersHttpServer = await startLettersHttpServer({
                store: new LettersStore(config.memory.dir),
                port: args.lettersHttpPort,
                host: args.lettersHttpHost,
                path: args.lettersHttpPath,
                lettersRoot: config.memory.dir,
            });
            process.stderr.write(`[controller] letters HTTP listening at ${lettersHttpServer.url}\n`);
        }
    } catch (error) {
        if (lettersHttpServer) {
            await closeLettersHttpServer(lettersHttpServer.server).catch(closeError => {
                process.stderr.write(`[controller] letters HTTP close failed after startup error: ${errorMessage(closeError)}\n`);
            });
            lettersHttpServer = undefined;
        }
        if (mcpHttpServer) {
            await closeControllerMcpHttpServer(mcpHttpServer.server).catch(closeError => {
                process.stderr.write(`[controller] MCP HTTP close failed after startup error: ${errorMessage(closeError)}\n`);
            });
            mcpHttpServer = undefined;
        }
        await host.stop().catch(stopError => {
            process.stderr.write(`[controller] stop failed after startup error: ${errorMessage(stopError)}\n`);
        });
        lock.release();
        throw error;
    }

    if (args.once) {
        if (lettersHttpServer) {
            await closeLettersHttpServer(lettersHttpServer.server);
            lettersHttpServer = undefined;
        }
        if (mcpHttpServer) {
            await closeControllerMcpHttpServer(mcpHttpServer.server);
            mcpHttpServer = undefined;
        }
        await host.stop();
        lock.release();
    }
}

main().catch(error => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`[controller] ${message}\n`);
    process.exitCode = 1;
});

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.stack || error.message : String(error);
}
