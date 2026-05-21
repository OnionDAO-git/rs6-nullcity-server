import { assertProductionControllerConfig, loadControllerConfig, parseControllerArgs, sanitizedControllerConfigSummary } from './config';
import { acquireControllerLock } from './controller-lock';
import { ControllerHost } from './controller-host';

async function main(): Promise<void> {
    const args = parseControllerArgs(process.argv.slice(2));
    const config = loadControllerConfig(args.configPath);
    assertProductionControllerConfig(config);
    process.stderr.write(`[controller] ${sanitizedControllerConfigSummary(config)}\n`);
    const lock = acquireControllerLock({ lockDir: config.memory.dir, controllerId: config.gateway.controllerId });
    const host = new ControllerHost(config, { once: args.once, logEnvelope: args.logEnvelope });

    const shutdown = async () => {
        await host.stop();
        lock.release();
        process.exit(0);
    };

    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());

    try {
        await host.start();
    } catch (error) {
        lock.release();
        throw error;
    }

    if (args.once) {
        await host.stop();
        lock.release();
    }
}

main().catch(error => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`[controller] ${message}\n`);
    process.exitCode = 1;
});
