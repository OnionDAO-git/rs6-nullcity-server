import { closeCityIntegrationHttpServer, startCityIntegrationHttpServer } from './city-integration/http-server';
import { CityIntegrationService } from './city-integration/service';
import { assertProductionControllerConfig, loadControllerConfig, parseControllerArgs, sanitizedControllerConfigSummary } from './config';
import { ControllerHost } from './controller-host';
import { acquireControllerLock } from './controller-lock';
import { closeLettersHttpServer, DEFAULT_HEALTH_TIMEOUT_MS, startLettersHttpServer } from './letters/letters-http-server';
import { runInferenceHealthProbe } from './llm/inference-health';
import { LlmClient } from './llm/llm-client';
import { closeControllerMcpHttpServer, startControllerMcpHttpServer } from './mcp/http-server';
import { LettersStore } from './patron/letters-store';

async function main(): Promise<void> {
    const args = parseControllerArgs(process.argv.slice(2));
    const config = loadControllerConfig(args.configPath);
    assertProductionControllerConfig(config);
    process.stderr.write(`[controller] ${sanitizedControllerConfigSummary(config)}\n`);
    const lock = acquireControllerLock({ lockDir: config.memory.dir, controllerId: config.gateway.controllerId });
    const llm = new LlmClient(config.llm.endpoints, config.inference.maxConcurrent);
    const host = new ControllerHost(config, { once: args.once, logEnvelope: args.logEnvelope, llm });
    let mcpHttpServer: Awaited<ReturnType<typeof startControllerMcpHttpServer>> | undefined;
    let lettersHttpServer: Awaited<ReturnType<typeof startLettersHttpServer>> | undefined;
    let cityHttpServer: Awaited<ReturnType<typeof startCityIntegrationHttpServer>> | undefined;

    const shutdown = async () => {
        if (cityHttpServer) {
            await closeCityIntegrationHttpServer(cityHttpServer.server);
            cityHttpServer = undefined;
        }
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
                residentIds: config.residents,
                soulsDir: config.souls.dir,
                wallRedact: args.lettersHttpWallRedact,
                health: () => runInferenceHealthProbe({ endpoints: config.llm.endpoints, timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS }),
                healthTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
                patronMemoryRoot: config.memory.dir,
            });
            process.stderr.write(`[controller] letters HTTP listening at ${lettersHttpServer.url}\n`);
        }
        if (args.cityHttpPort !== undefined) {
            if (!args.cityHttpToken) {
                throw new Error('CONTROLLER_CITY_HTTP_TOKEN is required when --city-http-port is set');
            }
            const cityService = new CityIntegrationService({
                memoryRoot: config.memory.dir,
                getRuntime: resident => host.getRuntime(resident),
                inventory: {
                    inspectResidentGold: resident => host.inspectResidentGold(resident),
                    burnResidentGold: (resident, amount) => host.burnResidentGold(resident, amount),
                },
                birth: {
                    birthResident: input => host.birthResidentFromCity(input),
                },
                // S-HOST-WIRE: share the host's EconomyEventLog so AP/GP/NCRI
                // events from the city HTTP surface land in the same
                // append-only stream that future per-resident ApLedger
                // emitters will use (see ControllerHost.getEconomyEventLog).
                economyEventLog: host.getEconomyEventLog(),
            });
            cityHttpServer = await startCityIntegrationHttpServer({
                service: cityService,
                port: args.cityHttpPort,
                host: args.cityHttpHost,
                pathPrefix: args.cityHttpPathPrefix,
                bearerToken: args.cityHttpToken,
                enableEconomyStream: readEnvBoolean(process.env.CONTROLLER_CITY_ECONOMY_STREAM, false),
                economyStreamIntervalMs: readOptionalPositiveInt(process.env.CONTROLLER_CITY_ECONOMY_STREAM_INTERVAL_MS),
            });
            process.stderr.write(`[controller] city integration HTTP listening at ${cityHttpServer.url}\n`);
        }
    } catch (error) {
        if (cityHttpServer) {
            await closeCityIntegrationHttpServer(cityHttpServer.server).catch(closeError => {
                process.stderr.write(`[controller] city integration HTTP close failed after startup error: ${errorMessage(closeError)}\n`);
            });
            cityHttpServer = undefined;
        }
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
        if (cityHttpServer) {
            await closeCityIntegrationHttpServer(cityHttpServer.server);
            cityHttpServer = undefined;
        }
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

function readEnvBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function readOptionalPositiveInt(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
